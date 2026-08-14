import { AuthError } from "./errors";
import { verifyGoogleIdToken } from "./google";
import { clearSessionCookie, createSessionCookie, requireSession } from "./session";
import { hashToken } from "./tokenHash";
import { generateApiToken } from "./tokens";

/**
 * Handles every `/auth/*` route. Called directly from src/worker/index.ts
 * for requests whose path starts with `/auth/`.
 *
 * Routes:
 *   POST   /auth/google/callback  - body { credential }, the Google ID
 *                                   token from the frontend's Google
 *                                   Identity Services button. On success,
 *                                   sets the session cookie and returns
 *                                   { email }.
 *   POST   /auth/logout           - clears the session cookie.
 *   GET    /auth/session          - returns { email } if logged in, 401
 *                                   otherwise. Lets the frontend check
 *                                   auth state on load.
 *   GET    /auth/config           - PUBLIC, no session required. Returns
 *                                   { googleClientId } read from the
 *                                   Worker's GOOGLE_CLIENT_ID env var. A
 *                                   Google OAuth Client ID is meant to be
 *                                   public (it's embedded in every Google
 *                                   Sign-In button on the web) — this lets
 *                                   the frontend pick it up from the same
 *                                   `wrangler secret put` a self-hoster
 *                                   already has to run, instead of a
 *                                   separate frontend-build-time env var
 *                                   that would need a rebuild to change.
 *   POST   /auth/tokens           - requires a session. body { label? }.
 *                                   Creates an agent API token, returns the
 *                                   PLAINTEXT token once: { id, token,
 *                                   label, created_at }. Never retrievable
 *                                   again after this response.
 *   GET    /auth/tokens           - requires a session. Lists this user's
 *                                   tokens WITHOUT the plaintext: [{ id,
 *                                   label, created_at, last_used_at,
 *                                   revoked }].
 *   DELETE /auth/tokens/:id       - requires a session. Revokes (soft
 *                                   delete via revoked_at) one of this
 *                                   user's tokens.
 */
export async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const secure = url.protocol === "https:";

  try {
    if (request.method === "POST" && url.pathname === "/auth/google/callback") {
      return await handleGoogleCallback(request, env, secure);
    }

    if (request.method === "POST" && url.pathname === "/auth/logout") {
      return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(secure) });
    }

    if (request.method === "GET" && url.pathname === "/auth/session") {
      const session = await requireSession(request, env);
      if (!session) return json({ error: "Not authenticated" }, 401);
      return json({ email: session.email });
    }

    if (request.method === "GET" && url.pathname === "/auth/config") {
      return json({ googleClientId: env.GOOGLE_CLIENT_ID ?? null });
    }

    if (url.pathname === "/auth/tokens") {
      const session = await requireSession(request, env);
      if (!session) return json({ error: "Not authenticated" }, 401);

      if (request.method === "POST") return await handleCreateToken(request, env, session.email);
      if (request.method === "GET") return await handleListTokens(env, session.email);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/auth/tokens/")) {
      const session = await requireSession(request, env);
      if (!session) return json({ error: "Not authenticated" }, 401);

      const id = url.pathname.slice("/auth/tokens/".length);
      if (!id) return json({ error: "Missing token id" }, 400);
      return await handleRevokeToken(env, session.email, id);
    }

    return json({ error: "Not found" }, 404);
  } catch (err) {
    if (err instanceof AuthError) {
      return json({ error: err.message }, err.status);
    }
    throw err;
  }
}

async function handleGoogleCallback(request: Request, env: Env, secure: boolean): Promise<Response> {
  const body = await request
    .json<{ credential?: string; id_token?: string }>()
    .catch(() => ({}) as { credential?: string; id_token?: string });
  const idToken = body.credential ?? body.id_token ?? "";

  const user = await verifyGoogleIdToken(idToken, env);
  const cookie = await createSessionCookie(user.email, env, secure);

  return json({ email: user.email }, 200, { "Set-Cookie": cookie });
}

async function handleCreateToken(request: Request, env: Env, ownerEmail: string): Promise<Response> {
  const body = await request.json<{ label?: string }>().catch(() => ({}) as { label?: string });
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 200) : null;

  const token = generateApiToken();
  const tokenHash = await hashToken(token);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO api_tokens (id, token_hash, name, created_by, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(id, tokenHash, label, ownerEmail, createdAt)
    .run();

  // Plaintext token is returned exactly once, right here — it is never
  // stored anywhere and this response is the only chance to see it.
  return json({ id, token, label, created_at: createdAt }, 201);
}

async function handleListTokens(env: Env, ownerEmail: string): Promise<Response> {
  const { results } = await env.DB.prepare(
    `SELECT id, name, created_at, last_used_at, revoked_at FROM api_tokens WHERE created_by = ? ORDER BY created_at DESC`,
  )
    .bind(ownerEmail)
    .all<{ id: string; name: string | null; created_at: string; last_used_at: string | null; revoked_at: string | null }>();

  const tokens = results.map((row) => ({
    id: row.id,
    label: row.name,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    revoked: row.revoked_at !== null,
  }));

  return json({ tokens });
}

async function handleRevokeToken(env: Env, ownerEmail: string, id: string): Promise<Response> {
  const result = await env.DB.prepare(
    `UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND created_by = ? AND revoked_at IS NULL`,
  )
    .bind(new Date().toISOString(), id, ownerEmail)
    .run();

  if (result.meta.changes === 0) {
    return json({ error: "Token not found" }, 404);
  }
  return json({ ok: true });
}

function json(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
