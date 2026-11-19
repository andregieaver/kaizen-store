/**
 * The kit area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * KIT_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { kitEn, type KitMessages } from "../admin-messages/kit.en";
import { kitNb } from "../admin-messages/kit.nb";

export const KIT_WORDS: Record<AdminLang, KitMessages> = { en: kitEn, nb: kitNb };
