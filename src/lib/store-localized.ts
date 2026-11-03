import type { StoreCurrency } from "./currency";
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
};

/**
 * The markets and what the store offers in languages and currencies, as read from its row and switched by its features (D178): the countries
 * offered (`offeredMarkets()`), and languages and currencies beyond each country's own only while Several languages or currencies is on; and
 * the shape of its addresses (D181). The row needs `features`, `locales`, `currencies`, `markets` and `all_markets` as `loadStore()` selects
 * them (the proxy's facts read the same, `redirect-resolve.ts`). Each market carries how it shows prices (D429, `Market.priceStyle`) from the
 * row's `price_decimals` and `price_words` and its own `priceDecimals`; a row without them shows decimals always and no words.
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
  const localization = localizationOf(chosenLocales, chosenCurrencies, plainOffered, {
    kept: plainKept,
    languages: featureOn(features, "languages"),
    currencies: featureOn(features, "currencies"),
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
    address: storeAddressOf({ markets, keptMarkets, allMarkets, localization }),
    ratesAuto: Boolean(row.rates_auto),
    ratesUpdatedAt: row.rates_updated_at ? new Date(String(row.rates_updated_at)).toISOString() : null,
    chosenLocales,
    chosenCurrencies,
  };
}
