import { handleApiRequest } from "./api/routes";
import { handleAuthRequest } from "./auth/routes";
import { requireSession } from "./auth/session";
import { BoardDO } from "./durable-objects/BoardDO";
import { handleMcpRequest } from "./mcp";
import { sendTelegramMessage } from "./notify/telegram";

/**
 * Hive Worker entry point.
 *
 * Static assets (the built React app) are served automatically by the
 * `assets` binding configured in wrangler.jsonc; `run_worker_first` sends
 * these path prefixes here instead of straight to static assets:
 *
 *   /api/*   -> REST API: CRUD for boards/tasks/comments, session-gated
 *               (src/worker/api/routes.ts)
 *   /mcp/*   -> MCP server route, Bearer-token authenticated
 *               (src/worker/mcp) — tools: create_task, get_task,
 *               update_task, claim_next_task, comment_task, list_tasks,
 *               list_boards
 *   /auth/*  -> Google Sign-In verification + session cookie issuance,
 *               and API token generation/revocation (src/worker/auth)
 *   /ws/boards/:slug -> WebSocket upgrade to that board's BoardDO
 *               (Hibernation API), session-gated same as /api/*
 *
 * Anything else falls through to the SPA (index.html) per
 * assets.not_found_handling in wrangler.jsonc.
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      return handleApiRequest(request, env);
    }

    if (url.pathname === "/mcp" || url.pathname.startsWith("/mcp/")) {
      return handleMcpRequest(request, env);
    }

    if (url.pathname.startsWith("/auth/")) {
      return handleAuthRequest(request, env);
    }

    if (url.pathname.startsWith("/ws/boards/")) {
      const session = await requireSession(request, env);
      if (!session) {
        return new Response(JSON.stringify({ error: "Not authenticated" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const slug = url.pathname.slice("/ws/boards/".length);
      if (!slug) {
        return new Response("Missing board slug", { status: 400 });
      }

      // BoardDO's fetch() only upgrades at exactly `/ws` (see BoardDO.ts) —
      // forward the request with the path rewritten, everything else as-is.
      const forwardUrl = new URL(request.url);
      forwardUrl.pathname = "/ws";
      const forwardRequest = new Request(forwardUrl, request);
      return env.BOARD_DO.getByName(slug).fetch(forwardRequest);
    }

    return env.ASSETS.fetch(request);
  },

  /**
   * The "what's still stuck" half of the escalation loop (the immediate
   * ping on flag-set is the other half, in BoardDO's #notifyNeedsHuman).
   * Runs on the cron in wrangler.jsonc's `triggers.crons`. Reads D1's
   * tasks_index — a read-only index, so this never touches a BoardDO
   * directly — for every task still flagged needs_human, grouped by board,
   * and sends one digest message. No-op (no Telegram call at all) when
   * nothing is flagged, so a healthy day produces silence, not noise.
   */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(sendNeedsHumanDigest(env));
  },
} satisfies ExportedHandler<Env>;

async function sendNeedsHumanDigest(env: Env): Promise<void> {
  const { results } = await env.DB.prepare(
    `SELECT board_id, title, needs_human_reason
     FROM tasks_index
     WHERE needs_human = 1 AND archived_at IS NULL
     ORDER BY board_id, updated_at ASC`,
  ).all<{ board_id: string; title: string; needs_human_reason: string | null }>();

  const rows = results ?? [];
  if (rows.length === 0) return;

  const byBoard = new Map<string, typeof rows>();
  for (const row of rows) {
    const list = byBoard.get(row.board_id) ?? [];
    list.push(row);
    byBoard.set(row.board_id, list);
  }

  const lines = [`🐝 <b>Hive daily digest</b> — ${rows.length} task${rows.length === 1 ? "" : "s"} still need you:`];
  for (const [boardId, tasks] of byBoard) {
    lines.push("");
    lines.push(`<b>${boardId}</b>`);
    for (const t of tasks) {
      lines.push(t.needs_human_reason ? `• ${t.title} — ${t.needs_human_reason}` : `• ${t.title}`);
    }
  }
  if (env.APP_URL) lines.push("", env.APP_URL);

  await sendTelegramMessage(env, lines.join("\n"));
}

export { BoardDO };
