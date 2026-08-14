-- Hive D1 schema — a denormalized READ-ONLY index for cross-board search
-- and the dashboard, plus API token storage. Never authoritative for task
-- state: each board's own BoardDO SQLite storage is the source of truth
-- for that board's tasks and comments (see src/worker/durable-objects/BoardDO.ts).

CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,          -- board slug, also the BoardDO instance name
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks_index (
  id TEXT PRIMARY KEY,          -- mirrors the task id in the owning BoardDO
  board_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  priority TEXT NOT NULL,
  assignee TEXT,
  labels TEXT,                  -- JSON array
  due_date TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (board_id) REFERENCES boards(id)
);

CREATE INDEX IF NOT EXISTS tasks_index_board_id ON tasks_index(board_id);
CREATE INDEX IF NOT EXISTS tasks_index_status ON tasks_index(status);
CREATE INDEX IF NOT EXISTS tasks_index_assignee ON tasks_index(assignee);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,     -- SHA-256 hash of the token; plaintext is never stored
  name TEXT,                    -- human label, e.g. "jugglehire-bugfix-agent"
  created_by TEXT,
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_token_hash ON api_tokens(token_hash);
