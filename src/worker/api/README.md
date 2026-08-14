# src/worker/api

`/api/*` REST routes — CRUD for boards/tasks/comments, backing the React
dashboard (`src/frontend/lib/api.ts`). Session-gated (Google Sign-In
cookie); the agent-facing surface is `/mcp`, not this.

- `routes.ts` — `handleApiRequest(request, env)`, called from
  `src/worker/index.ts` for anything under `/api/`. Tasks and comments go
  straight to the owning board's `BoardDO` over Workers RPC
  (`env.BOARD_DO.getByName(slug)`); boards and task-count aggregates read
  D1 directly. Maps BoardDO's camelCase `Task`/`Comment` shapes to the
  snake_case wire format the frontend expects.

WebSocket upgrades (`/ws/boards/:slug`) are handled directly in
`src/worker/index.ts`, not here — Durable Object `fetch()` is the only way
to return a 101 response, so there's no RPC path for it.
