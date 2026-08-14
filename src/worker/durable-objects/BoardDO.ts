import { DurableObject } from "cloudflare:workers";
import {
  type BoardEvent,
  type ClaimNextTaskFilter,
  type Comment,
  type CreateCommentInput,
  type CreateTaskInput,
  type ListTasksFilter,
  type Task,
  type TaskPriority,
  type TaskStatus,
  type UpdateTaskInput,
  NotFoundError,
  ValidationError,
} from "./types";
import { needsHumanPingMessage, sendTelegramMessage } from "../notify/telegram";

/**
 * BoardDO — one Durable Object instance per board (DO id = board slug, e.g.
 * "engineering", "sales"). SQLite-backed (`new_sqlite_classes` in
 * wrangler.jsonc), so each board owns its own durable storage and that
 * storage — never D1 — is the source of truth for its tasks and comments.
 *
 * Because a DO is single-threaded per instance, every request routed to a
 * given board's DO (RPC call or fetch()) is fully handled to completion
 * before the next one starts. Combined with the fact that `sql.exec()` is
 * synchronous, two operations with no `await` between them can never be
 * interleaved by another caller — that's what makes `claimNextTask` race-free
 * without any hand-written locking (see the comment on that method).
 *
 * ── Primary interface: RPC ──────────────────────────────────────────────
 * Compatibility date is well past 2024-04-03, so per current Cloudflare
 * guidance every public method below is callable directly as RPC on the
 * stub — this is the interface the REST API and MCP layers should prefer:
 *
 *   const stub = env.BOARD_DO.getByName(boardSlug);
 *   const task = await stub.createTask({ title: "..." });
 *
 *   createTask(input): Task
 *   getTask(id): Task
 *   listTasks(filter?): Task[]
 *   updateTask(id, patch): Task
 *   deleteTask(id): void
 *   claimNextTask(filter?): Task | null
 *   commentTask(taskId, input): Comment
 *   listComments(taskId): Comment[]
 *
 * All of the above throw NotFoundError / ValidationError (see types.ts) on
 * bad input — callers should branch on `error.name`, not `instanceof`.
 *
 * ── Secondary interface: fetch() routes ─────────────────────────────────
 * fetch() exists mainly because a WebSocket upgrade MUST go through it (RPC
 * has no way to hand back a 101 response). It also exposes the same
 * operations as plain HTTP/JSON for anything that would rather issue a
 * Request than hold a typed RPC stub — each route is a thin wrapper that
 * calls the RPC method above and serializes the result, so there is exactly
 * one implementation of each operation. Paths are relative to whatever the
 * caller forwards to this DO's fetch() (the parent Worker owns stripping any
 * `/ws/:board` or `/api/boards/:board` prefix before forwarding):
 *
 *   GET    /tasks                  list tasks   ?status=&assignee=&label=
 *   POST   /tasks                  create task  body: CreateTaskInput
 *   GET    /tasks/:id              get task
 *   PATCH  /tasks/:id              update task  body: UpdateTaskInput
 *   DELETE /tasks/:id              delete task
 *   POST   /tasks/claim-next       claim next   body?: ClaimNextTaskFilter
 *   GET    /tasks/:id/comments     list comments
 *   POST   /tasks/:id/comments     add comment  body: CreateCommentInput
 *   GET    /ws                     upgrade to WebSocket (Hibernation API)
 *
 * Anything else -> 404. Bad JSON / failed validation -> 400.
 *
 * ── Realtime ─────────────────────────────────────────────────────────────
 * WebSocket clients (opened by browsers on `GET /ws`, routed here by the
 * Worker) are accepted via the Hibernation API (`ctx.acceptWebSocket`), so
 * an idle connection doesn't keep this DO billed/running. After every
 * committed write this DO broadcasts a `BoardEvent` JSON message to every
 * currently-attached socket via `ctx.getWebSockets()` — that call returns
 * sockets even across a hibernate/wake cycle, so broadcasting doesn't need
 * to track connections in memory itself.
 *
 * ── D1 index sync ────────────────────────────────────────────────────────
 * D1 bindings declared in wrangler.jsonc are handed to every component that
 * shares the Worker's `env` — Durable Objects included — so this DO reaches
 * D1 directly via `this.env.DB` rather than looping back through a service
 * binding to the parent Worker; there is no parent Worker instance to call
 * back into once inside the DO; only the platform-level D1 binding, which
 * the DO already holds. Every push is fire-and-forget via `ctx.waitUntil()`
 * with an internal `.catch()` — a D1 outage or a missing `boards` row (the
 * index has a FK to `boards`) can never fail or roll back this DO's own
 * SQLite write, only fail to (temporarily) update the cross-board index.
 */
export class BoardDO extends DurableObject<Env> {
  /** This board's slug — the DO's own id when created via `getByName(slug)`. Computed once, on first use. */
  #boardId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.#migrate());
  }

  // ── Schema ────────────────────────────────────────────────────────────

  /**
   * `PRAGMA user_version` isn't available on DO SQLite storage, so schema
   * versioning is tracked in an ordinary table instead. Only ever called
   * from the constructor inside `blockConcurrencyWhile` — never on the
   * request path.
   */
  #migrate(): void {
    const sql = this.ctx.storage.sql;
    sql.exec(`
      CREATE TABLE IF NOT EXISTS _schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      )
    `);
    const version = sql
      .exec<{ v: number }>("SELECT COALESCE(MAX(id), 0) AS v FROM _schema_migrations")
      .one().v;

    if (version < 1) {
      sql.exec(`
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','blocked','done')),
          priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
          assignee TEXT,
          labels TEXT,
          due_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT,
          claimed_by TEXT,
          version INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);

        CREATE TABLE IF NOT EXISTS comments (
          id TEXT PRIMARY KEY,
          task_id TEXT NOT NULL,
          author TEXT,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_comments_task_id ON comments(task_id);
      `);
      sql.exec("INSERT INTO _schema_migrations (id, applied_at) VALUES (1, ?)", new Date().toISOString());
    }

    if (version < 2) {
      sql.exec(`
        ALTER TABLE tasks ADD COLUMN needs_human INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE tasks ADD COLUMN needs_human_reason TEXT;
        CREATE INDEX IF NOT EXISTS idx_tasks_needs_human ON tasks(needs_human);
      `);
      sql.exec("INSERT INTO _schema_migrations (id, applied_at) VALUES (2, ?)", new Date().toISOString());
    }

    if (version < 3) {
      // Adds the "planned" status (the Backlog concept — a task triaged
      // but not yet active). SQLite can't ALTER a CHECK constraint in
      // place, so this rebuilds the table: new table with the widened
      // constraint, copy rows, drop old, rename. Standard SQLite pattern
      // for a constraint change; safe here because BoardDO only ever runs
      // this from the constructor inside blockConcurrencyWhile.
      sql.exec(`
        CREATE TABLE tasks_v3 (
          id TEXT PRIMARY KEY,
          board_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('planned','open','in_progress','blocked','done')),
          priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
          assignee TEXT,
          labels TEXT,
          due_date TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          created_by TEXT,
          claimed_by TEXT,
          version INTEGER NOT NULL DEFAULT 0,
          needs_human INTEGER NOT NULL DEFAULT 0,
          needs_human_reason TEXT
        );
        INSERT INTO tasks_v3 SELECT * FROM tasks;
        DROP TABLE tasks;
        ALTER TABLE tasks_v3 RENAME TO tasks;
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
        CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee);
        CREATE INDEX IF NOT EXISTS idx_tasks_needs_human ON tasks(needs_human);
      `);
      sql.exec("INSERT INTO _schema_migrations (id, applied_at) VALUES (3, ?)", new Date().toISOString());
    }
  }

  /** The board slug this DO instance owns. Requires the DO to have been created via `getByName(slug)`. */
  get boardId(): string {
    if (this.#boardId === null) {
      const name = this.ctx.id.name;
      if (!name) {
        throw new ValidationError(
          "BoardDO was not created via getByName(slug) — it has no name to use as board_id",
        );
      }
      this.#boardId = name;
    }
    return this.#boardId;
  }

  // ── RPC: tasks ───────────────────────────────────────────────────────

  createTask(input: CreateTaskInput): Task {
    const title = input.title?.trim();
    if (!title) {
      throw new ValidationError("title is required");
    }

    const now = new Date().toISOString();
    const row: TaskRow = {
      id: crypto.randomUUID(),
      board_id: this.boardId,
      title,
      description: input.description ?? null,
      status: input.status ?? "open",
      priority: input.priority ?? "normal",
      assignee: input.assignee ?? null,
      labels: JSON.stringify(input.labels ?? []),
      due_date: input.dueDate ?? null,
      created_at: now,
      updated_at: now,
      created_by: input.createdBy ?? null,
      claimed_by: null,
      version: 0,
      needs_human: input.needsHuman ? 1 : 0,
      needs_human_reason: input.needsHuman ? (input.needsHumanReason ?? null) : null,
    };

    this.ctx.storage.sql.exec(
      `INSERT INTO tasks
        (id, board_id, title, description, status, priority, assignee, labels, due_date, created_at, updated_at, created_by, claimed_by, version, needs_human, needs_human_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.id,
      row.board_id,
      row.title,
      row.description,
      row.status,
      row.priority,
      row.assignee,
      row.labels,
      row.due_date,
      row.created_at,
      row.updated_at,
      row.created_by,
      row.claimed_by,
      row.version,
      row.needs_human,
      row.needs_human_reason,
    );

    const task = toTask(row);
    this.#afterWrite({ type: "task.created", boardId: this.boardId, task, at: now }, task);
    if (task.needsHuman) this.#notifyNeedsHuman(task);
    return task;
  }

  getTask(id: string): Task {
    const row = this.ctx.storage.sql
      .exec<TaskRow>("SELECT * FROM tasks WHERE id = ?", id)
      .toArray()[0];
    if (!row) {
      throw new NotFoundError(`task ${id} not found`);
    }
    return toTask(row);
  }

  listTasks(filter: ListTasksFilter = {}): Task[] {
    const clauses: string[] = ["board_id = ?"];
    const params: SqlBindable[] = [this.boardId];

    if (filter.status) {
      clauses.push("status = ?");
      params.push(filter.status);
    }
    if (filter.assignee) {
      clauses.push("assignee = ?");
      params.push(filter.assignee);
    }
    if (filter.label) {
      // MVP substring match on the JSON array TEXT column — precise for
      // ordinary label text, since the label is bracketed by its own quotes.
      clauses.push("labels LIKE ?");
      params.push(`%"${filter.label}"%`);
    }

    const rows = this.ctx.storage.sql
      .exec<TaskRow>(
        `SELECT * FROM tasks WHERE ${clauses.join(" AND ")} ORDER BY created_at DESC`,
        ...params,
      )
      .toArray();
    return rows.map(toTask);
  }

  updateTask(id: string, patch: UpdateTaskInput): Task {
    const existing = this.ctx.storage.sql
      .exec<TaskRow>("SELECT * FROM tasks WHERE id = ?", id)
      .toArray()[0];
    if (!existing) {
      throw new NotFoundError(`task ${id} not found`);
    }
    if (patch.title !== undefined && !patch.title.trim()) {
      throw new ValidationError("title cannot be blank");
    }

    const now = new Date().toISOString();
    const next: TaskRow = {
      ...existing,
      title: patch.title !== undefined ? patch.title.trim() : existing.title,
      description: patch.description !== undefined ? patch.description : existing.description,
      status: patch.status ?? existing.status,
      priority: patch.priority ?? existing.priority,
      assignee: patch.assignee !== undefined ? patch.assignee : existing.assignee,
      labels: patch.labels !== undefined ? JSON.stringify(patch.labels) : existing.labels,
      due_date: patch.dueDate !== undefined ? patch.dueDate : existing.due_date,
      claimed_by: patch.claimedBy !== undefined ? patch.claimedBy : existing.claimed_by,
      updated_at: now,
      version: existing.version + 1,
      needs_human: patch.needsHuman !== undefined ? (patch.needsHuman ? 1 : 0) : existing.needs_human,
      needs_human_reason:
        patch.needsHumanReason !== undefined ? patch.needsHumanReason : existing.needs_human_reason,
    };

    this.ctx.storage.sql.exec(
      `UPDATE tasks SET
        title = ?, description = ?, status = ?, priority = ?, assignee = ?,
        labels = ?, due_date = ?, claimed_by = ?, updated_at = ?, version = ?,
        needs_human = ?, needs_human_reason = ?
       WHERE id = ?`,
      next.title,
      next.description,
      next.status,
      next.priority,
      next.assignee,
      next.labels,
      next.due_date,
      next.claimed_by,
      next.updated_at,
      next.version,
      next.needs_human,
      next.needs_human_reason,
      id,
    );

    const task = toTask(next);
    this.#afterWrite({ type: "task.updated", boardId: this.boardId, task, at: now }, task);
    // Only ping on the false → true transition, not on every subsequent
    // edit — otherwise re-saving an already-flagged task would re-page.
    if (task.needsHuman && existing.needs_human === 0) this.#notifyNeedsHuman(task);
    return task;
  }

  deleteTask(id: string): void {
    const result = this.ctx.storage.sql.exec("DELETE FROM tasks WHERE id = ?", id);
    if (result.rowsWritten === 0) {
      throw new NotFoundError(`task ${id} not found`);
    }
    this.ctx.storage.sql.exec("DELETE FROM comments WHERE task_id = ?", id);

    const at = new Date().toISOString();
    this.#broadcast({ type: "task.deleted", boardId: this.boardId, taskId: id, at });
    this.#syncDeleteToIndex(id);
  }

  /**
   * Atomically finds the first unclaimed open task matching `filter` and
   * claims it, in a single UPDATE ... WHERE id = (SELECT ...) statement.
   *
   * Why this is race-free even with many concurrent agent callers, purely
   * by construction:
   *  1. The whole operation is one SQL statement — SQLite itself guarantees
   *     the SELECT subquery and the UPDATE it feeds run as one atomic unit;
   *     there is no gap in which a second statement could pick the same row.
   *  2. Belt-and-suspenders: even if this were written as two statements, a
   *     Durable Object is single-threaded per instance and `sql.exec()` is
   *     synchronous, so two calls into this method can never interleave —
   *     the DO always finishes handling one caller's request (RPC or
   *     fetch()) before starting the next. There is no `await` anywhere
   *     between reading candidates and writing the claim, so nothing else
   *     ever runs in between.
   * Two agents calling claimNextTask() "at the same time" are, from the
   * DO's perspective, just two requests queued one after the other — the
   * second one simply sees the first one's claim already committed and
   * moves on to the next matching row (or gets null).
   */
  claimNextTask(filter: ClaimNextTaskFilter = {}, claimedBy?: string): Task | null {
    const clauses: string[] = ["board_id = ?", "status = 'open'", "claimed_by IS NULL"];
    const params: SqlBindable[] = [this.boardId];

    if (filter.assignee) {
      clauses.push("assignee = ?");
      params.push(filter.assignee);
    }
    if (filter.label) {
      clauses.push("labels LIKE ?");
      params.push(`%"${filter.label}"%`);
    }
    if (filter.priority) {
      clauses.push("priority = ?");
      params.push(filter.priority);
    }

    const now = new Date().toISOString();
    const row = this.ctx.storage.sql
      .exec<TaskRow>(
        `UPDATE tasks
         SET claimed_by = ?, status = 'in_progress', version = version + 1, updated_at = ?
         WHERE id = (
           SELECT id FROM tasks
           WHERE ${clauses.join(" AND ")}
           ORDER BY
             CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
             created_at ASC
           LIMIT 1
         )
         RETURNING *`,
        claimedBy ?? null,
        now,
        ...params,
      )
      .toArray()[0];

    if (!row) {
      return null;
    }

    const task = toTask(row);
    this.#afterWrite({ type: "task.claimed", boardId: this.boardId, task, at: now }, task);
    return task;
  }

  // ── RPC: comments ────────────────────────────────────────────────────

  commentTask(taskId: string, input: CreateCommentInput): Comment {
    const body = input.body?.trim();
    if (!body) {
      throw new ValidationError("body is required");
    }
    const taskExists = this.ctx.storage.sql
      .exec<{ id: string }>("SELECT id FROM tasks WHERE id = ?", taskId)
      .toArray()[0];
    if (!taskExists) {
      throw new NotFoundError(`task ${taskId} not found`);
    }

    const now = new Date().toISOString();
    const row: CommentRow = {
      id: crypto.randomUUID(),
      task_id: taskId,
      author: input.author ?? null,
      body,
      created_at: now,
    };
    this.ctx.storage.sql.exec(
      "INSERT INTO comments (id, task_id, author, body, created_at) VALUES (?, ?, ?, ?, ?)",
      row.id,
      row.task_id,
      row.author,
      row.body,
      row.created_at,
    );

    const comment = toComment(row);
    this.#broadcast({ type: "comment.created", boardId: this.boardId, comment, at: now });
    // Comments aren't indexed in D1 (tasks_index is task-only per spec), but
    // touch the parent task's updated_at so the dashboard reflects activity.
    this.ctx.storage.sql.exec("UPDATE tasks SET updated_at = ? WHERE id = ?", now, taskId);
    return comment;
  }

  listComments(taskId: string): Comment[] {
    const rows = this.ctx.storage.sql
      .exec<CommentRow>("SELECT * FROM comments WHERE task_id = ? ORDER BY created_at ASC", taskId)
      .toArray();
    return rows.map(toComment);
  }

  // ── fetch(): WebSocket upgrade + HTTP mirror of the RPC surface ───────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      if (request.headers.get("Upgrade") !== "websocket") {
        return new Response("Expected Upgrade: websocket", { status: 426 });
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    try {
      return await this.#routeHttp(request, url);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return jsonResponse({ error: error.message }, 404);
      }
      if (error instanceof ValidationError) {
        return jsonResponse({ error: error.message }, 400);
      }
      console.error("BoardDO fetch error:", error);
      return jsonResponse({ error: "internal error" }, 500);
    }
  }

  async #routeHttp(request: Request, url: URL): Promise<Response> {
    const parts = url.pathname.split("/").filter(Boolean); // "/tasks/:id/comments" -> ["tasks", ":id", "comments"]

    if (parts[0] !== "tasks") {
      return jsonResponse({ error: "not found" }, 404);
    }

    // /tasks
    if (parts.length === 1) {
      if (request.method === "GET") {
        const filter: ListTasksFilter = {
          status: (url.searchParams.get("status") as TaskStatus) ?? undefined,
          assignee: url.searchParams.get("assignee") ?? undefined,
          label: url.searchParams.get("label") ?? undefined,
        };
        return jsonResponse(this.listTasks(filter));
      }
      if (request.method === "POST") {
        const body = await readJson<CreateTaskInput>(request);
        return jsonResponse(this.createTask(body), 201);
      }
    }

    // /tasks/claim-next
    if (parts.length === 2 && parts[1] === "claim-next" && request.method === "POST") {
      const body = await readJsonOptional<ClaimNextTaskFilter & { claimedBy?: string }>(request);
      const { claimedBy, ...filter } = body ?? {};
      const task = this.claimNextTask(filter, claimedBy);
      return task ? jsonResponse(task) : jsonResponse(null, 204);
    }

    // /tasks/:id
    if (parts.length === 2) {
      const id = parts[1];
      if (request.method === "GET") return jsonResponse(this.getTask(id));
      if (request.method === "PATCH") return jsonResponse(this.updateTask(id, await readJson(request)));
      if (request.method === "DELETE") {
        this.deleteTask(id);
        return new Response(null, { status: 204 });
      }
    }

    // /tasks/:id/comments
    if (parts.length === 3 && parts[2] === "comments") {
      const id = parts[1];
      if (request.method === "GET") return jsonResponse(this.listComments(id));
      if (request.method === "POST") {
        const body = await readJson<CreateCommentInput>(request);
        return jsonResponse(this.commentTask(id, body), 201);
      }
    }

    return jsonResponse({ error: "not found" }, 404);
  }

  // ── WebSocket Hibernation API ────────────────────────────────────────

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Clients only ever receive broadcasts; the only inbound message this DO
    // understands is a keepalive ping, which also doubles as a liveness
    // check that survives hibernation/wake cycles.
    if (typeof message === "string") {
      try {
        const parsed = JSON.parse(message);
        if (parsed?.type === "ping") {
          ws.send(JSON.stringify({ type: "pong" }));
        }
      } catch {
        // Ignore unparseable client messages — this channel is broadcast-only.
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, _wasClean: boolean): Promise<void> {
    try {
      ws.close(code, reason);
    } catch {
      // Already closed — nothing to do.
    }
  }

  // ── After-write hooks ────────────────────────────────────────────────

  #afterWrite(event: BoardEvent, task: Task): void {
    this.#broadcast(event);
    this.#syncTaskToIndex(task);
  }

  #broadcast(event: BoardEvent): void {
    const payload = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
      } catch (error) {
        console.error("BoardDO broadcast failed for one socket:", error);
      }
    }
  }

  /**
   * Fire-and-forget push of the changed task's index fields into D1's
   * `tasks_index`. `waitUntil` keeps this running after the response is
   * already on its way back to the caller; the `.catch` means a D1 outage
   * (or the board's row not existing yet in D1's `boards` table) only logs
   * — it can never fail or roll back the write this DO already committed.
   */
  #syncTaskToIndex(task: Task): void {
    const query = this.env.DB.prepare(
      `INSERT INTO tasks_index (id, board_id, title, status, priority, assignee, labels, due_date, updated_at, needs_human, needs_human_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         board_id = excluded.board_id, title = excluded.title, status = excluded.status,
         priority = excluded.priority, assignee = excluded.assignee, labels = excluded.labels,
         due_date = excluded.due_date, updated_at = excluded.updated_at,
         needs_human = excluded.needs_human, needs_human_reason = excluded.needs_human_reason`,
    ).bind(
      task.id,
      task.boardId,
      task.title,
      task.status,
      task.priority,
      task.assignee,
      JSON.stringify(task.labels),
      task.dueDate,
      task.updatedAt,
      task.needsHuman ? 1 : 0,
      task.needsHumanReason,
    );
    this.ctx.waitUntil(
      query.run().catch((error) => {
        console.error(`BoardDO: D1 tasks_index sync failed for task ${task.id}:`, error);
      }),
    );
  }

  /**
   * Fires the escalation ping — a Telegram message the moment a task
   * transitions into needs_human=true. This is the "agent gets stuck, pings
   * me" half of the loop; the daily digest (scheduled() in
   * src/worker/index.ts) is the "what's still stuck" half, for anything
   * that doesn't get cleared same-day.
   */
  #notifyNeedsHuman(task: Task): void {
    const appUrl = this.env.APP_URL ?? "";
    this.ctx.waitUntil(
      sendTelegramMessage(
        this.env,
        needsHumanPingMessage({
          boardId: task.boardId,
          taskId: task.id,
          title: task.title,
          reason: task.needsHumanReason,
          appUrl,
        }),
      ),
    );
  }

  #syncDeleteToIndex(taskId: string): void {
    this.ctx.waitUntil(
      this.env.DB.prepare("DELETE FROM tasks_index WHERE id = ?")
        .bind(taskId)
        .run()
        .catch((error) => {
          console.error(`BoardDO: D1 tasks_index delete failed for task ${taskId}:`, error);
        }),
    );
  }
}

// ── Row <-> domain mapping ─────────────────────────────────────────────

interface TaskRow extends Record<string, SqlStorageValue> {
  id: string;
  board_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee: string | null;
  labels: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  claimed_by: string | null;
  version: number;
  needs_human: number;
  needs_human_reason: string | null;
}

interface CommentRow extends Record<string, SqlStorageValue> {
  id: string;
  task_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

type SqlBindable = string | number | null;

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    description: row.description,
    status: row.status as TaskStatus,
    priority: row.priority as TaskPriority,
    assignee: row.assignee,
    labels: row.labels ? (JSON.parse(row.labels) as string[]) : [],
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
    claimedBy: row.claimed_by,
    version: row.version,
    needsHuman: row.needs_human === 1,
    needsHumanReason: row.needs_human_reason,
  };
}

function toComment(row: CommentRow): Comment {
  return {
    id: row.id,
    taskId: row.task_id,
    author: row.author,
    body: row.body,
    createdAt: row.created_at,
  };
}

// ── fetch() helpers ──────────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ValidationError("request body must be valid JSON");
  }
}

async function readJsonOptional<T>(request: Request): Promise<T | undefined> {
  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ValidationError("request body must be valid JSON");
  }
}
