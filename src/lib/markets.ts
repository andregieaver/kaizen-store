/**
 * A market is a country a store sells to (`commerce.markets`). Its URL slug is
 * the lower-case country code: `/no`, `/se`, `/dk`.
 */
export type Market = {
  slug: string;
  code: string;
  currency: string;
  /** The market's default locale, e.g. `nb-NO`. */
  locale: string;
  /** The language subtag for `<html lang>`, e.g. `nb`. */
  lang: string;
  /** The country's name in the market's own language, e.g. "Norge". */
  name: string;
};

export type MarketRow = { code: string; currency: string; defaultLocale: string };

export function toMarket(row: MarketRow): Market {
  const code = row.code.toUpperCase();
  const locale = row.defaultLocale;
  return {
    slug: code.toLowerCase(),
    code,
    currency: row.currency.toUpperCase(),
    locale,
    lang: new Intl.Locale(locale).language,
    name: new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code,
  };
}

export function findMarket(markets: readonly Market[], slug: string): Market | null {
  return markets.find((market) => market.slug === slug) ?? null;
}

/** The market to suggest for a visitor's country, if the store sells there. */
export function marketForCountry(
  markets: readonly Market[],
  country: string | null,
): Market | null {
  if (!country) return null;
  return markets.find((market) => market.code === country.toUpperCase()) ?? null;
}
