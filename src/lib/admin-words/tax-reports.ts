/**
 * The taxReports area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * TAX_REPORTS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { taxReportsEn, type TaxReportsMessages } from "../admin-messages/tax-reports.en";
import { taxReportsNb } from "../admin-messages/tax-reports.nb";

export const TAX_REPORTS_WORDS: Record<AdminLang, TaxReportsMessages> = { en: taxReportsEn, nb: taxReportsNb };
