import "server-only";

import { marketPath } from "@/lib/paths";

import { storeSlugOf } from "./menus";
import { marketIn } from "./shop";
import { getStore } from "./stores";

/**
 * Where a store's own paths are drawn for a place (`src/lib/store-links.ts`): the market's path of the store that owns it (`/s/{store}/no`,
 * `/s/{store}` for a store selling in one country, `""` on its own host), in the view the place names (`no-en-eur` keeps its language and
 * currency, `marketIn()`), else the store's first. Null for Kaizena Flow's own pages and a store that cannot be read. Both reads are cached
 * (`getStore()`), so drawing a page asks nothing new.
 */
export async function storeLinkBase(owner: string | null, market: string | null | undefined): Promise<string | null> {
  if (!owner) return null;
  const slug = await storeSlugOf(owner);
  const store = slug ? await getStore(slug) : null;
  if (!slug || !store) return null;
  const chosen = marketIn(store, market) ?? store.markets[0];
  return chosen ? marketPath(slug, chosen.slug, "", store.address) : null;
}
