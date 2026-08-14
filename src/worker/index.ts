import { BoardDO } from "./durable-objects/BoardDO";

/**
 * Hive Worker entry point.
 *
 * Routing is not implemented yet — this is a scaffold for the next phase.
 * Static assets (the built React app) are served automatically by the
 * `assets` binding configured in wrangler.jsonc; `run_worker_first` sends
 * these path prefixes here instead of straight to static assets:
 *
 *   /api/*   -> REST API: CRUD for boards/tasks/comments (src/worker/api)
 *   /mcp/*   -> MCP server route, Bearer-token authenticated
 *               (src/worker/mcp) — tools: create_task, get_task,
 *               update_task, claim_next_task, comment_task, list_tasks,
 *               list_boards
 *   /auth/*  -> Google Sign-In verification + session cookie issuance,
 *               and API token generation/revocation (src/worker/auth)
 *   /ws/*    -> WebSocket upgrade to a board's BoardDO (Hibernation API);
 *               route by board slug to env.BOARD_DO.getByName(slug)
 *
 * Anything else falls through to the SPA (index.html) per
 * assets.not_found_handling in wrangler.jsonc.
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      // TODO: REST API routes (boards, tasks, comments)
      return new Response("Not implemented", { status: 501 });
    }

    if (url.pathname.startsWith("/mcp/")) {
      // TODO: MCP server route (Bearer-token authenticated)
      return new Response("Not implemented", { status: 501 });
    }

    if (url.pathname.startsWith("/auth/")) {
      // TODO: Google Sign-In verification, session cookie, API tokens
      return new Response("Not implemented", { status: 501 });
    }

    if (url.pathname.startsWith("/ws/")) {
      // TODO: WebSocket upgrade -> env.BOARD_DO.getByName(boardSlug)
      return new Response("Not implemented", { status: 501 });
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export { BoardDO };
