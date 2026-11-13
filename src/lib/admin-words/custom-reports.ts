/**
 * The customReports area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { customReportsEn, type CustomReportsMessages } from "../admin-messages/custom-reports.en";
import { customReportsNb } from "../admin-messages/custom-reports.nb";

export const CUSTOM_REPORTS_WORDS: Record<AdminLang, CustomReportsMessages> = { en: customReportsEn, nb: customReportsNb };
