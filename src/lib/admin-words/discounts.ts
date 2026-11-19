/**
 * The discounts area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * DISCOUNTS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { discountsEn, type DiscountsMessages } from "../admin-messages/discounts.en";
import { discountsNb } from "../admin-messages/discounts.nb";

export const DISCOUNTS_WORDS: Record<AdminLang, DiscountsMessages> = { en: discountsEn, nb: discountsNb };
