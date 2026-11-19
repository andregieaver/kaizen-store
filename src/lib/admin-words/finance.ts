/**
 * The finance area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * FINANCE_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { financeEn, type FinanceMessages } from "../admin-messages/finance.en";
import { financeNb } from "../admin-messages/finance.nb";

export const FINANCE_WORDS: Record<AdminLang, FinanceMessages> = { en: financeEn, nb: financeNb };
