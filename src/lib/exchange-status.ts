/**
 * An exchange's life (wave 3, D239, `docs/wave-3-exchanges.md` 3.3 point 1): the statuses and where each can go. The table is the same as the database's
 * (`commerce.return_exchanges_rules()` in `exchanges_rules`, which refuses anything else; `src/db/exchanges.test.ts` holds the two together), so a screen
 * only offers what the database accepts. Pure and dependency-free: the schema imports the lists for its checks.
 *
 * `draft` (staff are building it) → `proposed` (sent to the customer, a link and its end) → `confirmed` (the customer pressed *Confirm the exchange*, or, for a
 * voluntary return only, staff recorded the customer's agreement) → `processed` (the exchange order exists, stock held) → `settled` (the order is paid and
 * the return's refund recorded). It can end on the way: `declined_by_customer` (*No thanks*), `cancelled` (staff withdrew it, or cancelled it and refunded
 * instead), `expired` (the proposal or the pay link passed its end), `superseded` (staff refunded the return instead). Nothing is ever deleted.
 */

export const EXCHANGE_STATUSES = [
  "draft",
  "proposed",
  "confirmed",
  "processed",
  "settled",
  "declined_by_customer",
  "cancelled",
  "expired",
  "superseded",
] as const;
export type ExchangeStatus = (typeof EXCHANGE_STATUSES)[number];

export const isExchangeStatus = (value: unknown): value is ExchangeStatus =>
  typeof value === "string" && (EXCHANGE_STATUSES as readonly string[]).includes(value);

/** Where an exchange can go from each status. */
export const EXCHANGE_TRANSITIONS: Record<ExchangeStatus, readonly ExchangeStatus[]> = {
  draft: ["proposed", "cancelled"],
  proposed: ["confirmed", "declined_by_customer", "cancelled", "expired", "superseded"],
  confirmed: ["processed", "cancelled", "expired", "superseded"],
  processed: ["settled", "cancelled", "expired"],
  settled: [],
  declined_by_customer: [],
  cancelled: [],
  expired: [],
  superseded: [],
};

/** The statuses an exchange may be written with. */
export const EXCHANGE_START: readonly ExchangeStatus[] = ["draft", "proposed"];

/** An exchange that is still alive: one per return at a time (the partial unique index). */
export const EXCHANGE_OPEN: readonly ExchangeStatus[] = ["draft", "proposed", "confirmed", "processed"];

/** `to` when the table allows the step from `from`, else null. */
export function nextExchangeStatus(from: ExchangeStatus, to: ExchangeStatus): ExchangeStatus | null {
  return EXCHANGE_TRANSITIONS[from].includes(to) ? to : null;
}
export const canMoveExchange = (from: ExchangeStatus, to: ExchangeStatus): boolean => nextExchangeStatus(from, to) !== null;
export const isExchangeFinal = (status: ExchangeStatus): boolean => EXCHANGE_TRANSITIONS[status].length === 0;
export const isExchangeOpen = (status: ExchangeStatus): boolean => EXCHANGE_OPEN.includes(status);
/** An exchange that ended without being settled: the return is refunded as usual. */
export const isExchangeLapsed = (status: ExchangeStatus): boolean => isExchangeFinal(status) && status !== "settled";

/** How a confirmation came: the customer's press (`web`), or what staff recorded for a voluntary return. */
export const EXCHANGE_CHANNELS = ["web", "email", "letter", "phone", "in_person", "other"] as const;
export type ExchangeChannel = (typeof EXCHANGE_CHANNELS)[number];
/** The channels staff may record (never `web`, which is the customer's own press). */
export const STAFF_EXCHANGE_CHANNELS = ["email", "letter", "phone", "in_person", "other"] as const satisfies readonly ExchangeChannel[];
export type StaffExchangeChannel = (typeof STAFF_EXCHANGE_CHANNELS)[number];

/** Shipping of the replacements: free (the default), the market's flat rate, or a price staff set (VAT included). */
export const EXCHANGE_SHIPPING_KINDS = ["free", "standard", "set"] as const;
export type ExchangeShippingKind = (typeof EXCHANGE_SHIPPING_KINDS)[number];

/** The staff screens' words for each status. */
export const EXCHANGE_STATUS_LABELS: Record<ExchangeStatus, string> = {
  draft: "Draft",
  proposed: "Proposed",
  confirmed: "Confirmed",
  processed: "Waiting for payment",
  settled: "Exchanged",
  declined_by_customer: "Declined by the customer",
  cancelled: "Cancelled",
  expired: "Expired",
  superseded: "Refunded instead",
};

/** A return's label: pasted by staff (D153's `label_url`) or booked with a carrier (`returns.label_*`). */
export const LABEL_SOURCES = ["pasted", "carrier"] as const;
export type LabelSource = (typeof LABEL_SOURCES)[number];

/**
 * `refunds.kind`: an ordinary refund (`money`), the credit of a return moved to an exchange order (`transfer`, no provider call), or the part of a
 * held card payment staff did not capture (`release`, D289: never charged, so no provider call; the sale is reduced and it gets a credit note).
 */
export const REFUND_KINDS = ["money", "transfer", "release"] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];
