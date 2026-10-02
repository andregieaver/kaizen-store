import { createHmac } from "node:crypto";

/**
 * The visitor of a visit (D152, docs/analytics.md, "Visit counting"): who is one
 * visitor on one day, without keeping anything that identifies a person. No
 * `server-only` so it can be tested; it only runs on the server because it is
 * handed the secret, never in the browser.
 *
 * Two steps, as the doc says. The day's key is `HMAC(secret, store day)`, so it changes
 * every store day, so nothing stored links one day's visitor to the next (whoever holds the server's secret could still test a known address and user agent against a day's ids: the id is a pseudonym, and the doc says so). The visitor is
 * `HMAC(day key, [store, ip, user agent])` cut to 24 hex characters (96 bits:
 * collisions among a store's daily visitors are not a practical concern, and the
 * cut hash cannot be reversed to the address). The three parts go in as a JSON
 * array, so `("a|b", "c")` and `("a", "b|c")` can never give the same input.
 */

/** Length of a visitor id in hex characters. */
export const VISITOR_LENGTH = 24;

/**
 * The store's calendar date of an instant, `YYYY-MM-DD`: the one day clock of visit counting. The same string is the day a
 * visit row is written under (`visits.day`) and the day the visitor's key is made for, so one person on one store day is
 * one hash and one row, whatever the store's time zone. An unknown time zone falls back to UTC (for both uses alike).
 */
export function storeDayKey(at: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(at);
    const of = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const key = `${of("year")}-${of("month")}-${of("day")}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(key)) return key;
  } catch {
    // an unknown zone: UTC below
  }
  return at.toISOString().slice(0, 10);
}

/**
 * The hashed visitor: 24 lower-case hex characters. `ip` and `userAgent` may be empty (a missing header gives a
 * visitor all such requests share, which is as little as can be said); the store and the secret may not.
 * Throws on an empty secret or store, because a hash made without them could be guessed or would join stores.
 */
export function visitorHash(storeId: string, ip: string | null | undefined, userAgent: string | null | undefined, dayKey: string, secret: string): string {
  if (!secret) throw new Error("A visitor hash needs a secret.");
  if (!storeId) throw new Error("A visitor hash needs a store.");
  if (!dayKey) throw new Error("A visitor hash needs a day.");
  const key = createHmac("sha256", secret).update(dayKey).digest();
  return createHmac("sha256", key)
    .update(JSON.stringify([storeId, ip ?? "", userAgent ?? ""]))
    .digest("hex")
    .slice(0, VISITOR_LENGTH);
}
