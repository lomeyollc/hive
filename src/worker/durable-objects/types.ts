/**
 * Shared types for BoardDO — imported by the REST API, MCP server, and
 * anything else that calls a board's Durable Object stub (directly via RPC,
 * or indirectly over the DO's fetch() routes).
 */

/**
 * "planned" is the Backlog concept: a task that's been triaged (title,
 * priority, maybe owner/labels/due date set) but not yet pulled into
 * active work. It's a status value, not a board — Hive doesn't have
 * draggable board columns, so the status tabs already serve as the
 * board/view distinction other tools express separately.
 */
export type TaskStatus = "planned" | "open" | "in_progress" | "blocked" | "done";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

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
}

export interface ListTasksFilter {
  status?: TaskStatus;
  assignee?: string;
  /** Matches tasks whose `labels` array contains this exact label. */
  label?: string;
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
  | { type: "comment.created"; boardId: string; comment: Comment; at: string };

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
