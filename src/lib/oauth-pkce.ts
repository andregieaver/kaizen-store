import { createHash, timingSafeEqual } from "node:crypto";

import { isCodeChallenge, isCodeVerifier } from "./oauth";

/**
 * PKCE with S256 (RFC 7636, D439): the challenge is the verifier's SHA-256 in base64url. The only method Kaizena Flow's authorization
 * server takes; the comparison is in constant time. Pure (node's crypto only).
 */

/** The S256 challenge of a code verifier. */
export const pkceChallenge = (verifier: string): string => createHash("sha256").update(verifier, "ascii").digest("base64url");

/** Whether a code verifier answers a challenge: both well formed, and the verifier's S256 equal to it. */
export function pkceMatches(verifier: unknown, challenge: unknown): boolean {
  if (!isCodeVerifier(verifier) || !isCodeChallenge(challenge)) return false;
  const made = Buffer.from(pkceChallenge(verifier));
  const kept = Buffer.from(challenge);
  return made.length === kept.length && timingSafeEqual(made, kept);
}
