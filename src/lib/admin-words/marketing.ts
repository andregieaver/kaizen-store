/**
 * The marketing area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * MARKETING_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { marketingEn, type MarketingMessages } from "../admin-messages/marketing.en";
import { marketingNb } from "../admin-messages/marketing.nb";

export const MARKETING_WORDS: Record<AdminLang, MarketingMessages> = { en: marketingEn, nb: marketingNb };
