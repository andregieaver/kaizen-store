/**
 * What a return refunds (D153, `docs/returns.md`): worked out once, here, and shown with its working before the staff
 * member presses the button. Integer minor units in the order's currency; nothing is estimated and nothing is rounded
 * in floats.
 *
 * **What the shopper paid for a line.** `order_lines.total_minor` is `unit price x quantity - discount`, where the line's
 * discount already holds the campaign, group, welcome and code shares and the bonus credit used (`placeOrder()`), so it
 * is what the shopper paid for the line, VAT included: refund that, never the list price. (Bonus credits are given back
 * to the customer by the ledger's own triggers on a refund, D130.)
 *
 * **Partial quantities: the cumulative rule.** Of a line of `Q` units that cost `T`, the first `n` units returned are
 * worth `floor(T x n / Q)`. A return of `q` units after `p` were already returned (on other returns that count) is worth
 * `floor(T x (p + q) / Q) - floor(T x p / Q)`. So the odd minor units fall to the last units: however a line is split
 * over returns, the parts add up to `T` exactly when every unit is back, and never to more.
 *
 * **The rest of the sum** (the Consumer Rights Directive Art. 13 and 14(2)):
 * - minus a *deduction* per line for diminished value (never above the value of the units returned);
 * - plus the original **standard delivery** cost only when the whole order is withdrawn: a `withdrawal` return that, with the
 *   order's other withdrawals whose goods are settled, takes every line of the order in full, and only what no other return
 *   refunded of the delivery (`shippingRefundedMinor`, kept on each return as it is refunded). Delivery the shopper
 *   paid beyond the cheapest standard option is not refunded (`standardShippingMinor`). A voluntary return never
 *   refunds delivery here (the store's own policy is the store's to adjust by hand);
 * - minus the **return shipping** cost when the shopper pays it (the store's setting, a CRD default);
 * - never below 0 and never above what is left to refund through Stripe (`refundableMinor`).
 */

export type RefundLine = {
  lineId: string;
  /** Units bought on the order line. */
  quantity: number;
  /** What was paid for the whole line (`order_lines.total_minor`). */
  totalMinor: number;
  /** Units already on other returns that count (not declined or cancelled). */
  priorQuantity: number;
  /** Units accepted on this return. 0 for a line that is not in it. */
  returnQuantity: number;
  /**
   * Units on the order's other withdrawal returns that count and whose goods are settled (back, refunded or never sent), earlier
   * or later: what makes this return the one that completes the order. When absent, the units on earlier returns
   * (`priorQuantity`) are taken.
   */
  completedByOthers?: number;
  /** The deduction for diminished value on this return's units; 0 when none. */
  deductionMinor: number;
};

export type RefundInput = {
  kind: "withdrawal" | "return";
  /** Every line of the order, those not in this return with `returnQuantity` 0: whole-order is judged on all of them. */
  lines: RefundLine[];
  /** What the shopper paid for delivery: the order's total less its lines' totals (`shippingPaidMinor()`). */
  shippingPaidMinor: number;
  /** The cheapest standard delivery the store offered; null when it is not known, which counts the whole of what was paid. */
  standardShippingMinor?: number | null;
  /** Delivery refunded by earlier returns of this order. */
  shippingRefundedMinor?: number;
  whoPaysReturn: "shopper" | "store";
  /** What the return's shipping cost (a label the store paid and charges the shopper for); 0 when the shopper sent it themselves. */
  returnShippingMinor?: number;
  /** What is left to refund through Stripe on the order (`OrderAdmin.refundableMinor`). */
  refundableMinor: number;
};

export type RefundLineResult = {
  lineId: string;
  returnQuantity: number;
  /** What the units returned were paid for, by the cumulative rule. */
  valueMinor: number;
  /** The deduction taken, never above `valueMinor`. */
  deductionMinor: number;
  /** The deduction asked for was more than the value and was brought down. */
  deductionClamped: boolean;
  netMinor: number;
};

export type WorkingRow = {
  key: "goods" | "deductions" | "shipping" | "return_shipping";
  /** Signed: what it adds to the refund (a deduction is negative). */
  amountMinor: number;
};

export type Refund = {
  lines: RefundLineResult[];
  goodsMinor: number;
  deductionsMinor: number;
  /** Every line of the order is back in full with this return. */
  wholeOrder: boolean;
  shippingRefundMinor: number;
  returnShippingMinor: number;
  /** Goods, less deductions, plus delivery, less return shipping: before the floor and the cap. */
  sumMinor: number;
  /** The amount to refund: `sumMinor` held between 0 and what is left to refund. */
  amountMinor: number;
  /** What held it: `zero` (the sum was negative), `refundable` (more than is left through Stripe), or nothing. */
  cappedBy: "zero" | "refundable" | null;
  /** The lines of the working to show, in order, leaving out the ones that are 0. */
  working: WorkingRow[];
};

function assertMinor(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a whole number of minor units, 0 or more: ${value}`);
}
function assertCount(name: string, value: number) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a whole number, 0 or more: ${value}`);
}

/** `floor(total x units / quantity)` in exact integer arithmetic. */
export function paidForUnits(totalMinor: number, quantity: number, units: number): number {
  assertMinor("totalMinor", totalMinor);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new RangeError(`quantity must be 1 or more: ${quantity}`);
  assertCount("units", units);
  if (units > quantity) throw new RangeError(`units (${units}) are more than the line's quantity (${quantity})`);
  return Number((BigInt(totalMinor) * BigInt(units)) / BigInt(quantity));
}

/**
 * What `q` units are worth when `p` were returned before: the cumulative rule (see the top of this file). The odd
 * minor units come with the last units, so the parts of a line add up to its total exactly.
 */
export function lineValue(line: Pick<RefundLine, "quantity" | "totalMinor" | "priorQuantity" | "returnQuantity">): number {
  const { quantity, totalMinor, priorQuantity: p, returnQuantity: q } = line;
  assertCount("priorQuantity", p);
  assertCount("returnQuantity", q);
  if (q === 0) return 0;
  if (p + q > quantity) throw new RangeError(`More units are returned (${p + q}) than the line holds (${quantity})`);
  return paidForUnits(totalMinor, quantity, p + q) - paidForUnits(totalMinor, quantity, p);
}

/**
 * What the shopper paid for delivery: the order's total less what its lines come to (the lines carry every discount, a
 * delivery discount code included, so this is delivery as paid). Never below 0.
 */
export function shippingPaidMinor(orderTotalMinor: number, lineTotalsMinor: number[]): number {
  return Math.max(0, orderTotalMinor - lineTotalsMinor.reduce((sum, v) => sum + v, 0));
}

/** Whether, with this return, every line of the order is back in full. An order with no lines is not whole. */
export function isWholeOrder(lines: Pick<RefundLine, "quantity" | "priorQuantity" | "returnQuantity" | "completedByOthers">[]): boolean {
  return (
    lines.length > 0 &&
    lines.every((l) => (l.completedByOthers ?? l.priorQuantity) + l.returnQuantity >= l.quantity) &&
    lines.some((l) => l.returnQuantity > 0)
  );
}

export function refundFor(input: RefundInput): Refund {
  assertMinor("shippingPaidMinor", input.shippingPaidMinor);
  assertMinor("refundableMinor", input.refundableMinor);
  const lines: RefundLineResult[] = input.lines.map((line) => {
    assertMinor("deductionMinor", line.deductionMinor);
    const valueMinor = lineValue(line);
    const deductionMinor = Math.min(line.deductionMinor, valueMinor);
    return {
      lineId: line.lineId,
      returnQuantity: line.returnQuantity,
      valueMinor,
      deductionMinor,
      deductionClamped: line.deductionMinor > valueMinor,
      netMinor: valueMinor - deductionMinor,
    };
  });
  const goodsMinor = lines.reduce((sum, l) => sum + l.valueMinor, 0);
  const deductionsMinor = lines.reduce((sum, l) => sum + l.deductionMinor, 0);

  const alreadyRefunded = input.shippingRefundedMinor ?? 0;
  assertMinor("shippingRefundedMinor", alreadyRefunded);
  const wholeOrder = input.kind === "withdrawal" && isWholeOrder(input.lines);
  let shippingRefundMinor = 0;
  if (wholeOrder) {
    const standard = input.standardShippingMinor == null ? input.shippingPaidMinor : Math.min(input.shippingPaidMinor, Math.max(0, input.standardShippingMinor));
    shippingRefundMinor = Math.max(0, standard - alreadyRefunded);
  }

  const returnShip = input.whoPaysReturn === "shopper" ? (input.returnShippingMinor ?? 0) : 0;
  assertMinor("returnShippingMinor", returnShip);

  const sumMinor = goodsMinor - deductionsMinor + shippingRefundMinor - returnShip;
  const floored = Math.max(0, sumMinor);
  const amountMinor = Math.min(floored, input.refundableMinor);
  const cappedBy = sumMinor < 0 ? "zero" : floored > input.refundableMinor ? "refundable" : null;
  const working: WorkingRow[] = (
    [
      { key: "goods", amountMinor: goodsMinor },
      { key: "deductions", amountMinor: -deductionsMinor },
      { key: "shipping", amountMinor: shippingRefundMinor },
      { key: "return_shipping", amountMinor: -returnShip },
    ] as WorkingRow[]
  ).filter((row) => row.amountMinor !== 0 || row.key === "goods");
  return { lines, goodsMinor, deductionsMinor, wholeOrder, shippingRefundMinor, returnShippingMinor: returnShip, sumMinor, amountMinor, cappedBy, working };
}

export type OverrideProblem = "not_whole_number" | "negative" | "over_refundable" | "reason_needed" | "reason_too_long" | "below_working";
export const MAX_OVERRIDE_REASON = 500;

/**
 * Staff may set the final amount from what `refundFor()` worked out, inside 0 and what is left to refund, with a reason; a
 * change is logged as `return.refund_overridden`. A withdrawal is refunded in full (CRD Art. 13(1)): the only things that
 * take from it are the deductions of the inspection (Art. 14(2), each with its note) and the return shipping the shopper
 * pays, both already in the working, so a withdrawal's amount can be raised but never lowered here. A voluntary return is
 * the store's own offer and can be set lower. Returns the amount to refund, or why not.
 */
export function reviewOverride(input: {
  computedMinor: number;
  requestedMinor: number;
  refundableMinor: number;
  reason: string;
  kind?: "withdrawal" | "return";
}): { ok: true; amountMinor: number; changed: boolean } | { ok: false; problem: OverrideProblem } {
  const { computedMinor, requestedMinor, refundableMinor } = input;
  if (!Number.isSafeInteger(requestedMinor)) return { ok: false, problem: "not_whole_number" };
  if (requestedMinor < 0) return { ok: false, problem: "negative" };
  if (requestedMinor > refundableMinor) return { ok: false, problem: "over_refundable" };
  if (input.kind === "withdrawal" && requestedMinor < computedMinor) return { ok: false, problem: "below_working" };
  const changed = requestedMinor !== computedMinor;
  const reason = input.reason.trim();
  if (changed && reason.length === 0) return { ok: false, problem: "reason_needed" };
  if (reason.length > MAX_OVERRIDE_REASON) return { ok: false, problem: "reason_too_long" };
  return { ok: true, amountMinor: requestedMinor, changed };
}

/** What is left that returns may still refund on an order: what was paid less what was already refunded, never below 0. */
export const refundableAfter = (paidMinor: number, refundedMinor: number): number => Math.max(0, paidMinor - refundedMinor);
