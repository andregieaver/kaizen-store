/**
 * An order change's life (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 3.3 point 7 and 4.5): the statuses and where each can go. The table is the
 * same as the database's (`order_edits_rules()` in `fulfilment_rules`, which refuses anything else; `src/db/fulfilment.test.ts` holds the two together), so a
 * screen only offers what the database accepts.
 *
 * An edit with a lower or equal total is written `applied` at once (the order carries it in the same transaction). One with a higher total is written
 * `awaiting_payment`: the order is unchanged and only the added units are held until the link's end; the customer's payment (or staff recording it as paid
 * outside Kaizen) makes it `applied`, *Cancel the change* or a confirmed withdrawal `cancelled`, and the five-minute job `expired` at the link's end.
 * `applied`, `cancelled` and `expired` are final. Nothing is ever deleted.
 */

export const ORDER_EDIT_STATUSES = ["awaiting_payment", "applied", "cancelled", "expired"] as const;
export type OrderEditStatus = (typeof ORDER_EDIT_STATUSES)[number];

export const isOrderEditStatus = (value: unknown): value is OrderEditStatus =>
  typeof value === "string" && (ORDER_EDIT_STATUSES as readonly string[]).includes(value);

/** Where an edit can go from each status. */
export const ORDER_EDIT_TRANSITIONS: Record<OrderEditStatus, readonly OrderEditStatus[]> = {
  awaiting_payment: ["applied", "cancelled", "expired"],
  applied: [],
  cancelled: [],
  expired: [],
};

/** The statuses an edit may be written with: an applied one at once (a lower or equal total, or paid outside Kaizen), or one waiting for the customer's payment. */
export const ORDER_EDIT_START: readonly OrderEditStatus[] = ["awaiting_payment", "applied"];

export const canMoveOrderEdit = (from: OrderEditStatus, to: OrderEditStatus): boolean => ORDER_EDIT_TRANSITIONS[from].includes(to);
export const isOrderEditFinal = (status: OrderEditStatus): boolean => ORDER_EDIT_TRANSITIONS[status].length === 0;
/** An edit that ended without changing the order. */
export const isOrderEditEnded = (status: OrderEditStatus): boolean => status === "cancelled" || status === "expired";

/** Why staff changed the order: a fixed list; the customer sees fixed words for the first three and nothing for `other` (never staff's note). */
export const ORDER_EDIT_REASONS = ["customer_request", "out_of_stock", "store_error", "other"] as const;
export type OrderEditReason = (typeof ORDER_EDIT_REASONS)[number];
export const isOrderEditReason = (value: unknown): value is OrderEditReason =>
  typeof value === "string" && (ORDER_EDIT_REASONS as readonly string[]).includes(value);

/** The kinds of an edit's line: units added (a new order line), a line removed entirely, a line's quantity lowered. */
export const ORDER_EDIT_LINE_KINDS = ["add", "remove", "reduce"] as const;
export type OrderEditLineKind = (typeof ORDER_EDIT_LINE_KINDS)[number];

/**
 * What became of the edit's documents (D159 extended, 4.6): `none` (nothing to issue yet: an awaiting edit, or an applied one before its documents were
 * looked at), `issued` (the edit credit note and/or the edit invoice exist, or there was nothing to put on either), `waiting` (the original invoice is
 * waiting, or issuing failed: the five-minute job tries again), `not_invoiced` (the order gets no documents: copied, host, test mode, invoicing off),
 * `in_original` (the order's own invoice was issued after the change and already states the order as changed, so the change needs none of its own: 3.10).
 * `issued`, `not_invoiced` and `in_original` are final.
 */
export const ORDER_EDIT_DOCUMENTS = ["none", "issued", "waiting", "not_invoiced", "in_original"] as const;
export type OrderEditDocuments = (typeof ORDER_EDIT_DOCUMENTS)[number];
export const ORDER_EDIT_DOCUMENT_TRANSITIONS: Record<OrderEditDocuments, readonly OrderEditDocuments[]> = {
  none: ["issued", "waiting", "not_invoiced", "in_original"],
  waiting: ["issued", "not_invoiced", "in_original"],
  issued: [],
  not_invoiced: [],
  in_original: [],
};
export const canMoveEditDocuments = (from: OrderEditDocuments, to: OrderEditDocuments): boolean => ORDER_EDIT_DOCUMENT_TRANSITIONS[from].includes(to);

/** The edit's number as staff and the customer see it (`E1`, `E2`, …), per order. */
export const editLabel = (seq: number): string => `E${seq}`;

export const ORDER_EDIT_STATUS_LABELS: Record<OrderEditStatus, string> = {
  awaiting_payment: "Waiting for the customer's payment",
  applied: "Applied",
  cancelled: "Cancelled",
  expired: "Expired",
};

export const ORDER_EDIT_REASON_LABELS: Record<OrderEditReason, string> = {
  customer_request: "The customer asked",
  out_of_stock: "Out of stock",
  store_error: "Our mistake",
  other: "Other",
};
