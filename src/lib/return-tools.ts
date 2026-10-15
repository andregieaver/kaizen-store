import { EXCHANGE_STATUS_LABELS, type ExchangeStatus } from "./exchange-status";
import { STATUS_LABELS } from "./return-admin";
import { canMove, type ReturnKind, type ReturnStatus } from "./return-status";
import { CARRIERS } from "./shipping-carriers";

/**
 * What the AI manager's returns tools (D153) may do, decided without a database: `list_returns` and `explain_return` only read,
 * `approve_return` and `decline_return` answer a voluntary return the store has not yet answered and email the shopper, and
 * nothing here refunds: refunding stays a screen action (the return's page shows the working), as does everything that follows
 * the answer. A withdrawal is the shopper's legal right: it is never declined by the assistant, and the database refuses it too.
 */

export type ReturnRef = { number: string; kind: ReturnKind; status: ReturnStatus };

/** Why a return cannot be approved by the assistant, in a sentence for the model; null when it can. */
export function approveProblem(r: ReturnRef): string | null {
  if (r.kind === "withdrawal") {
    return `Return ${r.number} is a withdrawal: it was approved when the customer confirmed it, because the right of withdrawal is not the store's to refuse. What follows (instructions, receiving, refunding) is done on its page.`;
  }
  if (r.status === "requested") return null;
  if (canMove(r.kind, r.status, "approved")) return null;
  return `Return ${r.number} is ${STATUS_LABELS[r.status].toLowerCase()}, so it cannot be approved: only a return request that waits for an answer can.`;
}

/** Why a return cannot be declined by the assistant, in a sentence for the model; null when it can. */
export function declineProblem(r: ReturnRef): string | null {
  if (r.kind === "withdrawal") {
    return `Return ${r.number} is a withdrawal, the customer's legal right inside the withdrawal period, so it cannot be declined. Only a line the law excludes from the right can be declined, on the return's page.`;
  }
  if (canMove(r.kind, r.status, "declined")) return null;
  return `Return ${r.number} is ${STATUS_LABELS[r.status].toLowerCase()}, so it cannot be declined: only a return request that waits for an answer can.`;
}

/** What the assistant says about the part it does not do. */
export const REFUND_ON_SCREEN =
  "Refunding is done on the return's page, where the working is shown before the button: the assistant does not refund returns.";

/** The words a gated call is kept with, for the owner's yes. */
export function approveSummary(number: string, instructions: string | null): string {
  return `Approve the return ${number} and email the customer how to send the goods back${instructions ? `, with your instructions: "${instructions}"` : ""}.`;
}

export function declineSummary(number: string, reason: string): string {
  return `Decline the return ${number} and email the customer why: "${reason}"`;
}

// Exchanges and return labels (D239, docs/wave-3-exchanges.md 2.6) ------------------------------------------------------------

/** What the assistant says about exchanges and labels: it reads them, and never proposes, confirms, processes, books or records a payment. */
export const EXCHANGE_ON_SCREEN =
  "Exchanges and return labels are made on the return's page: the assistant can say where they stand, but never proposes, confirms or processes an exchange, books a label or records a payment.";

/** The queue's exchange marks in words (`QueueRow.exchange`). */
export const EXCHANGE_MARK_WORDS: Record<"wished" | "proposed" | "confirmed" | "waiting_payment", string> = {
  wished: "The customer would like an exchange (no proposal yet)",
  proposed: "Exchange proposed, waiting for the customer",
  confirmed: "Exchange confirmed by the customer, ready to process",
  waiting_payment: "Exchange processed, waiting for the customer to pay the difference",
};

const isExchangeStatus = (value: string): value is ExchangeStatus => Object.hasOwn(EXCHANGE_STATUS_LABELS, value);

/** A return's newest exchange as the server reads it (`ReturnExchangeState`): amounts in the order's currency, worked out by the store, never by the model. */
export type ExchangeFactsInput = {
  status: string;
  creditMinor: number;
  totalMinor: number;
  differenceMinor: number;
  expiresAt: string | null;
  exchangeOrderNumber: string | null;
};

/**
 * The exchange's facts for the model: its state, the credit (C), the replacements' total (T) and the difference (Δ = T − C) as sentences, every amount
 * written by `money` (the caller's `formatMoney`). The difference's words follow its sign; nothing is computed here but its absolute value.
 */
export function exchangeFacts(x: ExchangeFactsInput, money: (minor: number) => string, day: (at: string | null) => string | null) {
  const d = x.differenceMinor;
  const difference = d < 0 ? `The customer gets ${money(-d)} back` : d === 0 ? "Even: nothing to pay and nothing to refund" : `The customer pays ${money(d)}`;
  const status = isExchangeStatus(x.status) ? EXCHANGE_STATUS_LABELS[x.status] : x.status;
  const open = x.status === "proposed" || x.status === "confirmed" || x.status === "processed";
  return {
    status,
    credit: money(x.creditMinor),
    replacements: money(x.totalMinor),
    difference,
    exchange_order: x.exchangeOrderNumber ?? undefined,
    ends: open && x.expiresAt ? day(x.expiresAt) : undefined,
  };
}

export type LabelFactsInput = {
  source: "pasted" | "carrier" | null;
  carrierId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  costMinor: number | null;
  test: boolean;
  bookedAt: string | null;
};

/** The return label's facts for the model: booked with which carrier, the tracking, a test label, its cost and who pays for it. Never the carrier's own label address. */
export function labelFacts(l: LabelFactsInput, whoPays: "shopper" | "store", money: (minor: number) => string, day: (at: string | null) => string | null) {
  const payer = whoPays === "shopper" ? "The customer pays return shipping: a booked label's cost is taken off the refund only when staff confirm the parcel came back with it (never a test label), never more than it cost" : "The store pays return shipping";
  if (l.source === null) return { label: "No return label yet", who_pays: payer };
  if (l.source === "pasted") return { label: "A label address pasted by staff", who_pays: payer };
  const carrier = CARRIERS.find((c) => c.id === l.carrierId)?.name ?? l.carrierId ?? "a carrier";
  return {
    label: `Booked with ${carrier}${l.test ? " (a test label: it cannot be sent)" : ""}`,
    booked: day(l.bookedAt) ?? undefined,
    tracking: l.trackingNumber ?? undefined,
    tracking_link: l.trackingUrl ?? undefined,
    cost: l.costMinor !== null ? money(l.costMinor) : "Not known",
    who_pays: payer,
  };
}
