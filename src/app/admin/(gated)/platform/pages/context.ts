import "server-only";

import type { PageOwnerContext } from "@/components/admin/page-context";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { reservedPageSlugs, type PageType } from "@/lib/page-content";
import { pageLanguages } from "@/lib/page-translation";
import { siteUrl } from "@/lib/site";
import { listGridStores } from "@/server/content-grid";
import { siteFontStyle } from "@/server/fonts";
import { uploadsEnabled } from "@/server/media";
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
  gridPreviewAction,
  gridTermsAction,
  platformLinkTargetsAction,
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
    defaultDescription: PLATFORM_DEFAULTS.description,
    upload: uploadsEnabled() ? uploadPlatformImageAction : null,
    startVideo: uploadsEnabled() ? startPlatformVideoUploadAction : null,
    gridStores,
    fonts: { site: fonts, style: siteFontStyle(fonts) },
    menus,
    standardMenus: { header: chrome.headerMenuId, footer: chrome.footerMenuId },
    menusHref: "/admin/platform/menus",
    plans: planChoices(plans),
    theme: null,
    templates: null,
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
      translate: null,
    },
  };
}
