<p align="center"><img src=".github/logo.png" width="96" height="96" alt="Hive logo"></p>

# Hive

Hive is an open-source, AI-agent-native task/project manager. Built so a
human and a fleet of AI agents can share one live board without colliding.

Every board is a single Cloudflare Durable Object. A DO is single-threaded
per instance, so every write — whether it comes from you or from ten agents
at once — is serialized for free. No locking code, no lost updates, no
double-claimed tasks.

**Status: early / under active development.** Core task/board CRUD, atomic
claiming, realtime WebSocket updates, the MCP server, the REST API, and the
React frontend are implemented — see [Architecture](#architecture) below.

## Architecture

- **`BoardDO`** (one Durable Object per board, SQLite-backed) — the source
  of truth for that board's tasks and comments. DO id = board slug.
- **D1** — a denormalized, read-only index (`boards`, `tasks_index`,
  `api_tokens`) for cross-board search and the dashboard only. Never
  authoritative for task state.
- **WebSockets** via the DO Hibernation API — the board's DO pushes live
  updates to every connected browser client.
- **Auth** — Google Sign-In for the human (ID token verified server-side,
  our own HMAC-signed session cookie; optionally restricted to an
  `ALLOWED_EMAILS` allowlist); long-lived Bearer API tokens (SHA-256 hashed
  in D1) for agents and the MCP server.
- **MCP server** at `/mcp`, Bearer-token authenticated: `create_task`,
  `get_task`, `update_task`, `claim_next_task`, `comment_task`,
  `list_tasks`, `list_boards`.
- **Frontend** — React + shadcn/ui + Tailwind, served as static assets from
  the same Worker.

## Self-host quickstart

1. Fork this repo and clone it.
2. `npm install`, then `npm run cf-typegen` (generates `worker-configuration.d.ts` from your bindings — gitignored, regenerate it after any `wrangler.jsonc` change or fresh clone).
3. Create your D1 database:
   ```bash
   npx wrangler d1 create hive
   ```
   Copy the `database_id` it prints into `wrangler.jsonc` (`d1_databases[0].database_id`).
4. Apply the migrations:
   ```bash
   npm run d1:migrate:remote
   ```
5. Create a Google OAuth 2.0 client (Google Cloud Console → APIs & Services
   → Credentials → OAuth client ID → Web application) and add
   `https://<your-worker>.workers.dev` (or your custom domain) as an
   **Authorized JavaScript origin**. Sign-in uses Google Identity Services'
   client-side button (which POSTs an ID token to `/auth/google/callback`
   for server-side verification), not a server-side redirect, so no
   redirect URI is needed.
6. Set secrets — never put these in `wrangler.jsonc`:
   ```bash
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler secret put SESSION_SECRET   # any long random string
   npx wrangler secret put ALLOWED_EMAILS   # optional: comma-separated allowlist
   ```
7. Deploy:
   ```bash
   npm run deploy
   ```

### Local development

```bash
cp .dev.vars.example .dev.vars   # fill in the three values
npm run d1:migrate:local
npm run dev
```

`npm run dev` runs the Worker inside the real Workers runtime (via the
Cloudflare Vite plugin) with Vite's HMR for the React frontend.

## Tech stack

Cloudflare Workers, Durable Objects (SQLite storage), D1, TypeScript, React,
shadcn/ui, Tailwind CSS, Vite.

## License

MIT — see [LICENSE](./LICENSE).
