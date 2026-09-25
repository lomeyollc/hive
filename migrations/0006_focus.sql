-- Focus: the one thing a workspace is pushing on right now (see
-- docs/superpowers/specs/2026-09-25-focus-design.md). One active Focus per
-- workspace is enforced here, at the data layer, by a partial unique index
-- rather than only in application code — an INSERT racing a check-then-insert
-- would otherwise slip a second active Focus through.
--
-- A Focus's tasks are linked by a label (`focus:<focus_id>`) on the task, not
-- a foreign key into BoardDO's own SQLite storage — that keeps this feature
-- entirely inside D1 with no BoardDO/task-schema migration.

CREATE TABLE IF NOT EXISTS focuses (
  id TEXT PRIMARY KEY,                    -- "f-<8 lowercase hex>"
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  title TEXT NOT NULL,
  why TEXT,                               -- one line
  not_list TEXT NOT NULL DEFAULT '[]',    -- JSON string array
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | hit | missed | parked
  lesson TEXT,                            -- set on close
  created_by TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
);

-- At most one active Focus per workspace. SQLite/D1 treats every row as
-- distinct for a partial unique index's WHERE clause, so this only conflicts
-- when a second status='active' row targets the same workspace_id.
CREATE UNIQUE INDEX IF NOT EXISTS focuses_one_active ON focuses(workspace_id) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS focuses_workspace ON focuses(workspace_id);

CREATE TABLE IF NOT EXISTS focus_metrics (
  id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL REFERENCES focuses(id),
  label TEXT NOT NULL,                    -- e.g. "Signups from strangers"
  target REAL NOT NULL,
  current REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS focus_metrics_focus ON focus_metrics(focus_id);
CREATE UNIQUE INDEX IF NOT EXISTS focus_metrics_focus_label ON focus_metrics(focus_id, label);
