/**
 * The carriers area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * CARRIERS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { carriersEn, type CarriersMessages } from "../admin-messages/carriers.en";
import { carriersNb } from "../admin-messages/carriers.nb";

export const CARRIERS_WORDS: Record<AdminLang, CarriersMessages> = { en: carriersEn, nb: carriersNb };
