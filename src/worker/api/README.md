# src/worker/api

Empty scaffold, referenced by the `/api/*` TODO in `src/worker/index.ts`.
Not called out by name in the original spec, but split out here so REST
routes (CRUD for boards/tasks/comments, WebSocket upgrade) don't all pile
into `index.ts`. Same RPC-into-`BoardDO` pattern as `src/worker/mcp`.

Delete this directory and inline the routes in `index.ts` instead if the
next-phase agent prefers — nothing else depends on this split existing.
