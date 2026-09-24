import "server-only";

import { findMarket, type Market } from "@/lib/markets";

import { getOpenStore, templateStoreSlug, type Store } from "./stores";

/** An open store and one of its active markets, from URL params, or null. */
export async function resolveShop(
  storeSlug: string,
  marketSlug: string,
): Promise<{ store: Store; market: Market } | null> {
  const store = await getOpenStore(storeSlug);
  const market = store ? findMarket(store.markets, marketSlug) : null;
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
