/**
 * The reports area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { reportsEn, type ReportsMessages } from "../admin-messages/reports.en";
import { reportsNb } from "../admin-messages/reports.nb";

export const REPORTS_WORDS: Record<AdminLang, ReportsMessages> = { en: reportsEn, nb: reportsNb };
