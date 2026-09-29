import { marketSlug, parseMarketSlug } from "./market-slug";

/**
 * A market is a country a store sells to (`commerce.markets`), shown to a
 * shopper in a language and a currency (D109). The country decides shipping,
 * VAT and the prices, kept in its own currency; language and currency are the
 * shopper's to choose among those the store offers, and are in the address:
 * `/no`, `/no-en`, `/no-eur`, `/no-en-eur` (`src/lib/market-slug.ts`). A market
 * as the pages get it is the country as shown: `currency` and `locale` are
 * what is shown, `nativeCurrency` what amounts are kept in.
 */
export type Market = {
  /** The address of this view: the country's, with the language and currency when they are not its own. */
  slug: string;
  /** The country, upper case. */
  code: string;
  /** The currency shown. */
  currency: string;
  /** The language shown, e.g. `nb-NO`: also how numbers and dates read. */
  locale: string;
  /** The language subtag for `<html lang>`, e.g. `nb`. */
  lang: string;
  /** The country's name in the language shown, e.g. "Norge". */
  name: string;
  /** The country's own currency: prices and every other amount are kept in it. */
  nativeCurrency: string;
  /** The country's own language, shown at its bare address. */
  ownLocale: string;
  /** What turns an amount in `nativeCurrency` into `currency`: times `factor`, rounded to a multiple of `step` (1 and 1 when they are the same). */
  conversion: { factor: number; step: number };
};

export type MarketRow = { code: string; currency: string; defaultLocale: string };

/** The language and currency a shopper chose, when not the country's own, and how amounts convert into the currency. */
export type MarketView = { locale?: string; currency?: string; conversion?: { factor: number; step: number } };

const SAME = { factor: 1, step: 1 } as const;

/** An amount in the country's own currency as it is shown: converted at the store's rate when another currency is chosen. */
export function shown(market: Pick<Market, "conversion">, nativeMinor: number): number {
  const { factor, step } = market.conversion;
  return factor === 1 && step === 1 ? nativeMinor : Math.round((nativeMinor * factor) / step) * step;
}

/** Whether amounts are shown in the country's own currency, the only one subscriptions and weekly deliveries are in. */
export const isNative = (market: Pick<Market, "currency" | "nativeCurrency">) => market.currency === market.nativeCurrency;

const languageOf = (locale: string) => new Intl.Locale(locale).language;

/** A market from its row, in its country's own view (usable with `map`). */
export function toMarket(row: MarketRow): Market {
  return showMarket(row, {});
}

/** A market from its row, shown in the language and currency chosen. */
export function showMarket(row: MarketRow, view: MarketView): Market {
  const code = row.code.toUpperCase();
  const native = row.currency.toUpperCase();
  const locale = view.locale ?? row.defaultLocale;
  const currency = (view.currency ?? native).toUpperCase();
  const lang = languageOf(locale);
  return {
    slug: marketSlug(code, { lang, currency }, { lang: languageOf(row.defaultLocale), currency: native }),
    code,
    currency,
    locale,
    lang,
    name: new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code,
    nativeCurrency: native,
    ownLocale: row.defaultLocale,
    conversion: currency === native ? SAME : (view.conversion ?? SAME),
  };
}

/** The same country shown in another language and/or currency. */
export function inView(market: Market, view: MarketView): Market {
  const currency = view.currency ?? market.currency;
  return showMarket(
    { code: market.code, currency: market.nativeCurrency, defaultLocale: market.ownLocale },
    { locale: view.locale ?? market.locale, currency, conversion: view.conversion ?? (currency === market.currency ? market.conversion : undefined) },
  );
}

/** The country's own view (its bare address) of a market. */
export function ownView(market: Market): Market {
  return inView(market, { locale: market.ownLocale, currency: market.nativeCurrency });
}

/**
 * The market an address names, from a store's markets (each in its country's
 * own view), with the language and currency it asks for: `no-en-eur` is
 * Norway in English and euro. `locales` are the store's; a language it does
 * not have, or a currency `offered` does not allow, is not found.
 */
export function findMarket(
  markets: readonly Market[],
  slug: string,
  choices: {
    locales: readonly string[];
    /** How a country's own currency converts into another the store offers, or null when it cannot be shown in it. */
    conversion: (native: string, currency: string) => { factor: number; step: number } | null;
  } = { locales: [], conversion: () => null },
): Market | null {
  const parsed = parseMarketSlug(slug);
  const own = parsed && markets.find((market) => market.code === parsed.country);
  if (!parsed || !own) return null;
  let locale = own.ownLocale;
  if (parsed.lang && parsed.lang !== languageOf(own.ownLocale)) {
    const found = choices.locales.find((l) => languageOf(l) === parsed.lang);
    if (!found) return null;
    locale = found;
  }
  let currency = own.nativeCurrency;
  let conversion: { factor: number; step: number } | undefined;
  if (parsed.currency && parsed.currency !== own.nativeCurrency) {
    const found = choices.conversion(own.nativeCurrency, parsed.currency);
    if (!found) return null;
    currency = parsed.currency;
    conversion = found;
  }
  return showMarket({ code: own.code, currency: own.nativeCurrency, defaultLocale: own.ownLocale }, { locale, currency, conversion });
}

/** The market to suggest for a visitor's country, if the store sells there. */
export function marketForCountry(
  markets: readonly Market[],
  country: string | null,
): Market | null {
  if (!country) return null;
  return markets.find((market) => market.code === country.toUpperCase()) ?? null;
}
