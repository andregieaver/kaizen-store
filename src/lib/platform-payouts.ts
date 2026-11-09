import { reconcilePayout, type PayoutLineKind, type PayoutState, type PayoutStatus, type Reconciliation } from "./payouts";

/**
 * Kaizena Flow's own payouts (D509, the platform's twin of D290): what each carried, line by line, tied to the sale it was for, and whether
 * it adds up. Pure.
 */

/** A line of one of Kaizena Flow's payouts as kept: Stripe's gross, fee and net, and the sale it was for (a payment, its refund or dispute). */
export type PlatformPayoutLine = { kind: PayoutLineKind; amountMinor: number; feeMinor: number; netMinor: number; saleId: string | null };

export type PlatformPayoutFacts = { amountMinor: number; status: PayoutStatus; automatic: boolean; linesRead: boolean; linesComplete: boolean };

/** Whether a payout adds up, as a store's does (`reconcilePayout()`): money for a sale must be tied to one. */
export function reconcilePlatformPayout(payout: PlatformPayoutFacts, lines: readonly PlatformPayoutLine[]): Reconciliation {
  return reconcilePayout(
    payout,
    lines.map((l) => ({ kind: l.kind, amountMinor: l.amountMinor, feeMinor: l.feeMinor, netMinor: l.netMinor, orderId: l.saleId })),
  );
}

/** A payout's state from its lines' totals (the list reads sums, not lines), in the same order `reconcilePayout()` decides it. */
export function platformPayoutState(payout: PlatformPayoutFacts & { linesNetMinor: number; untiedCount: number }): PayoutState {
  if (!payout.automatic) return "manual";
  if (!payout.linesRead) return "not_read";
  if (!payout.linesComplete) return "incomplete";
  if (payout.amountMinor !== payout.linesNetMinor) return "difference";
  if (payout.untiedCount > 0) return "untied";
  return "reconciles";
}

type Ref = string | { id?: string | null } | null | undefined;
const idOf = (ref: Ref): string | null => (typeof ref === "string" ? ref : (ref?.id ?? null));

/**
 * The payment a balance transaction's source was for, by its payment intent: a charge's, a refund's or a dispute's own (Stripe pays an
 * invoice through a payment intent, so the invoice is found by it). None for a source without one, or one not expanded.
 */
export function paymentIntentOf(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const s = source as { object?: string; payment_intent?: Ref; charge?: Ref | { payment_intent?: Ref } };
  if (s.object !== "charge" && s.object !== "refund" && s.object !== "dispute") return null;
  const own = idOf(s.payment_intent ?? null);
  if (own) return own;
  const charge = s.charge;
  return charge && typeof charge === "object" && "payment_intent" in charge ? idOf(charge.payment_intent ?? null) : null;
}
