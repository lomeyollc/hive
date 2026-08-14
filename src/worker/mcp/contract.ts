/**
 * The BoardDO RPC contract this MCP route is built against.
 *
 * Data shapes (Task, Comment, CreateTaskInput, UpdateTaskInput,
 * ListTasksFilter, ClaimNextTaskFilter, CreateCommentInput) are re-exported
 * from `../durable-objects/types` — the BoardDO implementer's own contract
 * file — rather than redeclared here, so the two sides can't silently drift
 * on field names/casing (that file uses camelCase; D1 and the wire schema
 * use snake_case, which is why the MCP tool params below stay snake_case
 * and get mapped at the call site in tools.ts).
 *
 * Method names/arities come from BoardDO.ts's own JSDoc, which already
 * commits to an RPC surface (methods called directly on the DO stub via
 * Workers RPC, not a manual fetch() REST API):
 *
 *   const stub = env.BOARD_DO.getByName(board);
 *   const task = await stub.createTask({ title: "..." });
 *
 * One deliberate extension beyond that JSDoc: `claimNextTask` takes a
 * second `claimedBy` argument here. Neither BoardDO.ts nor
 * durable-objects/types.ts's `ClaimNextTaskFilter` carries a field for
 * *who is claiming* (only fields to filter candidate tasks BY, e.g.
 * "already assigned to X"), and something has to set `claimedBy` on the
 * winning row. The MCP-authenticated caller's identity (see
 * `actorFor()` in tools.ts) is the natural source for that, so it's
 * threaded through as an explicit argument rather than folded into the
 * filter. If BoardDO lands with a different shape (e.g. claimedBy inside
 * the filter object instead), this is the one signature to reconcile.
 *
 * D1 (`env.DB`) is read directly by list_boards only — it is never queried
 * or written for task state; every other tool goes through the DO stub.
 */

export type {
  Task,
  Comment,
  TaskStatus,
  TaskPriority,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksFilter,
  ClaimNextTaskFilter,
  CreateCommentInput,
} from "../durable-objects/types";

import type {
  Task,
  Comment,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksFilter,
  ClaimNextTaskFilter,
  CreateCommentInput,
} from "../durable-objects/types";

/**
 * The RPC methods this route calls on a BoardDO stub. BoardDO extends
 * `DurableObject<Env>` so these are plain instance methods — Workers RPC
 * makes them callable straight off `env.BOARD_DO.getByName(slug)`.
 */
export interface BoardDOStub {
  createTask(input: CreateTaskInput): Promise<Task>;
  getTask(id: string): Promise<Task>;
  updateTask(id: string, patch: UpdateTaskInput): Promise<Task>;
  claimNextTask(filter: ClaimNextTaskFilter | undefined, claimedBy: string): Promise<Task | null>;
  commentTask(taskId: string, input: CreateCommentInput): Promise<Comment>;
  listTasks(filter?: ListTasksFilter): Promise<Task[]>;
}

/** Row shape of D1's `boards` table (migrations/0001_init.sql). Read-only here. */
export interface BoardRow {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
}
