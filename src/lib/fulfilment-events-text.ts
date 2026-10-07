/**
 * What the order page's history says for the events of sending in parts and changing an order (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.1 and 2.2), as text.
 * Pure, so the page and its test read the same words. Only amounts, counts, labels and the method are taken from the data, and `data.note` (staff's own words, the one
 * free-text key an erasure removes, D162). Null for an event that is not one of these. English: the admin.
 */
import { MANUAL_METHOD_LABELS, type ManualPaymentMethod } from "./draft-input";
import { FULFILMENT_EVENTS, FULFILMENT_EVENT_LABELS, type FulfilmentEvent } from "./order-ops-events";
import { ORDER_EDIT_REASON_LABELS, type OrderEditReason } from "./order-edit-status";

const note = (data: Record<string, unknown>): string => (typeof data.note === "string" ? data.note.trim() : "");
const label = (data: Record<string, unknown>): string => (typeof data.label === "string" && /^E\d{1,3}$/.test(data.label) ? data.label : "");
const count = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null);
const units = (n: number) => `${n} ${n === 1 ? "unit" : "units"}`;

export function fulfilmentEventText(type: string, data: Record<string, unknown>, money: (minor: number) => string): string | null {
  if (type === "order.sent") {
    const carrier = typeof data.carrier === "string" && data.carrier ? ` with ${data.carrier}` : "";
    const tracking = typeof data.tracking === "string" && data.tracking ? ` (${data.tracking})` : "";
    const sent = count(data.units);
    const left = count(data.left);
    // An event from before parcels named their lines carries neither count.
    if (sent === null) return `Sent${carrier}${tracking}`;
    return `Parcel sent${carrier}${tracking}: ${units(sent)}${left !== null && left > 0 ? `, ${units(left)} still to send` : ", nothing left to send"}`;
  }
  if (!(Object.values(FULFILMENT_EVENTS) as string[]).includes(type)) return null;
  const event = type as FulfilmentEvent;
  const name = label(data);
  const text = note(data);
  const withNote = (line: string) => `${line}${text ? ` · ${text}` : ""}`;
  switch (event) {
    case FULFILMENT_EVENTS.editApplied: {
      const difference = typeof data.difference === "number" && Number.isSafeInteger(data.difference) ? data.difference : null;
      const before = (data.before as { totals?: { totalMinor?: unknown } } | undefined)?.totals?.totalMinor;
      const after = (data.after as { totals?: { totalMinor?: unknown } } | undefined)?.totals?.totalMinor;
      const reason = ORDER_EDIT_REASON_LABELS[data.reason as OrderEditReason];
      const totals = typeof before === "number" && typeof after === "number" ? `, total ${money(before)} → ${money(after)}` : "";
      const diff = difference === null || difference === 0 ? "" : ` (${difference > 0 ? "+" : "−"}${money(Math.abs(difference))})`;
      return withNote(`Order changed${name ? ` (${name})` : ""}${diff}${totals}${reason ? ` · ${reason}` : ""}`);
    }
    case FULFILMENT_EVENTS.editSent: {
      const amount = typeof data.difference === "number" && data.difference > 0 ? ` of ${money(data.difference)}` : "";
      const how = data.emailed === true ? "emailed to the customer" : "made into a link to share";
      return withNote(`${data.again === true ? "New pay link for change" : "Change"}${name ? ` ${name}` : ""}${data.again === true ? "" : ` waiting for the customer's payment${amount}`}: ${how}`);
    }
    case FULFILMENT_EVENTS.editPaidOutside: {
      const method = MANUAL_METHOD_LABELS[data.method as ManualPaymentMethod];
      return withNote(`${FULFILMENT_EVENT_LABELS[event]}${name ? ` (${name})` : ""}${method ? `: ${method.toLowerCase()}` : ""}`);
    }
    case FULFILMENT_EVENTS.editRefundFailed: {
      const amount = typeof data.amount === "number" && data.amount > 0 ? ` ${money(data.amount)}` : "";
      return `${FULFILMENT_EVENT_LABELS[event]}${name ? ` (${name})` : ""}:${amount} did not reach the customer. Refund it again from this page`;
    }
    case FULFILMENT_EVENTS.editPaymentRefunded: {
      const amount = typeof data.amount === "number" && data.amount > 0 ? ` ${money(data.amount)}` : "";
      return `${FULFILMENT_EVENT_LABELS[event]}${name ? ` (${name})` : ""}:${amount} given back because the order changed before the payment arrived`;
    }
    case FULFILMENT_EVENTS.unsentClosed: {
      const lines = Array.isArray(data.lines) ? (data.lines as { title?: unknown; sku?: unknown; quantity?: unknown }[]) : [];
      const listed = lines
        .map((l) => ({ quantity: count(l.quantity), what: typeof l.sku === "string" && l.sku ? l.sku : typeof l.title === "string" ? l.title : "" }))
        .filter((l) => l.quantity !== null && l.quantity > 0 && l.what)
        .map((l) => `${l.quantity} × ${l.what}`);
      const total = count(data.units);
      return `${FULFILMENT_EVENT_LABELS[event]}: ${listed.length > 0 ? listed.join(", ") : total !== null ? units(total) : "units"} will not be sent`;
    }
    default:
      return `${FULFILMENT_EVENT_LABELS[event]}${name ? ` (${name})` : ""}`;
  }
}
