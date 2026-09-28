import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Gravatar (D97). Browsers never ask Gravatar themselves, which would tell it
 * who is looking: pages link to Kaizen's `/api/gravatar/{hash}`, which asks
 * on the server. Addresses are signed, so the route is no open proxy.
 */

/** Gravatar's key for an email: SHA-256 of the trimmed, lower-case address. */
export function gravatarHash(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export const isGravatarHash = (value: string): boolean => /^[0-9a-f]{64}$/.test(value);

/** The signature of a hash, with a key of its own derived from `secret`. */
export function signGravatar(hash: string, secret: Buffer): string {
  const key = createHmac("sha256", secret).update("kaizen:gravatar").digest();
  return createHmac("sha256", key).update(hash).digest("base64url").slice(0, 22);
}

export function gravatarSignatureOk(hash: string, signature: string, secret: Buffer): boolean {
  if (!isGravatarHash(hash)) return false;
  const expected = Buffer.from(signGravatar(hash, secret));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Kaizen's address for someone's Gravatar. */
export function gravatarPath(email: string, secret: Buffer): string {
  const hash = gravatarHash(email);
  return `/api/gravatar/${hash}?k=${signGravatar(hash, secret)}`;
}

/** Where the server asks: 160 pixels, suitable for all audiences, and 404 when there is none. */
export const gravatarSource = (hash: string): string => `https://gravatar.com/avatar/${hash}?s=160&r=g&d=404`;
