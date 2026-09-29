import "server-only";

import { bindPage, hasBindings } from "@/lib/field-binding";
import type { PageContent } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { shownFieldsFor } from "@/server/custom-fields";
import { storeSlugOf } from "@/server/menus";
import { marketIn } from "@/server/shop";
import { getOpenStore } from "@/server/stores";

/**
 * A store's page or article with its bound blocks (D118) showing the values
 * of the page's own custom fields, in the shopper's language. The fields are
 * read only when some block is bound, so a page with none costs nothing and
 * stays prerendered; the read itself is cached under the store's fields tag.
 * A page that is not saved yet, or has no owner, has no fields: its bound
 * blocks follow their fallback rule (`bindPage()` with no groups).
 */
export async function bindForPlace(content: PageContent, place: GridPlace): Promise<PageContent> {
  if (!hasBindings(content)) return content;
  const slug = place.owner && place.pageId ? await storeSlugOf(place.owner) : null;
  const store = slug ? await getOpenStore(slug) : null;
  const market = store ? marketIn(store, place.market) : undefined;
  if (!store || !market || !place.pageId) return bindPage(content, []);
  const groups = await shownFieldsFor(
    store.id,
    place.pageType ?? "page",
    place.pageId,
    market.locale,
    market.lang,
    market.slug,
  );
  return bindPage(content, groups);
}
