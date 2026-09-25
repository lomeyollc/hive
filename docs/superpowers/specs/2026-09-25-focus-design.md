# Focus — design

Date: 2026-09-25 · Hive ticket: f5d04393 · Status: approved in chat

## Why

A solo founder works in pushes longer than a task: "Launch S&C", "Fix JH trial→paid".
Today that lives in `context/zakir/this-week.md`, which went 19 days stale with no warning.
A Focus puts the push inside Hive, on every page, readable by every agent through one call.

Main jobs (Zakir's answer): **keep me on one thing** and **track the campaign**. History of
closed Focuses gives the weekly review for free.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Active count | **One active Focus per workspace.** Starting a second while one is active fails |
| Who updates numbers | Agents / products push via the existing Hive API tokens (MCP). No DB pulls |
| Task link | Label `focus:<focus_id>` on the task. No BoardDO or task schema change |
| Duration | 1–4 weeks is advice, not enforced. `ends_at` is required |

Cross-check against the code (2026-09-25):
- Hive is multi-workspace, so "one active" is per workspace, resolved like `create_board` does.
- Tasks live in BoardDO SQLite. A label link avoids a DO migration; `/api/tasks` already filters
  by `label`, and `tasks_index.labels` is JSON in D1, so progress is one D1 query.
- Deploy is manual (`npm run d1:migrate:remote` then `npm run deploy`); CI only checks.

## Data — migration `0006_focus.sql`

```sql
focuses (
  id TEXT PRIMARY KEY,            -- short slug-safe id, e.g. "f-<8 hex>"
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  why TEXT,                       -- one line
  not_list TEXT NOT NULL DEFAULT '[]',  -- JSON string array
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active | hit | missed | parked
  lesson TEXT,                    -- set on close
  created_by TEXT,
  created_at TEXT NOT NULL,
  closed_at TEXT
)
-- partial unique index: at most one active per workspace
CREATE UNIQUE INDEX focuses_one_active ON focuses(workspace_id) WHERE status = 'active';

focus_metrics (
  id TEXT PRIMARY KEY,
  focus_id TEXT NOT NULL REFERENCES focuses(id),
  label TEXT NOT NULL,            -- "Signups from strangers"
  target REAL NOT NULL,
  current REAL NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  updated_by TEXT,
  updated_at TEXT NOT NULL
)
```

## Worker module — `src/worker/focus/`

One module with pure D1 functions, used by both REST and MCP (no duplicated logic):
`getActiveFocus(db, workspaceId)`, `listFocuses(db, workspaceId)`, `startFocus(...)`,
`updateFocus(...)` (title/why/not_list/ends_at), `closeFocus(db, id, status, lesson)`,
`setMetric(db, focusId, label, {current?, target?}, actor)` (upsert by label),
`focusProgress(db, workspaceId, focusId)` → `{ total, done }` from `tasks_index`
(labels LIKE `%"focus:<id>"%`, archived excluded; done = status `done`).

A Focus response always includes: fields, `metrics[]`, `progress`, `days_left`, and
`overdue: boolean` (now > ends_at and still active).

## REST (session auth, dashboard)

| Route | Does |
|---|---|
| `GET /api/focus?workspace_id=` | `{ active: Focus \| null, past: Focus[] }` |
| `POST /api/focus` | start; 409 if one is active |
| `PATCH /api/focus/:id` | edit title/why/not_list/ends_at, metrics targets |
| `POST /api/focus/:id/close` `{ status, lesson? }` | close as hit/missed/parked |

Caller must be an active member of the Focus's workspace (same rule as boards).

## MCP (token auth, agents)

| Tool | Does |
|---|---|
| `get_active_focus` | the active Focus, or `null` with a note. Agents call this instead of reading this-week.md |
| `start_focus` | title, why, not_list[], ends_at, metrics[{label,target}] |
| `update_focus_metric` | label + current (and optional target). The number push path |
| `close_focus` | status hit/missed/parked + lesson |

`workspace_id` optional on all four — resolved exactly like `create_board`.
`create_task` / `update_task` need nothing new: agents add the label `focus:<id>`;
`get_active_focus` returns that label string ready to use.

## UI

- **FocusBanner** in `AppShell`, under the header, every page: title, days left, metric bars
  (current/target), task progress, link to `/focus`. Hidden when no active Focus.
  **Overdue** → red banner: "Past its end date — close or extend".
- **`/focus` page**: active Focus with edit, metric inline edit, NOT list, close dialog;
  below it, past Focuses with result + lesson. Empty state has a "Start a Focus" button.
- **Task dialogs**: a "Part of current Focus" checkbox that adds/removes the `focus:<id>` label.
- Nav link "Focus" (lucide `Target` icon).

## Out of scope

Nested epics, dependencies, Gantt, one Focus per product, pulling numbers from product DBs,
Telegram nudges (possible follow-up), replacing `this-week.md` in agent prompts (separate
change outside this repo).

## Testing

Vitest in the workers pool (real D1 with migrations): start, second-start conflict,
metric upsert, progress count from `tasks_index`, close, overdue flag. `npm run check`,
`npm test`, `npm run build` green before merge.
