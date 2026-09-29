import { CustomFieldGroups, CustomFieldView } from "@/components/custom-fields-view";
import { fieldHeading, fieldToShow, groupHeading, groupsToShow } from "@/lib/field-parts";
import type { CustomFieldBlock } from "@/lib/page-content";
import type { GridPlace } from "@/server/content-grid";
import { shownFieldsFor } from "@/server/custom-fields";
import { storeSlugOf } from "@/server/menus";
import { marketIn } from "@/server/shop";
import { getOpenStore } from "@/server/stores";

/**
 * A custom fields component on a store's page or article (D118): the public
 * fields of the page it is on, or with `source` "store" (D120) the store's own,
 * in the shopper's language (the group chosen,
 * one field of it, or every group that applies to the page). Only a saved
 * page of a store has fields, so Kaizen's own pages, a product layout's
 * preview and a page not saved yet draw nothing; so does a page with no value
 * for them. The reads are cached, so the page stays prerendered.
 */
export async function CustomFieldSection({ block, place }: { block: CustomFieldBlock; place: GridPlace }) {
  // The store's own fields (D120) need no page: a header, a footer or a product layout can show them too.
  const ofStore = block.source === "store";
  if (!place.owner || (!ofStore && !place.pageId)) return null;
  const slug = await storeSlugOf(place.owner);
  const store = slug ? await getOpenStore(slug) : null;
  const market = store ? marketIn(store, place.market) : undefined;
  if (!store || !market) return null;
  const groups = ofStore
    ? await shownFieldsFor(store.id, "store", store.id, market.locale, market.lang, market.slug)
    : await shownFieldsFor(store.id, place.pageType ?? "page", place.pageId!, market.locale, market.lang, market.slug);
  const showLabel = block.showLabel !== false;
  const headingId = `${block.id}-heading`;

  if (block.fieldId) {
    const field = fieldToShow(groups, block.fieldId);
    return field ? (
      <CustomFieldView
        field={field}
        display={block.display}
        showLabel={showLabel}
        heading={fieldHeading(block)}
        id={headingId}
      />
    ) : null;
  }
  return (
    <CustomFieldGroups
      groups={groupsToShow(groups, block.groupId)}
      display={block.display}
      showLabel={showLabel}
      idPrefix={block.id}
      headingFor={(group) => groupHeading(block, group, Boolean(block.groupId))}
    />
  );
}
