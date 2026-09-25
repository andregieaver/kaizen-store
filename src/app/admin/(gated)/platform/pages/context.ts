import "server-only";

import type { PageOwnerContext } from "@/components/admin/page-context";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { reservedPageSlugs, type PageType } from "@/lib/page-content";
import { pageLanguages } from "@/lib/page-translation";
import { siteUrl } from "@/lib/site";
import { listGridStores } from "@/server/content-grid";
import { uploadsEnabled } from "@/server/media";
import { PLATFORM_DEFAULTS } from "@/server/seo";

import { uploadPlatformImageAction } from "../actions";
import {
  createPageTermAction,
  createSavedPartAction,
  deletePageAction,
  deleteSavedPartAction,
  gridPreviewAction,
  gridTermsAction,
  savePageAction,
  unpublishPageAction,
  updateSavedPartAction,
} from "./actions";

/** The page editor's context for Kaizen's own pages (D42, D53) or articles (D57); `author` starts a new article. */
export async function platformPageContext(type: PageType = "page", author = ""): Promise<PageOwnerContext> {
  const copy = PAGE_TYPE_COPY[type];
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
    gridStores: await listGridStores(),
    actions: {
      save: savePageAction.bind(null, type),
      unpublish: unpublishPageAction.bind(null, type),
      remove: deletePageAction.bind(null, type),
      createTerm: createPageTermAction.bind(null, type),
      createPart: createSavedPartAction,
      updatePart: updateSavedPartAction,
      deletePart: deleteSavedPartAction,
      gridPreview: gridPreviewAction,
      gridTerms: gridTermsAction,
    },
  };
}
