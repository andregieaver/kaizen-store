/**
 * The shop's notes about a basket (D541, `STORE_NOTES` in `src/lib/store-parts.ts`): how far it is from free shipping, and what the
 * shopper saves today. Pure: the server gives the amounts, already in the currency shown; the arithmetic is here, in whole minor units.
 *
 * Free shipping follows the checkout's own rule (`shippingCost()`): the market's flat rate is free from its threshold, compared with the
 * basket's goods before discounts. A saving is only ever a genuine reduction (Price Indication Directive Art. 6a): a line's price against
 * its product's lowest price of the last 30 days, never against a price list, a price break or a subscription, plus the discounts the cart
 * takes off.
 */

/** Where a basket stands against the free-shipping threshold; null when there is no threshold or nothing to ship. */
export type FreeShippingState =
  | { kind: "reached"; thresholdMinor: number }
  | { kind: "short"; thresholdMinor: number; leftMinor: number; /** How far along, 0 to 100, for the bar. */ percent: number }
  | { kind: "empty"; thresholdMinor: number };

/**
 * Where the basket stands (`basketMinor`: its goods sent by post, before discounts). `ships` is false for a basket of downloads alone, which
 * pays no shipping and so is told nothing, unless it is empty (then the threshold is offered as it is on any page).
 */
export function freeShippingState(rate: { amountMinor: number; freeOverMinor: number | null } | null, basketMinor: number, ships: boolean, empty: boolean): FreeShippingState | null {
  if (!rate || rate.freeOverMinor === null || rate.freeOverMinor <= 0 || rate.amountMinor <= 0) return null;
  const threshold = rate.freeOverMinor;
  if (empty) return { kind: "empty", thresholdMinor: threshold };
  if (!ships) return null;
  if (basketMinor >= threshold) return { kind: "reached", thresholdMinor: threshold };
  const left = threshold - Math.max(0, basketMinor);
  return { kind: "short", thresholdMinor: threshold, leftMinor: left, percent: Math.max(0, Math.min(99, Math.floor((Math.max(0, basketMinor) * 100) / threshold))) };
}

/** A line as `cartSaving()` reads it: its unit price and quantity, the product's 30-day lowest price, and whether it may be called a reduction at all. */
export type SavingLine = {
  unitPriceMinor: number;
  quantity: number;
  /** The variant's lowest price of the last 30 days in the market, in the currency shown; null when there is none. */
  priorMinor: number | null;
  /** A price list's, a price break's or a subscription's price is never a reduction (D321, D323, D25); a booking's nor a gift card's either. */
  ownPrice: boolean;
};

/** What a line saves against its 30-day lowest price: only a genuine reduction, never below zero. */
export function lineSaving(line: SavingLine): number {
  if (line.ownPrice || line.priorMinor === null || line.priorMinor <= line.unitPriceMinor || line.quantity <= 0) return 0;
  return (line.priorMinor - line.unitPriceMinor) * line.quantity;
}

/** What the cart saves today: its lines' reductions and the discounts taken off it (codes, campaigns, a group's discount). */
export function cartSaving(lines: readonly SavingLine[], discountMinor: number): { reductionsMinor: number; discountMinor: number; totalMinor: number } {
  const reductions = lines.reduce((sum, line) => sum + lineSaving(line), 0);
  const discount = Math.max(0, Math.round(discountMinor));
  return { reductionsMinor: reductions, discountMinor: discount, totalMinor: reductions + discount };
}

/** What one product saves at its headline price: its 30-day reference less its price, when the price is a reduction. */
export function productSaving(price: { amountMinor: number; referenceMinor: number | null }): number {
  return price.referenceMinor !== null && price.referenceMinor > price.amountMinor ? price.referenceMinor - price.amountMinor : 0;
}
