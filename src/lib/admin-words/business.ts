/**
 * The business area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * BUSINESS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { businessEn, type BusinessMessages } from "../admin-messages/business.en";
import { businessNb } from "../admin-messages/business.nb";

export const BUSINESS_WORDS: Record<AdminLang, BusinessMessages> = { en: businessEn, nb: businessNb };
