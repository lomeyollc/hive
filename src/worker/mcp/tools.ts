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

function ok(payload: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function err(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function boardStub(env: McpEnv, board: string): BoardDOStub {
  return env.BOARD_DO.getByName(board) as unknown as BoardDOStub;
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
      },
    },
    async ({ board, title, description, status, priority, assignee, labels, due_date, needs_human, needs_human_reason }) => {
      try {
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
      },
    },
    async ({ board, task_id, due_date, needs_human, needs_human_reason, ...patch }) => {
      try {
        const task = await boardStub(env, board).updateTask(task_id, {
          ...patch,
          dueDate: due_date,
          needsHuman: needs_human,
          needsHumanReason: needs_human_reason,
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
      },
    },
    async ({ board, ...filter }) => {
      try {
        const tasks: Task[] = await boardStub(env, board).listTasks(filter);
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
      description: "List every board, read from the D1 cross-board index (not a DO call).",
      inputSchema: {},
    },
    async () => {
      try {
        const { results } = await env.DB.prepare(
          `SELECT id, name, description, created_at FROM boards ORDER BY name ASC`
        ).all<BoardRow>();
        return ok(results ?? []);
      } catch (e) {
        return err(`list_boards failed: ${(e as Error).message}`);
      }
    }
  );
}
