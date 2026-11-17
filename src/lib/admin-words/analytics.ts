/**
 * The analytics area's words in both languages, for code outside the admin (bloat review step 0.7, used by the platform's morning briefing).
 * Code outside src/app/admin and src/components/admin reads an area here, never through the admin registry, which loads every area.
 * Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { analyticsEn, type AnalyticsMessages } from "../admin-messages/analytics.en";
import { analyticsNb } from "../admin-messages/analytics.nb";

export const ANALYTICS_WORDS: Record<AdminLang, AnalyticsMessages> = { en: analyticsEn, nb: analyticsNb };
