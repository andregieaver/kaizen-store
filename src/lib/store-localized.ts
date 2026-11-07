import type { StoreCurrency } from "./currency";
import { isLanguageRule, type LanguageRule } from "./language-rule";
import { localizationOf, type Localization } from "./localization";
import { offeredMarkets, toMarket, type Market, type PriceStyle } from "./markets";
import { isPriceDecimals, type PriceDecimals } from "./money";
import { parseWordsByLocale } from "./price-words";
import { storeAddressOf, type StoreAddress } from "./store-address";
import { featureOn, normaliseFeatures } from "./store-features";

type Row = Record<string, unknown>;

/** A market as the store's row lists it: its country, currency and language, and its own choice of decimals (D429), null for the store's. */
type MarketJson = { code: string; currency: string; defaultLocale: string; priceDecimals?: unknown };

/** What a store's row gives of its countries, languages, currencies and address shape (`Store`'s fields of the same names). */
export type Localized = {
  markets: Market[];
  keptMarkets: Market[];
  allMarkets: Market[];
  localization: Localization;
  address: StoreAddress | null;
  ratesAuto: boolean;
  ratesUpdatedAt: string | null;
  chosenLocales: string[];
  chosenCurrencies: StoreCurrency[];
  /** What the owner chose of how a visitor is first shown a language and the currency with it (D479), kept while the features are off. */
  languageSettings: LanguageSettings;
};

/** The owner's choices of D479 as the settings page edits them: `localization.languageRule` and `.currencyByLanguage` are what applies. */
export type LanguageSettings = { rule: LanguageRule; currencyFollows: boolean; currencies: Record<string, string> };

/** The owner's currency per language (D479) as the row keeps it: two letters to a currency or `own`, anything else left out. */
export function languageCurrenciesOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, string] => /^[a-z]{2}$/.test(entry[0]) && typeof entry[1] === "string" && /^([A-Z]{3}|own)$/.test(entry[1]),
    ),
  );
}

/**
 * The markets and what the store offers in languages and currencies, as read from its row and switched by its features (D178): the countries
 * offered (`offeredMarkets()`), and languages and currencies beyond each country's own only while Several languages or currencies is on; and
 * the shape of its addresses (D181). The row needs `features`, `locales`, `currencies`, `markets`, `all_markets` and `house` as `loadStore()`
 * selects them (the proxy's facts read the same, `redirect-resolve.ts`). Each market carries how it shows prices (D429, `Market.priceStyle`) from the
 * row's `price_decimals` and `price_words` and its own `priceDecimals`; a row without them shows decimals always and no words. How a visitor
 * is first shown a language and whether the currency follows it (D479) are the row's `language_rule`, `currency_follows_language` and
 * `language_currencies`; a row without them is the country's own language, the currency apart.
 */
export function localized(row: Row): Localized {
  const features = normaliseFeatures(Array.isArray(row.features) ? (row.features as unknown[]).map(String) : []);
  const keptRows = row.markets as MarketJson[];
  const plainKept = keptRows.map(toMarket);
  const plainOffered = offeredMarkets(plainKept, featureOn(features, "countries"));
  const chosenLocales = ((row.locales ?? []) as string[]).map(String);
  const chosenCurrencies = ((row.currencies ?? []) as { currency: string; rate: string | number | null; roundTo: number }[]).map((c) => ({
    currency: String(c.currency).trim(),
    rate: c.rate === null ? null : Number(c.rate),
    roundTo: Number(c.roundTo),
  }));
  const allRows = (row.all_markets ?? []) as MarketJson[];
  const languageSettings: LanguageSettings = {
    rule: isLanguageRule(row.language_rule) ? row.language_rule : "own",
    currencyFollows: row.currency_follows_language === true,
    currencies: languageCurrenciesOf(row.language_currencies),
  };
  const localization = localizationOf(chosenLocales, chosenCurrencies, plainOffered, {
    kept: plainKept,
    languages: featureOn(features, "languages"),
    currencies: featureOn(features, "currencies"),
    rule: languageSettings.rule,
    currencyFollows: languageSettings.currencyFollows ? { chosen: languageSettings.currencies } : null,
  });
  // How each country shows prices (D429): its own decimals, else the store's; the store's words, a language without its own taking the main one's.
  const storeDecimals: PriceDecimals = isPriceDecimals(row.price_decimals) ? row.price_decimals : "always";
  const words = { byLocale: parseWordsByLocale(row.price_words), main: localization.locales[0] ?? "" };
  const styled = (market: MarketJson): Market => {
    const priceStyle: PriceStyle = { decimals: isPriceDecimals(market.priceDecimals) ? market.priceDecimals : storeDecimals, words };
    return toMarket({ code: market.code, currency: market.currency, defaultLocale: market.defaultLocale, priceStyle });
  };
  const keptMarkets = keptRows.map(styled);
  const markets = offeredMarkets(keptMarkets, featureOn(features, "countries"));
  const allMarkets = allRows.map(styled);
  return {
    markets,
    keptMarkets,
    allMarkets,
    localization,
    // Kaizena Flow's own store writes Norwegian at `/no/…` (D466 step 5, `HOUSE_ALIASES`): the row's `house`, where it is read.
    address: storeAddressOf({ markets, keptMarkets, allMarkets, localization, house: row.house === true }),
    ratesAuto: Boolean(row.rates_auto),
    ratesUpdatedAt: row.rates_updated_at ? new Date(String(row.rates_updated_at)).toISOString() : null,
    chosenLocales,
    chosenCurrencies,
    languageSettings,
  };
}
