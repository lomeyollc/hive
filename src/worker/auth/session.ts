import { base64urlDecode, base64urlEncode } from "./base64url";

export const SESSION_COOKIE_NAME = "hive_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface SessionPayload {
  email: string;
  exp: number; // unix seconds
}

/**
 * Session cookie format: `<base64url(JSON payload)>.<base64url(HMAC-SHA256
 * signature of the payload part)>`, signed with SESSION_SECRET via Web
 * Crypto SubtleCrypto — no external JWT library. The payload itself is
 * plaintext-readable (it's just base64, not encryption) but the signature
 * makes it tamper-evident: verifySessionCookie rejects anything whose
 * signature doesn't match, so a client can't forge or edit it.
 */
async function getHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function signPayload(payloadB64: string, env: Env): Promise<string> {
  const key = await getHmacKey(env.SESSION_SECRET);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payloadB64));
  return base64urlEncode(new Uint8Array(signature));
}

/** Builds the `Set-Cookie` header value for a fresh session. */
export async function createSessionCookie(email: string, env: Env, secure: boolean): Promise<string> {
  const payload: SessionPayload = { email, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const payloadB64 = base64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signatureB64 = await signPayload(payloadB64, env);
  const value = `${payloadB64}.${signatureB64}`;

  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${SESSION_TTL_SECONDS}`];
  if (secure) attrs.push("Secure");
  return `${SESSION_COOKIE_NAME}=${value}; ${attrs.join("; ")}`;
}

/** `Set-Cookie` header value that immediately expires the session cookie. */
export function clearSessionCookie(secure: boolean): string {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return `${SESSION_COOKIE_NAME}=; ${attrs.join("; ")}`;
}

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return part.slice(eq + 1).trim();
    }
  }
  return null;
}

/**
 * Verifies the session cookie's HMAC signature and expiry. Returns the
 * decoded payload on success, `null` on any failure (missing cookie,
 * malformed, bad signature, expired) — callers treat `null` as "not
 * authenticated" and never need to distinguish why.
 */
export async function verifySessionCookie(cookieHeader: string | null, env: Env): Promise<SessionPayload | null> {
  if (!cookieHeader) return null;
  const value = readCookie(cookieHeader, SESSION_COOKIE_NAME);
  if (!value) return null;

  const dot = value.indexOf(".");
  if (dot === -1) return null;
  const payloadB64 = value.slice(0, dot);
  const signatureB64 = value.slice(dot + 1);
  if (!payloadB64 || !signatureB64) return null;

  const key = await getHmacKey(env.SESSION_SECRET);
  const valid = await crypto.subtle.verify(
    "HMAC",
    key,
    base64urlDecode(signatureB64),
    new TextEncoder().encode(payloadB64),
  );
  if (!valid) return null;

  let payload: SessionPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadB64)));
  } catch {
    return null;
  }

  if (typeof payload.email !== "string" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
}

/**
 * Session-verification helper for other routes to import (REST API, the
 * token-generation/list/revoke routes below, any future authenticated
 * page). Reads the session cookie straight off the incoming Request.
 *
 * Usage: `const session = await requireSession(request, env); if (!session)
 * return new Response("Unauthorized", { status: 401 });`
 */
export async function requireSession(request: Request, env: Env): Promise<SessionPayload | null> {
  return verifySessionCookie(request.headers.get("Cookie"), env);
}
