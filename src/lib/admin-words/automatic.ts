/**
 * The automatic area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * AUTOMATIC_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { automaticEn, type AutomaticMessages } from "../admin-messages/automatic.en";
import { automaticNb } from "../admin-messages/automatic.nb";

export const AUTOMATIC_WORDS: Record<AdminLang, AutomaticMessages> = { en: automaticEn, nb: automaticNb };
