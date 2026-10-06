/**
 * What the order page's history says for the events of wave 3's order operations (run 2, D173, `docs/wave-3-orders.md` 2.3 and 2.4), as text: the draft that made the order, tags, archive, a payment
 * taken outside Kaizen and a refund of one. Pure, so the page and its test read the same words. `data.note` is the one free-text key of an event (the one an erasure removes, D162), so it is the only
 * thing taken from the data besides the method and the amount. Null for an event that is not one of these.
 */
import { MANUAL_METHOD_LABELS, type ManualPaymentMethod } from "./draft-input";
import { ORDER_OPS_EVENTS, ORDER_OPS_EVENT_LABELS } from "./order-ops-events";

const note = (data: Record<string, unknown>): string => (typeof data.note === "string" ? data.note.trim() : "");

export function opsEventText(type: string, data: Record<string, unknown>, money: (minor: number) => string): string | null {
  if (type === "order.placed" && typeof data.draft === "string") {
    return `Draft ${data.draft} sent to the customer: the order was made and its stock is held until the pay link expires`;
  }
  switch (type) {
    case ORDER_OPS_EVENTS.tagsChanged:
    case ORDER_OPS_EVENTS.archived:
    case ORDER_OPS_EVENTS.unarchived: {
      const text = note(data);
      return `${ORDER_OPS_EVENT_LABELS[type]}${text ? `: ${text}` : ""}`;
    }
    case ORDER_OPS_EVENTS.paidOutside: {
      const method = MANUAL_METHOD_LABELS[data.method as ManualPaymentMethod];
      const text = note(data);
      return `${ORDER_OPS_EVENT_LABELS[type]}${method ? `: ${method.toLowerCase()}` : ""}${text ? ` · ${text}` : ""}`;
    }
    case ORDER_OPS_EVENTS.refundedOutside: {
      const amount = Number(data.amount);
      const text = note(data);
      return `${ORDER_OPS_EVENT_LABELS[type]}${amount > 0 ? ` ${money(amount)}` : ""}${text ? ` · ${text}` : ""}: nothing was sent, the store paid the customer back`;
    }
    default:
      return null;
  }
}
