-- Activity feed: a cross-board, workspace-scoped log of every task/comment
-- event. Written by BoardDO alongside its existing tasks_index sync (same
-- fire-and-forget pattern, never authoritative — the DO's own write is
-- already committed by the time this runs).

CREATE TABLE IF NOT EXISTS activity_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  board_id TEXT NOT NULL,
  task_id TEXT,
  type TEXT NOT NULL, -- 'task.created' | 'task.updated' | 'task.claimed' | 'task.deleted' | 'comment.created'
  actor TEXT,
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS activity_log_workspace ON activity_log(workspace_id);
CREATE INDEX IF NOT EXISTS activity_log_board ON activity_log(board_id);
CREATE INDEX IF NOT EXISTS activity_log_created ON activity_log(created_at);

-- Comments never had a D1 mirror (only tasks did) — needed so search can
-- find a comment's content without opening every board's Durable Object.
CREATE TABLE IF NOT EXISTS comments_index (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  author TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS comments_index_board ON comments_index(board_id);
CREATE INDEX IF NOT EXISTS comments_index_task ON comments_index(task_id);

-- tasks_index never carried description — search needs it (title-only
-- search misses most of a task's actual content).
ALTER TABLE tasks_index ADD COLUMN description TEXT;
