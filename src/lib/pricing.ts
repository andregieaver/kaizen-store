/**
 * What to show for a price. A reduction may only be advertised against the
 * lowest price of the previous 30 days (Price Indication Directive Art. 6a;
 * the same rule applies in Norway), so the reference comes from the database
 * and appears only when the current price is genuinely lower.
 */
export type PriceView = {
  amountMinor: number;
  currency: string;
  /** The 30-day lowest prior price, when the current price is a reduction. */
  referenceMinor: number | null;
};

export function priceView(
  amountMinor: number,
  currency: string,
  prior30dMinor: number | null,
): PriceView {
  return {
    amountMinor,
    currency,
    referenceMinor:
      prior30dMinor !== null && amountMinor < prior30dMinor ? prior30dMinor : null,
  };
}

export type StockLevel = "in_stock" | "low" | "out";

export const LOW_STOCK_THRESHOLD = 5;

export function stockLevel(available: number): StockLevel {
  if (available <= 0) return "out";
  return available <= LOW_STOCK_THRESHOLD ? "low" : "in_stock";
}
