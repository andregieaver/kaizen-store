/**
 * Where a refund's money goes back (D174, review of wave 3 run 3): an order can carry more than one captured payment (the order's own and each change paid
 * through its link or recorded outside Kaizen, D174; a deposit and a no-show fee, D66), and each payment can give back only what it took less what was
 * already refunded from it: Stripe refuses a refund above the charge it names ("Refund amount is greater than charge amount"). So an amount is split over
 * the payments in the order they were made (the order's own first), each part capped at what its payment has left, and each part is one refund of that
 * payment. Pure; integer minor units.
 */

export type RefundablePayment = {
  id: string;
  /** `stripe` (refunded through Stripe) or `manual` (money taken outside Kaizen: the refund is recorded, D173). */
  provider: "stripe" | "manual";
  /** What the payment took less its refunds that did not fail. */
  leftMinor: number;
};

export type RefundPart = { paymentId: string; provider: "stripe" | "manual"; amountMinor: number };

/**
 * The parts of a refund of `amountMinor` over `payments` (already in the order they were made). Null when they have less left than the amount (the caller
 * refuses: "more than is left to refund"). An amount of 0 has no parts.
 */
export function splitRefund(payments: readonly RefundablePayment[], amountMinor: number): RefundPart[] | null {
  if (!Number.isInteger(amountMinor) || amountMinor < 0) return null;
  const parts: RefundPart[] = [];
  let rest = amountMinor;
  for (const p of payments) {
    if (rest <= 0) break;
    const left = Math.max(0, Math.trunc(p.leftMinor));
    if (left <= 0) continue;
    const take = Math.min(left, rest);
    parts.push({ paymentId: p.id, provider: p.provider, amountMinor: take });
    rest -= take;
  }
  return rest > 0 ? null : parts;
}

/** What is left to refund on an order: the sum of what its payments have left (never below 0 per payment). */
export const refundableOf = (payments: readonly Pick<RefundablePayment, "leftMinor">[]): number => payments.reduce((s, p) => s + Math.max(0, Math.trunc(p.leftMinor)), 0);
