import type { FieldLanguage } from "@/components/admin/field-editor-dialog";
import type { StartFieldFile } from "@/components/admin/field-file-upload";
import type { UploadPictureAction } from "@/components/admin/field-picture-upload";
import type { AdminLang } from "@/lib/admin-lang";
import type { ContentAction, ContentCall, ContentTypeInput } from "@/lib/content-types";
import type { FieldLookups } from "@/lib/custom-fields";

/**
 * What Website → Content's shared screens (D326, `content-views.tsx`) are given by a store's routes or Kaizena Flow's own (H4): the owner,
 * its languages, its uploads and its bound actions.
 */
export type ContentSite = {
  /** A store's id, or null for Kaizena Flow's own site. */
  owner: string | null;
  /** Content's address in the admin (`/admin/{store}/content`, `/admin/platform/content`). */
  base: string;
  lang: AdminLang;
  /** The site's languages, the main one first, with their names. */
  languages: FieldLanguage[];
  /** The currencies money fields may use (none for Kaizena Flow's own site, which keeps no money fields). */
  currencies: string[];
  uploadImage: UploadPictureAction | null;
  startFile: StartFieldFile | null;
  /** What relational fields choose from, read when an entry is written. */
  lookups: () => Promise<FieldLookups>;
  actions: {
    saveType: ContentAction<ContentTypeInput>;
    deleteType: (typeId: string) => ContentCall;
    /** Opens the type's entry page in the page builder; null where entry layouts are not offered (Kaizena Flow's own site). */
    designLayout: ((typeId: string) => () => Promise<void>) | null;
    saveEntry: ContentAction<unknown>;
    publish: ContentAction<string>;
    unpublish: ContentAction<string>;
    removeEntry: (typeId: string) => ContentAction<string>;
    move: (entryId: string, direction: "earlier" | "later") => () => Promise<void>;
  };
};
