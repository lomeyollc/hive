# src/worker/auth

Google Sign-In session auth (for the human) + API token generation (for
agents). Routed from `src/worker/index.ts` for any `/auth/*` request.

## Files

- `routes.ts` — `handleAuthRequest(request, env)`, the `/auth/*` route
  table. Routes: `POST /auth/google/callback`, `POST /auth/logout`,
  `GET /auth/session`, `POST /auth/tokens`, `GET /auth/tokens`,
  `DELETE /auth/tokens/:id`.
- `google.ts` — verifies a Google ID token against
  `https://oauth2.googleapis.com/tokeninfo`, checks `aud` == GOOGLE_CLIENT_ID,
  expiry, `email_verified`, and (if `ALLOWED_EMAILS` is set) the allowlist.
- `session.ts` — HMAC-SHA256-signed session cookie (Web Crypto
  `SubtleCrypto`, `SESSION_SECRET`). Exports `requireSession(request, env)`
  for other routes to import as the auth check.
- `tokens.ts` — `generateApiToken()`, the plaintext-token generator
  (`crypto.randomUUID()` bytes + extra `crypto.getRandomValues()` bytes,
  base64url, `hive_` prefix).
- `tokenHash.ts` — **shared** `hashToken(token)`. The MCP route's
  Bearer-token check (`src/worker/mcp`) must hash tokens the same way to
  look them up in D1's `api_tokens.token_hash` — import this function
  rather than re-implementing SHA-256 hex hashing.
- `base64url.ts`, `errors.ts` — small shared helpers.
- `../env.d.ts` — declares `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
  `SESSION_SECRET` / `ALLOWED_EMAILS` on the global `Env` type (these are
  secrets, so `wrangler types` doesn't generate them).

## Session cookie

Cookie `hive_session`, `httpOnly; SameSite=Lax; Secure` (when the request
is https). Value is `<base64url(JSON {email, exp})>.<base64url(HMAC-SHA256
signature)>` — plaintext-readable payload, tamper-evident via the
signature. 30-day expiry.

## v1 authorization model

Any successfully Google-verified email is trusted by default — this is a
single-user (or small-trusted-set) self-hosted instance, so a self-hoster's
main defense is simply not sharing their instance URL. Since it's cheap and
meaningfully safer for a public open-source project, an explicit allowlist
is also supported: set `ALLOWED_EMAILS` (comma-separated) and only those
emails can sign in.

Secrets (set via `wrangler secret put <NAME>`, never in `wrangler.jsonc`):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, and optionally
`ALLOWED_EMAILS`. See `.dev.vars.example` for local dev.
