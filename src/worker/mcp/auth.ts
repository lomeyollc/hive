/**
 * Bearer-token auth for the MCP route.
 *
 * Tokens are never stored in plaintext. `migrations/0001_init.sql` defines
 * D1's `api_tokens` table as:
 *
 *   api_tokens(id, token_hash, name, created_by, created_at, last_used_at, revoked_at)
 *
 * `token_hash` is the lowercase-hex SHA-256 of the raw token string. The
 * settings-page token-generation flow (owned by the auth-implementing
 * agent) is expected to show the raw token once and store only this hash.
 */

export interface AuthedToken {
  id: string;
  name: string | null;
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Extracts the Bearer token from an `Authorization` header, hashes it, and
 * looks it up in D1. Returns `null` if the header is missing/malformed, the
 * hash doesn't match a row, or the token has been revoked.
 *
 * On a successful match, fire-and-forget bumps `last_used_at` — this is a
 * courtesy field for the settings UI, not something a request should ever
 * block on or fail over.
 */
export async function authenticate(request: Request, db: D1Database): Promise<AuthedToken | null> {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  const token = header.slice("Bearer ".length).trim();
  if (!token) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const row = await db
    .prepare(
      `SELECT id, name FROM api_tokens WHERE token_hash = ?1 AND revoked_at IS NULL LIMIT 1`
    )
    .bind(tokenHash)
    .first<{ id: string; name: string | null }>();

  if (!row) {
    return null;
  }

  db.prepare(`UPDATE api_tokens SET last_used_at = ?1 WHERE id = ?2`)
    .bind(new Date().toISOString(), row.id)
    .run()
    .catch(() => {
      // Best-effort telemetry only — never fail auth over this.
    });

  return row;
}

export function unauthorizedResponse(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized: missing or invalid Bearer token" },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": 'Bearer realm="hive-mcp"',
      },
    }
  );
}
