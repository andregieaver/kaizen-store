import { pickPlatformMediaAction } from "../media/actions";
import { listMenuPages } from "@/server/pages";
import "server-only";

import { themeSwatches } from "@/lib/colour";
import { breakpointsOf } from "@/lib/breakpoints";
import { themeSetsOf } from "@/lib/page-a11y";
import { themeAttributes, themeCss } from "@/lib/theme";
import type { PageOwnerContext } from "@/components/admin/page-context";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { reservedPageSlugs, type PageType } from "@/lib/page-content";
import { pageLanguages } from "@/lib/page-translation";
import { siteUrl } from "@/lib/site";
import { listGridStores } from "@/server/content-grid";
import { siteFontStyle } from "@/server/fonts";
import { uploadsEnabled } from "@/server/media";
import { canMakePictures } from "@/server/picture-maker";
import { platformMenuPreviews } from "@/server/menus";
import { getPlatformChrome, getPlatformFonts } from "@/server/platform-navigation";
import { PLATFORM_DEFAULTS } from "@/server/seo";

import { startPlatformVideoUploadAction, uploadPlatformImageAction } from "../actions";
import { installPlatformFontAction } from "../fonts/actions";
import {
  createPageTermAction,
  createSavedPartAction,
  deletePageAction,
  deleteSavedPartAction,
  savePlatformCssAction,
  savePlatformLibraryAction,
  savePlatformThemeTabAction,
  gridPreviewAction,
  gridTermsAction,
  kaizenTemplateFixedAction,
  kaizenTemplatesListAction,
  applyKaizenTemplateAction,
  placePlatformThemeSectionAction,
  platformLinkTargetsAction,
  platformThemeSectionsAction,
  savePageAction,
  unpublishPageAction,
  updateSavedPartAction,
} from "./actions";
import { duplicatePageAction } from "./duplicate-action";
import { planChoices } from "@/lib/plan-offer";
import { getPublicPlans } from "@/server/public-plans";

import { planMotionAction } from "./motion-action";

/** The page editor's context for Kaizen's own pages (D42, D53) or articles (D57); `author` starts a new article. */
export async function platformPageContext(type: PageType = "page", author = ""): Promise<PageOwnerContext> {
  const copy = PAGE_TYPE_COPY[type];
  const [gridStores, fonts, menus, chrome, plans] = await Promise.all([listGridStores(), getPlatformFonts(), platformMenuPreviews(), getPlatformChrome(), getPublicPlans()]);
  return {
    owner: null,
    type,
    defaultAuthor: author,
    adminBase: `/admin/platform/${copy.segment}`,
    siteBase: copy.sitePrefix,
    origin: siteUrl(),
    languages: pageLanguages(["en"]),
    reserved: reservedPageSlugs(null, type),
    // The pages a new or edited page can be nested under (`/projects/project-a`).
    parents: (await listMenuPages(null, "page")).map(({ slug, title }) => ({ slug, title })),
    defaultDescription: PLATFORM_DEFAULTS.description,
    upload: uploadsEnabled() ? uploadPlatformImageAction : null,
    media: pickPlatformMediaAction,
    // Pictures made by prompt in Kaizena Flow's own look (D283), while its AI has a picture model.
    pictures: (await canMakePictures(null)) ? { endpoint: "/admin/platform/media/make" } : null,
    startVideo: uploadsEnabled() ? startPlatformVideoUploadAction : null,
    gridStores,
    fonts: { site: fonts, style: siteFontStyle(fonts) },
    menus,
    standardMenus: { header: chrome.headerMenuId, footer: chrome.footerMenuId },
    menusHref: "/admin/platform/menus",
    plans: planChoices(plans),
    // Kaizen's own theme (D235), as a store's is given: its Theme tab, its saved colours, and the theme under every part.
    theme: {
      css: themeCss(chrome.theme.settings, "[data-theme-canvas]"),
      attributes: themeAttributes(chrome.theme.settings),
      breakpoints: breakpointsOf(chrome.theme.settings),
      settings: chrome.theme.settings,
    },
    // Kaizen's own templates (D236): its saved parts, page layouts among them, always on; previewed in Kaizen's look.
    templates: {
      list: kaizenTemplatesListAction,
      setActive: kaizenTemplateFixedAction,
      use: applyKaizenTemplateAction,
      setSharing: kaizenTemplateFixedAction,
      previewStore: null,
    },
    // The live theme's own sections (D272), as in a store's builder, for Kaizena Flow's pages and articles.
    themeSections: type === "page" || type === "article" ? { list: platformThemeSectionsAction, place: placePlatformThemeSectionAction } : null,
    // The page checker reads contrast against Kaizen's colours (wave 1, 1e); Kaizen has no checkout page.
    check: { theme: themeSetsOf(chrome.theme.settings), checkoutPageId: null },
    colours: themeSwatches(chrome.theme.settings),
    variantOf: null,
    experimentsHref: null,
    fields: null,
    siteCss: chrome.customCss,
    actions: {
      save: savePageAction.bind(null, type),
      unpublish: unpublishPageAction.bind(null, type),
      remove: deletePageAction.bind(null, type),
      duplicate: duplicatePageAction.bind(null, type),
      motion: planMotionAction.bind(null, type),
      createTerm: createPageTermAction.bind(null, type),
      createPart: createSavedPartAction,
      updatePart: updateSavedPartAction,
      deletePart: deleteSavedPartAction,
      gridPreview: gridPreviewAction,
      gridTerms: gridTermsAction,
      linkTargets: platformLinkTargetsAction,
      installFont: installPlatformFontAction,
      saveSiteCss: savePlatformCssAction,
      saveThemeTab: savePlatformThemeTabAction,
      saveLibrary: savePlatformLibraryAction,
      translate: null,
    },
  };
}
