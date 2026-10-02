import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The token that lets the browser of a page copy (D150) open the copy's draft, which is not behind a sign-in as that browser
 * has none: it names one job, is signed with a key made from the server's own secret, and runs out. It opens nothing else.
 */

export const FRAME_MINUTES = 40;

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:replica-frame").digest();
const sign = (secret: Buffer, id: string, expires: number) => createHmac("sha256", derive(secret)).update(`${id}.${expires}`).digest("base64url").slice(0, 32);

export function signFrame(secret: Buffer, id: string, now = Date.now()): string {
  const expires = now + FRAME_MINUTES * 60_000;
  return `${expires}.${sign(secret, id, expires)}`;
}

export function frameTokenValid(secret: Buffer, id: string, token: string | undefined, now = Date.now()): boolean {
  if (!token) return false;
  const [expiresText, given] = token.split(".");
  const expires = Number(expiresText);
  if (!Number.isFinite(expires) || expires < now || !given) return false;
  const expected = Buffer.from(sign(secret, id, expires));
  const actual = Buffer.from(given);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
