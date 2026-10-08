import { marketChoices, type Localization } from "./localization";
import { marketSlug, parseMarketSlug } from "./market-slug";
import { findMarket, type Market } from "./markets";

/**
 * Where the address of a country, language or currency a store no longer offers goes (D178, `docs/store-features.md` 4d): the same page in
 * the market that offers the most of what the address asked. A country that is not offered (Several countries off, or taken off the store's
 * list) goes to the store's own country; a language or a currency that is not offered is dropped, so `no-en` goes to `no` with Several
 * languages off and `no-eur` to `no` with Several currencies off, and `se-en-eur` to `no-en-eur` with only the countries off. An address
 * that is offered, or names no country the store ever had, moves nowhere (null): it is served, or it is the 404 it was. The address it gives
 * is always offered, so a move never loops.
 */
export function movedMarketSlug(
  store: { markets: readonly Market[]; allMarkets: readonly Pick<Market, "code">[]; localization: Localization },
  slug: string,
): string | null {
  const parsed = parseMarketSlug(slug);
  if (!parsed) return null;
  const choices = marketChoices(store.localization);
  if (findMarket(store.markets, slug, choices)) return null;
  const offered = store.markets.find((market) => market.code === parsed.country);
  const own = offered ?? (store.allMarkets.some((market) => market.code === parsed.country) ? store.markets[0] : undefined);
  if (!own) return null;
  const ownLang = own.ownLocale.split("-")[0];
  const asked = [
    { lang: parsed.lang, currency: parsed.currency },
    { lang: parsed.lang, currency: null },
    { lang: null, currency: parsed.currency },
  ];
  for (const { lang, currency } of asked) {
    if (!lang && !currency) continue;
    const candidate = marketSlug(own.code, { lang: lang ?? ownLang, currency: currency ?? own.nativeCurrency }, { lang: ownLang, currency: own.nativeCurrency });
    if (candidate !== slug && findMarket(store.markets, candidate, choices)) return candidate;
  }
  return own.slug === slug ? null : own.slug;
}
