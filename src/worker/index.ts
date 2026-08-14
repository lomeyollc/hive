import { handleApiRequest } from "./api/routes";
import { handleAuthRequest } from "./auth/routes";
import { requireSession } from "./auth/session";
import { BoardDO } from "./durable-objects/BoardDO";
import { handleMcpRequest } from "./mcp";

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
} satisfies ExportedHandler<Env>;

export { BoardDO };
