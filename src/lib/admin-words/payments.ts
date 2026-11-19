/**
 * The payments area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * PAYMENTS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { paymentsEn, type PaymentsMessages } from "../admin-messages/payments.en";
import { paymentsNb } from "../admin-messages/payments.nb";

export const PAYMENTS_WORDS: Record<AdminLang, PaymentsMessages> = { en: paymentsEn, nb: paymentsNb };
