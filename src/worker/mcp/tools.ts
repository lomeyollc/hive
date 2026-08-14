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
const statusEnum = z.enum(["planned", "open", "in_progress", "blocked", "done"]);
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
        status: statusEnum.optional().describe("Defaults to \"open\". Use \"planned\" to file straight into the Backlog."),
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
        status: statusEnum.optional(),
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
    async ({ board, task_id, due_date, needs_human, needs_human_reason, parent_task_id, ...patch }) => {
      try {
        await requireBoardAccess(env, token, board);
        const task = await boardStub(env, board).updateTask(task_id, {
          ...patch,
          dueDate: due_date,
          needsHuman: needs_human,
          needsHumanReason: needs_human_reason,
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
        "List tasks on a board, optionally filtered by status, assignee, or label. " +
        "(No priority or claimed_by filter yet — BoardDO's ListTasksFilter doesn't carry " +
        "those fields; widen this tool's schema if that changes.)",
      inputSchema: {
        board: z.string(),
        status: statusEnum.optional(),
        assignee: z.string().optional(),
        label: z.string().optional(),
        parent_task_id: z.string().optional().describe("List only sub-tasks of this task id."),
      },
    },
    async ({ board, parent_task_id, ...filter }) => {
      try {
        await requireBoardAccess(env, token, board);
        const tasks: Task[] = await boardStub(env, board).listTasks({ ...filter, parentTaskId: parent_task_id });
        return ok(tasks);
      } catch (e) {
        return err(`list_tasks failed: ${(e as Error).message}`);
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
}
