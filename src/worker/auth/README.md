# src/worker/auth

Empty scaffold. The next-phase agent implements two things here:

1. **Human login (Google Sign-In)** — frontend uses Google Identity Services
   to get an ID token, POSTs it to a route here. Verify it server-side
   (either fetch `https://oauth2.googleapis.com/tokeninfo?id_token=...` and
   check `aud`/`email`, or do a proper JWKS verify against
   `https://www.googleapis.com/oauth2/v3/certs`), then issue an HMAC-signed
   httpOnly session cookie using Web Crypto `SubtleCrypto.sign("HMAC", ...)`
   with `SESSION_SECRET`. No external JWT library needed.

2. **Agent auth (API tokens)** — once logged in, an authenticated
   settings endpoint generates a long-lived Bearer token
   (`crypto.randomUUID()` + extra random bytes), shows it once, and stores
   only its SHA-256 hash in D1's `api_tokens` table (see
   `migrations/0001_init.sql`) — never the plaintext. The REST API and the
   MCP route (`src/worker/mcp`) both check `Authorization: Bearer <token>`
   against that hash.

Secrets this needs (set via `wrangler secret put <NAME>`, never in
`wrangler.jsonc`): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`SESSION_SECRET`. See `.dev.vars.example` for local dev.
