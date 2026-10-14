/**
 * Local pickup (D237, `docs/wave-3-shipping-methods.md` 2.2 and 4.4): why an order cannot be marked *Ready for pickup* or *Collected*, and how the
 * usual ready time is said. Pure, no zod: the order pages and the checkout read it. The database holds what it can (`orders_delivery_frozen()`:
 * ready once; the copied-order guard; `shipments_method_rules()`), and `markReadyForPickup()`/`markCollected()` ask this before they write.
 */

export type PickupAction = "ready" | "collected";

export type PickupBlock =
  | "not_pickup"
  | "unpaid"
  | "copied"
  | "cancelled"
  | "closed"
  | "waiting_for_stock"
  | "edit_pending"
  | "collected"
  | "already_ready";

/** What the two buttons need to know of an order. */
export type PickupOrderFacts = {
  deliveryMethod: "ship" | "pickup" | "local";
  /** `orders.status`: `pending_payment`, `paid`, `fulfilled`, `cancelled`, or another the order may have. */
  status: string;
  copied: boolean;
  /** Archived or otherwise closed for handling (D173): no button acts on it. */
  closed: boolean;
  /** Units still waiting for stock (D172 backorders). */
  waitingForStock: boolean;
  /** A change to the order waits for the customer's payment (D174). */
  editPending: boolean;
  /** A handover of method `pickup` that is not undone exists (the order was collected). */
  collected: boolean;
  readyForPickupAt: string | null;
};

/**
 * Why the action is refused, or null when it may go ahead. *Collected* does not need *Ready* first (a customer may come before the email); *Ready* is
 * recorded once (a second press is `already_ready`, and the page offers to send the email again only when the first failed).
 */
export function pickupBlock(order: PickupOrderFacts, action: PickupAction): PickupBlock | null {
  if (order.deliveryMethod !== "pickup") return "not_pickup";
  if (order.copied) return "copied";
  if (order.status === "cancelled") return "cancelled";
  if (order.collected || order.status === "fulfilled") return "collected";
  if (order.status !== "paid") return "unpaid";
  if (order.closed) return "closed";
  if (order.waitingForStock) return "waiting_for_stock";
  if (order.editPending) return "edit_pending";
  if (action === "ready" && order.readyForPickupAt !== null) return "already_ready";
  return null;
}

/**
 * How *Usually ready in* is said (keys for `m.delivery`): `notify` for 0 (no promise: "We will email you when it is ready"), whole hours under two days,
 * else whole days rounded up.
 */
export function readyInWords(hours: number): { key: "notify" } | { key: "hours"; count: number } | { key: "days"; count: number } {
  const h = Math.max(0, Math.round(hours));
  if (h === 0) return { key: "notify" };
  if (h < 48) return { key: "hours", count: h };
  return { key: "days", count: Math.ceil(h / 24) };
}
