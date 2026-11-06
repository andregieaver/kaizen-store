import "server-only";

import type { AdminLang } from "@/lib/admin-lang";
import { screensEn } from "@/lib/admin-messages/screens.en";
import { adminText } from "@/lib/admin-text";
import { sayIn, type Say } from "@/lib/analytics-notes";

/** An analytics page's `Say` (D152, D312): the reports' notes, written in English, in the admin's language and its way of writing numbers. */
export function analyticsSay(lang: AdminLang, locale: string): Say {
  return sayIn(screensEn.analyticsNotes, adminText(lang, "screens").analyticsNotes, locale);
}

/** The analytics tables' captions in the admin's language for `ExportScope`; none in English, where the registry's own are the words. */
export function analyticsCaptions(lang: AdminLang): Readonly<Record<string, string>> | undefined {
  return lang === "en" ? undefined : adminText(lang, "screens").analyticsCaptions;
}
