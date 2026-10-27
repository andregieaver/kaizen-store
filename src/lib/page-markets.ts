/**
 * Which countries a store's page or article is for (D338, `docs/wave-7-storefront.md` D1): `PageContent.markets`, none for every country.
 * Pure and without zod, so the builder and the site read it alike.
 */

/** Whether a page is for a country (a market code, any case): every page without countries of its own is. */
export function pageInMarket(page: { markets?: readonly string[] | null }, country: string): boolean {
  const markets = page.markets;
  return !markets || markets.length === 0 || markets.includes(country.toUpperCase());
}

/** The countries a page keeps when saved: the owner's own (the store's countries, kept ones included), none when that is every one. */
export function ownMarkets(chosen: readonly string[] | undefined, storeCountries: readonly string[]): string[] | undefined {
  if (!chosen || chosen.length === 0) return undefined;
  const own = new Set(storeCountries.map((c) => c.toUpperCase()));
  const kept = [...new Set(chosen.map((c) => c.toUpperCase()))].filter((c) => own.has(c)).sort();
  return kept.length === 0 || kept.length === own.size ? undefined : kept;
}
