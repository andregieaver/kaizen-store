/** Cart rules that do not need a database. */

import { fitQuantity, PLAIN_RULE, type QuantityRule } from "./quantity-rules";

/** The most units of one variant a single cart line may hold without a rule of its own (D323: `lineMax()` for one with). */
export { MAX_LINE_QUANTITY, MAX_ORDER_QUANTITY } from "./quantity-rules";

/** How long an idle cart (and its cookie) lives. */
export const CART_TTL_DAYS = 30;

export type LineOutcome = "added" | "capped" | "unavailable";

/**
 * The quantity a line should end up with when a shopper asks for `wanted`
 * units and `available` can be sold. Never above the line's maximum (the
 * variant's rule, D323) or the stock, in whole steps and never below its
 * minimum; `capped` tells the shopper they got fewer than they asked for.
 */
export function settleQuantity(
  wanted: number,
  available: number,
  rule: QuantityRule = PLAIN_RULE,
): { quantity: number; outcome: LineOutcome } {
  const asked = Math.max(rule.min, Math.floor(wanted));
  const quantity = fitQuantity(asked, available, rule);
  if (quantity === 0) return { quantity: 0, outcome: "unavailable" };
  if (quantity < asked) return { quantity, outcome: "capped" };
  return { quantity, outcome: "added" };
}

export type PricedLine = { unitPriceMinor: number; quantity: number };

export function cartSubtotal(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
}
