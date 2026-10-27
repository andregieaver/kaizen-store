import "server-only";

import type { ContentSite } from "@/components/admin/content-site";
import { adminLangOf } from "@/lib/admin-lang";
import { MAX_LOOKUPS } from "@/lib/custom-fields";
import { PLATFORM_PAGE_LOCALES } from "@/lib/platform-lang";
import type { Account } from "@/server/auth";
import { db } from "@/db/client";
import { entryLookups } from "@/server/entry-targets";
import { uploadsEnabled } from "@/server/media";

import { uploadPlatformImageAction } from "../actions";
import {
  deletePlatformContentTypeAction,
  deletePlatformEntryAction,
  movePlatformEntryAction,
  publishPlatformEntryAction,
  savePlatformContentTypeAction,
  savePlatformEntryAction,
  unpublishPlatformEntryAction,
} from "./actions";

/**
 * Kaizena Flow's own content screens (D326 H4): its site's languages (English first), no currencies or field files, pictures kept in its
 * media library, and its entries for entry fields to choose from. Entries are drawn with the standard entry page (no entry layout here).
 */
export function platformContentSite(account: Account): ContentSite {
  const lang = adminLangOf(account.adminLocale);
  const names = new Intl.DisplayNames([lang === "nb" ? "nb" : "en"], { type: "language" });
  return {
    owner: null,
    base: "/admin/platform/content",
    lang,
    languages: PLATFORM_PAGE_LOCALES.map((locale) => ({ locale, name: names.of(locale) ?? locale })),
    currencies: [],
    uploadImage: uploadsEnabled() ? uploadPlatformImageAction : null,
    startFile: null,
    lookups: async () => ({ products: [], pages: [], terms: [], entries: await entryLookups(db(), null, "en", MAX_LOOKUPS) }),
    actions: {
      saveType: savePlatformContentTypeAction,
      deleteType: (typeId) => deletePlatformContentTypeAction.bind(null, typeId),
      designLayout: null,
      saveEntry: savePlatformEntryAction,
      publish: publishPlatformEntryAction,
      unpublish: unpublishPlatformEntryAction,
      removeEntry: (typeId) => deletePlatformEntryAction.bind(null, typeId),
      move: (entryId, direction) => movePlatformEntryAction.bind(null, entryId, direction),
    },
  };
}
