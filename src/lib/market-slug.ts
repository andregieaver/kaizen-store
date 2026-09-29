/**
 * The address of a market and how it is shown (D109). A store's country
 * (`no`) has its own language and currency; a shopper may choose others, and
 * the choice is in the address so every page and link keeps it and can be
 * cached and found: `no` (the country's own), `no-en` (in English), `no-eur`
 * (in euro), `no-en-eur`. A language is two letters and a currency three, so
 * none is taken for the other. A choice that is the country's own is left
 * out: that is the address it is known by.
 */

export type MarketChoice = {
  /** The country, upper case: `NO`. */
  country: string;
  /** A language tag, lower case, or null for the country's own. */
  lang: string | null;
  /** A currency code, upper case, or null for the country's own. */
  currency: string | null;
};

const PATTERN = /^([a-z]{2})(?:-([a-z]{2}))?(?:-([a-z]{3}))?$/;

/** The parts of a market address, or null when it is not one. */
export function parseMarketSlug(slug: string): MarketChoice | null {
  const match = PATTERN.exec(slug);
  if (!match) return null;
  return { country: match[1].toUpperCase(), lang: match[2] ?? null, currency: match[3] ? match[3].toUpperCase() : null };
}

/** The address of a country shown in a language and a currency, without what is the country's own. */
export function marketSlug(country: string, chosen: { lang: string; currency: string }, own: { lang: string; currency: string }): string {
  const parts = [country.toLowerCase()];
  if (chosen.lang !== own.lang) parts.push(chosen.lang.toLowerCase());
  if (chosen.currency !== own.currency) parts.push(chosen.currency.toLowerCase());
  return parts.join("-");
}
