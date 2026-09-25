import { NotFoundError, ValidationError } from "../durable-objects/types";

/**
 * Focus — the one thing a workspace is pushing on right now (see
 * docs/superpowers/specs/2026-09-25-focus-design.md). Pure D1 functions used
 * by both the REST API (`../api/routes.ts`) and the MCP tools
 * (`../mcp/tools.ts`) so the two surfaces never duplicate this logic — each
 * just maps its own auth/wire concerns on top of these calls.
 *
 * `focuses.status` is one of `active | hit | missed | parked`. "active" is
 * enforced to at most one row per workspace by the partial unique index
 * `focuses_one_active` (migrations/0006_focus.sql) — `startFocus` relies on
 * that constraint firing rather than a check-then-insert, which would race.
 *
 * A Focus links to tasks by the label `focus:<focus_id>` (see `toWire`'s
 * `task_label`), not a foreign key into a board's own Durable Object SQLite
 * storage — that is what keeps this feature entirely inside D1 with no
 * BoardDO/task-schema migration.
 */

export type FocusStatus = "active" | "hit" | "missed" | "parked";

/** Row shape exactly as stored in D1 — `not_list` is still JSON TEXT here. */
export interface FocusRow {
  id: string;
  workspace_id: string;
  title: string;
  why: string | null;
  not_list: string;
  starts_at: string;
  ends_at: string;
  status: FocusStatus;
  lesson: string | null;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
}

export interface FocusMetricRow {
  id: string;
  focus_id: string;
  label: string;
  target: number;
  current: number;
  position: number;
  updated_by: string | null;
  updated_at: string;
}

export interface FocusMetricWire {
  id: string;
  label: string;
  target: number;
  current: number;
  position: number;
  updated_by: string | null;
  updated_at: string;
}

/** The full Focus shape every caller (REST and MCP) sees — see `toWire`. */
export interface Focus {
  id: string;
  workspace_id: string;
  title: string;
  why: string | null;
  not_list: string[];
  starts_at: string;
  ends_at: string;
  status: FocusStatus;
  lesson: string | null;
  created_by: string | null;
  created_at: string;
  closed_at: string | null;
  metrics: FocusMetricWire[];
  progress: { total: number; done: number };
  days_left: number;
  overdue: boolean;
  /** The label to put on a task to count it toward this Focus's progress. */
  task_label: string;
}

export interface StartFocusInput {
  title: string;
  why?: string | null;
  notList?: string[];
  /** Defaults to now. */
  startsAt?: string;
  endsAt: string;
  metrics?: { label: string; target: number }[];
}

export interface UpdateFocusInput {
  title?: string;
  why?: string | null;
  notList?: string[];
  endsAt?: string;
}

/**
 * Raised when starting a Focus in a workspace that already has one active —
 * mapped to REST 409 (`routes.ts`) and a plain error string over MCP
 * (`tools.ts`), per the design's "clear error" requirement. Thrown instead
 * of a boolean so a caller can't forget to check it.
 */
export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

function newFocusId(): string {
  return `f-${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

function parseNotList(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function assertEndsAfterStarts(startsAt: string, endsAt: string): void {
  if (!(Date.parse(endsAt) > Date.parse(startsAt))) {
    throw new ValidationError("ends_at must be after starts_at");
  }
}

/** The active Focus for a workspace, or null — never throws for "none". */
export async function getActiveFocus(db: D1Database, workspaceId: string): Promise<FocusRow | null> {
  return db
    .prepare(`SELECT * FROM focuses WHERE workspace_id = ? AND status = 'active' LIMIT 1`)
    .bind(workspaceId)
    .first<FocusRow>();
}

export async function getFocusById(db: D1Database, id: string): Promise<FocusRow | null> {
  return db.prepare(`SELECT * FROM focuses WHERE id = ?`).bind(id).first<FocusRow>();
}

/**
 * Closed Focuses for a workspace, newest-closed first — the "past" half of
 * `GET /api/focus`'s `{ active, past }` response and the review history the
 * design calls out as free once Focuses close. `limit` defaults to 20.
 */
export async function listFocuses(db: D1Database, workspaceId: string, limit = 20): Promise<FocusRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM focuses WHERE workspace_id = ? AND status != 'active'
       ORDER BY closed_at DESC, created_at DESC LIMIT ?`,
    )
    .bind(workspaceId, limit)
    .all<FocusRow>();
  return results ?? [];
}

/**
 * Starts a new Focus. Relies on `focuses_one_active`'s partial unique index
 * to reject a second active Focus for the workspace — that D1 UNIQUE
 * violation is caught here and re-thrown as `ConflictError` so both callers
 * get one clear error instead of a raw SQLite message.
 */
export async function startFocus(
  db: D1Database,
  workspaceId: string,
  input: StartFocusInput,
  actor?: string,
): Promise<FocusRow> {
  const title = input.title?.trim();
  if (!title) {
    throw new ValidationError("title is required");
  }
  const startsAt = input.startsAt ?? new Date().toISOString();
  const endsAt = input.endsAt;
  if (!endsAt) {
    throw new ValidationError("ends_at is required");
  }
  assertEndsAfterStarts(startsAt, endsAt);

  // Validated up front, and independently of the DB round-trip below, so a
  // caller mistake (two metrics with the same label) is never mistaken for
  // the one-active-per-workspace conflict — both would otherwise hit a
  // UNIQUE violation at insert time and be indistinguishable by message.
  const metrics = input.metrics ?? [];
  const seenLabels = new Set<string>();
  for (const m of metrics) {
    const label = m.label?.trim();
    if (!label) {
      throw new ValidationError("every metric needs a label");
    }
    if (typeof m.target !== "number" || !Number.isFinite(m.target)) {
      throw new ValidationError(`metric "${m.label}" needs a numeric target`);
    }
    if (seenLabels.has(label)) {
      throw new ValidationError(`duplicate metric label "${label}" — labels must be unique on a focus`);
    }
    seenLabels.add(label);
  }

  // Checked explicitly (rather than relying solely on the UNIQUE violation
  // below) so the common case returns a clean ConflictError without ever
  // reaching the DB write; the index itself remains the race backstop for
  // two concurrent starts, which is the only remaining way this INSERT can
  // hit "UNIQUE constraint failed" now that duplicate labels are rejected
  // above.
  if (await getActiveFocus(db, workspaceId)) {
    throw new ConflictError(`workspace "${workspaceId}" already has an active focus`);
  }

  const id = newFocusId();
  const createdAt = new Date().toISOString();
  const notList = JSON.stringify(input.notList ?? []);

  const statements = [
    db
      .prepare(
        `INSERT INTO focuses (id, workspace_id, title, why, not_list, starts_at, ends_at, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`,
      )
      .bind(id, workspaceId, title, input.why?.trim() || null, notList, startsAt, endsAt, actor ?? null, createdAt),
  ];

  metrics.forEach((m, i) => {
    const label = m.label.trim();
    statements.push(
      db
        .prepare(
          `INSERT INTO focus_metrics (id, focus_id, label, target, current, position, updated_by, updated_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, label, m.target, i, actor ?? null, createdAt),
    );
  });

  try {
    await db.batch(statements);
  } catch (error) {
    const message = (error as Error).message ?? "";
    if (message.includes("UNIQUE constraint failed")) {
      throw new ConflictError(`workspace "${workspaceId}" already has an active focus`);
    }
    throw error;
  }

  const row = await getFocusById(db, id);
  if (!row) {
    throw new NotFoundError(`focus "${id}" not found after creation`);
  }
  return row;
}

/** Edits title/why/not_list/ends_at. Any field left out of `patch` is unchanged. */
export async function updateFocus(db: D1Database, id: string, patch: UpdateFocusInput): Promise<FocusRow> {
  const existing = await getFocusById(db, id);
  if (!existing) {
    throw new NotFoundError(`focus "${id}" not found`);
  }

  const title = patch.title !== undefined ? patch.title.trim() : existing.title;
  if (!title) {
    throw new ValidationError("title cannot be empty");
  }
  const endsAt = patch.endsAt ?? existing.ends_at;
  assertEndsAfterStarts(existing.starts_at, endsAt);

  const why = patch.why !== undefined ? patch.why?.trim() || null : existing.why;
  const notList = patch.notList !== undefined ? JSON.stringify(patch.notList) : existing.not_list;

  await db
    .prepare(`UPDATE focuses SET title = ?, why = ?, not_list = ?, ends_at = ? WHERE id = ?`)
    .bind(title, why, notList, endsAt, id)
    .run();

  const row = await getFocusById(db, id);
  if (!row) {
    throw new NotFoundError(`focus "${id}" not found`);
  }
  return row;
}

/**
 * Closes an active Focus — sets `status` (must be hit/missed/parked) and
 * `closed_at`, freeing the workspace's active slot for a new Focus. Only an
 * active Focus can be closed; closing is not reversible through this call.
 */
export async function closeFocus(
  db: D1Database,
  id: string,
  status: Exclude<FocusStatus, "active">,
  lesson?: string | null,
): Promise<FocusRow> {
  if (status !== "hit" && status !== "missed" && status !== "parked") {
    throw new ValidationError('status must be one of "hit", "missed", "parked"');
  }
  const existing = await getFocusById(db, id);
  if (!existing) {
    throw new NotFoundError(`focus "${id}" not found`);
  }
  if (existing.status !== "active") {
    throw new ValidationError(`focus "${id}" is already closed`);
  }

  const closedAt = new Date().toISOString();
  await db
    .prepare(`UPDATE focuses SET status = ?, lesson = ?, closed_at = ? WHERE id = ?`)
    .bind(status, lesson?.trim() || null, closedAt, id)
    .run();

  const row = await getFocusById(db, id);
  if (!row) {
    throw new NotFoundError(`focus "${id}" not found`);
  }
  return row;
}

/**
 * Upserts a metric by (focus_id, label) — the number-push path agents and
 * the dashboard both call to move `current`. `target` is required when
 * creating a metric for the first time, optional (leave unchanged) when
 * updating one that already exists; `current` is optional either way and
 * defaults to 0 on create.
 */
export async function setMetric(
  db: D1Database,
  focusId: string,
  label: string,
  values: { current?: number; target?: number },
  actor?: string,
): Promise<FocusMetricRow> {
  const focus = await getFocusById(db, focusId);
  if (!focus) {
    throw new NotFoundError(`focus "${focusId}" not found`);
  }
  const trimmedLabel = label?.trim();
  if (!trimmedLabel) {
    throw new ValidationError("label is required");
  }

  // Zod covers this on the MCP path, but REST's `PATCH /api/focus/:id`
  // forwards raw parsed JSON (see routes.ts) — a string, null, or NaN would
  // otherwise land straight into a REAL column. `values` is typed
  // `number | undefined` at compile time, but nothing enforces that at
  // the JSON boundary, hence the explicit runtime check here rather than
  // trusting the type.
  for (const [field, value] of Object.entries(values) as ["current" | "target", unknown][]) {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new ValidationError(`metric "${trimmedLabel}" ${field} must be a finite number`);
    }
  }

  const existing = await db
    .prepare(`SELECT * FROM focus_metrics WHERE focus_id = ? AND label = ?`)
    .bind(focusId, trimmedLabel)
    .first<FocusMetricRow>();

  const now = new Date().toISOString();

  if (existing) {
    const current = values.current ?? existing.current;
    const target = values.target ?? existing.target;
    await db
      .prepare(`UPDATE focus_metrics SET current = ?, target = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(current, target, actor ?? null, now, existing.id)
      .run();
    return { ...existing, current, target, updated_by: actor ?? null, updated_at: now };
  }

  if (values.target === undefined) {
    throw new ValidationError(`metric "${trimmedLabel}" needs a target — it doesn't exist yet`);
  }

  const { results: countRows } = await db
    .prepare(`SELECT COUNT(*) AS count FROM focus_metrics WHERE focus_id = ?`)
    .bind(focusId)
    .all<{ count: number }>();
  const position = countRows?.[0]?.count ?? 0;

  const row: FocusMetricRow = {
    id: crypto.randomUUID(),
    focus_id: focusId,
    label: trimmedLabel,
    target: values.target,
    current: values.current ?? 0,
    position,
    updated_by: actor ?? null,
    updated_at: now,
  };
  await db
    .prepare(
      `INSERT INTO focus_metrics (id, focus_id, label, target, current, position, updated_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(row.id, row.focus_id, row.label, row.target, row.current, row.position, row.updated_by, row.updated_at)
    .run();
  return row;
}

/**
 * Task progress toward a Focus: counts non-archived `tasks_index` rows
 * carrying the label `focus:<focus_id>`, restricted to boards in the
 * Focus's workspace (so a task on someone else's board can't inflate a
 * workspace's own Focus just by reusing its id in a label string).
 * `done` counts the subset whose status is exactly "done".
 */
export async function focusProgress(
  db: D1Database,
  workspaceId: string,
  focusId: string,
): Promise<{ total: number; done: number }> {
  const like = `%"focus:${focusId}"%`;
  const row = await db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done
       FROM tasks_index t
       JOIN boards b ON b.id = t.board_id
       WHERE b.workspace_id = ? AND t.archived_at IS NULL AND t.labels LIKE ?`,
    )
    .bind(workspaceId, like)
    .first<{ total: number; done: number | null }>();

  return { total: row?.total ?? 0, done: row?.done ?? 0 };
}

/**
 * Maps a stored `FocusRow` to the full wire shape every caller sees:
 * metrics (ordered), task progress, days left, and the overdue flag — the
 * design's "a Focus response always includes" list. Only `focusProgress`
 * needs `workspaceId` separately; it's always `row.workspace_id` here, kept
 * as an explicit param on `focusProgress` itself since REST/MCP sometimes
 * already have the workspace id in hand and would otherwise re-derive it.
 */
export async function toWire(db: D1Database, row: FocusRow): Promise<Focus> {
  const [{ results: metricRows }, progress] = await Promise.all([
    db
      .prepare(`SELECT * FROM focus_metrics WHERE focus_id = ? ORDER BY position ASC`)
      .bind(row.id)
      .all<FocusMetricRow>(),
    focusProgress(db, row.workspace_id, row.id),
  ]);

  const daysLeft = Math.ceil((Date.parse(row.ends_at) - Date.now()) / 86_400_000);
  const overdue = row.status === "active" && Date.now() > Date.parse(row.ends_at);

  return {
    id: row.id,
    workspace_id: row.workspace_id,
    title: row.title,
    why: row.why,
    not_list: parseNotList(row.not_list),
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    lesson: row.lesson,
    created_by: row.created_by,
    created_at: row.created_at,
    closed_at: row.closed_at,
    metrics: (metricRows ?? []).map((m) => ({
      id: m.id,
      label: m.label,
      target: m.target,
      current: m.current,
      position: m.position,
      updated_by: m.updated_by,
      updated_at: m.updated_at,
    })),
    progress,
    days_left: daysLeft,
    overdue,
    task_label: `focus:${row.id}`,
  };
}
