/**
 * The billing area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * BILLING_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { billingEn, type BillingMessages } from "../admin-messages/billing.en";
import { billingNb } from "../admin-messages/billing.nb";

export const BILLING_WORDS: Record<AdminLang, BillingMessages> = { en: billingEn, nb: billingNb };
