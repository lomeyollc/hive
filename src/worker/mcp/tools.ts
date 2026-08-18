import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { AuthedToken } from "./auth";
import type { BoardDOStub, BoardRow, Task } from "./contract";

/**
 * Env slice the tools need. Kept narrow (rather than importing the global
 * `Env` from worker-configuration.d.ts) so this file has no build-order
 * dependency on the generated types.
 *
 * `BOARD_DO` is intentionally left untyped-generic here: the concrete
 * `DurableObjectNamespace<BoardDO>` binding lives in the generated `Env`,
 * and Workers RPC's branded generics don't structurally unify with the
 * `BoardDOStub` interface above while BoardDO is still a scaffold. The
 * `.getByName(...)` stub is cast to `BoardDOStub` at the one call site
 * below (`boardStub`) — once BoardDO implements that surface for real,
 * this is a correct runtime call regardless of the compile-time cast.
 */
export interface McpEnv {
  BOARD_DO: DurableObjectNamespace;
  DB: D1Database;
}

const priorityEnum = z.enum(["low", "normal", "high", "urgent"]);
// A status is a per-board column id — boards define their own columns now,
// so this can't be a fixed enum. Call list_columns first to see valid
// values for a given board; every board starts with "planned", "open",
// "in_progress", "blocked", "done" but any of those may have been renamed,
// deleted (if custom), or joined by new custom columns since.
const statusSchema = z.string().describe('A column id on this board — call list_columns to see valid values. Defaults to the board\'s "open"-role column.');
const recurrenceEnum = z.enum(["daily", "weekly", "monthly"]);

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function boardStub(env: McpEnv, board: string): BoardDOStub {
  return env.BOARD_DO.getByName(board) as unknown as BoardDOStub;
}

/**
 * Gate for every board-scoped tool (create/get/update/delete/claim/comment/
 * list task). A token only acts within workspaces its owning human is an
 * active member of — without this, any valid token could read/write any
 * board by slug, regardless of who created the token. Throws (caught by
 * each tool's own try/catch, surfaced as a normal `err()` result) rather
 * than returning a boolean so callers can't forget to check it.
 */
async function requireBoardAccess(env: McpEnv, token: AuthedToken, board: string): Promise<void> {
  const row = token.createdBy
    ? await env.DB.prepare(
        `SELECT 1 FROM boards b JOIN workspace_members m ON m.workspace_id = b.workspace_id
         WHERE b.id = ? AND m.email = ? AND m.status = 'active' LIMIT 1`,
      )
        .bind(board, token.createdBy)
        .first()
    : null;
  if (!row) {
    throw new Error(`board "${board}" not found`);
  }
}

/** tasks_index stores labels as JSON TEXT; every task shape agents see carries a real array. */
function parseLabels(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

/** Identity string recorded as `createdBy` / `claimedBy` for agent-driven writes. */
function actorFor(token: AuthedToken): string {
  return token.name ? `agent:${token.name}` : `agent:${token.id}`;
}

/**
 * Registers every Hive MCP tool on the given server instance. Called once
 * per request (see index.ts — the transport runs in stateless mode, so a
 * fresh McpServer is built per request) with the authenticated token bound
 * as the acting identity for writes.
 */
export function registerTools(server: McpServer, env: McpEnv, token: AuthedToken): void {
  server.registerTool(
    "create_task",
    {
      title: "Create Task",
      description: "Create a new task on a board.",
      inputSchema: {
        board: z.string().describe("Board slug, e.g. \"engineering\""),
        title: z.string().min(1).describe("Task title"),
        description: z.string().optional(),
        status: statusSchema.optional(),
        priority: priorityEnum.optional().describe("Defaults to \"normal\""),
        assignee: z.string().optional(),
        labels: z.array(z.string()).optional(),
        due_date: z.string().optional().describe("ISO 8601 date"),
        needs_human: z
          .boolean()
          .optional()
          .describe(
            "Set true when you're stuck and need a human decision. Pings Telegram immediately " +
              "and rolls into the daily digest until a human clears it back to false.",
          ),
        needs_human_reason: z.string().optional().describe("Why you're stuck — shown in the ping."),
        parent_task_id: z.string().optional().describe("Make this a sub-task of an existing task id."),
        recurrence: recurrenceEnum
          .optional()
          .describe("If set, completing this task auto-creates its next occurrence."),
      },
    },
    async ({
      board,
      title,
      description,
      status,
      priority,
      assignee,
      labels,
      due_date,
      needs_human,
      needs_human_reason,
      parent_task_id,
      recurrence,
    }) => {
      try {
        await requireBoardAccess(env, token, board);
        const task = await boardStub(env, board).createTask({
          title,
          description,
          status,
          priority,
          assignee,
          labels,
          dueDate: due_date,
          createdBy: actorFor(token),
          needsHuman: needs_human,
          needsHumanReason: needs_human_reason,
          parentTaskId: parent_task_id,
          recurrence,
        });
        return ok(task);
      } catch (e) {
        return err(`create_task failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "get_task",
    {
      title: "Get Task",
      description: "Fetch a single task by id from a board.",
      inputSchema: {
        board: z.string(),
        task_id: z.string(),
      },
    },
    async ({ board, task_id }) => {
      try {
        await requireBoardAccess(env, token, board);
        const task = await boardStub(env, board).getTask(task_id);
        return ok(task);
      } catch (e) {
        return err(`get_task failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "update_task",
    {
      title: "Update Task",
      description:
        "Update one or more fields on a task (partial patch — omitted fields are left unchanged).",
      inputSchema: {
        board: z.string(),
        task_id: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        status: statusSchema.optional(),
        priority: priorityEnum.optional(),
        assignee: z.string().optional(),
        labels: z.array(z.string()).optional(),
        due_date: z.string().optional(),
        needs_human: z
          .boolean()
          .optional()
          .describe(
            "Set true when stuck and need a human decision (pings Telegram once), or false to clear/resolve it.",
          ),
        needs_human_reason: z.string().optional().describe("Why you're stuck — shown in the ping."),
        archived: z
          .boolean()
          .optional()
          .describe(
            "true moves the task to cold storage: it keeps its status but disappears from every " +
              "default view, count and claim_next_task pool. false restores it. Archive instead " +
              "of deleting when the work is real but nobody is going to do it.",
          ),
        parent_task_id: z
          .string()
          .nullable()
          .optional()
          .describe("Make this a sub-task of an existing task id, or null to un-parent it."),
        recurrence: recurrenceEnum
          .nullable()
          .optional()
          .describe("If set, completing this task auto-creates its next occurrence. Null clears it."),
      },
    },
    async ({ board, task_id, due_date, needs_human, needs_human_reason, archived, parent_task_id, ...patch }) => {
      try {
        await requireBoardAccess(env, token, board);
        const task = await boardStub(env, board).updateTask(task_id, {
          ...patch,
          dueDate: due_date,
          needsHuman: needs_human,
          needsHumanReason: needs_human_reason,
          archivedAt: archived === undefined ? undefined : archived ? new Date().toISOString() : null,
          parentTaskId: parent_task_id,
        });
        return ok(task);
      } catch (e) {
        return err(`update_task failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "claim_next_task",
    {
      title: "Claim Next Task",
      description:
        "Atomically claim the first unclaimed open task on a board matching an optional filter. " +
        "Race-free across concurrent agents because the board's Durable Object serializes all requests. " +
        "Returns null (no error) when nothing matches.",
      inputSchema: {
        board: z.string(),
        priority: priorityEnum.optional().describe("Only claim a task at exactly this priority"),
        assignee: z.string().optional().describe("Only claim a task already assigned (but unclaimed) to this name"),
        label: z.string().optional().describe("Only claim a task carrying this label"),
      },
    },
    async ({ board, priority, assignee, label }) => {
      try {
        await requireBoardAccess(env, token, board);
        const task = await boardStub(env, board).claimNextTask(
          { priority, assignee, label },
          actorFor(token)
        );
        return ok(task);
      } catch (e) {
        return err(`claim_next_task failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "delete_task",
    {
      title: "Delete Task",
      description: "Permanently delete a task. No confirmation step — the caller decides.",
      inputSchema: {
        board: z.string(),
        task_id: z.string(),
      },
    },
    async ({ board, task_id }) => {
      try {
        await requireBoardAccess(env, token, board);
        await boardStub(env, board).deleteTask(task_id);
        return ok({ deleted: task_id });
      } catch (e) {
        return err(`delete_task failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "comment_task",
    {
      title: "Comment on Task",
      description: "Add a comment to a task.",
      inputSchema: {
        board: z.string(),
        task_id: z.string(),
        author: z.string().describe("Display name of the commenter"),
        body: z.string().min(1),
      },
    },
    async ({ board, task_id, author, body }) => {
      try {
        await requireBoardAccess(env, token, board);
        const comment = await boardStub(env, board).commentTask(task_id, { author, body });
        return ok(comment);
      } catch (e) {
        return err(`comment_task failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "List Tasks",
      description:
        "List tasks, on one board or across every board you can see. Omit `board` for the " +
        "cross-board view — that reads the D1 index and supports priority/needs_human/" +
        "updated_since/limit filters, which the single-board path does not. Pass `board` " +
        "when you need a board's authoritative live state (it reads that board's Durable " +
        "Object directly and can also filter by parent_task_id). Archived tasks are " +
        "excluded from both unless you ask for them.",
      inputSchema: {
        board: z.string().optional().describe("Board slug. Omit to search across every board you can see."),
        status: statusSchema.optional(),
        assignee: z.string().optional(),
        label: z.string().optional(),
        priority: priorityEnum.optional().describe("Cross-board only (omit `board`)."),
        needs_human: z.boolean().optional().describe("Cross-board only — true returns just the tasks flagged as blocked on a human."),
        updated_since: z.string().optional().describe("Cross-board only — ISO 8601 timestamp; only tasks touched after it."),
        archived: z
          .enum(["exclude", "only", "all"])
          .optional()
          .describe('Archived tasks are cold storage and hidden by default. "only" lists the archive itself.'),
        limit: z.number().int().min(1).max(1000).optional().describe("Cross-board only. Defaults to 200."),
        parent_task_id: z.string().optional().describe("Single-board only — list sub-tasks of this task id."),
      },
    },
    async ({ board, parent_task_id, priority, needs_human, updated_since, limit, archived, ...filter }) => {
      try {
        if (board) {
          await requireBoardAccess(env, token, board);
          const tasks: Task[] = await boardStub(env, board).listTasks({
            ...filter,
            parentTaskId: parent_task_id,
            archived,
          });
          return ok(tasks);
        }

        // Cross-board: the D1 index, scoped to the token owner's active
        // workspace memberships — never a fan-out across every board's DO.
        if (!token.createdBy) return ok([]);
        const clauses = ["m.email = ?", "m.status = 'active'"];
        const binds: (string | number)[] = [token.createdBy];
        if (filter.status) {
          clauses.push("t.status = ?");
          binds.push(filter.status);
        }
        if (filter.assignee) {
          clauses.push("t.assignee = ?");
          binds.push(filter.assignee);
        }
        if (filter.label) {
          clauses.push("t.labels LIKE ?");
          binds.push(`%"${filter.label}"%`);
        }
        if (priority) {
          clauses.push("t.priority = ?");
          binds.push(priority);
        }
        if (needs_human !== undefined) {
          clauses.push("t.needs_human = ?");
          binds.push(needs_human ? 1 : 0);
        }
        if (updated_since) {
          clauses.push("t.updated_at > ?");
          binds.push(updated_since);
        }
        if (archived === "only") {
          clauses.push("t.archived_at IS NOT NULL");
        } else if (archived !== "all") {
          clauses.push("t.archived_at IS NULL");
        }
        binds.push(limit ?? 200);

        const { results } = await env.DB.prepare(
          `SELECT t.id, t.board_id, b.name AS board_name, t.title, t.description, t.status,
                  t.priority, t.assignee, t.labels, t.due_date,
                  COALESCE(t.created_at, t.updated_at) AS created_at, t.updated_at,
                  t.needs_human, t.needs_human_reason, t.archived_at
           FROM tasks_index t
           JOIN boards b ON b.id = t.board_id
           JOIN workspace_members m ON m.workspace_id = b.workspace_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY
             CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END ASC,
             t.updated_at DESC
           LIMIT ?`
        )
          .bind(...binds)
          .all<Record<string, unknown>>();

        return ok(
          (results ?? []).map((r) => ({
            ...r,
            labels: parseLabels(r.labels as string | null),
            needs_human: r.needs_human === 1,
          }))
        );
      } catch (e) {
        return err(`list_tasks failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "bulk_update_tasks",
    {
      title: "Bulk Update Tasks",
      description:
        "Apply one patch to many tasks at once, across any number of boards — the tool to " +
        "reach for when cleaning up a backlog (archive 20 stale tasks, re-prioritize a " +
        "label, reassign a batch) instead of calling update_task in a loop. Partial " +
        "failures are reported per task rather than rolling back the rest.",
      inputSchema: {
        items: z
          .array(z.object({ board: z.string(), task_id: z.string() }))
          .min(1)
          .max(200)
          .describe("The tasks to patch. Capped at 200 per call."),
        status: statusSchema.optional(),
        priority: priorityEnum.optional(),
        assignee: z.string().nullable().optional(),
        labels: z.array(z.string()).optional(),
        due_date: z.string().nullable().optional(),
        needs_human: z.boolean().optional(),
        needs_human_reason: z.string().nullable().optional(),
        archived: z.boolean().optional().describe("true archives (cold storage, hidden by default), false restores."),
      },
    },
    async ({ items, archived, due_date, needs_human, needs_human_reason, ...rest }) => {
      try {
        const patch = {
          ...rest,
          dueDate: due_date,
          needsHuman: needs_human,
          needsHumanReason: needs_human_reason,
          archivedAt: archived === undefined ? undefined : archived ? new Date().toISOString() : null,
        };
        if (Object.values(patch).every((v) => v === undefined)) {
          return err("bulk_update_tasks failed: at least one field to change is required");
        }

        // Group by board so each DO is fetched once, and check access once
        // per board before any write rather than per task.
        const byBoard = new Map<string, string[]>();
        for (const item of items) {
          const ids = byBoard.get(item.board) ?? [];
          ids.push(item.task_id);
          byBoard.set(item.board, ids);
        }
        for (const board of byBoard.keys()) {
          await requireBoardAccess(env, token, board);
        }

        const updated: Task[] = [];
        const failed: { board: string; task_id: string; error: string }[] = [];
        for (const [board, ids] of byBoard) {
          const stub = boardStub(env, board);
          for (const task_id of ids) {
            try {
              updated.push(await stub.updateTask(task_id, patch));
            } catch (e) {
              failed.push({ board, task_id, error: (e as Error).message });
            }
          }
        }
        return ok({ updated_count: updated.length, failed_count: failed.length, updated, failed });
      } catch (e) {
        return err(`bulk_update_tasks failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "resync_board_index",
    {
      title: "Resync Board Index",
      description:
        "Replays a board's tasks from its Durable Object (the source of truth) into the D1 " +
        "index that cross-board listing and search read. Repair tool for that mirror, which " +
        "is written fire-and-forget and so can drift after a D1 hiccup or a newly added " +
        "column. Safe to run any time — it only ever moves the index toward the truth.",
      inputSchema: { board: z.string() },
    },
    async ({ board }) => {
      try {
        await requireBoardAccess(env, token, board);
        return ok({ board, synced: await boardStub(env, board).resyncIndex() });
      } catch (e) {
        return err(`resync_board_index failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "list_boards",
    {
      title: "List Boards",
      description:
        "List boards in workspaces the token owner is an active member of (D1 cross-board index, not a DO call).",
      inputSchema: {},
    },
    async () => {
      try {
        if (!token.createdBy) return ok([]);
        const { results } = await env.DB.prepare(
          `SELECT b.id, b.name, b.description, b.created_at FROM boards b
           JOIN workspace_members m ON m.workspace_id = b.workspace_id
           WHERE m.email = ? AND m.status = 'active' ORDER BY b.name ASC`
        )
          .bind(token.createdBy)
          .all<BoardRow>();
        return ok(results ?? []);
      } catch (e) {
        return err(`list_boards failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "create_board",
    {
      title: "Create Board",
      description:
        "Create a new board. `id` is the slug every other tool takes as `board` — lowercase letters, numbers and " +
        "hyphens only, and permanent. The board starts with the standard columns (planned, open, in_progress, " +
        "blocked, done). Omit `workspace_id` when you belong to exactly one workspace. Deleting a board is " +
        "deliberately not exposed here — that stays a dashboard action.",
      inputSchema: {
        id: z
          .string()
          .regex(/^[a-z0-9-]+$/, "id must be lowercase letters, numbers and hyphens only")
          .describe("Board slug, e.g. \"jeffclaw\". Permanent — this is what every other tool passes as `board`."),
        name: z.string().min(1).describe("Human-readable board name shown in the dashboard."),
        description: z.string().optional(),
        workspace_id: z
          .string()
          .optional()
          .describe("Only needed when you are an active member of more than one workspace."),
      },
    },
    async ({ id, name, description, workspace_id }) => {
      try {
        if (!token.createdBy) {
          return err("create_board failed: this token has no owner, so no workspace can be resolved");
        }

        // Resolve the workspace before touching anything: either the caller named
        // one (and must be an active member of it), or they belong to exactly one.
        let workspaceId = workspace_id?.trim();
        if (workspaceId) {
          const member = await env.DB.prepare(
            `SELECT 1 FROM workspace_members WHERE workspace_id = ? AND email = ? AND status = 'active' LIMIT 1`
          )
            .bind(workspaceId, token.createdBy)
            .first();
          if (!member) {
            return err(`create_board failed: not an active member of workspace "${workspaceId}"`);
          }
        } else {
          const { results } = await env.DB.prepare(
            `SELECT workspace_id FROM workspace_members WHERE email = ? AND status = 'active'`
          )
            .bind(token.createdBy)
            .all<{ workspace_id: string }>();
          const ids = (results ?? []).map((r) => r.workspace_id);
          if (ids.length === 0) {
            return err("create_board failed: you are not an active member of any workspace");
          }
          if (ids.length > 1) {
            return err(
              `create_board failed: you belong to ${ids.length} workspaces (${ids.join(", ")}) — pass workspace_id to pick one`
            );
          }
          workspaceId = ids[0];
        }

        // A duplicate slug would otherwise surface as an opaque D1 constraint error,
        // and silently adopting an existing board is worse than refusing.
        const existing = await env.DB.prepare(`SELECT 1 FROM boards WHERE id = ? LIMIT 1`).bind(id).first();
        if (existing) {
          return err(`create_board failed: board "${id}" already exists`);
        }

        const createdAt = new Date().toISOString();
        await env.DB.prepare(
          `INSERT INTO boards (id, name, description, created_at, workspace_id) VALUES (?, ?, ?, ?, ?)`
        )
          .bind(id, name.trim(), description?.trim() || null, createdAt, workspaceId)
          .run();

        // First call into the board's Durable Object runs its migration, which is
        // what seeds the default columns. Return them so the caller can use a
        // valid `status` immediately without a second round-trip.
        const columns = await boardStub(env, id).listColumns();

        return ok({
          id,
          name: name.trim(),
          description: description?.trim() || null,
          workspace_id: workspaceId,
          created_at: createdAt,
          columns,
        });
      } catch (e) {
        return err(`create_board failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "list_activity",
    {
      title: "List Activity",
      description:
        "Cross-board activity feed — task created/updated/claimed/deleted, comments added. Scoped to workspaces you're an active member of. Use `since` to poll for what happened after your last check.",
      inputSchema: {
        board: z.string().optional().describe("Limit to one board's slug."),
        type: z
          .enum(["task.created", "task.updated", "task.claimed", "task.deleted", "comment.created"])
          .optional(),
        since: z.string().optional().describe("ISO 8601 timestamp — only events after this."),
        limit: z.number().int().min(1).max(200).optional().describe("Defaults to 50."),
      },
    },
    async ({ board, type, since, limit }) => {
      try {
        if (!token.createdBy) return ok({ items: [] });
        const clauses = ["m.email = ?", "m.status = 'active'"];
        const binds: (string | number)[] = [token.createdBy];
        if (board) {
          clauses.push("a.board_id = ?");
          binds.push(board);
        }
        if (type) {
          clauses.push("a.type = ?");
          binds.push(type);
        }
        if (since) {
          clauses.push("a.created_at > ?");
          binds.push(since);
        }
        binds.push(limit ?? 50);
        const { results } = await env.DB.prepare(
          `SELECT a.id, a.board_id, b.name AS board_name, a.task_id, a.type, a.actor, a.summary, a.created_at
           FROM activity_log a
           JOIN boards b ON b.id = a.board_id
           JOIN workspace_members m ON m.workspace_id = a.workspace_id
           WHERE ${clauses.join(" AND ")}
           ORDER BY a.created_at DESC LIMIT ?`
        )
          .bind(...binds)
          .all();
        return ok({ items: results ?? [] });
      } catch (e) {
        return err(`list_activity failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "search",
    {
      title: "Search",
      description:
        "Cross-board substring search over task title/description and comment body, scoped to workspaces you're an active member of.",
      inputSchema: {
        q: z.string().min(1),
      },
    },
    async ({ q }) => {
      try {
        if (!token.createdBy) return ok({ tasks: [], comments: [] });
        const like = `%${q}%`;
        const [taskRows, commentRows] = await Promise.all([
          env.DB.prepare(
            `SELECT t.id, t.board_id, b.name AS board_name, t.title, t.status, t.priority, t.updated_at
             FROM tasks_index t
             JOIN boards b ON b.id = t.board_id
             JOIN workspace_members m ON m.workspace_id = b.workspace_id
             WHERE m.email = ? AND m.status = 'active' AND (t.title LIKE ? OR t.description LIKE ?)
             ORDER BY t.updated_at DESC LIMIT 50`
          )
            .bind(token.createdBy, like, like)
            .all(),
          env.DB.prepare(
            `SELECT c.id, c.board_id, b.name AS board_name, c.task_id, c.author, c.body, c.created_at
             FROM comments_index c
             JOIN boards b ON b.id = c.board_id
             JOIN workspace_members m ON m.workspace_id = b.workspace_id
             WHERE m.email = ? AND m.status = 'active' AND c.body LIKE ?
             ORDER BY c.created_at DESC LIMIT 50`
          )
            .bind(token.createdBy, like)
            .all(),
        ]);
        return ok({ tasks: taskRows.results ?? [], comments: commentRows.results ?? [] });
      } catch (e) {
        return err(`search failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "list_columns",
    {
      title: "List Columns",
      description:
        "List a board's columns in order. Every task's `status` is one of these columns' ids — call this before " +
        "create_task/update_task if you don't already know the board's valid status values.",
      inputSchema: { board: z.string() },
    },
    async ({ board }) => {
      try {
        await requireBoardAccess(env, token, board);
        return ok(await boardStub(env, board).listColumns());
      } catch (e) {
        return err(`list_columns failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "create_column",
    {
      title: "Create Column",
      description: "Add a new column to a board. Always appended at the end — use reorder_columns to reposition it.",
      inputSchema: { board: z.string(), name: z.string().min(1) },
    },
    async ({ board, name }) => {
      try {
        await requireBoardAccess(env, token, board);
        return ok(await boardStub(env, board).createColumn({ name }));
      } catch (e) {
        return err(`create_column failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "update_column",
    {
      title: "Update Column",
      description: "Rename a column.",
      inputSchema: { board: z.string(), column_id: z.string(), name: z.string().min(1) },
    },
    async ({ board, column_id, name }) => {
      try {
        await requireBoardAccess(env, token, board);
        return ok(await boardStub(env, board).updateColumn(column_id, { name }));
      } catch (e) {
        return err(`update_column failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "delete_column",
    {
      title: "Delete Column",
      description:
        "Delete a custom column. Fails if the column has an automation role (open/active/done — rename those " +
        "instead) or has tasks in it and no reassign_to is given.",
      inputSchema: {
        board: z.string(),
        column_id: z.string(),
        reassign_to: z.string().optional().describe("Another column id to move this column's tasks into first."),
      },
    },
    async ({ board, column_id, reassign_to }) => {
      try {
        await requireBoardAccess(env, token, board);
        await boardStub(env, board).deleteColumn(column_id, reassign_to);
        return ok({ deleted: column_id });
      } catch (e) {
        return err(`delete_column failed: ${(e as Error).message}`);
      }
    }
  );

  server.registerTool(
    "reorder_columns",
    {
      title: "Reorder Columns",
      description: "Set the display order of every column on a board in one call.",
      inputSchema: {
        board: z.string(),
        ordered_ids: z.array(z.string()).min(1).describe("Every column id on this board, in the desired order."),
      },
    },
    async ({ board, ordered_ids }) => {
      try {
        await requireBoardAccess(env, token, board);
        return ok(await boardStub(env, board).reorderColumns(ordered_ids));
      } catch (e) {
        return err(`reorder_columns failed: ${(e as Error).message}`);
      }
    }
  );
}
