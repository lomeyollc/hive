/**
 * Shared types for BoardDO — imported by the REST API, MCP server, and
 * anything else that calls a board's Durable Object stub (directly via RPC,
 * or indirectly over the DO's fetch() routes).
 */

/**
 * A task's status is a per-board column id — boards define their own
 * ordered columns (see Column below) instead of sharing one fixed enum.
 * Every board is seeded with 5 default columns whose ids match the old
 * fixed statuses ("planned","open","in_progress","blocked","done"), so
 * existing data needs no migration — only the CHECK constraint that used
 * to pin these 5 values is gone. A column id is only ever valid within
 * its own board; there's no cross-board meaning to the string itself.
 */
export type TaskStatus = string;
export type TaskPriority = "low" | "normal" | "high" | "urgent";
export type RecurrenceInterval = "daily" | "weekly" | "monthly";

/**
 * Three roles carry automation; every other column is purely a label with
 * no side effects:
 *   "open"   - the pool claimNextTask() draws from (old fixed "open")
 *   "active" - where claimNextTask() moves a claimed task (old "in_progress")
 *   "done"   - completing a recurring task into this role spawns its next
 *              occurrence (old "done")
 * A board must always have exactly one column with role "open" and one
 * with role "active" for claimNextTask() to work — enforced by BoardDO
 * refusing to delete a role-bearing column (rename freely, delete never).
 * A brand-new custom column always has role null.
 */
export type ColumnRole = "open" | "active" | "done";

export interface Column {
  id: string;
  name: string;
  position: number;
  role: ColumnRole | null;
}

export interface CreateColumnInput {
  name: string;
}

export interface UpdateColumnInput {
  name?: string;
}

/** A task as returned to callers — `labels` is a real string array, never the raw JSON TEXT column. */
export interface Task {
  id: string;
  boardId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  labels: string[];
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
  claimedBy: string | null;
  version: number;
  /**
   * The escalation primitive. An agent (or human) sets this true when it's
   * stuck and needs a decision — Hive pings Telegram immediately and rolls
   * any still-open ones into a daily digest. A human clearing it back to
   * false is what "unblocks" the work.
   */
  needsHuman: boolean;
  needsHumanReason: string | null;
  /**
   * Cold storage. A task with `archivedAt` set is excluded from every
   * default view, count and agent listing — it still exists and unarchives
   * in one call, but it stops competing for attention. Deliberately a
   * timestamp field rather than a board column: a column would have to be
   * created on every board, would pollute the column list and the count
   * badges, and would force a task to give up its real status to be
   * archived. Orthogonal to status, so anything can be archived from
   * anywhere.
   */
  archivedAt: string | null;
  /** Another task's id in the same board, if this is a sub-task of it. */
  parentTaskId: string | null;
  /** When set, completing this task (status -> "done") spawns the next
   *  occurrence automatically — a new task with the same fields, status
   *  "open", due_date advanced by one interval. See BoardDO.updateTask. */
  recurrence: RecurrenceInterval | null;
}

export interface Comment {
  id: string;
  taskId: string;
  author: string | null;
  body: string;
  createdAt: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string | null;
  labels?: string[];
  dueDate?: string | null;
  createdBy?: string | null;
  needsHuman?: boolean;
  needsHumanReason?: string | null;
  parentTaskId?: string | null;
  recurrence?: RecurrenceInterval | null;
}

/** Partial patch — only the provided fields are changed. Every update bumps `version` and `updatedAt` regardless. */
export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee?: string | null;
  labels?: string[];
  dueDate?: string | null;
  claimedBy?: string | null;
  needsHuman?: boolean;
  needsHumanReason?: string | null;
  /** ISO timestamp to archive, `null` to restore. Callers that only know
   *  "archive it" should pass `new Date().toISOString()`. */
  archivedAt?: string | null;
  parentTaskId?: string | null;
  recurrence?: RecurrenceInterval | null;
}

export interface ListTasksFilter {
  status?: TaskStatus;
  assignee?: string;
  /** Matches tasks whose `labels` array contains this exact label. */
  label?: string;
  /** Sub-tasks of this task id. Pass "" (empty string) to mean "top-level
   *  only" if that filtering is ever needed server-side; today the
   *  frontend derives sub-tasks client-side from the already-loaded list,
   *  so this exists mainly for MCP/agent callers. */
  parentTaskId?: string;
  /**
   * Archived tasks are hidden by default everywhere — that is the whole
   * point of archiving. Pass "only" to list the archive itself, "all" to
   * see both. Omitted/"exclude" is the default.
   */
  archived?: "exclude" | "only" | "all";
}

/** Filter for claim_next_task — narrows which unclaimed open task gets picked, all fields optional/AND'd. */
export interface ClaimNextTaskFilter {
  /** Only claim a task pre-assigned (but not yet claimed) to this name. */
  assignee?: string;
  /** Only claim a task carrying this label. */
  label?: string;
  /** Only claim a task at exactly this priority. */
  priority?: TaskPriority;
}

export interface CreateCommentInput {
  author?: string | null;
  body: string;
}

/** Broadcast payload shape sent over every open WebSocket on a board after a committed write. */
export type BoardEvent =
  | { type: "task.created"; boardId: string; task: Task; at: string }
  | { type: "task.updated"; boardId: string; task: Task; at: string }
  | { type: "task.claimed"; boardId: string; task: Task; at: string }
  | { type: "task.deleted"; boardId: string; taskId: string; at: string }
  | { type: "comment.created"; boardId: string; comment: Comment; at: string }
  | { type: "column.created"; boardId: string; column: Column; at: string }
  | { type: "column.updated"; boardId: string; column: Column; at: string }
  | { type: "column.deleted"; boardId: string; columnId: string; at: string }
  | { type: "columns.reordered"; boardId: string; columns: Column[]; at: string };

/**
 * Thrown by BoardDO methods. Callers going through RPC should branch on
 * `.name` rather than `instanceof` — Durable Object RPC crosses an isolate
 * boundary and does not reliably preserve the prototype chain, but the
 * `name` string property survives serialization. fetch() callers get these
 * mapped to HTTP status codes directly (see BoardDO.ts).
 */
export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
