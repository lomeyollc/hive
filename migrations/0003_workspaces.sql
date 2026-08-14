-- Workspaces: the multi-tenant boundary. A workspace owns boards; a user
-- must be an active workspace_members row to see or act on that
-- workspace's boards. Invitations are membership rows with status
-- 'invited' and a token — accepting flips them to 'active'.

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'owner' | 'member'
  status TEXT NOT NULL DEFAULT 'invited', -- 'invited' | 'active'
  invite_token TEXT,
  invited_by TEXT,
  invited_at TEXT NOT NULL,
  accepted_at TEXT
);

CREATE INDEX IF NOT EXISTS workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_email ON workspace_members(email);
CREATE UNIQUE INDEX IF NOT EXISTS workspace_members_token ON workspace_members(invite_token);

ALTER TABLE boards ADD COLUMN workspace_id TEXT;
CREATE INDEX IF NOT EXISTS boards_workspace ON boards(workspace_id);
