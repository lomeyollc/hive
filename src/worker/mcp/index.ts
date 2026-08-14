import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { authenticate, unauthorizedResponse } from "./auth";
import { registerTools, type McpEnv } from "./tools";

/**
 * Hive's MCP server, mounted at `/mcp` (see wrangler.jsonc's
 * `run_worker_first` and the dispatch in src/worker/index.ts).
 *
 * Chosen approach: `@modelcontextprotocol/sdk`'s
 * `WebStandardStreamableHTTPServerTransport` directly, run in stateless
 * mode (no `sessionIdGenerator`) — NOT Cloudflare's `agents-sdk`
 * `McpAgent`.
 *
 * Why: `McpAgent` models an MCP server as its own Durable Object per
 * session, which is the right shape when the server itself needs durable
 * per-connection state (e.g. an agent that IS a DO). Hive's MCP surface is
 * a stateless Bearer-authed proxy in front of state that already lives
 * elsewhere (BoardDO, D1) — every tool call is a single request that reads
 * or writes through an *existing* BoardDO stub. Adding a second DO class
 * just to host the protocol would mean a new wrangler binding + migration
 * for no state it actually owns, plus OAuth machinery `agents-sdk`'s MCP
 * pattern is built around that this single-user, Bearer-only deploy
 * explicitly doesn't need (see auth.ts). The SDK's own
 * `WebStandardStreamableHTTPServerTransport` runs on the Fetch API
 * directly (Request in, Response out — see the class's own "Cloudflare
 * Workers usage" doc comment) and was already a project dependency, so it
 * mounts here with no new bindings and no new infrastructure.
 *
 * A fresh `McpServer` + transport is constructed per request (the SDK's
 * documented stateless pattern for serverless runtimes) — Workers isolates
 * don't reliably persist in-memory session state across requests, and
 * stateless mode is exactly what a Bearer-token-per-call protocol wants
 * anyway: no session handshake, no session ID bookkeeping, every request
 * self-authenticates.
 *
 * Mounting: `handleMcpRequest` is a plain
 * `(request, env) => Promise<Response>` function — call it for any request
 * under `/mcp` from src/worker/index.ts's fetch handler, e.g.:
 *
 *   if (url.pathname.startsWith("/mcp")) {
 *     return handleMcpRequest(request, env);
 *   }
 */
export async function handleMcpRequest(request: Request, env: McpEnv): Promise<Response> {
  const token = await authenticate(request, env.DB);
  if (!token) {
    return unauthorizedResponse();
  }

  const server = new McpServer({ name: "hive", version: "0.1.0" });
  registerTools(server, env, token);

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Stateless mode: no session ID issued or checked. Every call
    // self-authenticates via Bearer token, so there's no session to track.
    sessionIdGenerator: undefined,
    // Plain JSON responses rather than an SSE stream: every Hive tool call
    // is a single request/response RPC against a BoardDO, never a
    // long-running or server-push operation, so there's nothing an SSE
    // stream would buy here — and it keeps request handling a plain
    // request-in/response-out call, which is the shape the SDK's own
    // Cloudflare Workers usage example (WebStandardStreamableHTTPServerTransport's
    // doc comment) is built around.
    enableJsonResponse: true,
  });

  await server.connect(transport);
  // No manual transport.close()/server.close() here: with
  // enableJsonResponse, handleRequest() resolves only once the full JSON
  // body is ready, so the returned Response is already complete — closing
  // is unnecessary and, in the SDK's Cloudflare Workers example, is
  // likewise left to fall out of scope rather than closed by hand.
  return transport.handleRequest(request);
}

export type { McpEnv } from "./tools";
