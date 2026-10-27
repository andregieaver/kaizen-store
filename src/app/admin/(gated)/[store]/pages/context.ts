import { pickMediaAction } from "../media/actions";
import { typeAsGroup, type ContentType } from "@/lib/content-types";
import { listContentTypes } from "@/server/content-types";
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
import { canMakePictures } from "@/server/picture-maker";
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
  placeStoreThemeSectionAction,
  storeThemeSectionsAction,
} from "./actions";
import { duplicateStorePageAction } from "./duplicate-action";
import { cancelScheduleAction, readScheduleAction, scheduleAction } from "./schedule-actions";
import { authorsNow, blogsNow } from "@/server/blogs";
import { blogPath, blogTitle } from "@/lib/blogs";
import { storePageVersionAction, storePageVersionsAction } from "./version-actions";
import { planMotionAction } from "./motion-action";
import { signupCodeChoices } from "@/server/discounts";

/** Where a store's pages (or articles, D57) are edited. */
export const storePagesBase = (store: Pick<Store, "slug">, type: PageType = "page") =>
  `/admin/${store.slug}/${PAGE_TYPE_COPY[type].segment}`;

/**
 * The page editor's context for a store's pages (D53): the same editor as
 * Kaizen's, with the store's actions (bound to it), its first market for
 * addresses and previews, and its own reserved addresses.
 */
export async function storePageContext(
  store: Store,
  type: PageType = "page",
  author = "",
  variantOf: PageType | null = null,
  /** For an entry layout (D326): the type it draws, whose public fields its blocks can take. */
  entryType: ContentType | null = null,
): Promise<PageOwnerContext> {
  const market = store.markets[0];
  const menus = await storeMenuPreviews(store, market?.locale ?? "nb-NO", market?.lang ?? "nb");
  const allGroups = await allActiveFieldGroups(store.id);
  // An entry layout's blocks take the entry's public fields (the type as one group, offered where a page's would be) or the store's own.
  const fieldGroups =
    type === "entry_layout"
      ? [
          ...(entryType ? [{ ...typeAsGroup({ ...entryType, fields: entryType.fields.filter((f) => f.access === "public") }), entities: ["page" as const] }] : []),
          ...allGroups.filter((g) => g.entities.includes("store")).map((g) => ({ ...g, entities: ["store" as const] })),
        ]
      : allGroups;
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
    // An article's blog and author record (D341), chosen in the editor's sidebar.
    blog:
      type === "article"
        ? await (async () => {
            const [blogs, authors] = await Promise.all([blogsNow(store.id), authorsNow(store.id)]);
            const main = store.localization.locales[0];
            return {
              blogs: blogs.map((b) => ({ id: b.id, title: blogTitle(b, main ?? "en", main, t(market?.lang ?? "en").blog), address: blogPath(b), main: b.main })),
              authors: authors.map((a) => ({ id: a.id, name: a.name })),
              manageHref: `/admin/${store.slug}/articles/blogs`,
            };
          })()
        : null,
    // Publishing a page's or an article's draft at a set time (D341), on the store's clock.
    schedule:
      (type === "page" || type === "article") && !variantOf
        ? { zone: store.timeZone, read: typed(readScheduleAction), set: typed(scheduleAction), cancel: typed(cancelScheduleAction) }
        : null,
    adminBase: storePagesBase(store, type),
    // A full address once the store has its own host (P7), and origin then empty.
    siteBase: storeHref(store.slug, market ? marketPath(store.slug, market.slug) : storeBase(store.slug)) + PAGE_TYPE_COPY[type].sitePrefix,
    origin: storeOrigin(store.slug) ? "" : siteUrl(),
    // One page in every language the store sells in, its own country's first (D55).
    languages: pageLanguages(store.localization.locales),
    // The countries a page or article may be limited to (D338), and the one the canvas draws it as.
    ...((type === "page" || type === "article") && store.keptMarkets.length > 1 && { countries: store.keptMarkets.map((m) => m.code) }),
    viewCountry: store.markets[0]?.code,
    // A language or currency the store keeps is a short address of its own (D181), never a page's.
    reserved: [...reservedPageSlugs(store.id, type), ...(type === "page" ? reservedChoiceSlugs(store.address) : [])],
    // The pages a new or edited page can be nested under (`/projects/project-a`).
    parents: (await listMenuPages(store.id, "page")).map(({ slug, title }) => ({ slug, title })),
    // The store's content types (D326), for a grid of their entries.
    contentTypes: (await listContentTypes(store.id)).map(({ key, name, fields }) => ({ key, name, fields })),
    defaultDescription:
      (market && store.seo.description[market.locale]) || (market ? t(market.lang).storeSummary(store.name, market.name) : store.name),
    upload: uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null,
    media: pickMediaAction.bind(null, store.slug),
    // Pictures made by prompt in the store's look (D283), through its own route, while its AI has a picture model.
    pictures: (await canMakePictures(store.id)) ? { endpoint: `/admin/${store.slug}/media/make` } : null,
    // A newsletter form's welcome code is one of the store's discounts with single-use codes (D304 J3).
    signupCodes: await signupCodeChoices(store.id),
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
    // A signature theme's own sections (D272), for pages and articles: what the theme designed its demo store's pages with.
    themeSections:
      (type === "page" || type === "article") && !variantOf
        ? { list: bind(storeThemeSectionsAction), place: bind(placeStoreThemeSectionAction) }
        : null,
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
      versions: { list: typed(storePageVersionsAction), read: typed(storePageVersionAction) },
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
