/**
 * Single API client file — every fetch call the frontend makes lives here,
 * on purpose, so reconciling exact paths/shapes with the backend agent's
 * implementation (src/worker/api, src/worker/auth) is a one-file change.
 *
 * Contract:
 *
 *   Auth — VERIFIED live against src/worker/auth/routes.ts (implemented
 *   concurrently by another agent during this build; confirmed by reading
 *   its source, not guessed):
 *     POST   /auth/google/callback   { credential: string }        -> { email: string }
 *     GET    /auth/session                                          -> { email: string } | 401 { error }
 *     POST   /auth/logout                                           -> 200 { ok: true }
 *     GET    /auth/tokens                                           -> { tokens: ApiToken[] }  (label, not name)
 *     POST   /auth/tokens            { label?: string }             -> CreatedApiToken (id, token, label, created_at)
 *     DELETE /auth/tokens/:id                                       -> 200 { ok: true } | 404 { error }
 *
 *   Boards / tasks / comments — STILL A GUESS. src/worker/index.ts has
 *   /api/* stubbed at 501 as of this build; reconcile against the real
 *   REST routes once implemented.
 *     GET    /api/boards                                            -> { boards: Board[] }
 *     GET    /api/boards/:slug                                      -> { board: Board }
 *     GET    /api/boards/:slug/tasks       ?status=&assignee=       -> { tasks: Task[] }
 *     POST   /api/boards/:slug/tasks       CreateTaskInput          -> { task: Task }
 *     PATCH  /api/boards/:slug/tasks/:id   Partial<Task>            -> { task: Task }
 *     POST   /api/boards/:slug/tasks/:id/claim                      -> { task: Task }
 *     GET    /api/boards/:slug/tasks/:id/comments                   -> { comments: Comment[] }
 *     POST   /api/boards/:slug/tasks/:id/comments  { body: string } -> { comment: Comment }
 *
 *   Realtime
 *     WS     /ws/boards/:slug  -> BoardSocketMessage JSON frames, see lib/types.ts
 *
 * TODO(integration): the auth agent's /auth/google/callback route may expect
 * a different field name than `credential` (that's the field GIS's callback
 * gives us) or return a different shape than { user }. Reconcile against the
 * real route in src/worker/auth once it lands — this file is the only place
 * that needs to change.
 *
 * Session auth uses an httpOnly cookie, so every call passes
 * `credentials: "include"`. No Bearer token handling here — that's the
 * agent/MCP auth path, not the browser's.
 */
import type {
  AllWorkTask,
  ApiToken,
  Board,
  Column,
  Comment,
  CreatedApiToken,
  CurrentUser,
  RecurrenceInterval,
  Task,
  TaskPriority,
  TaskStatus,
  Workspace,
  WorkspaceMember,
} from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
    },
    ...init,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      // Non-JSON response (e.g. the 501 "Not implemented" scaffold text) —
      // surface it as the error message below.
      body = text;
    }
  }

  if (!res.ok) {
    const message =
      body && typeof body === "object" && "error" in body && typeof (body as { error?: unknown }).error === "string"
        ? (body as { error: string }).error
        : typeof body === "string"
          ? body
          : `Request failed: ${res.status}`;
    throw new ApiError(res.status, message);
  }

  return body as T;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export async function fetchSession(): Promise<CurrentUser | null> {
  try {
    const data = await request<{ email: string }>("/auth/session");
    return { email: data.email };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return null;
    }
    throw err;
  }
}

export async function signInWithGoogle(credential: string): Promise<CurrentUser> {
  const data = await request<{ email: string }>("/auth/google/callback", {
    method: "POST",
    body: JSON.stringify({ credential }),
  });
  return { email: data.email };
}

export async function signOut(): Promise<void> {
  await request<void>("/auth/logout", { method: "POST" });
}

export async function listApiTokens(): Promise<ApiToken[]> {
  const data = await request<{ tokens: ApiToken[] }>("/auth/tokens");
  return data.tokens;
}

export async function createApiToken(label: string): Promise<CreatedApiToken> {
  return request<CreatedApiToken>("/auth/tokens", {
    method: "POST",
    body: JSON.stringify({ label }),
  });
}

export async function revokeApiToken(id: string): Promise<void> {
  await request<void>(`/auth/tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Boards
// ---------------------------------------------------------------------------

export async function listBoards(): Promise<Board[]> {
  const data = await request<{ boards: Board[] }>("/api/boards");
  return data.boards;
}

export async function getBoard(slug: string): Promise<Board> {
  const data = await request<{ board: Board }>(`/api/boards/${encodeURIComponent(slug)}`);
  return data.board;
}

export async function createBoard(input: {
  id: string;
  name: string;
  description?: string;
  workspace_id: string;
}): Promise<Board> {
  const data = await request<{ board: Board }>("/api/boards", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.board;
}

export async function updateBoard(slug: string, patch: { name?: string; description?: string }): Promise<Board> {
  const data = await request<{ board: Board }>(`/api/boards/${encodeURIComponent(slug)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.board;
}

export async function deleteBoard(slug: string): Promise<void> {
  await request<void>(`/api/boards/${encodeURIComponent(slug)}`, { method: "DELETE" });
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export interface TaskFilters {
  status?: TaskStatus;
  assignee?: string;
}

export async function listTasks(slug: string, filters: TaskFilters = {}): Promise<Task[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set("status", filters.status);
  if (filters.assignee) params.set("assignee", filters.assignee);
  const qs = params.toString();
  const data = await request<{ tasks: Task[] }>(
    `/api/boards/${encodeURIComponent(slug)}/tasks${qs ? `?${qs}` : ""}`,
  );
  return data.tasks;
}

export interface CreateTaskInput {
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

export async function createTask(slug: string, input: CreateTaskInput): Promise<Task> {
  const data = await request<{ task: Task }>(`/api/boards/${encodeURIComponent(slug)}/tasks`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.task;
}

export async function updateTask(
  slug: string,
  taskId: string,
  patch: Partial<
    Pick<
      Task,
      | "title"
      | "description"
      | "status"
      | "priority"
      | "assignee"
      | "labels"
      | "due_date"
      | "needs_human"
      | "needs_human_reason"
      | "parent_task_id"
      | "recurrence"
    >
  > & {
    /** The wire carries a boolean; the server stamps the timestamp. */
    archived?: boolean;
  },
): Promise<Task> {
  const data = await request<{ task: Task }>(
    `/api/boards/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  return data.task;
}

export async function claimTask(slug: string, taskId: string): Promise<Task> {
  const data = await request<{ task: Task }>(
    `/api/boards/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/claim`,
    { method: "POST" },
  );
  return data.task;
}

export async function deleteTask(slug: string, taskId: string): Promise<void> {
  await request<void>(`/api/boards/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export async function listColumns(slug: string): Promise<Column[]> {
  const data = await request<{ columns: Column[] }>(`/api/boards/${encodeURIComponent(slug)}/columns`);
  return data.columns;
}

export async function createColumn(slug: string, name: string): Promise<Column> {
  const data = await request<{ column: Column }>(`/api/boards/${encodeURIComponent(slug)}/columns`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
  return data.column;
}

export async function updateColumn(slug: string, columnId: string, name: string): Promise<Column> {
  const data = await request<{ column: Column }>(
    `/api/boards/${encodeURIComponent(slug)}/columns/${encodeURIComponent(columnId)}`,
    { method: "PATCH", body: JSON.stringify({ name }) },
  );
  return data.column;
}

export async function deleteColumn(slug: string, columnId: string, reassignTo?: string): Promise<void> {
  await request<void>(`/api/boards/${encodeURIComponent(slug)}/columns/${encodeURIComponent(columnId)}`, {
    method: "DELETE",
    body: JSON.stringify({ reassign_to: reassignTo }),
  });
}

export async function reorderColumns(slug: string, orderedIds: string[]): Promise<Column[]> {
  const data = await request<{ columns: Column[] }>(`/api/boards/${encodeURIComponent(slug)}/columns/reorder`, {
    method: "POST",
    body: JSON.stringify({ ordered_ids: orderedIds }),
  });
  return data.columns;
}

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export async function listComments(slug: string, taskId: string): Promise<Comment[]> {
  const data = await request<{ comments: Comment[] }>(
    `/api/boards/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/comments`,
  );
  return data.comments;
}

export async function createComment(slug: string, taskId: string, body: string): Promise<Comment> {
  const data = await request<{ comment: Comment }>(
    `/api/boards/${encodeURIComponent(slug)}/tasks/${encodeURIComponent(taskId)}/comments`,
    { method: "POST", body: JSON.stringify({ body }) },
  );
  return data.comment;
}

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export async function listWorkspaces(): Promise<Workspace[]> {
  const data = await request<{ workspaces: Workspace[] }>("/api/workspaces");
  return data.workspaces;
}

export async function createWorkspace(input: { id: string; name: string }): Promise<Workspace> {
  const data = await request<{ workspace: Workspace }>("/api/workspaces", {
    method: "POST",
    body: JSON.stringify(input),
  });
  return data.workspace;
}

export async function updateWorkspace(id: string, patch: { name: string }): Promise<Workspace> {
  const data = await request<{ workspace: Workspace }>(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
  return data.workspace;
}

export async function listMembers(workspaceId: string): Promise<WorkspaceMember[]> {
  const data = await request<{ members: WorkspaceMember[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/members`,
  );
  return data.members;
}

export async function createInvite(workspaceId: string, email: string): Promise<{ invite_url: string }> {
  return request<{ invite_url: string }>(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** PUBLIC — no session required, used by the accept-invite landing page
 *  before the user has signed in. Does not go through `request()` since
 *  that helper doesn't distinguish "no session" from "this call needs none". */
export async function getInvite(token: string): Promise<{ email: string; status: string; workspace_name: string }> {
  const res = await fetch(`/api/invites/${encodeURIComponent(token)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new ApiError(res.status, (body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function acceptInvite(token: string): Promise<{ workspace: Workspace }> {
  return request<{ workspace: Workspace }>(`/api/invites/${encodeURIComponent(token)}/accept`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Cross-board
// ---------------------------------------------------------------------------

export interface NeedsHumanItem {
  id: string;
  board_id: string;
  board_name: string;
  title: string;
  priority: TaskPriority;
  needs_human_reason: string | null;
  updated_at: string;
}

export async function listNeedsHuman(): Promise<NeedsHumanItem[]> {
  const data = await request<{ count: number; items: NeedsHumanItem[] }>("/api/needs-human");
  return data.items;
}

/** Filters for GET /api/tasks. Array fields OR within themselves, AND across. */
export interface AllWorkFilters {
  board?: string[];
  priority?: TaskPriority[];
  status?: TaskStatus[];
  label?: string[];
  /** An email, or the literal "none" for unassigned. */
  assignee?: string;
  needsHuman?: boolean;
  /** Archived tasks are hidden unless this says otherwise. */
  archived?: "exclude" | "only" | "all";
  /** Only tasks untouched for at least this many days. */
  staleDays?: number;
  q?: string;
  sort?: "priority" | "updated" | "created" | "due";
}

export async function listAllTasks(filters: AllWorkFilters = {}): Promise<AllWorkTask[]> {
  const qs = new URLSearchParams();
  for (const board of filters.board ?? []) qs.append("board", board);
  for (const priority of filters.priority ?? []) qs.append("priority", priority);
  for (const status of filters.status ?? []) qs.append("status", status);
  for (const label of filters.label ?? []) qs.append("label", label);
  if (filters.assignee) qs.set("assignee", filters.assignee);
  if (filters.needsHuman) qs.set("needs_human", "1");
  if (filters.archived && filters.archived !== "exclude") qs.set("archived", filters.archived);
  if (filters.staleDays) qs.set("stale_days", String(filters.staleDays));
  if (filters.q?.trim()) qs.set("q", filters.q.trim());
  if (filters.sort) qs.set("sort", filters.sort);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{ count: number; items: AllWorkTask[] }>(`/api/tasks${suffix}`);
  return data.items;
}

export interface BulkUpdateResult {
  updated_count: number;
  failed_count: number;
  failed: { id: string; board_id: string; error: string }[];
}

/**
 * One patch across many tasks on any number of boards. Partial failure is
 * normal and reported — there is no cross-board transaction to roll back to,
 * so callers should surface `failed_count` rather than assume all-or-nothing.
 */
export async function bulkUpdateTasks(
  items: { board_id: string; id: string }[],
  patch: {
    status?: TaskStatus;
    priority?: TaskPriority;
    assignee?: string | null;
    labels?: string[];
    due_date?: string | null;
    needs_human?: boolean;
    archived?: boolean;
  },
): Promise<BulkUpdateResult> {
  return request<BulkUpdateResult>("/api/tasks/bulk", {
    method: "PATCH",
    body: JSON.stringify({ items, patch }),
  });
}

export interface ActivityItem {
  id: string;
  board_id: string;
  board_name: string;
  task_id: string | null;
  type: "task.created" | "task.updated" | "task.claimed" | "task.deleted" | "comment.created";
  actor: string | null;
  summary: string;
  created_at: string;
}

export async function listActivity(params?: { board?: string; since?: string }): Promise<ActivityItem[]> {
  const qs = new URLSearchParams();
  if (params?.board) qs.set("board", params.board);
  if (params?.since) qs.set("since", params.since);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const data = await request<{ items: ActivityItem[] }>(`/api/activity${suffix}`);
  return data.items;
}

export interface SearchTaskResult {
  id: string;
  board_id: string;
  board_name: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  updated_at: string;
}

export interface SearchCommentResult {
  id: string;
  board_id: string;
  board_name: string;
  task_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

export async function search(q: string): Promise<{ tasks: SearchTaskResult[]; comments: SearchCommentResult[] }> {
  if (!q.trim()) return { tasks: [], comments: [] };
  return request(`/api/search?q=${encodeURIComponent(q)}`);
}

// ---------------------------------------------------------------------------
// Realtime
// ---------------------------------------------------------------------------

/** Builds the board WebSocket URL. TODO(integration): confirm `/ws/boards/:slug`
 *  matches the route the backend agent mounts under the `/ws/*` prefix in
 *  wrangler.jsonc's run_worker_first list. */
export function boardSocketUrl(slug: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/boards/${encodeURIComponent(slug)}`;
}
