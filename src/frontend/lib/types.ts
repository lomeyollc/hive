/**
 * Shared frontend types, mirroring the BoardDO SQLite schema and the D1
 * index (see migrations/0001_init.sql and
 * src/worker/durable-objects/BoardDO.ts). These are the shapes api.ts
 * expects every REST endpoint to return — reconcile here first if the
 * backend agent's response shapes differ.
 */

/** A per-board column id — see Column below. Not a fixed enum: every board
 *  defines its own ordered columns, seeded with 5 defaults whose ids match
 *  the old fixed statuses ("planned","open","in_progress","blocked","done"). */
export type TaskStatus = string;
export type RecurrenceInterval = "daily" | "weekly" | "monthly";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

/** Three roles carry automation (claim_next_task, recurrence); every other
 *  column is a plain label with no side effects. See BoardDO's doc comment. */
export type ColumnRole = "open" | "active" | "done";

export interface Column {
  id: string;
  name: string;
  position: number;
  role: ColumnRole | null;
}

export interface Task {
  id: string;
  board_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: string | null;
  labels: string[];
  due_date: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  claimed_by: string | null;
  version: number;
  needs_human: boolean;
  needs_human_reason: string | null;
  parent_task_id: string | null;
  recurrence: RecurrenceInterval | null;
}

export interface Comment {
  id: string;
  task_id: string;
  author: string;
  body: string;
  created_at: string;
}

/** Keyed by column id — which ids exist depends on the board (see Column). */
export type TaskCounts = Record<string, number>;

export interface Board {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  workspace_id: string | null;
  /** Denormalized from D1's tasks_index — may be absent while the index
   *  catches up; api.ts / BoardListPage treat a missing value as zeros. */
  task_counts?: TaskCounts;
  /** Only present on GET /api/boards/:slug (the list endpoint omits it to
   *  avoid a DO round-trip per board). */
  columns?: Column[];
}

export interface Workspace {
  id: string;
  name: string;
  created_at: string;
}

export interface WorkspaceMember {
  id: string;
  email: string;
  role: "owner" | "member";
  status: "invited" | "active";
  invited_by: string | null;
  invited_at: string;
  accepted_at: string | null;
  /** Only present while status is "invited" — the accept link to hand the
   *  invitee, since no email is actually sent. */
  invite_url: string | null;
}

/** Matches src/worker/auth/routes.ts, which only surfaces `email` today. */
export interface CurrentUser {
  email: string;
}

/** Matches the shape src/worker/auth/routes.ts's GET /auth/tokens returns. */
export interface ApiToken {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked: boolean;
}

/** Only returned once, immediately after creation — never persisted or refetchable. */
export interface CreatedApiToken {
  id: string;
  label: string | null;
  created_at: string;
  token: string;
}

/** Live-update messages broadcast by a BoardDO over its /ws/boards/:slug socket. */
export type BoardSocketMessage =
  | { type: "task.created"; task: Task }
  | { type: "task.updated"; task: Task }
  | { type: "task.claimed"; task: Task }
  | { type: "task.deleted"; taskId: string }
  | { type: "comment.created"; comment: Comment }
  | { type: "column.created"; column: Column }
  | { type: "column.updated"; column: Column }
  | { type: "column.deleted"; columnId: string }
  | { type: "columns.reordered"; columns: Column[] };
