/**
 * One row of the Orders page (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2.3), and what its payment and fulfilment cells say. Pure: the server fills a row from one
 * statement (`listOrdersPage()`), and the table, the CSV-less views and the AI manager read these words from here, so the cells say one thing everywhere.
 * An order whose person was erased (restricted or anonymised, D162) shows its number, date, status and total and `erased: true`, never the person.
 */
import type { Tag } from "./order-tags";

export type OrderStatusValue = "pending_payment" | "authorized" | "paid" | "fulfilled" | "cancelled" | "closed";

/** The payment cell: what the money did. `copied` is history from another store (no payment to speak of). */
export type PayCell = "unpaid" | "authorized" | "paid" | "partially_refunded" | "refunded" | "balance_due" | "copied";
/** The fulfilment cell. `none` is an unfinished checkout or a cancelled order, where there is nothing to send. */
export type ShipCell = "to_send" | "partly_sent" | "waiting" | "sent" | "no_shipping" | "none" | "copied";

export type OrderListItem = {
  id: string;
  number: string;
  status: OrderStatusValue;
  placedAt: string;
  /** In the order's own currency: no sum across currencies is made on the page. */
  totalMinor: number;
  currency: string;
  marketCode: string;
  copied: boolean;
  archived: boolean;
  /** On a fulfilment hold (D238, `orders.held_at`): still listed in *To send*, with its chip. */
  held?: boolean;
  /** D288: Stripe judged a captured payment `elevated` or `highest` risk (null: neither), and a dispute is open or was lost. */
  risk?: "elevated" | "highest" | null;
  disputed?: boolean;
  /** `draft` for a staff-made order (D173), with its draft's number (`D-12`) while the draft still exists. */
  source: "checkout" | "draft" | "exchange";
  draftNumber: string | null;
  gift: boolean;
  /** The person's data was erased or restricted (D162): `email` and `name` are then null. */
  erased: boolean;
  email: string | null;
  name: string | null;
  items: number;
  /** Units sold on backorder that the store has not received (D172). */
  owed: number;
  /** The earliest release date of its lines on pre-order still to send (D396), `YYYY-MM-DD`; null for none. */
  preorderFrom: string | null;
  tags: Tag[];
  pay: PayCell;
  ship: ShipCell;
  /** Part still to pay at the venue (D66), in the order's currency. */
  balanceMinor: number;
  /** A change was applied to the order after purchase (D174: the *Edited* badge). */
  edited?: boolean;
  /** A change waits for the customer's payment (D174: *Change awaiting payment*). */
  editPending?: boolean;
  /** How the goods reach the buyer (D237); absent for a row read before it was known. */
  delivery?: DeliveryCell;
};

/**
 * The *Delivery* cell (D237, `docs/wave-3-shipping-methods.md` 2.2, 2.3): the method's label kept on the order (a method's or the flat rate's name, a
 * carrier's service, the pickup place, the local area), and for local delivery where it goes and the start of the driver's note. An erased person's
 * order shows no postal code, city, phone or note (D162).
 */
export type DeliveryCell = {
  method: "ship" | "pickup" | "local";
  label: string | null;
  /** Marked *Ready for pickup*. */
  ready: boolean;
  postalCode: string | null;
  city: string | null;
  phone: string | null;
  /** The first 80 characters of the driver's note. */
  note: string | null;
};

/** The first 80 characters of a note, with an ellipsis when cut. */
export const noteStart = (note: string | null): string | null => (note ? (note.length > 80 ? `${note.slice(0, 79).trimEnd()}…` : note) : null);

/** The fulfilment cell's words, saying *To hand over* and *Collected* for a pickup order and *To deliver* and *Taken out* for local delivery. */
export function shipWords(item: Pick<OrderListItem, "ship" | "delivery">): string {
  const method = item.delivery?.method ?? "ship";
  if (method === "pickup") {
    if (item.ship === "to_send" || item.ship === "partly_sent") return item.delivery?.ready ? "Ready for pickup" : "To hand over";
    if (item.ship === "sent") return "Collected";
  }
  if (method === "local") {
    if (item.ship === "to_send" || item.ship === "partly_sent") return "To deliver";
    if (item.ship === "sent") return "Taken out";
  }
  return SHIP_CELL_LABELS[item.ship];
}

/** What the payment cell says. The captured and refunded sums are of the order's own payments (`PAY_STATE`'s two figures). */
export function payCellOf(order: {
  status: OrderStatusValue;
  copied: boolean;
  capturedMinor: number;
  refundedMinor: number;
  balanceMinor: number;
}): PayCell {
  if (order.copied) return "copied";
  if (order.status === "pending_payment") return "unpaid";
  // D289: the card is held, nothing is taken yet.
  if (order.status === "authorized") return "authorized";
  if (order.capturedMinor <= 0) {
    // Cancelled and never paid is an unfinished checkout; paid with nothing taken online (a venue booking) still has a balance to take.
    if (order.status === "cancelled") return "unpaid";
    return order.balanceMinor > 0 ? "balance_due" : "paid";
  }
  if (order.refundedMinor >= order.capturedMinor) return "refunded";
  if (order.refundedMinor > 0) return "partially_refunded";
  if (order.balanceMinor > 0 && (order.status === "paid" || order.status === "fulfilled")) return "balance_due";
  return "paid";
}

/** What the fulfilment cell says. */
export function shipCellOf(order: {
  status: OrderStatusValue;
  copied: boolean;
  physical: boolean;
  backorderUnits: number;
  /** A parcel is recorded and units are still to send (D174). */
  partlySent?: boolean;
  /** The later capture a held card's order waits for (D289). */
  captureMode?: "when_sent" | "by_hand" | null;
}): ShipCell {
  if (order.copied) return "copied";
  if (order.status === "pending_payment") return "none";
  if (!order.physical) return "no_shipping";
  // D289: the card is held; under *when sent* the first parcel charges it, so the order is to send (as the *To send* filter says); captured by hand, it waits for the capture.
  if (order.status === "authorized") return order.captureMode === "when_sent" ? "to_send" : "none";
  if (order.status === "fulfilled") return "sent";
  if (order.status === "paid") return order.backorderUnits > 0 ? "waiting" : order.partlySent ? "partly_sent" : "to_send";
  return "none";
}

export const PAY_CELL_LABELS: Record<PayCell, string> = {
  unpaid: "Unpaid",
  authorized: "Card held",
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  balance_due: "Balance due",
  copied: "Copied",
};

export const SHIP_CELL_LABELS: Record<ShipCell, string> = {
  to_send: "To send",
  partly_sent: "Partly sent",
  waiting: "Waiting for stock",
  sent: "Sent",
  no_shipping: "Nothing to ship",
  none: "-",
  copied: "Copied",
};
