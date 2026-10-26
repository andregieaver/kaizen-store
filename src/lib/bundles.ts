/**
 * A bundle's price and stock as the editor previews them (wave 6 unit D, D322). The database works out the real ones (`refresh_bundle_prices()`
 * and `variant_availability`); these give the same answer from the same facts, held together by `bundles.test.ts` and the database test. No
 * imports: the editor reads it in the browser.
 */

export type BundlePart = { quantity: number; inStock: number; prices: Record<string, number>; usable: boolean };

/** A computed bundle's price in a market: the parts' prices times their quantities, less the percentage, half up; null when a part has none there. */
export function computedBundlePrice(parts: readonly BundlePart[], market: string, percentOff: number): { sumMinor: number; priceMinor: number } | null {
  if (parts.length === 0) return null;
  let sum = 0;
  for (const part of parts) {
    const price = part.prices[market];
    if (price === undefined) return null;
    sum += price * part.quantity;
  }
  return { sumMinor: sum, priceMinor: Math.floor((sum * (100 - percentOff) + 50) / 100) };
}

/** How many bundles the parts' stock allows: the lowest whole number, none with an unusable part or fewer than two units in all. */
export function bundleStock(parts: readonly BundlePart[]): number {
  if (parts.length === 0) return 0;
  if (parts.reduce((sum, p) => sum + p.quantity, 0) < 2) return 0;
  if (parts.some((p) => !p.usable)) return 0;
  return Math.max(0, Math.min(...parts.map((p) => Math.floor(Math.max(p.inStock, 0) / p.quantity))));
}

/** A bundle's components in one line of words, as an order and a slip show them (D322): "2 × Mug, 1 × Tote", per bundle. */
export function componentsText(components: readonly { title: string; quantity: number }[]): string {
  return components.map((c) => `${c.quantity} × ${c.title}`).join(", ");
}
