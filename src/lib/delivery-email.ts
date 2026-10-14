import type { AnyOrderDelivery, LocalDelivery, PickupDelivery } from "./delivery-options";
import { pickupPlaceLine } from "./delivery-options";
import type { EmailBlock } from "./email-layout";
import type { DeliveryEmailText } from "./email-text";
import { hoursOn, type OpeningHours } from "./opening-hours";
import { readyInWords } from "./pickup";

/**
 * What the pickup and local delivery emails say (D237, `docs/wave-3-shipping-methods.md` 2.5), as email blocks from the order's own snapshot
 * (`orders.delivery`, written when it was bought, so editing the place later changes nothing here) and the hand-written words of
 * `deliveryEmailText()`. Pure: the server sends what these give. No prices, no address a shopper typed beyond the order's own postal code and city.
 */

/** Whether a value is opening hours as `store_locations.hours` keeps them. */
function asHours(value: unknown): OpeningHours | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<OpeningHours>;
  return v.week && typeof v.week === "object" ? { week: v.week, exceptions: Array.isArray(v.exceptions) ? v.exceptions : [] } : null;
}

/** `YYYY-MM-DD` of a date in a time zone. */
const dayIn = (at: Date, timeZone: string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);

/** The days from `fromIso` on, `count` of them, as `YYYY-MM-DD`. */
function nextDays(fromIso: string, count: number): string[] {
  const start = new Date(`${fromIso}T12:00:00Z`);
  return Array.from({ length: count }, (_, i) => new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10));
}

/**
 * The place's hours for the next `days` days from `now` in the store's time zone, one row each ("Monday 14 October", "09:00–17:00" or "closed"), with
 * exceptions (a holiday, a season) taken into account. Empty when the place keeps no hours.
 */
export function openingHoursLines(
  hours: unknown,
  { locale, timeZone, now, closed, days = 7 }: { locale: string; timeZone: string; now: Date; closed: string; days?: number },
): { label: string; value: string }[] {
  const parsed = asHours(hours);
  if (!parsed) return [];
  const name = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
  return nextDays(dayIn(now, timeZone), days).map((iso) => {
    const open = hoursOn(parsed, iso);
    return { label: name.format(new Date(`${iso}T12:00:00Z`)), value: open ? `${open.open}–${open.close}` : closed };
  });
}

/**
 * The *Ready for pickup* email's blocks after its intro: where (name and address), the next days' hours, the instructions as the order kept them (plain
 * text), what to collect (titles and quantities, no prices) and what to bring.
 */
export function pickupReadyBlocks(
  text: DeliveryEmailText,
  delivery: PickupDelivery,
  { number, lines, locale, timeZone, now }: { number: string; lines: readonly { title: string; quantity: number }[]; locale: string; timeZone: string; now: Date },
): EmailBlock[] {
  const hours = openingHoursLines(delivery.hours, { locale, timeZone, now, closed: text.closed });
  return [
    { type: "paragraph", text: `${text.collectAt}:\n${pickupPlaceLine(delivery)}` },
    ...(hours.length > 0 ? [{ type: "paragraph" as const, text: text.openingHours }, { type: "lines" as const, rows: hours }] : []),
    ...(delivery.instructions.trim() ? [{ type: "paragraph" as const, text: `${text.instructions}:\n${delivery.instructions.trim()}` }] : []),
    ...(lines.length > 0
      ? [{ type: "paragraph" as const, text: text.toCollect }, { type: "lines" as const, rows: lines.map((l) => ({ label: `${l.quantity} × ${l.title}`, value: "" })) }]
      : []),
    { type: "paragraph", text: text.bring(number) },
  ];
}

/** The *Out for delivery* email's blocks after its intro: the area's information and where (postal code and city only). */
export function outForDeliveryBlocks(text: DeliveryEmailText, delivery: LocalDelivery, place: { postalCode: string; city: string }): EmailBlock[] {
  const where = `${place.postalCode || delivery.postalCode} ${place.city}`.trim();
  return [
    ...(delivery.info.trim() ? [{ type: "paragraph" as const, text: `${text.deliveryInfo}:\n${delivery.info.trim()}` }] : []),
    ...(where ? [{ type: "paragraph" as const, text: `${text.deliveryTo}: ${where}` }] : []),
  ];
}

/**
 * The order confirmation's delivery block: a method's label and transit time; the pickup place and when it is usually ready (or that an email follows);
 * the local area's information and the shopper's note. Nothing for a carrier's service or the flat rate (the confirmation shows those as today).
 */
export function confirmationDeliveryBlocks(text: DeliveryEmailText, delivery: AnyOrderDelivery | null, note: string | null): EmailBlock[] {
  if (!delivery) return [];
  switch (delivery.kind) {
    case "method":
      return delivery.estimate
        ? [{ type: "paragraph", text: `${text.deliveryHeading}: ${delivery.label}\n${text.transit(delivery.estimate.min, delivery.estimate.max)}` }]
        : [];
    case "pickup": {
      const ready = readyInWords(delivery.readyInHours);
      return [
        {
          type: "paragraph",
          text: [`${text.collectAt}:`, pickupPlaceLine(delivery), ready.key === "notify" ? text.pickupNotify : `${text.readyIn(delivery.readyInHours)} ${text.pickupNotify}`].join("\n"),
        },
      ];
    }
    case "local":
      return [
        {
          type: "paragraph",
          text: [`${text.deliveryHeading}: ${delivery.label}`, delivery.info.trim(), note ? `${text.driverNote}: ${note}` : ""].filter(Boolean).join("\n"),
        },
      ];
    default:
      return [];
  }
}
