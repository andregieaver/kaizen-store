/** Cart rules that do not need a database. */

/** The most units of one variant a single cart line may hold. */
export const MAX_LINE_QUANTITY = 20;

/** How long an idle cart (and its cookie) lives. */
export const CART_TTL_DAYS = 30;

export type LineOutcome = "added" | "capped" | "unavailable";

/**
 * The quantity a line should end up with when a shopper asks for `wanted`
 * units and `available` can be sold. Never above the per-line maximum or the
 * stock; `capped` tells the shopper they got fewer than they asked for.
 */
export function settleQuantity(
  wanted: number,
  available: number,
): { quantity: number; outcome: LineOutcome } {
  const limit = Math.min(MAX_LINE_QUANTITY, Math.max(0, available));
  if (limit === 0) return { quantity: 0, outcome: "unavailable" };
  if (wanted > limit) return { quantity: limit, outcome: "capped" };
  return { quantity: Math.max(1, Math.floor(wanted)), outcome: "added" };
}

export type PricedLine = { unitPriceMinor: number; quantity: number };

export function cartSubtotal(lines: PricedLine[]): number {
  return lines.reduce((sum, line) => sum + line.unitPriceMinor * line.quantity, 0);
}
