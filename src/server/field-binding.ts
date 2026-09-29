import "server-only";

import { bindPage, hasBindings, hasStoreBindings } from "@/lib/field-binding";
import type { Market } from "@/lib/markets";
import type { PageContent } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { shownFieldsFor } from "@/server/custom-fields";
import { storeSlugOf } from "@/server/menus";
import { marketIn } from "@/server/shop";
import { getOpenStore, type Store } from "@/server/stores";

/**
 * A store's page or article with its bound blocks (D118) showing the values
 * of the page's own custom fields, in the shopper's language, and, for blocks
 * bound to the store's own fields (D120), those. The fields are read only when
 * some block is bound, so a page with none costs nothing and stays
 * prerendered; the reads themselves are cached under the store's fields tag.
 * A page that is not saved yet, or has no owner, has no fields: its bound
 * blocks follow their fallback rule (`bindPage()` with no groups).
 */
export async function bindForPlace(content: PageContent, place: GridPlace): Promise<PageContent> {
  if (!hasBindings(content)) return content;
  const storeBound = hasStoreBindings(content);
  const slug = place.owner && (place.pageId || storeBound) ? await storeSlugOf(place.owner) : null;
  const store = slug ? await getOpenStore(slug) : null;
  const market = store ? marketIn(store, place.market) : undefined;
  if (!store || !market) return bindPage(content, []);
  const [own, ofStore] = await Promise.all([
    place.pageId
      ? shownFieldsFor(store.id, place.pageType ?? "page", place.pageId, market.locale, market.lang, market.slug)
      : Promise.resolve([]),
    storeBound ? shownFieldsFor(store.id, "store", store.id, market.locale, market.lang, market.slug) : Promise.resolve([]),
  ]);
  return bindPage(content, own, ofStore);
}

/**
 * A header's or footer's blocks bound to the store's own fields (D120): a
 * header has no page of its own to take fields from, so the store's are the
 * only ones it can show. Nothing is read when no block is bound to them.
 */
export async function bindStoreFields(content: PageContent, store: Store, market: Market): Promise<PageContent> {
  if (!hasBindings(content)) return content;
  const groups = hasStoreBindings(content)
    ? await shownFieldsFor(store.id, "store", store.id, market.locale, market.lang, market.slug)
    : [];
  return bindPage(content, [], groups);
}
