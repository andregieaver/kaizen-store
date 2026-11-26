/**
 * The words of heatmaps and recordings of how owners use the admin in both languages (D895). Server code reads them as ADMIN_USE_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { adminUseEn, type AdminUseMessages } from "../admin-messages/admin-use.en";
import { adminUseNb } from "../admin-messages/admin-use.nb";

export const ADMIN_USE_WORDS: Record<AdminLang, AdminUseMessages> = { en: adminUseEn, nb: adminUseNb };
