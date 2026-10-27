import "server-only";

import type { ContentSite } from "@/components/admin/content-site";
import { adminLangOf } from "@/lib/admin-lang";
import { moneyCurrencies } from "@/lib/field-money";
import type { Membership } from "@/server/auth";
import { fieldLookups } from "@/server/custom-fields";
import { uploadsEnabled } from "@/server/media";

import { startFieldFileUploadAction } from "../fields/actions";
import { storeLanguages } from "../fields/data";
import { uploadImageAction } from "../products/actions";
import {
  deleteContentTypeAction,
  deleteEntryAction,
  designEntryLayoutAction,
  moveEntryAction,
  publishEntryAction,
  saveContentTypeAction,
  saveEntryAction,
  unpublishEntryAction,
} from "./actions";

/** A store's content screens (D326): its languages, currencies and uploads, and its actions bound to it. */
export function storeContentSite({ store, account }: Membership): ContentSite {
  const lang = adminLangOf(account.adminLocale);
  return {
    owner: store.id,
    base: `/admin/${store.slug}/content`,
    lang,
    languages: storeLanguages(store, lang === "nb" ? "nb" : "en"),
    currencies: moneyCurrencies(store),
    uploadImage: uploadsEnabled() ? uploadImageAction.bind(null, store.slug) : null,
    startFile: uploadsEnabled() ? startFieldFileUploadAction.bind(null, store.slug) : null,
    lookups: () => fieldLookups(store.id),
    actions: {
      saveType: saveContentTypeAction.bind(null, store.slug),
      deleteType: (typeId) => deleteContentTypeAction.bind(null, store.slug, typeId),
      designLayout: (typeId) => designEntryLayoutAction.bind(null, store.slug, typeId),
      saveEntry: saveEntryAction.bind(null, store.slug),
      publish: publishEntryAction.bind(null, store.slug),
      unpublish: unpublishEntryAction.bind(null, store.slug),
      removeEntry: (typeId) => deleteEntryAction.bind(null, store.slug, typeId),
      move: (entryId, direction) => moveEntryAction.bind(null, store.slug, entryId, direction),
    },
  };
}
