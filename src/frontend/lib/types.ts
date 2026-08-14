/**
 * Shared frontend types, mirroring the BoardDO SQLite schema and the D1
 * index (see migrations/0001_init.sql and
 * src/worker/durable-objects/BoardDO.ts). These are the shapes api.ts
 * expects every REST endpoint to return — reconcile here first if the
 * backend agent's response shapes differ.
 */

export type TaskStatus = "planned" | "open" | "in_progress" | "blocked" | "done";
export type RecurrenceInterval = "daily" | "weekly" | "monthly";
export type TaskPriority = "low" | "normal" | "high" | "urgent";

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

export interface TaskCounts {
  planned: number;
  open: number;
  in_progress: number;
  blocked: number;
  done: number;
}

export interface Board {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  created_at: string;
  /** Denormalized from D1's tasks_index — may be absent while the index
   *  catches up; api.ts / BoardListPage treat a missing value as zeros. */
  task_counts?: TaskCounts;
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
  | { type: "comment.created"; comment: Comment };
