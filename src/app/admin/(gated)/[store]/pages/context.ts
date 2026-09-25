import "server-only";

import type { PageOwnerContext } from "@/components/admin/page-context";
import { t } from "@/lib/i18n";
import { RESERVED_STORE_PAGE_SLUGS } from "@/lib/page-content";
import { pageLanguages } from "@/lib/page-translation";
import { marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { uploadsEnabled } from "@/server/media";
import type { Store } from "@/server/stores";

import { uploadImageAction } from "../products/actions";
import {
  createStorePageTermAction,
  createStorePartAction,
  deleteStorePageAction,
  deleteStorePartAction,
  saveStorePageAction,
  storeGridPreviewAction,
  storeGridTermsAction,
  unpublishStorePageAction,
  updateStorePartAction,
} from "./actions";

/** Where a store's pages are edited. */
export const storePagesBase = (store: Pick<Store, "slug">) => `/admin/${store.slug}/pages`;

/**
 * The page editor's context for a store's pages (D53): the same editor as
 * Kaizen's, with the store's actions (bound to it), its first market for
 * addresses and previews, and its own reserved addresses.
 */
export function storePageContext(store: Store): PageOwnerContext {
  const market = store.markets[0];
  const bind = <A extends unknown[], R>(action: (slug: string, ...args: A) => R) => action.bind(null, store.slug);
  return {
    owner: store.id,
    adminBase: storePagesBase(store),
    siteBase: market ? marketPath(store.slug, market.slug) : `/s/${store.slug}`,
    origin: siteUrl(),
    // One page in every language the store sells in, its own country's first (D55).
    languages: pageLanguages(store.markets.map((m) => m.locale)),
    reserved: RESERVED_STORE_PAGE_SLUGS,
    defaultDescription:
      (market && store.seo.description[market.locale]) || (market ? t(market.lang).storeSummary(store.name, market.name) : store.name),
    upload: uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null,
    // A store's grids show its own products.
    gridStores: [],
    actions: {
      save: bind(saveStorePageAction),
      unpublish: bind(unpublishStorePageAction),
      remove: bind(deleteStorePageAction),
      createTerm: bind(createStorePageTermAction),
      createPart: bind(createStorePartAction),
      updatePart: bind(updateStorePartAction),
      deletePart: bind(deleteStorePartAction),
      gridPreview: bind(storeGridPreviewAction),
      gridTerms: bind(storeGridTermsAction),
    },
  };
}
