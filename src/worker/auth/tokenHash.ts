/**
 * Shared token-hashing util.
 *
 * Every place that needs to check a Bearer API token against D1's
 * `api_tokens.token_hash` column — the token-generation/list/revoke routes
 * in this directory AND the MCP server's auth check (src/worker/mcp) —
 * MUST hash the token the exact same way, or a valid token will look
 * invalid (or worse, a forged one will look valid). Import `hashToken`
 * from here rather than re-implementing SHA-256 hex hashing inline.
 *
 * Plaintext tokens are never stored anywhere — only this hash.
 */
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
