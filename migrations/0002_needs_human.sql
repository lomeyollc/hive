-- The escalation primitive: a task can flag that it needs a human decision.
-- This is the mechanic the whole project was originally asked for — an
-- agent gets stuck, sets needs_human=1 (+ a reason), Hive pings Telegram
-- immediately and rolls unresolved ones into a daily digest. Resolving it
-- (a human sets needs_human back to 0) is what "unblocks" the agent.

ALTER TABLE tasks_index ADD COLUMN needs_human INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks_index ADD COLUMN needs_human_reason TEXT;

CREATE INDEX IF NOT EXISTS tasks_index_needs_human ON tasks_index(needs_human);
