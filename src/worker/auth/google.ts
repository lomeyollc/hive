import { AuthError } from "./errors";

export interface GoogleVerifiedUser {
  email: string;
}

interface TokenInfoResponse {
  aud?: string;
  email?: string;
  email_verified?: string; // Google returns "true"/"false" as a string
  exp?: string; // unix seconds, as a string
  [key: string]: unknown;
}

/**
 * Verifies a Google Identity Services ID token server-side by calling
 * Google's tokeninfo endpoint (simplest correct approach for a single-user
 * / small-trusted-set instance — a full JWKS verify against
 * https://www.googleapis.com/oauth2/v3/certs is unnecessary complexity
 * here). Checks the token hasn't expired and that it was issued for THIS
 * app (`aud` must match GOOGLE_CLIENT_ID) before trusting the email.
 *
 * v1 authorization model: any successfully Google-verified email is
 * trusted — this is a single-user (or small-trusted-set) self-hosted
 * instance, so that's normally fine; a self-hoster's main defense is simply
 * not sharing their instance URL. But since it's cheap and meaningfully
 * safer for a public open-source project, we also support an explicit
 * allowlist: set ALLOWED_EMAILS (comma-separated) and only those emails can
 * sign in. Leave it unset to allow any verified Google account.
 *
 * Workspaces add a second, additive path in: an email with ANY
 * workspace_members row (invited or active) may also sign in, even if it's
 * not on ALLOWED_EMAILS — otherwise an invited teammate could never get far
 * enough to accept their invite. Signing in is not the same as having
 * access to anything: workspace membership status ('invited' vs 'active')
 * is what actually gates board visibility, checked separately in
 * src/worker/api/routes.ts.
 */
export async function verifyGoogleIdToken(idToken: string, env: Env): Promise<GoogleVerifiedUser> {
  if (!idToken) {
    throw new AuthError(400, "Missing Google ID token");
  }

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  if (!res.ok) {
    throw new AuthError(401, "Google rejected the ID token");
  }

  const data = (await res.json()) as TokenInfoResponse;

  if (!data.aud || data.aud !== env.GOOGLE_CLIENT_ID) {
    throw new AuthError(401, "ID token was not issued for this app");
  }

  const exp = Number(data.exp);
  if (!exp || exp < Math.floor(Date.now() / 1000)) {
    throw new AuthError(401, "ID token has expired");
  }

  if (data.email_verified !== "true") {
    throw new AuthError(401, "Google account email is not verified");
  }

  const email = data.email?.toLowerCase().trim();
  if (!email) {
    throw new AuthError(401, "ID token did not include an email");
  }

  const allowlist = (env.ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (allowlist.length > 0 && !allowlist.includes(email)) {
    const invited = await env.DB.prepare(`SELECT 1 FROM workspace_members WHERE email = ? LIMIT 1`)
      .bind(email)
      .first();
    if (!invited) {
      throw new AuthError(403, "This email is not on the allowlist for this Hive instance");
    }
  }

  return { email };
}
