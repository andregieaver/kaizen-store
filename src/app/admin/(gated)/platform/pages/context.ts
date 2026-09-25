import "server-only";

import type { PageOwnerContext } from "@/components/admin/page-context";
import { RESERVED_PAGE_SLUGS } from "@/lib/page-content";
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

/** The page editor's context for Kaizen's own pages (D42, D53). */
export async function platformPageContext(): Promise<PageOwnerContext> {
  return {
    owner: null,
    adminBase: "/admin/platform/pages",
    siteBase: "",
    origin: siteUrl(),
    reserved: RESERVED_PAGE_SLUGS,
    defaultDescription: PLATFORM_DEFAULTS.description,
    upload: uploadsEnabled() ? uploadPlatformImageAction : null,
    gridStores: await listGridStores(),
    actions: {
      save: savePageAction,
      unpublish: unpublishPageAction,
      remove: deletePageAction,
      createTerm: createPageTermAction,
      createPart: createSavedPartAction,
      updatePart: updateSavedPartAction,
      deletePart: deleteSavedPartAction,
      gridPreview: gridPreviewAction,
      gridTerms: gridTermsAction,
    },
  };
}
