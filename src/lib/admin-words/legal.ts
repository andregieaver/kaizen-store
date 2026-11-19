/**
 * The legal area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * LEGAL_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { legalEn, type LegalMessages } from "../admin-messages/legal.en";
import { legalNb } from "../admin-messages/legal.nb";

export const LEGAL_WORDS: Record<AdminLang, LegalMessages> = { en: legalEn, nb: legalNb };
