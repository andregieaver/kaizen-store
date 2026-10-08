import type { StoreCurrency } from "./currency";
import { localizationOf, type Localization } from "./localization";
import { offeredMarkets, toMarket, type Market } from "./markets";
import { storeAddressOf, type StoreAddress } from "./store-address";
import { featureOn, normaliseFeatures } from "./store-features";

type Row = Record<string, unknown>;

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
 * them (the proxy's facts read the same, `redirect-resolve.ts`).
 */
export function localized(row: Row): Localized {
  const features = normaliseFeatures(Array.isArray(row.features) ? (row.features as unknown[]).map(String) : []);
  const keptMarkets = (row.markets as { code: string; currency: string; defaultLocale: string }[]).map(toMarket);
  const markets = offeredMarkets(keptMarkets, featureOn(features, "countries"));
  const chosenLocales = ((row.locales ?? []) as string[]).map(String);
  const chosenCurrencies = ((row.currencies ?? []) as { currency: string; rate: string | number | null; roundTo: number }[]).map((c) => ({
    currency: String(c.currency).trim(),
    rate: c.rate === null ? null : Number(c.rate),
    roundTo: Number(c.roundTo),
  }));
  const allMarkets = ((row.all_markets ?? []) as { code: string; currency: string; defaultLocale: string }[]).map(toMarket);
  const localization = localizationOf(chosenLocales, chosenCurrencies, markets, {
    kept: keptMarkets,
    languages: featureOn(features, "languages"),
    currencies: featureOn(features, "currencies"),
  });
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
