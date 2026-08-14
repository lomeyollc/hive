# src/worker/mcp

MCP server mounted at `/mcp` (both `/mcp` and `/mcp/*`, see
`wrangler.jsonc`'s `run_worker_first` and the dispatch in
`src/worker/index.ts`).

Uses `@modelcontextprotocol/sdk`'s `WebStandardStreamableHTTPServerTransport`
directly, run stateless (fresh `McpServer` + transport per request, JSON
responses, no session ID) — see `index.ts` for why this was chosen over
Cloudflare's `agents-sdk` `McpAgent` pattern.

- `auth.ts` — Bearer token auth. Hashes the presented token (SHA-256) and
  checks it against D1's `api_tokens.token_hash` (`migrations/0001_init.sql`).
  401s on anything missing/invalid/revoked.
- `contract.ts` — the BoardDO RPC surface this route calls
  (`env.BOARD_DO.getByName(slug)`), re-exporting data shapes from
  `../durable-objects/types` so the two sides can't drift on field names.
- `tools.ts` — registers the seven tools below on an `McpServer`.
- `index.ts` — `handleMcpRequest(request, env)`, the function
  `src/worker/index.ts` calls for anything under `/mcp`.

Tools, each backed by RPC calls into the relevant board's `BoardDO`:

- `create_task`
- `get_task`
- `update_task`
- `claim_next_task` — atomic claim, race-free because the DO is single-threaded
- `comment_task`
- `list_tasks` (filter by board/status/assignee/label)
- `list_boards` — reads D1's `boards` table directly, no DO call
