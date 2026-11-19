/**
 * The setup area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * SETUP_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { setupEn, type SetupMessages } from "../admin-messages/setup.en";
import { setupNb } from "../admin-messages/setup.nb";

export const SETUP_WORDS: Record<AdminLang, SetupMessages> = { en: setupEn, nb: setupNb };
