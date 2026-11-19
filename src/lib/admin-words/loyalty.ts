/**
 * The loyalty area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * LOYALTY_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { loyaltyEn, type LoyaltyMessages } from "../admin-messages/loyalty.en";
import { loyaltyNb } from "../admin-messages/loyalty.nb";

export const LOYALTY_WORDS: Record<AdminLang, LoyaltyMessages> = { en: loyaltyEn, nb: loyaltyNb };
