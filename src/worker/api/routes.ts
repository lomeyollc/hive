import { requireSession } from "../auth/session";
import type {
  Comment as DoComment,
  CreateCommentInput,
  CreateTaskInput as DoCreateTaskInput,
  ListTasksFilter,
  RecurrenceInterval,
  Task as DoTask,
  TaskPriority,
  TaskStatus,
  UpdateTaskInput as DoUpdateTaskInput,
} from "../durable-objects/types";
import { NotFoundError, ValidationError } from "../durable-objects/types";

/**
 * Handles every `/api/*` request — the REST surface behind the React
 * dashboard (`src/frontend/lib/api.ts` is the client this was written
 * against field-for-field). Session-gated throughout: this is the human's
 * dashboard, not the agent surface (that's `/mcp`, Bearer-token authed).
 *
 * Every task/comment operation calls the target board's BoardDO directly
 * over Workers RPC (`env.BOARD_DO.getByName(slug)`) — per BoardDO's own
 * doc comment, RPC is the interface the REST API and MCP layers should
 * prefer over its fetch() HTTP mirror. `env.BOARD_DO` here is already
 * strongly typed to the real `BoardDO` class (see
 * worker-configuration.d.ts), so unlike the MCP layer there's no separate
 * hand-maintained stub interface to drift out of sync with it.
 *
 * D1 (`env.DB`) is only ever read/written here for the `boards` /
 * `tasks_index` tables (board listing, task counts) — never for task or
 * comment state, which always lives in and comes from the owning BoardDO.
 *
 * The wire format is snake_case (id, board_id, due_date, created_at, ...)
 * to match `src/frontend/lib/types.ts`; BoardDO's RPC surface is camelCase
 * (see `../durable-objects/types.ts`) so every response is mapped at the
 * edge here, once, via `taskToWire` / `commentToWire`.
 *
 * Routes:
 *   GET    /api/needs-human                      -> { count, items: [...] }
 *          Cross-board (scoped to the caller's active workspace memberships)
 *          — every task currently flagged needs_human, oldest first.
 *          Powers the nav badge AND the /needs-you page; the same signal
 *          that drives the Telegram ping/digest (BoardDO.#notifyNeedsHuman,
 *          index.ts scheduled()), read back for in-app visibility.
 *   GET    /api/invites/:token                   PUBLIC — no session required
 *          (an invited user hasn't logged in yet). -> { workspace_name, email, status }
 *   POST   /api/invites/:token/accept             session-gated. The session
 *          email must match the invite's email (case-insensitive) — activates
 *          the membership. -> { workspace }
 *   GET    /api/workspaces                       -> { workspaces: Workspace[] }
 *          Only workspaces the caller is an ACTIVE member of.
 *   POST   /api/workspaces        { id, name }    -> { workspace } (201)
 *          Creator becomes an active 'owner' member automatically.
 *   PATCH  /api/workspaces/:id    { name }        -> { workspace }
 *   GET    /api/workspaces/:id/members            -> { members: Member[] }
 *   POST   /api/workspaces/:id/invites { email }   -> { invite_url } (201)
 *          Creates an 'invited' member row + token. No email is sent — the
 *          caller is responsible for handing the URL to the invitee.
 *   GET    /api/activity  ?board=&type=&since=&limit=
 *          -> { items: [...] }
 *          Cross-board (workspace-scoped) event log — task created/updated/
 *          claimed/deleted, comment added. Written by BoardDO alongside its
 *          existing D1 sync (activity_log table, migrations/0004). `since`
 *          is an ISO timestamp; `limit` defaults to 50, capped at 200.
 *   GET    /api/search  ?q=
 *          -> { tasks: [...], comments: [...] }
 *          Cross-board (workspace-scoped) substring search over task
 *          title/description and comment body. Reads tasks_index and the
 *          new comments_index mirror — never opens a Durable Object.
 *   GET    /api/boards                          -> { boards: Board[] }
 *          Scoped to workspaces the caller is an active member of.
 *   POST   /api/boards            { id, name, description?, workspace_id }
 *                                                -> { board: Board } (201)
 *          workspace_id is required; caller must be an active member of it.
 *   GET    /api/boards/:slug                     -> { board: Board }
 *   PATCH  /api/boards/:slug      { name?, description? }
 *                                                -> { board: Board }
 *   DELETE /api/boards/:slug                     -> { ok: true }
 *          Removes the board's D1 record/index only (see deleteBoard's own
 *          comment for why its Durable Object is left alone).
 *   GET    /api/boards/:slug/tasks  ?status=&assignee=
 *                                                -> { tasks: Task[] }
 *   POST   /api/boards/:slug/tasks  CreateTaskInput (snake_case)
 *                                                -> { task: Task } (201)
 *   PATCH  /api/boards/:slug/tasks/:id  Partial<Task> (snake_case)
 *                                                -> { task: Task }
 *   DELETE /api/boards/:slug/tasks/:id           -> { ok: true }
 *   POST   /api/boards/:slug/tasks/:id/claim     -> { task: Task }
 *          Claims this SPECIFIC task for the signed-in human (sets
 *          claimed_by to their email, status to in_progress) — distinct
 *          from BoardDO's claimNextTask/MCP's claim_next_task, which picks
 *          *a* matching task rather than a task the caller already chose
 *          by id. Implemented as a plain updateTask() patch; BoardDO needs
 *          no new method for it.
 *   GET    /api/boards/:slug/tasks/:id/comments  -> { comments: Comment[] }
 *   POST   /api/boards/:slug/tasks/:id/comments  { body: string }
 *                                                -> { comment: Comment } (201)
 *
 */
export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean); // "/api/boards/:slug/tasks" -> ["api","boards",":slug","tasks"]

  try {
    // /api/invites/:token — PUBLIC, checked before the session gate below:
    // an invited user hasn't logged in yet, so they can't have a session.
    if (parts.length === 3 && parts[1] === "invites" && request.method === "GET") {
      return await getInvite(env, parts[2]);
    }

    const session = await requireSession(request, env);
    if (!session) {
      return json({ error: "Not authenticated" }, 401);
    }

    // /api/invites/:token/accept
    if (parts.length === 4 && parts[1] === "invites" && parts[3] === "accept" && request.method === "POST") {
      return await acceptInvite(env, parts[2], session.email);
    }

    // /api/needs-human — cross-board, powers the nav badge ("what's stuck on me")
    if (parts.length === 2 && parts[1] === "needs-human" && request.method === "GET") {
      return await listNeedsHuman(env, session.email);
    }

    // /api/activity — cross-board event feed. ?board=&type=&since=&limit=
    if (parts.length === 2 && parts[1] === "activity" && request.method === "GET") {
      return await listActivity(env, session.email, url.searchParams);
    }

    // /api/search — cross-board task + comment search. ?q=
    if (parts.length === 2 && parts[1] === "search" && request.method === "GET") {
      return await searchWorkspace(env, session.email, url.searchParams);
    }

    // /api/workspaces
    if (parts.length === 2 && parts[1] === "workspaces") {
      if (request.method === "GET") return await listWorkspaces(env, session.email);
      if (request.method === "POST") return await createWorkspace(request, env, session.email);
    }

    // /api/workspaces/:id
    if (parts.length === 3 && parts[1] === "workspaces" && request.method === "PATCH") {
      return await updateWorkspace(request, env, parts[2], session.email);
    }

    // /api/workspaces/:id/members
    if (parts.length === 4 && parts[1] === "workspaces" && parts[3] === "members" && request.method === "GET") {
      return await listMembers(env, parts[2], session.email);
    }

    // /api/workspaces/:id/invites
    if (parts.length === 4 && parts[1] === "workspaces" && parts[3] === "invites" && request.method === "POST") {
      return await createInvite(request, env, parts[2], session.email);
    }

    // /api/boards
    if (parts.length === 2 && parts[1] === "boards") {
      if (request.method === "GET") return await listBoards(env, session.email);
      if (request.method === "POST") return await createBoard(request, env, session.email);
    }

    // /api/boards/:slug
    if (parts.length === 3 && parts[1] === "boards") {
      if (request.method === "GET") return await getBoard(env, parts[2], session.email);
      if (request.method === "PATCH") return await updateBoard(request, env, parts[2]);
      if (request.method === "DELETE") return await deleteBoard(env, parts[2]);
    }

    // /api/boards/:slug/tasks
    if (parts.length === 4 && parts[1] === "boards" && parts[3] === "tasks") {
      const slug = parts[2];
      if (request.method === "GET") return await listTasks(env, slug, url.searchParams);
      if (request.method === "POST") return await createTask(request, env, slug);
    }

    // /api/boards/:slug/tasks/:id
    if (parts.length === 5 && parts[1] === "boards" && parts[3] === "tasks") {
      const [, , slug, , taskId] = parts;
      if (request.method === "PATCH") return await updateTask(request, env, slug, taskId);
      if (request.method === "DELETE") return await deleteTask(env, slug, taskId);
    }

    // /api/boards/:slug/tasks/:id/claim
    if (parts.length === 6 && parts[1] === "boards" && parts[3] === "tasks" && parts[5] === "claim") {
      const [, , slug, , taskId] = parts;
      if (request.method === "POST") return await claimTask(env, slug, taskId, session.email);
    }

    // /api/boards/:slug/tasks/:id/comments
    if (parts.length === 6 && parts[1] === "boards" && parts[3] === "tasks" && parts[5] === "comments") {
      const [, , slug, , taskId] = parts;
      if (request.method === "GET") return await listComments(env, slug, taskId);
      if (request.method === "POST") return await createComment(request, env, slug, taskId, session.email);
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return json({ error: error.message }, 404);
    }
    if (error instanceof ValidationError) {
      return json({ error: error.message }, 400);
    }
    console.error("API error:", error);
    return json({ error: "Internal error" }, 500);
  }
}

async function listNeedsHuman(env: Env, email: string): Promise<Response> {
  // Scoped to workspaces the caller is an active member of — same rule as
  // listBoards. Without this join, needs-human would leak titles/reasons
  // from boards in workspaces the caller isn't in.
  const { results } = await env.DB.prepare(
    `SELECT t.id, t.board_id, b.name AS board_name, t.title, t.priority, t.needs_human_reason, t.updated_at
     FROM tasks_index t
     JOIN boards b ON b.id = t.board_id
     JOIN workspace_members m ON m.workspace_id = b.workspace_id
     WHERE t.needs_human = 1 AND m.email = ? AND m.status = 'active'
     ORDER BY t.updated_at ASC`,
  )
    .bind(email)
    .all<{
      id: string;
      board_id: string;
      board_name: string;
      title: string;
      priority: TaskPriority;
      needs_human_reason: string | null;
      updated_at: string;
    }>();

  const items = (results ?? []).map((r) => ({
    id: r.id,
    board_id: r.board_id,
    board_name: r.board_name,
    title: r.title,
    priority: r.priority,
    needs_human_reason: r.needs_human_reason,
    updated_at: r.updated_at,
  }));
  return json({ count: items.length, items });
}

async function listActivity(env: Env, email: string, params: URLSearchParams): Promise<Response> {
  const board = params.get("board");
  const type = params.get("type");
  const since = params.get("since");
  const limit = Math.min(Number(params.get("limit")) || 50, 200);

  const clauses = ["m.email = ?", "m.status = 'active'"];
  const binds: (string | number)[] = [email];
  if (board) {
    clauses.push("a.board_id = ?");
    binds.push(board);
  }
  if (type) {
    clauses.push("a.type = ?");
    binds.push(type);
  }
  if (since) {
    clauses.push("a.created_at > ?");
    binds.push(since);
  }
  binds.push(limit);

  const { results } = await env.DB.prepare(
    `SELECT a.id, a.board_id, b.name AS board_name, a.task_id, a.type, a.actor, a.summary, a.created_at
     FROM activity_log a
     JOIN boards b ON b.id = a.board_id
     JOIN workspace_members m ON m.workspace_id = a.workspace_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY a.created_at DESC
     LIMIT ?`,
  )
    .bind(...binds)
    .all<{
      id: string;
      board_id: string;
      board_name: string;
      task_id: string | null;
      type: string;
      actor: string | null;
      summary: string;
      created_at: string;
    }>();

  return json({ items: results ?? [] });
}

async function searchWorkspace(env: Env, email: string, params: URLSearchParams): Promise<Response> {
  const q = params.get("q")?.trim();
  if (!q) {
    return json({ tasks: [], comments: [] });
  }
  const like = `%${q}%`;

  const [taskRows, commentRows] = await Promise.all([
    env.DB.prepare(
      `SELECT t.id, t.board_id, b.name AS board_name, t.title, t.status, t.priority, t.updated_at
       FROM tasks_index t
       JOIN boards b ON b.id = t.board_id
       JOIN workspace_members m ON m.workspace_id = b.workspace_id
       WHERE m.email = ? AND m.status = 'active' AND (t.title LIKE ? OR t.description LIKE ?)
       ORDER BY t.updated_at DESC LIMIT 50`,
    )
      .bind(email, like, like)
      .all<{
        id: string;
        board_id: string;
        board_name: string;
        title: string;
        status: TaskStatus;
        priority: TaskPriority;
        updated_at: string;
      }>(),
    env.DB.prepare(
      `SELECT c.id, c.board_id, b.name AS board_name, c.task_id, c.author, c.body, c.created_at
       FROM comments_index c
       JOIN boards b ON b.id = c.board_id
       JOIN workspace_members m ON m.workspace_id = b.workspace_id
       WHERE m.email = ? AND m.status = 'active' AND c.body LIKE ?
       ORDER BY c.created_at DESC LIMIT 50`,
    )
      .bind(email, like)
      .all<{
        id: string;
        board_id: string;
        board_name: string;
        task_id: string;
        author: string | null;
        body: string;
        created_at: string;
      }>(),
  ]);

  return json({ tasks: taskRows.results ?? [], comments: commentRows.results ?? [] });
}

// ── Workspaces (D1) ───────────────────────────────────────────────────────
//
// A workspace is the multi-tenant boundary: boards belong to exactly one
// workspace, and a caller only sees/acts on a board if they're an ACTIVE
// workspace_members row for its workspace. Invitations are membership rows
// with status 'invited' and a token; accepting flips them to 'active'. No
// email is ever sent — the invite URL is returned to the caller (a human,
// session-gated) to hand to the invitee by whatever channel they like.

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
}

async function isActiveMember(env: Env, workspaceId: string, email: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 FROM workspace_members WHERE workspace_id = ? AND email = ? AND status = 'active' LIMIT 1`,
  )
    .bind(workspaceId, email)
    .first();
  return row !== null;
}

async function listWorkspaces(env: Env, email: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, w.created_at FROM workspaces w
     JOIN workspace_members m ON m.workspace_id = w.id
     WHERE m.email = ? AND m.status = 'active'
     ORDER BY w.name ASC`,
  )
    .bind(email)
    .all<WorkspaceRow>();
  return json({ workspaces: results ?? [] });
}

async function createWorkspace(request: Request, env: Env, email: string): Promise<Response> {
  const body = await readJson<{ id?: string; name?: string }>(request);
  const id = body.id?.trim();
  const name = body.name?.trim();
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    throw new ValidationError("id is required and must be lowercase letters, numbers, and hyphens only");
  }
  if (!name) {
    throw new ValidationError("name is required");
  }

  const now = new Date().toISOString();
  try {
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO workspaces (id, name, created_at) VALUES (?, ?, ?)`).bind(id, name, now),
      env.DB.prepare(
        `INSERT INTO workspace_members (id, workspace_id, email, role, status, invited_by, invited_at, accepted_at)
         VALUES (?, ?, ?, 'owner', 'active', ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, email, email, now, now),
    ]);
  } catch (error) {
    throw new ValidationError(`could not create workspace "${id}" (does it already exist?): ${(error as Error).message}`);
  }

  return json({ workspace: { id, name, created_at: now } }, 201);
}

async function updateWorkspace(request: Request, env: Env, workspaceId: string, email: string): Promise<Response> {
  if (!(await isActiveMember(env, workspaceId, email))) {
    throw new NotFoundError(`workspace "${workspaceId}" not found`);
  }
  const body = await readJson<{ name?: string }>(request);
  const name = body.name?.trim();
  if (!name) {
    throw new ValidationError("name is required");
  }

  await env.DB.prepare(`UPDATE workspaces SET name = ? WHERE id = ?`).bind(name, workspaceId).run();

  const row = await env.DB.prepare(`SELECT id, name, created_at FROM workspaces WHERE id = ?`)
    .bind(workspaceId)
    .first<WorkspaceRow>();
  return json({ workspace: row });
}

async function listMembers(env: Env, workspaceId: string, email: string): Promise<Response> {
  if (!(await isActiveMember(env, workspaceId, email))) {
    throw new NotFoundError(`workspace "${workspaceId}" not found`);
  }
  const { results } = await env.DB.prepare(
    `SELECT id, email, role, status, invited_by, invited_at, accepted_at, invite_token
     FROM workspace_members WHERE workspace_id = ? ORDER BY invited_at ASC`,
  )
    .bind(workspaceId)
    .all<{
      id: string;
      email: string;
      role: string;
      status: string;
      invited_by: string | null;
      invited_at: string;
      accepted_at: string | null;
      invite_token: string | null;
    }>();

  const members = (results ?? []).map((m) => ({
    id: m.id,
    email: m.email,
    role: m.role,
    status: m.status,
    invited_by: m.invited_by,
    invited_at: m.invited_at,
    accepted_at: m.accepted_at,
    // Only surface the invite link for members still pending — an already
    // active member's token is spent and shouldn't be re-shown as live.
    invite_url: m.status === "invited" && m.invite_token ? `${env.APP_URL ?? ""}/invites/${m.invite_token}` : null,
  }));
  return json({ members });
}

async function createInvite(request: Request, env: Env, workspaceId: string, email: string): Promise<Response> {
  if (!(await isActiveMember(env, workspaceId, email))) {
    throw new NotFoundError(`workspace "${workspaceId}" not found`);
  }
  const body = await readJson<{ email?: string }>(request);
  const inviteEmail = body.email?.trim().toLowerCase();
  if (!inviteEmail || !inviteEmail.includes("@")) {
    throw new ValidationError("a valid email is required");
  }

  const token = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO workspace_members (id, workspace_id, email, role, status, invite_token, invited_by, invited_at)
     VALUES (?, ?, ?, 'member', 'invited', ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), workspaceId, inviteEmail, token, email, now)
    .run();

  return json({ invite_url: `${env.APP_URL ?? ""}/invites/${token}` }, 201);
}

async function getInvite(env: Env, token: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT m.email, m.status, w.name AS workspace_name
     FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.invite_token = ?`,
  )
    .bind(token)
    .first<{ email: string; status: string; workspace_name: string }>();
  if (!row) {
    throw new NotFoundError("invite not found — it may have already been used or the link is wrong");
  }
  return json({ email: row.email, status: row.status, workspace_name: row.workspace_name });
}

async function acceptInvite(env: Env, token: string, sessionEmail: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT m.id, m.email, m.workspace_id, m.status, w.name AS workspace_name
     FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
     WHERE m.invite_token = ?`,
  )
    .bind(token)
    .first<{ id: string; email: string; workspace_id: string; status: string; workspace_name: string }>();
  if (!row) {
    throw new NotFoundError("invite not found — it may have already been used or the link is wrong");
  }
  if (row.email !== sessionEmail) {
    throw new ValidationError(`this invite was sent to ${row.email} — signed in as ${sessionEmail}`);
  }

  if (row.status !== "active") {
    await env.DB.prepare(`UPDATE workspace_members SET status = 'active', accepted_at = ? WHERE id = ?`)
      .bind(new Date().toISOString(), row.id)
      .run();
  }

  return json({ workspace: { id: row.workspace_id, name: row.workspace_name } });
}

// ── Boards (D1) ────────────────────────────────────────────────────────

interface BoardRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  workspace_id: string | null;
}

async function listBoards(env: Env, email: string): Promise<Response> {
  const [{ results: boardRows }, { results: countRows }] = await Promise.all([
    env.DB.prepare(
      `SELECT b.id, b.name, b.description, b.created_at, b.workspace_id FROM boards b
       JOIN workspace_members m ON m.workspace_id = b.workspace_id
       WHERE m.email = ? AND m.status = 'active'
       ORDER BY b.name ASC`,
    )
      .bind(email)
      .all<BoardRow>(),
    env.DB.prepare(`SELECT board_id, status, COUNT(*) AS count FROM tasks_index GROUP BY board_id, status`).all<{
      board_id: string;
      status: TaskStatus;
      count: number;
    }>(),
  ]);

  const countsByBoard = new Map<string, Record<TaskStatus, number>>();
  for (const row of countRows ?? []) {
    const counts = countsByBoard.get(row.board_id) ?? { planned: 0, open: 0, in_progress: 0, blocked: 0, done: 0 };
    counts[row.status] = row.count;
    countsByBoard.set(row.board_id, counts);
  }

  const boards = (boardRows ?? []).map((row) => boardToWire(row, countsByBoard.get(row.id)));
  return json({ boards });
}

async function getBoard(env: Env, slug: string, email: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT id, name, description, created_at, workspace_id FROM boards WHERE id = ?`,
  )
    .bind(slug)
    .first<BoardRow>();
  if (!row || !row.workspace_id || !(await isActiveMember(env, row.workspace_id, email))) {
    throw new NotFoundError(`board "${slug}" not found`);
  }

  const { results: countRows } = await env.DB.prepare(
    `SELECT status, COUNT(*) AS count FROM tasks_index WHERE board_id = ? GROUP BY status`,
  )
    .bind(slug)
    .all<{ status: TaskStatus; count: number }>();

  const counts: Record<TaskStatus, number> = { planned: 0, open: 0, in_progress: 0, blocked: 0, done: 0 };
  for (const row2 of countRows ?? []) counts[row2.status] = row2.count;

  return json({ board: boardToWire(row, counts) });
}

async function createBoard(request: Request, env: Env, email: string): Promise<Response> {
  const body = await readJson<{ id?: string; name?: string; description?: string; workspace_id?: string }>(request);
  const id = body.id?.trim();
  const name = body.name?.trim();
  const workspaceId = body.workspace_id?.trim();
  if (!id || !/^[a-z0-9-]+$/.test(id)) {
    throw new ValidationError("id is required and must be lowercase letters, numbers, and hyphens only");
  }
  if (!name) {
    throw new ValidationError("name is required");
  }
  if (!workspaceId) {
    throw new ValidationError("workspace_id is required");
  }
  if (!(await isActiveMember(env, workspaceId, email))) {
    throw new ValidationError(`not a member of workspace "${workspaceId}"`);
  }

  const createdAt = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO boards (id, name, description, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(id, name, body.description?.trim() || null, createdAt, workspaceId)
      .run();
  } catch (error) {
    // D1's unique constraint on the primary key is the only realistic way
    // this insert fails validation-wise; surface it as 400 rather than 500.
    throw new ValidationError(`could not create board "${id}" (does it already exist?): ${(error as Error).message}`);
  }

  return json(
    {
      board: boardToWire({
        id,
        name,
        description: body.description ?? null,
        created_at: createdAt,
        workspace_id: workspaceId,
      }),
    },
    201,
  );
}

async function updateBoard(request: Request, env: Env, slug: string): Promise<Response> {
  const body = await readJson<{ name?: string; description?: string }>(request);
  const existing = await env.DB.prepare(
    `SELECT id, name, description, created_at, workspace_id FROM boards WHERE id = ?`,
  )
    .bind(slug)
    .first<BoardRow>();
  if (!existing) {
    throw new NotFoundError(`board "${slug}" not found`);
  }

  const name = body.name?.trim();
  if (name !== undefined && !name) {
    throw new ValidationError("name cannot be empty");
  }

  await env.DB.prepare(`UPDATE boards SET name = COALESCE(?, name), description = ? WHERE id = ?`)
    .bind(name ?? null, body.description !== undefined ? body.description.trim() || null : existing.description, slug)
    .run();

  return json({
    board: boardToWire({
      id: existing.id,
      name: name ?? existing.name,
      description: body.description !== undefined ? body.description.trim() || null : existing.description,
      created_at: existing.created_at,
      workspace_id: existing.workspace_id,
    }),
  });
}

async function deleteBoard(env: Env, slug: string): Promise<Response> {
  const existing = await env.DB.prepare(`SELECT id FROM boards WHERE id = ?`).bind(slug).first<{ id: string }>();
  if (!existing) {
    throw new NotFoundError(`board "${slug}" not found`);
  }

  // Deletes the board's D1 record and index rows. The board's Durable
  // Object (its tasks/comments) is left in place — Cloudflare has no API to
  // destroy a DO instance, and an unreferenced DO costs nothing at rest.
  // Re-creating a board with the same id later would see that DO's old
  // tasks reappear; that's an accepted v1 tradeoff, documented in the
  // README rather than solved with a wipe-on-delete RPC call.
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM tasks_index WHERE board_id = ?`).bind(slug),
    env.DB.prepare(`DELETE FROM boards WHERE id = ?`).bind(slug),
  ]);

  return json({ ok: true });
}

function boardToWire(row: BoardRow, counts?: Record<TaskStatus, number>) {
  return {
    id: row.id,
    slug: row.id,
    name: row.name,
    description: row.description,
    created_at: row.created_at,
    workspace_id: row.workspace_id,
    task_counts: counts,
  };
}

// ── Tasks (BoardDO RPC) ──────────────────────────────────────────────────

async function listTasks(env: Env, slug: string, params: URLSearchParams): Promise<Response> {
  const filter: ListTasksFilter = {
    status: (params.get("status") as TaskStatus) ?? undefined,
    assignee: params.get("assignee") ?? undefined,
    label: params.get("label") ?? undefined,
    parentTaskId: params.get("parent_task_id") ?? undefined,
  };
  const tasks = await env.BOARD_DO.getByName(slug).listTasks(filter);
  return json({ tasks: tasks.map(taskToWire) });
}

async function createTask(request: Request, env: Env, slug: string): Promise<Response> {
  const body = await readJson<WireCreateTaskInput>(request);
  if (!body.title?.trim()) {
    throw new ValidationError("title is required");
  }

  const input: DoCreateTaskInput = {
    title: body.title,
    description: body.description ?? null,
    status: body.status,
    priority: body.priority,
    assignee: body.assignee ?? null,
    labels: body.labels,
    dueDate: body.due_date ?? null,
    needsHuman: body.needs_human,
    needsHumanReason: body.needs_human_reason ?? null,
    parentTaskId: body.parent_task_id ?? null,
    recurrence: body.recurrence ?? null,
  };
  const task = await env.BOARD_DO.getByName(slug).createTask(input);
  return json({ task: taskToWire(task) }, 201);
}

async function updateTask(request: Request, env: Env, slug: string, taskId: string): Promise<Response> {
  const body = await readJson<WireUpdateTaskInput>(request);
  const patch: DoUpdateTaskInput = {
    title: body.title,
    description: body.description,
    status: body.status,
    priority: body.priority,
    assignee: body.assignee,
    labels: body.labels,
    dueDate: body.due_date,
    needsHuman: body.needs_human,
    needsHumanReason: body.needs_human_reason,
    parentTaskId: body.parent_task_id,
    recurrence: body.recurrence,
  };
  const task = await env.BOARD_DO.getByName(slug).updateTask(taskId, patch);
  return json({ task: taskToWire(task) });
}

async function deleteTask(env: Env, slug: string, taskId: string): Promise<Response> {
  await env.BOARD_DO.getByName(slug).deleteTask(taskId);
  await env.DB.prepare(`DELETE FROM tasks_index WHERE id = ?`).bind(taskId).run();
  return json({ ok: true });
}

async function claimTask(env: Env, slug: string, taskId: string, claimedBy: string): Promise<Response> {
  const task = await env.BOARD_DO.getByName(slug).updateTask(taskId, {
    claimedBy,
    status: "in_progress",
  });
  return json({ task: taskToWire(task) });
}

function taskToWire(task: DoTask) {
  return {
    id: task.id,
    board_id: task.boardId,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignee: task.assignee,
    labels: task.labels,
    due_date: task.dueDate,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    created_by: task.createdBy,
    claimed_by: task.claimedBy,
    version: task.version,
    needs_human: task.needsHuman,
    needs_human_reason: task.needsHumanReason,
    parent_task_id: task.parentTaskId,
    recurrence: task.recurrence,
  };
}

interface WireCreateTaskInput {
  title: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  labels?: string[];
  due_date?: string;
  needs_human?: boolean;
  needs_human_reason?: string;
  parent_task_id?: string;
  recurrence?: RecurrenceInterval;
}

interface WireUpdateTaskInput {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string;
  labels?: string[];
  due_date?: string;
  needs_human?: boolean;
  needs_human_reason?: string;
  parent_task_id?: string | null;
  recurrence?: RecurrenceInterval | null;
}

// ── Comments (BoardDO RPC) ────────────────────────────────────────────────

async function listComments(env: Env, slug: string, taskId: string): Promise<Response> {
  const comments = await env.BOARD_DO.getByName(slug).listComments(taskId);
  return json({ comments: comments.map(commentToWire) });
}

async function createComment(request: Request, env: Env, slug: string, taskId: string, author: string): Promise<Response> {
  const body = await readJson<{ body?: string }>(request);
  if (!body.body?.trim()) {
    throw new ValidationError("body is required");
  }
  const input: CreateCommentInput = { author, body: body.body };
  const comment = await env.BOARD_DO.getByName(slug).commentTask(taskId, input);
  return json({ comment: commentToWire(comment) }, 201);
}

function commentToWire(comment: DoComment) {
  return {
    id: comment.id,
    task_id: comment.taskId,
    author: comment.author,
    body: comment.body,
    created_at: comment.createdAt,
  };
}

// ── helpers ────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("request body must be valid JSON");
  }
}
