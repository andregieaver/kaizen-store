/**
 * The words of Platform → Admin use in both languages (D895 phase 3b). Server code reads them as ADMIN_USE_VIEWER_WORDS[lang]. Never import
 * this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import {
  adminUseViewerEn,
  type AdminUseViewerMessages,
} from "../admin-messages/admin-use-viewer.en";
import { adminUseViewerNb } from "../admin-messages/admin-use-viewer.nb";

export const ADMIN_USE_VIEWER_WORDS: Record<AdminLang, AdminUseViewerMessages> =
  { en: adminUseViewerEn, nb: adminUseViewerNb };
