/**
 * One row of the Orders page (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2.3), and what its payment and fulfilment cells say. Pure: the server fills a row from one
 * statement (`listOrdersPage()`), and the table, the CSV-less views and the AI manager read these words from here, so the cells say one thing everywhere.
 * An order whose person was erased (restricted or anonymised, D162) shows its number, date, status and total and `erased: true`, never the person.
 */
import type { Tag } from "./order-tags";

export type OrderStatusValue = "pending_payment" | "paid" | "fulfilled" | "cancelled" | "closed";

/** The payment cell: what the money did. `copied` is history from another store (no payment to speak of). */
export type PayCell = "unpaid" | "paid" | "partially_refunded" | "refunded" | "balance_due" | "copied";
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
  /** `draft` for a staff-made order (D173), with its draft's number (`D-12`) while the draft still exists. */
  source: "checkout" | "draft";
  draftNumber: string | null;
  gift: boolean;
  /** The person's data was erased or restricted (D162): `email` and `name` are then null. */
  erased: boolean;
  email: string | null;
  name: string | null;
  items: number;
  /** Units sold on backorder that the store has not received (D172). */
  owed: number;
  tags: Tag[];
  pay: PayCell;
  ship: ShipCell;
  /** Part still to pay at the venue (D66), in the order's currency. */
  balanceMinor: number;
  /** A change was applied to the order after purchase (D174: the *Edited* badge). */
  edited?: boolean;
  /** A change waits for the customer's payment (D174: *Change awaiting payment*). */
  editPending?: boolean;
};

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
export function shipCellOf(order: { status: OrderStatusValue; copied: boolean; physical: boolean; backorderUnits: number; /** A parcel is recorded and units are still to send (D174). */ partlySent?: boolean }): ShipCell {
  if (order.copied) return "copied";
  if (order.status === "pending_payment") return "none";
  if (!order.physical) return "no_shipping";
  if (order.status === "fulfilled") return "sent";
  if (order.status === "paid") return order.backorderUnits > 0 ? "waiting" : order.partlySent ? "partly_sent" : "to_send";
  return "none";
}

export const PAY_CELL_LABELS: Record<PayCell, string> = {
  unpaid: "Unpaid",
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
