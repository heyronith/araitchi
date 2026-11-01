import { createHash, randomBytes } from "node:crypto";

/** RFC 7636 base64url without padding. */
export function base64UrlEncode(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Generate a PKCE code_verifier (≥ 43 chars when base64url-encoded). */
export function generateCodeVerifier(): string {
  return base64UrlEncode(randomBytes(32));
}

/** S256 code_challenge = BASE64URL(SHA256(verifier)). */
export function createS256Challenge(verifier: string): string {
  const hash = createHash("sha256").update(verifier, "ascii").digest();
  return base64UrlEncode(hash);
}
