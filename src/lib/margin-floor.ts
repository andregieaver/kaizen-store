/**
 * The margin floor (`docs/100-day-challenge.md` D5): the autopilot never sets a price, a discount or a campaign that leaves a product under
 * the owner's lowest margin without their yes. Pure: a margin from a VAT-inclusive price, the VAT rate and the unit cost, all in the store's
 * main currency's minor units; the server reads the prices, rates and costs.
 */

/** One variant's price in one market: what the shopper pays (VAT included), its VAT rate as a fraction (0.25), and its unit cost. */
export type MarginRow = { priceMinor: number; vatRate: number; costMinor: number };

/** The margin in percent of the price without VAT: (net − cost) ÷ net. Null when there is no net price to measure against. */
export function marginPercent(row: MarginRow): number | null {
  if (!Number.isFinite(row.priceMinor) || !Number.isFinite(row.vatRate) || !Number.isFinite(row.costMinor) || row.vatRate < 0) return null;
  const net = row.priceMinor / (1 + row.vatRate);
  if (net <= 0) return null;
  return ((net - row.costMinor) / net) * 100;
}

/**
 * The lowest margin over the rows after taking `depthPercent` off every price (0: the prices as they are). Null when no row can be measured,
 * so a store without costs never passes the floor by accident.
 */
export function lowestMargin(rows: readonly MarginRow[], depthPercent = 0): number | null {
  const factor = 1 - Math.min(Math.max(depthPercent, 0), 100) / 100;
  let lowest: number | null = null;
  for (const row of rows) {
    const margin = marginPercent({ ...row, priceMinor: row.priceMinor * factor });
    if (margin === null) continue;
    lowest = lowest === null ? margin : Math.min(lowest, margin);
  }
  return lowest;
}

/** Why a margin breaks the floor, in words, or null when it holds (or there is no floor). */
export function marginFloorProblem(lowest: number | null | undefined, floorPercent: number | null): string | null {
  if (floorPercent === null) return null;
  if (lowest === undefined || lowest === null) return "The margin it leaves could not be measured: a product has no cost, or a price has no exchange rate.";
  if (lowest < floorPercent) return `It leaves a product a margin of ${Math.round(lowest * 10) / 10} %, under your lowest margin of ${floorPercent} %.`;
  return null;
}
