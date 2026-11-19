/**
 * The tax area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * TAX_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { taxEn, type TaxMessages } from "../admin-messages/tax.en";
import { taxNb } from "../admin-messages/tax.nb";

export const TAX_WORDS: Record<AdminLang, TaxMessages> = { en: taxEn, nb: taxNb };
