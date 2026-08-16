-- Cross-board "All work" view + archive.
--
-- Two gaps in tasks_index blocked a single flat list across every board:
--   1. no created_at  — so "newest first" and "created today" were impossible
--                       without opening every board's Durable Object
--   2. no archived_at — the new cold-storage field (see Task.archivedAt in
--                       src/worker/durable-objects/types.ts). Deliberately a
--                       nullable timestamp, not a board column: a column would
--                       have to exist on every board, would pollute the column
--                       list and the count badges, and would force a task to
--                       give up its real status just to be archived.
--
-- Both are mirrored by BoardDO.#syncTaskToIndex on every write. The DO's own
-- SQLite stays authoritative; this table is still only ever a read index.

ALTER TABLE tasks_index ADD COLUMN created_at TEXT;
ALTER TABLE tasks_index ADD COLUMN archived_at TEXT;

-- Seed created_at for rows written before this migration. updated_at is the
-- only timestamp those rows carry, so it is an upper bound, not the truth —
-- run BoardDO.resyncIndex() (POST /api/boards/:slug/resync) per board to
-- replace these with the real values from the authoritative store.
UPDATE tasks_index SET created_at = updated_at WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS tasks_index_archived_at ON tasks_index(archived_at);
CREATE INDEX IF NOT EXISTS tasks_index_created_at ON tasks_index(created_at);
CREATE INDEX IF NOT EXISTS tasks_index_priority ON tasks_index(priority);
CREATE INDEX IF NOT EXISTS tasks_index_updated_at ON tasks_index(updated_at);
