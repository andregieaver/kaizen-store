/**
 * Sending an order in parts (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 1.3 and 4.2): what is left to send, the order's fulfilment state and what
 * a parcel may hold. Pure: no database, no zod (the shopper's order page, a pay route, reaches it). The database says the same in
 * `commerce.line_to_send()` and `commerce.order_fulfilment()` (`src/db/fulfilment.test.ts` holds the two together), and `markSent()` checks a parcel
 * with `shipmentProblems()` under the order's lock before it writes anything.
 *
 * - A **physical line** is goods with a variant (`delivery = 'physical'`); downloads, services and sign-up fees are never sent.
 * - **Shipped** units are the line's units in parcels (all of them when the order has a parcel from before parcels named their lines: `legacy`). A parcel staff
 *   undid (D174 follow-up, `commerce.undo_shipment()`) was not sent: it counts nowhere, and its units are to send again.
 * - **Withdrawn** units are the line's units on returns that count (D153, `commerce.withdrawn_quantity()`: withdrawal returns only; a return of goods received does not cancel a unit to send).
 * - **Closed** units are units staff took off what is still to send because they will not be sent (`commerce.unsent_closures`, `commerce.closed_quantity()`:
 *   a refund or restock of units never sent, with *not sent* ticked).
 * - **Units to send** = `max(0, quantity − shipped − withdrawn − closed)`: withdrawn units are taken from the unsent ones first, so a withdrawal of a line that is
 *   partly sent removes unsent units before it asks for sent ones back.
 */

/** A line as the fulfilment rules read it. */
export type FulfilmentLine = {
  lineId: string;
  quantity: number;
  /** Goods with a variant, shipped. */
  physical: boolean;
  shipped: number;
  withdrawn: number;
  /** Units staff closed as not to be sent (`commerce.closed_quantity()`); absent is 0. */
  closed?: number;
  /** Units sold on backorder (D172), for the screens' "check you have them". */
  backordered?: number;
};

export const FULFILMENT_STATES = ["none", "unsent", "partly_sent", "sent", "withdrawn", "closed"] as const;
export type FulfilmentState = (typeof FULFILMENT_STATES)[number];

/** The admin's words for each state (English); the shopper's are `m.fulfilment.*`. */
export const FULFILMENT_STATE_LABELS: Record<FulfilmentState, string> = {
  none: "Nothing to send",
  unsent: "Not sent",
  partly_sent: "Partly sent",
  sent: "Sent",
  withdrawn: "Withdrawn before sending",
  closed: "Will not be sent",
};

const count = (n: number) => (Number.isSafeInteger(n) && n > 0 ? n : 0);

/** The units of a line still to send: 0 for a line that is not shipped. */
export function unitsToSend(line: Pick<FulfilmentLine, "quantity" | "physical" | "shipped" | "withdrawn" | "closed">): number {
  if (!line.physical) return 0;
  return Math.max(0, count(line.quantity) - count(line.shipped) - count(line.withdrawn) - count(line.closed ?? 0));
}

/** The units of an order still to send. */
export const orderUnitsToSend = (lines: readonly FulfilmentLine[]): number => lines.reduce((sum, l) => sum + unitsToSend(l), 0);

/**
 * The order's state: `none` (no physical line), `unsent` (no parcel, units to send), `partly_sent` (a parcel, units still to send), `sent` (a parcel,
 * nothing left), `withdrawn` (no parcel and nothing left to send, because it was withdrawn), `closed` (no parcel and nothing left to send, and staff closed
 * units as not to be sent). Mirrored by `commerce.order_fulfilment()`.
 */
export function fulfilmentState(lines: readonly FulfilmentLine[], hasShipment: boolean): FulfilmentState {
  const physical = lines.filter((l) => l.physical);
  if (physical.length === 0) return "none";
  const left = orderUnitsToSend(physical);
  if (left > 0) return hasShipment ? "partly_sent" : "unsent";
  if (hasShipment) return "sent";
  return physical.some((l) => count(l.closed ?? 0) > 0) ? "closed" : "withdrawn";
}

/** Every physical unit was withdrawn and nothing was ever sent (D153's `withdrawnInFull()`, read the same way). */
export const withdrawnInFull = (lines: readonly FulfilmentLine[], hasShipment: boolean): boolean => fulfilmentState(lines, hasShipment) === "withdrawn";

/**
 * Of a line's withdrawn units, how many were never sent (the store keeps them and refunds them at once, CRD Art. 13(3) lets it wait only for goods it sent)
 * and how many must come back: withdrawn units are taken from the unsent ones first. `shippedBefore` is what was in parcels when the withdrawal was confirmed,
 * `closedBefore` the units staff closed as not to be sent by then (3.16): those were put back and never delivered, so a withdrawal cannot take them.
 */
export function takeWithdrawnFromUnsent(input: { quantity: number; shippedBefore: number; withdrawn: number; closedBefore?: number }): { unsent: number; toComeBack: number } {
  const quantity = count(input.quantity);
  const shipped = Math.min(count(input.shippedBefore), quantity);
  const withdrawn = Math.min(count(input.withdrawn), quantity);
  const unsentUnits = Math.max(0, quantity - shipped - count(input.closedBefore ?? 0));
  const unsent = Math.min(withdrawn, unsentUnits);
  return { unsent, toComeBack: withdrawn - unsent };
}

/**
 * The units one withdrawal return asks back of a line (4.2, D153 refined): with `withdrawnBefore` units of the line on earlier counting withdrawal returns and
 * `withdrawnNow` on this one, the units to come back are those of the cumulative withdrawal beyond what was never sent (nor closed), less what earlier returns
 * asked back. 0 means the return has nothing to send back for this line. `NOTHING_SENT_SQL` says the same in SQL.
 */
export function unitsToSendBack(input: { quantity: number; shippedBefore: number; withdrawnBefore: number; withdrawnNow: number; closedBefore?: number }): number {
  const base = { quantity: input.quantity, shippedBefore: input.shippedBefore, closedBefore: input.closedBefore };
  const before = takeWithdrawnFromUnsent({ ...base, withdrawn: input.withdrawnBefore }).toComeBack;
  const through = takeWithdrawnFromUnsent({ ...base, withdrawn: input.withdrawnBefore + input.withdrawnNow }).toComeBack;
  return Math.max(0, through - before);
}

// ---------------------------------------------------------------------------------------------------------------------
// What a parcel may hold
// ---------------------------------------------------------------------------------------------------------------------

/** A line of a parcel: which order line and how many of its units. */
export type ParcelLine = { lineId: string; quantity: number };

/**
 * Why a parcel cannot be recorded, by code, with the sentence staff read. The first group is found here (`shipmentProblems()`), the second by the server
 * (`markSent()`), which uses these words so every screen says them one way.
 */
export const SHIPMENT_PROBLEMS = {
  // Found here
  nothing_to_send: "Nothing of this order is left to send.",
  empty: "Choose at least one item for this parcel.",
  not_in_order: "An item in the parcel is not on this order.",
  not_physical: "Only goods that are shipped go in a parcel: downloads and services are not sent.",
  quantity_invalid: "A quantity in the parcel is not a whole number of 1 or more.",
  too_many: "The parcel holds more of an item than is left to send.",
  withdrawn_in_full: "Every item of this order was withdrawn before it was sent, so there is nothing to send.",
  // Found by the server
  not_found: "The order was not found.",
  copied: "A copied order is history and is never sent.",
  unpaid: "The order is not paid yet, so it is not sent.",
  edit_pending: "A change to this order waits for the customer's payment. Nothing is sent until it is paid, cancelled or expired.",
  delivery_box_whole: "A subscription box delivery is sent whole, not in parts.",
  changed: "The order changed while you were choosing (another parcel, an undone parcel, a withdrawal or units that will not be sent were recorded). Look again and send what is left.",
} as const;
export type ShipmentProblemCode = keyof typeof SHIPMENT_PROBLEMS;
export const shipmentProblemText = (code: ShipmentProblemCode): string => SHIPMENT_PROBLEMS[code];

export type ShipmentProblem = { code: ShipmentProblemCode; lineId?: string };

export type ShipmentCheck = { ok: true; parcel: ParcelLine[]; left: number } | { ok: false; problems: ShipmentProblem[] };

/**
 * Checks a parcel against the order's lines as they stand (under the order's lock in `markSent()`). No `chosen` means "everything still to send", the meaning
 * of every caller from before parcels named their lines; lines chosen with 0 units are left out (a form sends every line). Returns the parcel, in the order's
 * line order, and the units still to send after it.
 */
export function shipmentProblems(lines: readonly FulfilmentLine[], chosen?: readonly ParcelLine[] | null, hasShipment = false): ShipmentCheck {
  const byId = new Map(lines.map((l) => [l.lineId, l]));
  const total = orderUnitsToSend(lines);
  if (total === 0) {
    return { ok: false, problems: [{ code: withdrawnInFull(lines, hasShipment) ? "withdrawn_in_full" : "nothing_to_send" }] };
  }
  if (chosen === undefined || chosen === null) {
    const parcel = lines.filter((l) => unitsToSend(l) > 0).map((l) => ({ lineId: l.lineId, quantity: unitsToSend(l) }));
    return { ok: true, parcel, left: 0 };
  }
  const problems: ShipmentProblem[] = [];
  const add = (code: ShipmentProblemCode, lineId?: string) => {
    if (!problems.some((p) => p.code === code && p.lineId === lineId)) problems.push(lineId === undefined ? { code } : { code, lineId });
  };
  const wanted = new Map<string, number>();
  for (const c of chosen) {
    if (!Number.isSafeInteger(c.quantity) || c.quantity < 0) {
      add("quantity_invalid", c.lineId);
      continue;
    }
    if (c.quantity === 0) continue;
    const line = byId.get(c.lineId);
    if (!line) {
      add("not_in_order", c.lineId);
      continue;
    }
    if (!line.physical) {
      add("not_physical", c.lineId);
      continue;
    }
    if (wanted.has(c.lineId)) {
      add("quantity_invalid", c.lineId);
      continue;
    }
    wanted.set(c.lineId, c.quantity);
  }
  for (const [lineId, quantity] of wanted) {
    if (quantity > unitsToSend(byId.get(lineId) as FulfilmentLine)) add("too_many", lineId);
  }
  if (problems.length === 0 && wanted.size === 0) add("empty");
  if (problems.length > 0) return { ok: false, problems };
  const parcel = lines.filter((l) => wanted.has(l.lineId)).map((l) => ({ lineId: l.lineId, quantity: wanted.get(l.lineId) as number }));
  const sent = parcel.reduce((sum, p) => sum + p.quantity, 0);
  return { ok: true, parcel, left: total - sent };
}

/** The lines as they will stand after a parcel (for the "rest follows" words and the state after it). */
export function afterParcel(lines: readonly FulfilmentLine[], parcel: readonly ParcelLine[]): FulfilmentLine[] {
  const add = new Map(parcel.map((p) => [p.lineId, p.quantity]));
  return lines.map((l) => (add.has(l.lineId) ? { ...l, shipped: count(l.shipped) + (add.get(l.lineId) as number) } : l));
}
