import "server-only";

import { conversionFor } from "@/lib/localization";
import { findMarket, type Market } from "@/lib/markets";

import { getOpenStore, templateStoreSlug, type Store } from "./stores";

/**
 * One of a store's markets as a place names it: a country's code (its own
 * view) or a market address such as `no-en-eur` (the view a shopper chose);
 * the store's first when none is named.
 */
export function marketIn(store: Store, ref: string | null | undefined): Market | undefined {
  if (!ref) return store.markets[0];
  return (
    findMarket(store.markets, ref.toLowerCase(), {
      locales: store.localization.locales,
      conversion: (native, currency) => conversionFor(store.localization, native, currency),
    }) ?? undefined
  );
}

/**
 * An open store and one of its active markets, from URL params, or null. The
 * market is the country shown in the language and currency its address
 * names (D109): `no`, `no-en`, `no-eur`, `no-en-eur`.
 */
export async function resolveShop(
  storeSlug: string,
  marketSlug: string,
): Promise<{ store: Store; market: Market } | null> {
  const store = await getOpenStore(storeSlug);
  const market = store
    ? findMarket(store.markets, marketSlug, {
        locales: store.localization.locales,
        conversion: (native, currency) => conversionFor(store.localization, native, currency),
      })
    : null;
  return store && market ? { store, market } : null;
}

/**
 * Store and market params to prerender at build time: the template store's
 * markets. Other stores render on first visit and are then cached. Cache
 * Components needs at least one entry; "_" simply renders a 404.
 */
export async function prerenderedShops(): Promise<{ store: string; market: string }[]> {
  const slug = await templateStoreSlug();
  const store = slug ? await getOpenStore(slug) : null;
  const params = store
    ? store.markets.map((market) => ({ store: store.slug, market: market.slug }))
    : [];
  return params.length > 0 ? params : [{ store: "_", market: "_" }];
}
