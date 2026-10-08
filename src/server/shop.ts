import "server-only";

import { permanentRedirect, notFound } from "next/navigation";

import { splitSiteVersions } from "@/lib/ab-site";
import { keptChoices, marketChoices } from "@/lib/localization";
import { movedMarketSlug } from "@/lib/market-move";
import { findMarket, type Market } from "@/lib/markets";
import { requirementMet, type FeatureRequirement } from "@/lib/store-features";

import { locationIn } from "./redirect-resolve";
import { getOpenStore, templateStoreSlug, type Store } from "./stores";

/**
 * A market the store offers as a place names it: a country's code (its own view) or a market address such as `no-en-eur` (the view a
 * shopper chose); the store's own country when none is named. Null for one it does not offer now (D178): what sells and what is offered to
 * a shopper outside a page of the store (WordPress) asks this.
 */
export function offeredMarketIn(store: Store, ref: string | null | undefined): Market | undefined {
  if (!ref) return store.markets[0];
  return findMarket(store.markets, ref.toLowerCase(), marketChoices(store.localization)) ?? undefined;
}

/**
 * One of a store's markets as a place on one of its pages names it: offered, or else one the store had or a view it no longer offers (D178),
 * for the parts of a page whose route already decided it is to be drawn there (an order's page in a country no longer offered). The store's
 * own country when none is named.
 */
export function marketIn(store: Store, ref: string | null | undefined): Market | undefined {
  if (!ref) return store.markets[0];
  return offeredMarketIn(store, ref) ?? findMarket(store.allMarkets, ref.toLowerCase(), keptChoices(store.localization)) ?? undefined;
}

export type Shop = { store: Store; market: Market; ab: Record<string, string> };

/**
 * An open store and one of the markets it offers, from URL params, or null. The market is the country shown in the language and currency its
 * address names (D109): `no`, `no-en`, `no-eur`, `no-en-eur`, each only while the store offers it (D178: Several countries, languages and
 * currencies); `ab` is the versions of site-wide A/B tests the address carries (test token → version), empty for everyone but a visitor in
 * another version of such a test. A page that finds none calls `marketMoved()`.
 */
export async function resolveShop(storeSlug: string, marketParam: string): Promise<Shop | null> {
  // A visitor in another version of a test of the header, footer or product layout (D148) is served the market's pages under
  // an address with the versions after it: they are taken off here, so the market, and every link made from it, is the real one.
  const { market: marketSlug, versions: ab } = splitSiteVersions(marketParam);
  const store = await getOpenStore(storeSlug);
  const market = store ? findMarket(store.markets, marketSlug, marketChoices(store.localization)) : null;
  return store && market ? { store, market, ab } : null;
}

/**
 * The same for the pages of what a shopper already bought (D178, `docs/store-features.md` 4d): an order and its terms, a withdrawal, a
 * return, a hosted invoice or credit note, a download, a subscription, an unsubscribe link and an order in My account. They open in the
 * country, language and currency they were bought in whether or not the store still offers them, so a link in an email keeps working.
 * Paying a draft order and a change are not after-sale: they sell, and ask `resolveShop()`.
 */
export async function resolveAfterSaleShop(storeSlug: string, marketParam: string): Promise<Shop | null> {
  const offered = await resolveShop(storeSlug, marketParam);
  if (offered) return offered;
  const { market: marketSlug, versions: ab } = splitSiteVersions(marketParam);
  const store = await getOpenStore(storeSlug);
  const market = store ? findMarket(store.allMarkets, marketSlug, keptChoices(store.localization)) : null;
  return store && market ? { store, market, ab } : null;
}

/** Whether the store offers this country now (D178): one of its markets, while Several countries is on or as its own country. */
export const countryOffered = (store: Pick<Store, "markets">, code: string): boolean => store.markets.some((m) => m.code === code);

/**
 * What a page calls where it found no shop: the same page in the market that offers what the address asked (D178, `movedMarketSlug()`), for
 * good (308, `path` being the address after the market, `query` the request's where the route has it), or the 404 it was. The decision is
 * made from the cached store alone, so the status is the response's. Never returns.
 */
export async function marketMoved(storeSlug: string, marketParam: string, path = "/", query = ""): Promise<never> {
  const store = await getOpenStore(storeSlug);
  const to = store ? movedMarketSlug(store, splitSiteVersions(marketParam).market) : null;
  if (store && to) permanentRedirect(locationIn(store.slug, to, `${path || "/"}${query}`));
  notFound();
}

/**
 * A page's shop, or, for a market it does not offer, the move to one that does (308) or the 404 (`marketMoved()`). A page whose content
 * streams in a `<Suspense>` calls it before the boundary, so the move is the response's status and not a redirect in a page already sent.
 */
export async function shopOrMoved(storeSlug: string, marketParam: string, path = "/"): Promise<Shop> {
  return (await resolveShop(storeSlug, marketParam)) ?? marketMoved(storeSlug, marketParam, path);
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

/**
 * The same, for a route of a store feature (D178): null while the feature is off, so the route answers as for an address that is not
 * there. The pattern for a feature's storefront routes: `const shop = await resolveFeatureShop(store, market, "business"); if (!shop)
 * notFound();`. A component inside a page asks `featureOn(store, id)` of the store it was given.
 */
export async function resolveFeatureShop(
  storeSlug: string,
  marketParam: string,
  feature: FeatureRequirement,
): Promise<Shop | null> {
  const shop = await resolveShop(storeSlug, marketParam);
  return shop && requirementMet(shop.store, feature) ? shop : null;
}
