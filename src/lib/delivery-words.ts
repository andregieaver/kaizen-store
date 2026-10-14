import type { AnyOrderDelivery, DeliveryOption, DeliveryOptions, OrderDelivery } from "./delivery-options";
import { openingHoursLines } from "./delivery-email";
import type { Messages } from "./i18n";
import { readyInWords } from "./pickup";

/**
 * What a shopper reads about the store's own delivery (D237, `docs/wave-3-shipping-methods.md` 2.4): the row that names the delivery in a summary,
 * how soon a pickup order is usually ready, and a place's hours today. Pure, worked out on the server: the checkout's client component gets the
 * sentences, never the functions (`m.deliveryOptions`, hand-written nb, sv, da and en).
 */

type Words = Pick<Messages, "deliveryOptions" | "shipping">;

/**
 * The name of the delivery row in a summary: "Collect at {place}", "Local delivery: {area}", a method's or carrier's name, else *Shipping*. Takes what
 * `readDelivery()` gives, or a carrier's delivery as `readOrderDelivery()` gives it (no `kind`).
 */
export function deliveryRowLabel(kept: AnyOrderDelivery | OrderDelivery | null, m: Words): string {
  if (!kept) return m.shipping;
  if (!("kind" in kept)) return kept.label || m.shipping;
  if (kept.kind === "pickup") return m.deliveryOptions.collectAt(kept.label);
  if (kept.kind === "local") return m.deliveryOptions.localLine(kept.label);
  return kept.label || m.shipping;
}

/** "Usually ready in 3 hours." or "We will email you when it is ready." (0 promises nothing, `readyInWords()`). */
export function readyInText(hours: number, m: Pick<Messages, "deliveryOptions">): string {
  const words = readyInWords(hours);
  if (words.key === "hours") return m.deliveryOptions.readyInHours(words.count);
  if (words.key === "days") return m.deliveryOptions.readyInDays(words.count);
  return m.deliveryOptions.readyNotify;
}

/** A place's hours today in the store's time zone ("Open today 09:00–17:00", "Closed today"), or null when the place keeps no hours. */
export function todayHoursText(
  hours: unknown,
  m: Pick<Messages, "deliveryOptions">,
  { locale, timeZone, now = new Date() }: { locale: string; timeZone: string; now?: Date },
): string | null {
  const [today] = openingHoursLines(hours, { locale, timeZone, now, closed: "", days: 1 });
  if (!today) return null;
  return today.value ? m.deliveryOptions.openToday(today.value) : m.deliveryOptions.closedToday;
}

/** An option as the checkout draws it: a pickup place carries its ready time and today's hours as sentences. */
export type ShownDeliveryOption = DeliveryOption & { words?: { ready: string; today: string | null } };
export type ShownDeliveryOptions = Omit<DeliveryOptions, "options"> & { options: ShownDeliveryOption[] };

/** The options with the sentences a pickup place needs, in the page's language and the store's time zone. */
export function withDeliveryWords(
  options: DeliveryOptions,
  m: Pick<Messages, "deliveryOptions">,
  at: { locale: string; timeZone: string; now?: Date },
): ShownDeliveryOptions {
  return {
    ...options,
    options: options.options.map((o) =>
      o.kind === "pickup" && o.place ? { ...o, words: { ready: readyInText(o.place.readyInHours, m), today: todayHoursText(o.place.hours, m, at) } } : o,
    ),
  };
}

/** What the cart knows of the basket's delivery (`cartSummary().deliveryState`), as far as the price sentence needs it. */
export type PriceLaterFacts = {
  postalCode: string | null;
  method: "ship" | "pickup" | "local";
  shipping: { zones: readonly unknown[]; areas: readonly unknown[]; pickups: readonly unknown[] };
  offer: { ship: readonly { priceMinor: number }[]; pickups: readonly { priceMinor: number }[] };
};

/**
 * Whether the cart's delivery price is not known yet (2.4, CRD Art. 6(1)(e)): the market has zones, a local area or a pickup place, no postal code is
 * given and pickup is not chosen. Then the lowest price on offer now (what is charged, a method at Rest of country, a pickup place) for *From {price}*,
 * with *Choose delivery at checkout*; else null and the row shows what is charged. A zone may still be cheaper than *From* says until a code is
 * given: the sentence says the price is chosen at checkout.
 */
export function priceLaterFrom(state: PriceLaterFacts | null, chargedMinor: number | null): number | null {
  if (!state || state.postalCode || state.method === "pickup") return null;
  const { zones, areas, pickups } = state.shipping;
  if (zones.length === 0 && areas.length === 0 && pickups.length === 0) return null;
  const prices = [...(chargedMinor === null ? [] : [chargedMinor]), ...state.offer.ship.map((d) => d.priceMinor), ...state.offer.pickups.map((d) => d.priceMinor)];
  return prices.length > 0 ? Math.min(...prices) : null;
}
