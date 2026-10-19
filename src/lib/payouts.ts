/**
 * Payouts and reconciliation (wave 4 unit C, D290, `docs/wave-4-payments.md` 5): what a store's Stripe payouts were, the balance transactions each
 * settles, and whether they add up. Pure, with no imports (`src/db/schema.ts` reads the lists for its checks). Amounts are integer minor units in the
 * payout's own currency, as Stripe gave them; nothing here converts. Staff words, English as the admin.
 */

/** Stripe's payout statuses, as Stripe gives them. */
export const PAYOUT_STATUSES = ["pending", "in_transit", "paid", "failed", "canceled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];
export const isPayoutStatus = (value: unknown): value is PayoutStatus => (PAYOUT_STATUSES as readonly unknown[]).includes(value);

export const PAYOUT_STATUS_WORDS: Record<PayoutStatus, string> = {
  pending: "Pending",
  in_transit: "On its way",
  paid: "Paid",
  failed: "Failed",
  canceled: "Cancelled",
};

/** What a payout's line is, as Kaizena Flow groups Stripe's balance transaction types. */
export const PAYOUT_LINE_KINDS = ["charge", "refund", "dispute", "fee", "adjustment", "payout", "other"] as const;
export type PayoutLineKind = (typeof PAYOUT_LINE_KINDS)[number];

export const PAYOUT_LINE_KIND_WORDS: Record<PayoutLineKind, string> = {
  charge: "Payment",
  refund: "Refund",
  dispute: "Dispute",
  fee: "Stripe fee",
  adjustment: "Adjustment",
  payout: "Payout",
  other: "Other",
};

/**
 * The kind of a balance transaction, from Stripe's `type` and its source's id: a charge or payment, a refund (or a refunded failed payment), a dispute's
 * money (an adjustment whose source is a dispute, or the dispute types), Stripe's own fees, any other adjustment, the payout itself, and the rest.
 */
export function lineKindOf(type: string, sourceId: string | null): PayoutLineKind {
  if (type === "charge" || type === "payment") return "charge";
  if (type === "refund" || type === "payment_refund" || type === "payment_failure_refund") return "refund";
  if (type === "payout" || type === "payout_cancel" || type === "payout_failure") return "payout";
  if (type === "stripe_fee" || type === "tax_fee" || type === "application_fee") return "fee";
  if (sourceId?.startsWith("dp_") || sourceId?.startsWith("du_") || type === "dispute" || type === "payment_reversal") return "dispute";
  if (type === "adjustment") return "adjustment";
  return "other";
}

/** A balance transaction's fee split as Stripe tells it apart: Stripe's own (and its tax on it) and the platform's application fee (Kaizena Flow's). */
export type FeeParts = { providerFeeMinor: number; applicationFeeMinor: number };

export function feeParts(details: readonly { type: string; amount: number }[] | null | undefined): FeeParts {
  let providerFeeMinor = 0;
  let applicationFeeMinor = 0;
  for (const d of details ?? []) {
    if (!Number.isInteger(d.amount)) continue;
    if (d.type === "application_fee") applicationFeeMinor += d.amount;
    else providerFeeMinor += d.amount;
  }
  return { providerFeeMinor, applicationFeeMinor };
}

/** One line of a payout as kept: Stripe's gross, fee and net, and what of Kaizena Flow's it is tied to. */
export type PayoutLineFacts = { kind: PayoutLineKind; amountMinor: number; feeMinor: number; netMinor: number; orderId: string | null };

/** A payout's facts as the reconciliation reads them. */
export type PayoutFacts = { amountMinor: number; status: PayoutStatus; automatic: boolean; linesRead: boolean; linesComplete: boolean };

export type PayoutState = "not_read" | "manual" | "incomplete" | "reconciles" | "difference" | "untied";

export type Reconciliation = {
  state: PayoutState;
  /** Σ net of the lines that are not the payout itself. */
  linesNetMinor: number;
  /** payout − Σ net: 0 when it adds up. */
  differenceMinor: number;
  /** Σ net of payments, refunds and disputes Kaizena Flow cannot tie to an order, and how many. */
  untiedMinor: number;
  untiedCount: number;
  /** Σ fee of the lines (Stripe's and the application fee), positive. */
  feesMinor: number;
};

/** What a line of these kinds is: money for an order, so a line of one that is not tied to an order is money Kaizena Flow cannot explain. */
const ORDER_KINDS: readonly PayoutLineKind[] = ["charge", "refund", "dispute"];

/**
 * Whether a payout adds up: the net of its lines (all but the payout's own) against the payout's amount, and the money in it tied to no order. A
 * payout whose lines were not read says so; a manual payout (Stripe lists no lines for one) says so; a payout with more lines than were read says so.
 */
export function reconcilePayout(payout: PayoutFacts, lines: readonly PayoutLineFacts[]): Reconciliation {
  const own = lines.filter((l) => l.kind !== "payout");
  const linesNetMinor = own.reduce((s, l) => s + l.netMinor, 0);
  const feesMinor = own.reduce((s, l) => s + l.feeMinor, 0);
  const untied = own.filter((l) => ORDER_KINDS.includes(l.kind) && l.orderId === null);
  const untiedMinor = untied.reduce((s, l) => s + l.netMinor, 0);
  const differenceMinor = payout.amountMinor - linesNetMinor;
  const base = { linesNetMinor, differenceMinor, untiedMinor, untiedCount: untied.length, feesMinor };
  if (!payout.automatic) return { ...base, state: "manual", differenceMinor: 0 };
  if (!payout.linesRead) return { ...base, state: "not_read", differenceMinor: 0 };
  if (!payout.linesComplete) return { ...base, state: "incomplete", differenceMinor: 0 };
  if (differenceMinor !== 0) return { ...base, state: "difference" };
  if (untied.length > 0) return { ...base, state: "untied" };
  return { ...base, state: "reconciles" };
}

export const PAYOUT_STATE_WORDS: Record<PayoutState, string> = {
  not_read: "Not read yet",
  manual: "Manual payout",
  incomplete: "Too many lines to read",
  reconciles: "Adds up",
  difference: "Does not add up",
  untied: "Money not tied to an order",
};

/** Whether a state needs the owner's look (the page's flag). */
export const payoutFlagged = (state: PayoutState): boolean => state === "difference" || state === "untied";

/** How many balance transactions are read for one payout; a payout with more is `incomplete` rather than read without end. */
export const PAYOUT_LINES_MAX = 2000;
/** How far back the daily read looks. */
export const PAYOUT_READ_DAYS = 30;

/** A balance transaction as far as its fee is read (`charge.balance_transaction` expanded, or a payout's listed line). */
export type BalanceLike = { currency?: string | null; fee_details?: readonly { type: string; amount: number }[] | null };

/** What Stripe took for a charge, from its balance transaction (expanded), in the balance transaction's currency; null when Stripe gave none. */
export function feeOfBalance(balance: BalanceLike | string | null | undefined): (FeeParts & { currency: string }) | null {
  if (!balance || typeof balance === "string" || typeof balance.currency !== "string" || !/^[a-z]{3}$/i.test(balance.currency)) return null;
  return { ...feeParts(balance.fee_details), currency: balance.currency.toUpperCase() };
}

/** The connected-account webhook's payout events. */
export const PAYOUT_EVENTS = ["payout.created", "payout.updated", "payout.paid", "payout.failed", "payout.canceled"] as const;
export const isPayoutEvent = (type: string): boolean => (PAYOUT_EVENTS as readonly string[]).includes(type);

/** A payout as the Payouts page lists it. */
export type PayoutRow = {
  id: string;
  reference: string;
  arrivalOn: string | null;
  status: PayoutStatus;
  amountMinor: number;
  currency: string;
  testMode: boolean;
  automatic: boolean;
  /** Lines by kind (the payout's own line left out). */
  payments: number;
  refunds: number;
  disputes: number;
  others: number;
  reconciliation: Reconciliation;
};

export type PayoutReport = {
  payouts: PayoutRow[];
  /** Live payouts that are paid, in the main currency; test payouts and other statuses are listed, never summed. */
  totals: { paidMinor: number; feesMinor: number; paid: number };
  /** Paid live payouts left out of the totals for want of a rate, and their currencies. */
  unconverted: number;
  missingCurrencies: string[];
  flagged: number;
  testPayouts: number;
};

/** One payout's facts and its lines, as the server reads them. */
export type PayoutInput = Omit<PayoutRow, "payments" | "refunds" | "disputes" | "others" | "reconciliation"> & { linesRead: boolean; linesComplete: boolean; lines: PayoutLineFacts[] };

/** The Payouts page's report: each payout reconciled, newest first, and the totals of the paid live ones in the main currency (a currency with no rate counted). */
export function payoutReportOf(inputs: readonly PayoutInput[], toMain: (currency: string, minor: number) => number | null): PayoutReport {
  const payouts: PayoutRow[] = inputs.map((p) => {
    const count = (kind: PayoutLineKind) => p.lines.filter((l) => l.kind === kind).length;
    const { lines, linesRead, linesComplete, ...rest } = p;
    return {
      ...rest,
      payments: count("charge"),
      refunds: count("refund"),
      disputes: count("dispute"),
      others: lines.filter((l) => !["charge", "refund", "dispute", "payout"].includes(l.kind)).length,
      reconciliation: reconcilePayout({ amountMinor: p.amountMinor, status: p.status, automatic: p.automatic, linesRead, linesComplete }, lines),
    };
  });
  const totals = { paidMinor: 0, feesMinor: 0, paid: 0 };
  const missing = new Set<string>();
  let unconverted = 0;
  for (const p of payouts) {
    if (p.testMode || p.status !== "paid") continue;
    const amount = toMain(p.currency, p.amountMinor);
    const fees = toMain(p.currency, p.reconciliation.feesMinor);
    if (amount === null || fees === null) {
      unconverted += 1;
      missing.add(p.currency);
      continue;
    }
    totals.paidMinor += amount;
    totals.feesMinor += fees;
    totals.paid += 1;
  }
  return {
    payouts,
    totals,
    unconverted,
    missingCurrencies: [...missing].sort(),
    flagged: payouts.filter((p) => payoutFlagged(p.reconciliation.state)).length,
    testPayouts: payouts.filter((p) => p.testMode).length,
  };
}
