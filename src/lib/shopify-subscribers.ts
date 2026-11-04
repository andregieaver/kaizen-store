/**
 * The email list from Shopify (D445 step 8, `docs/moving-from-shopify.md` 6.2, the owner's Decision 1), pure. Shopify keeps each customer's
 * consent: its state, how it was given (`marketingOptInLevel`) and when. The same shop owner, the same controller, moves; that record is the
 * evidence GDPR Art. 7(1) asks for, and it moves with him. Only `SUBSCRIBED` with a date becomes a subscriber; every other state comes over as
 * nothing, so nobody who left the list is ever added back. Confirmed only when Shopify says the opt-in was confirmed (double opt-in).
 */
import type { ConsentLine } from "./shopify-copy";

export type MovedSubscriber = { email: string; name: string; consentedAt: string; confirmed: boolean; consentText: string };

/** Shopify's record as the words kept with the subscription (the consent history keeps them with the event). */
export function movedConsentText(shop: string, line: Pick<ConsentLine, "state" | "level" | "updatedAt">): string {
  return `Agreed to email from ${shop.slice(0, 200)} while it was on Shopify, as Shopify recorded it: ${line.state}, ${line.level || "no opt-in level"}, ${line.updatedAt ?? "no date"}.`.slice(0, 1000);
}

/** A customer's line as a subscriber, or null when Shopify's record is not a subscription with its date. */
export function movedSubscriber(line: ConsentLine, shop: string): MovedSubscriber | null {
  if (line.state !== "SUBSCRIBED" || !line.updatedAt || !line.email.includes("@")) return null;
  return { email: line.email, name: line.name, consentedAt: line.updatedAt, confirmed: line.level === "CONFIRMED_OPT_IN", consentText: movedConsentText(shop, line) };
}
