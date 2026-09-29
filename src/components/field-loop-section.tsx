import { FieldLoopView } from "@/components/field-loop-view";
import { loopHeading, loopOf } from "@/lib/field-loop";
import type { FieldLoopBlock } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { shownFieldsFor } from "@/server/custom-fields";
import { storeSlugOf } from "@/server/menus";
import { marketIn } from "@/server/shop";
import { getOpenStore } from "@/server/stores";

/**
 * A field loop on a store's page or article (D120): the rows of the repeater
 * it names, of the page it is on, in the shopper's language. Only a saved
 * page of a store has fields, so Kaizen's own pages and a page not saved yet
 * draw nothing; so does a repeater that is missing, private or without rows.
 * The read is the custom fields' cached one, so the page stays prerendered.
 */
export async function FieldLoopSection({ block, place }: { block: FieldLoopBlock; place: GridPlace }) {
  if (!place.owner || !place.pageId || !block.fieldId) return null;
  const slug = await storeSlugOf(place.owner);
  const store = slug ? await getOpenStore(slug) : null;
  const market = store ? marketIn(store, place.market) : undefined;
  if (!store || !market) return null;
  const groups = await shownFieldsFor(
    store.id,
    place.pageType ?? "page",
    place.pageId,
    market.locale,
    market.lang,
    market.slug,
  );
  return (
    <FieldLoopView
      rows={loopOf(groups, block)}
      layout={block.layout}
      columns={block.columns}
      linkWholeCard={block.linkWholeCard}
      heading={loopHeading(block)}
      id={`${block.id}-heading`}
    />
  );
}
