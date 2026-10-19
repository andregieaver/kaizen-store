import { safeRatio } from "./analytics-core";
import { methodGroup } from "./payment-facts";

/**
 * Payments by method (wave 4 unit A, D288, docs/analytics.md "Payments by method"): what paid orders of a period were paid with, as the provider said.
 * Pure: the server reads the period's captured payments grouped by what they were and their currency (`src/server/analytics-payments-data.ts`), and this
 * groups them by method in the main currency. A currency with no rate is left out and counted; a Stripe payment whose charge was not read is *Unknown*.
 */

/** One SQL group: payments of one kind in one currency. */
export type PaymentGroupRow = {
  provider: string;
  methodType: string | null;
  wallet: string | null;
  manualMethod: string | null;
  currency: string;
  payments: number;
  /** Captured amounts, with VAT, in the currency's minor units. */
  receivedMinor: number;
  /** Succeeded refunds of these payments made in the period, with VAT. */
  refundedMinor: number;
  /** The percentage part of the estimated fee, in the currency (Stripe payments only; 0 for others). */
  feeShareMinor: number;
  /** Stripe payments in the group (each carries the fixed part of the fee). */
  feePayments: number;
};

export type PaymentMethodLine = {
  key: string;
  label: string;
  payments: number;
  receivedMinor: number;
  refundedMinor: number;
  /** Estimated from Analytics settings for Stripe payments; null for a method with no provider fee (staff-recorded, exchange credit, venue). */
  feesMinor: number | null;
  /** Of the money received. */
  share: number | null;
};

export type PaymentsByMethod = {
  lines: PaymentMethodLine[];
  total: { payments: number; receivedMinor: number; refundedMinor: number; feesMinor: number };
  /** Payments left out for want of a rate, and their currencies. */
  unconverted: number;
  missingCurrencies: string[];
  /** Stripe payments whose method is not known (their charge was not read). */
  unknown: number;
};

/** A currency's amount in the main currency, or null when there is no rate. */
export type ToMain = (currency: string, minor: number) => number | null;

/**
 * Groups by method (a wallet over its card), biggest first by money received, *Unknown* last. Fees are the estimate's percentage part converted plus
 * the fixed part (already in the main currency) per Stripe payment.
 */
export function paymentsByMethod(rows: readonly PaymentGroupRow[], toMain: ToMain, feeFixedMinor: number): PaymentsByMethod {
  const by = new Map<string, PaymentMethodLine>();
  const missing = new Set<string>();
  let unconverted = 0;
  let unknown = 0;
  for (const r of rows) {
    const received = toMain(r.currency, r.receivedMinor);
    const refunded = toMain(r.currency, r.refundedMinor);
    const feeShare = toMain(r.currency, r.feeShareMinor);
    if (received === null || refunded === null || feeShare === null) {
      unconverted += r.payments;
      missing.add(r.currency);
      continue;
    }
    const group = methodGroup(r);
    if (group.key === "unknown") unknown += r.payments;
    const line = by.get(group.key) ?? { key: group.key, label: group.label, payments: 0, receivedMinor: 0, refundedMinor: 0, feesMinor: null, share: null };
    line.payments += r.payments;
    line.receivedMinor += received;
    line.refundedMinor += refunded;
    if (r.feePayments > 0) line.feesMinor = (line.feesMinor ?? 0) + feeShare + feeFixedMinor * r.feePayments;
    by.set(group.key, line);
  }
  const lines = [...by.values()].sort((a, b) => (a.key === "unknown" ? 1 : b.key === "unknown" ? -1 : b.receivedMinor - a.receivedMinor || a.label.localeCompare(b.label)));
  const total = lines.reduce(
    (t, l) => ({ payments: t.payments + l.payments, receivedMinor: t.receivedMinor + l.receivedMinor, refundedMinor: t.refundedMinor + l.refundedMinor, feesMinor: t.feesMinor + (l.feesMinor ?? 0) }),
    { payments: 0, receivedMinor: 0, refundedMinor: 0, feesMinor: 0 },
  );
  for (const l of lines) l.share = safeRatio(l.receivedMinor, total.receivedMinor > 0 ? total.receivedMinor : null);
  return { lines, total, unconverted, missingCurrencies: [...missing].sort(), unknown };
}
