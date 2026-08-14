# src/worker/mcp

Empty scaffold. The next-phase agent mounts an MCP server here at `/mcp`,
using `@modelcontextprotocol/sdk` (already a dependency — see
`package.json`), or Cloudflare's `agents-sdk` `McpAgent` pattern if that
turns out simpler on Workers.

Auth: Bearer token only (`Authorization: Bearer <token>`), checked against
the SHA-256 hash stored in D1's `api_tokens` table (see
`migrations/0001_init.sql`). No OAuth — this is a single-user instance per
deploy, so OAuth is unnecessary complexity.

Tools to implement, each backed by RPC calls into the relevant board's
`BoardDO` (`env.BOARD_DO.getByName(slug)`):

- `create_task`
- `get_task`
- `update_task`
- `claim_next_task` — atomic claim, race-free because the DO is single-threaded
- `comment_task`
- `list_tasks` (filter by board/status/assignee)
- `list_boards`
