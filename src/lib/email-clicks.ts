import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Clicks kept per person (email plan M1.3, D754; the owner's decision M0.1 b). Each recipient's links in a broadcast carry `p`, their subscriber's
 * id and a signature over the broadcast and that id, so a press is theirs and nobody can make one look like someone else's by editing an address.
 * Without the key (no `SETTINGS_ENCRYPTION_KEY`) links carry no reference and presses are counted per link only, as before. Pure.
 */

/** How long a press is kept: 180 days, then it goes (`pruneEmailClicks()`). */
export const CLICK_DAYS = 180;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SIGNATURE_LENGTH = 22;

function signature(key: Buffer, broadcastId: string, subscriberId: string): string {
  return createHmac("sha256", key).update(`email-click:${broadcastId}:${subscriberId}`).digest("base64url").slice(0, SIGNATURE_LENGTH);
}

/** The reference a recipient's links carry: their subscriber's id and its signature for this broadcast. */
export function personRef(key: Buffer, broadcastId: string, subscriberId: string): string {
  return `${subscriberId}.${signature(key, broadcastId, subscriberId)}`;
}

/** The subscriber a reference names, or null when it is not one this key signed for this broadcast. Never throws. */
export function readPersonRef(key: Buffer, broadcastId: string, ref: string | null | undefined): string | null {
  if (!ref || ref.length > 80) return null;
  const dot = ref.indexOf(".");
  if (dot < 0) return null;
  const subscriberId = ref.slice(0, dot).toLowerCase();
  const given = ref.slice(dot + 1);
  if (!UUID.test(subscriberId) || given.length !== SIGNATURE_LENGTH) return null;
  const expected = signature(key, broadcastId.toLowerCase(), subscriberId);
  return timingSafeEqual(Buffer.from(given), Buffer.from(expected)) ? subscriberId : null;
}
