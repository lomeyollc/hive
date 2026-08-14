import { DurableObject } from "cloudflare:workers";

/**
 * BoardDO — one Durable Object instance per board (id = board slug, e.g.
 * "engineering", "sales"). SQLite-backed (see the `new_sqlite_classes`
 * migration in wrangler.jsonc) so each board owns its own durable storage.
 *
 * Because a DO is single-threaded per instance, every request routed to a
 * given board is serialized automatically — no hand-written locking needed
 * for concurrent agent writes.
 *
 * The next-phase agent implements, per the architecture spec:
 *
 * Schema (create in the constructor via ctx.blockConcurrencyWhile + sql.exec,
 * CREATE TABLE IF NOT EXISTS):
 *
 *   tasks(
 *     id TEXT PRIMARY KEY,
 *     board_id TEXT,
 *     title TEXT NOT NULL,
 *     description TEXT,
 *     status TEXT DEFAULT 'open' CHECK(status IN ('open','in_progress','blocked','done')),
 *     priority TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
 *     assignee TEXT,
 *     labels TEXT,        -- JSON array
 *     due_date TEXT,
 *     created_at TEXT,
 *     updated_at TEXT,
 *     created_by TEXT,
 *     claimed_by TEXT,
 *     version INTEGER DEFAULT 0
 *   )
 *
 *   comments(
 *     id TEXT PRIMARY KEY,
 *     task_id TEXT,
 *     author TEXT,
 *     body TEXT,
 *     created_at TEXT
 *   )
 *
 * RPC methods to expose (called from src/worker/index.ts / src/worker/api
 * and src/worker/mcp — prefer RPC over a manual fetch() handler):
 *   - createTask(input): Task
 *   - getTask(id): Task | null
 *   - updateTask(id, patch): Task           // bump `version`, updated_at
 *   - claimNextTask(filter): Task | null    // atomic: first unclaimed open
 *                                           // task matching filter gets
 *                                           // claimed_by + version++, in
 *                                           // one call — DO serialization
 *                                           // makes this race-free for free
 *   - commentTask(taskId, author, body): Comment
 *   - listTasks(filter): Task[]
 *
 * After every committed write: fire-and-forget a denormalized row into the
 * D1 `tasks_index` table (env.DB) for cross-board search/dashboard. D1 is
 * never authoritative and never a write target for task state itself — this
 * DO's SQLite storage always is.
 *
 * WebSocket (Hibernation API): accept upgrades in fetch(), use
 * ctx.acceptWebSocket(ws) instead of ws.accept(), implement
 * webSocketMessage()/webSocketClose(), and broadcast a change notification
 * to every connected socket after each committed write.
 */
export class BoardDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // TODO: ctx.blockConcurrencyWhile(() => { this.ctx.storage.sql.exec(`...schema above...`); });
  }

  // TODO: async fetch(request: Request): Promise<Response> { ... WebSocket upgrade ... }
  // TODO: async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> { ... }
  // TODO: async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> { ... }
}
