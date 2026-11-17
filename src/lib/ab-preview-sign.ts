import { createHmac, timingSafeEqual } from "node:crypto";

import { PREVIEW_LINK_DAYS, previewBody, tokenOfCookie, type Preview } from "./ab-preview";

/**
 * Signs and checks a preview link's token (D148 phase 20, `src/lib/ab-preview.ts`): the body names the store, the test and the version and when
 * the link ends, signed with a key made from the server's own secret for this use alone (as the private-mode pass's is, D339). Server and proxy only.
 */

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:ab-preview").digest();
const signature = (secret: Buffer, body: string) => createHmac("sha256", derive(secret)).update(body).digest("base64url");

/** A token for one version of a test, good for `PREVIEW_LINK_DAYS` days. */
export function signPreview(secret: Buffer, preview: Omit<Preview, "expires">, now = Date.now()): string {
  const expires = now + PREVIEW_LINK_DAYS * 24 * 60 * 60_000;
  const body = Buffer.from(JSON.stringify([1, preview.storeId, preview.experiment, preview.version, expires])).toString("base64url");
  return `${body}.${signature(secret, body)}`;
}

/** What a preview cookie holds (`{experiment}:{token}`), checked: the token's, and only when the plain id in front of it is the token's own test. */
export function readPreviewCookie(secret: Buffer | null, value: string | undefined | null, now = Date.now()): Preview | null {
  const preview = readPreview(secret, tokenOfCookie(value), now);
  return preview && value?.startsWith(`${preview.experiment}:`) ? preview : null;
}

/** What a token says, or null when it was not signed here, was altered or is over. Whether its test still runs is the caller's to check. */
export function readPreview(secret: Buffer | null, token: string | undefined | null, now = Date.now()): Preview | null {
  if (!secret || !token) return null;
  const [body, sig, extra] = token.split(".");
  if (!body || !sig || extra !== undefined) return null;
  const expected = Buffer.from(signature(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const preview = previewBody(token);
  return preview && preview.expires > now ? preview : null;
}
