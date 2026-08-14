import { base64urlEncode } from "./base64url";

const TOKEN_PREFIX = "hive_";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * Generates a fresh plaintext API token: `crypto.randomUUID()` (as its raw
 * 16 bytes, for a globally-unique component) concatenated with 24 more
 * `crypto.getRandomValues()` bytes (for margin against any UUID-generator
 * weakness), base64url-encoded, prefixed `hive_` so tokens are recognizable
 * in logs/UIs without decoding them.
 *
 * This is the ONLY place the plaintext ever exists outside the caller's
 * response — the route handler that calls this must hash it (see
 * tokenHash.ts) before storing anything, and must return the plaintext to
 * the caller exactly once.
 */
export function generateApiToken(): string {
  const uuidBytes = hexToBytes(crypto.randomUUID().replace(/-/g, ""));
  const extraBytes = crypto.getRandomValues(new Uint8Array(24));

  const combined = new Uint8Array(uuidBytes.length + extraBytes.length);
  combined.set(uuidBytes, 0);
  combined.set(extraBytes, uuidBytes.length);

  return `${TOKEN_PREFIX}${base64urlEncode(combined)}`;
}
