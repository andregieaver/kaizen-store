import { listMenuPages } from "@/server/pages";
import "server-only";

import { themeSwatches } from "@/lib/colour";
import { breakpointsOf } from "@/lib/breakpoints";

import type { PageOwnerContext } from "@/components/admin/page-context";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { t } from "@/lib/i18n";
import { reservedChoiceSlugs } from "@/lib/store-address";
import { reservedPageSlugs, type PageType } from "@/lib/page-content";
import { pageLanguages } from "@/lib/page-translation";
import { marketPath, storeBase, storeHref, storeOrigin } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { themeSetsOf } from "@/lib/page-a11y";
import { themeAttributes, themeCss } from "@/lib/theme";
import { siteFontStyle } from "@/server/fonts";
import { uploadsEnabled } from "@/server/media";
import { EMPTY_LOOKUPS, needsLookups } from "@/lib/custom-fields";
import { allActiveFieldGroups, fieldLookups } from "@/server/custom-fields";
import { storeMenuPreviews } from "@/server/menus";
import type { Store } from "@/server/stores";

import { startFieldFileUploadAction } from "../fields/actions";
import { startVideoUploadAction, uploadImageAction } from "../products/actions";
import { installStoreFontAction, saveLibraryAction, saveThemeTabAction } from "../settings/design/actions";
import {
  createStorePageTermAction,
  createStorePartAction,
  deleteStorePageAction,
  deleteStorePartAction,
  saveStoreCssAction,
  translateStorePageAction,
  saveStorePageAction,
  setPartSharingAction,
  setTemplateActiveAction,
  storeGridPreviewAction,
  storeGridTermsAction,
  storeLinkTargetsAction,
  storeVisibilityChoicesAction,
  templatesListAction,
  unpublishStorePageAction,
  updateStorePartAction,
  applyTemplateAction,
} from "./actions";
import { duplicateStorePageAction } from "./duplicate-action";
import { planMotionAction } from "./motion-action";

/** Where a store's pages (or articles, D57) are edited. */
export const storePagesBase = (store: Pick<Store, "slug">, type: PageType = "page") =>
  `/admin/${store.slug}/${PAGE_TYPE_COPY[type].segment}`;

/**
 * The page editor's context for a store's pages (D53): the same editor as
 * Kaizen's, with the store's actions (bound to it), its first market for
 * addresses and previews, and its own reserved addresses.
 */
export async function storePageContext(store: Store, type: PageType = "page", author = "", variantOf: PageType | null = null): Promise<PageOwnerContext> {
  const market = store.markets[0];
  const menus = await storeMenuPreviews(store, market?.locale ?? "nb-NO", market?.lang ?? "nb");
  const fieldGroups = await allActiveFieldGroups(store.id);
  // What the store has to choose from, listed only when some field points at it.
  const lookups = needsLookups(fieldGroups) ? await fieldLookups(store.id) : EMPTY_LOOKUPS;
  const bind = <A extends unknown[], R>(action: (slug: string, ...args: A) => R) => action.bind(null, store.slug);
  // The actions for pages or articles (D57): the type is bound after the store.
  const typed = <A extends unknown[], R>(action: (slug: string, type: PageType, ...args: A) => R) =>
    action.bind(null, store.slug, type);
  return {
    owner: store.id,
    // The store's features (D178): the builder offers only the parts of those that are on.
    features: store.features,
    type,
    defaultAuthor: author,
    adminBase: storePagesBase(store, type),
    // A full address once the store has its own host (P7), and origin then empty.
    siteBase: storeHref(store.slug, market ? marketPath(store.slug, market.slug) : storeBase(store.slug)) + PAGE_TYPE_COPY[type].sitePrefix,
    origin: storeOrigin(store.slug) ? "" : siteUrl(),
    // One page in every language the store sells in, its own country's first (D55).
    languages: pageLanguages(store.localization.locales),
    // A language or currency the store keeps is a short address of its own (D181), never a page's.
    reserved: [...reservedPageSlugs(store.id, type), ...(type === "page" ? reservedChoiceSlugs(store.address) : [])],
    // The pages a new or edited page can be nested under (`/projects/project-a`).
    parents: (await listMenuPages(store.id, "page")).map(({ slug, title }) => ({ slug, title })),
    defaultDescription:
      (market && store.seo.description[market.locale]) || (market ? t(market.lang).storeSummary(store.name, market.name) : store.name),
    upload: uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null,
    startVideo: uploadsEnabled() ? startVideoUploadAction.bind(null, store.slug) : null,
    // A store's grids show its own products.
    gridStores: [],
    fonts: { site: store.fonts, style: siteFontStyle(store.fonts) },
    menus,
    standardMenus: { header: store.headerMenuId, footer: store.footerMenuId },
    menusHref: `/admin/${store.slug}/menus`,
    plans: null,
    theme: {
      css: themeCss(store.theme.settings, "[data-theme-canvas]"),
      attributes: themeAttributes(store.theme.settings),
      breakpoints: breakpointsOf(store.theme.settings),
      settings: store.theme.settings,
    },
    // Templates shared between stores and the marketplace (D125), bound to the store.
    // What the page checker needs (wave 1, 1e): the theme's colours, and the page chosen for the checkout.
    check: { theme: themeSetsOf(store.theme.settings), checkoutPageId: store.pageRoles.checkout ?? null },
    colours: themeSwatches(store.theme.settings),
    variantOf,
    // Tests of a page, a product layout, a header or a footer, and of their parts (D148).
    experimentsHref: type === "page" || type === "product_layout" || type === "header" || type === "footer" ? `/admin/${store.slug}/experiments/new` : null,
    templates: {
      list: bind(templatesListAction),
      setActive: bind(setTemplateActiveAction),
      use: bind(applyTemplateAction),
      setSharing: bind(setPartSharingAction),
      // A page with nothing but the template on it, for the builder's frame (D127).
      previewStore: store.slug,
    },
    fields: {
      groups: fieldGroups,
      lookups,
      startFile: uploadsEnabled() ? startFieldFileUploadAction.bind(null, store.slug) : null,
    },
    siteCss: store.customCss,
    actions: {
      save: typed(saveStorePageAction),
      unpublish: typed(unpublishStorePageAction),
      remove: typed(deleteStorePageAction),
      duplicate: typed(duplicateStorePageAction),
      motion: typed(planMotionAction),
      createTerm: typed(createStorePageTermAction),
      createPart: bind(createStorePartAction),
      updatePart: bind(updateStorePartAction),
      deletePart: bind(deleteStorePartAction),
      gridPreview: bind(storeGridPreviewAction),
      gridTerms: bind(storeGridTermsAction),
      linkTargets: bind(storeLinkTargetsAction),
      visibilityChoices: bind(storeVisibilityChoicesAction),
      installFont: bind(installStoreFontAction),
      saveThemeTab: bind(saveThemeTabAction),
      saveLibrary: bind(saveLibraryAction),
      saveSiteCss: bind(saveStoreCssAction),
      translate: bind(translateStorePageAction),
    },
  };
}
