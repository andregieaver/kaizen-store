/**
 * The markets the storefront routes to. The database (`commerce.markets`) holds
 * each market's currency and whether it is active; this list decides which URL
 * prefixes exist. A test keeps the two in step.
 */
export const MARKETS = {
  no: { code: "NO", locale: "nb-NO", lang: "nb", currency: "NOK", name: "Norge" },
  se: { code: "SE", locale: "sv-SE", lang: "sv", currency: "SEK", name: "Sverige" },
  dk: { code: "DK", locale: "da-DK", lang: "da", currency: "DKK", name: "Danmark" },
} as const;

export type MarketSlug = keyof typeof MARKETS;
export type Market = (typeof MARKETS)[MarketSlug] & { slug: MarketSlug };

export const MARKET_SLUGS = Object.keys(MARKETS) as MarketSlug[];

export function getMarket(slug: string): Market | null {
  return slug in MARKETS
    ? { ...MARKETS[slug as MarketSlug], slug: slug as MarketSlug }
    : null;
}

/** The market to suggest for a visitor's country, if we sell there. */
export function marketForCountry(country: string | null): Market | null {
  if (!country) return null;
  const slug = MARKET_SLUGS.find((s) => MARKETS[s].code === country.toUpperCase());
  return slug ? getMarket(slug) : null;
}
