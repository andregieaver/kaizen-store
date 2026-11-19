/**
 * The backdrops area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * BACKDROPS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { backdropsEn, type BackdropsMessages } from "../admin-messages/backdrops.en";
import { backdropsNb } from "../admin-messages/backdrops.nb";

export const BACKDROPS_WORDS: Record<AdminLang, BackdropsMessages> = { en: backdropsEn, nb: backdropsNb };
