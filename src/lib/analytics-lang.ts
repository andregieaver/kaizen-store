import { cache } from "react";

import { ADMIN_LANG_FACTS, type AdminLang } from "./admin-lang";

/**
 * The language the analytics write in for this request (D312 A9). An analytics page sets it once, from the member's account, when it reads
 * its context (`analyticsContextFor()`), and the shared parts read it: the figures' own convention (`formatNumber()`: a decimal comma in
 * Norwegian), months and days, the period's words, and the words of the charts, tables and cards (`analyticsWords()`), so no page has to
 * hand them down. It is React's per-request cache, so a request outside a server render (a route, the AI manager's tools, a job, a test)
 * always gets English, the language the tools and the files are written in.
 */
const scope = cache((): { lang: AdminLang } => ({ lang: "en" }));

export function setAnalyticsLang(lang: AdminLang): void {
  scope().lang = lang;
}

export function analyticsLang(): AdminLang {
  return scope().lang;
}

/** The locale amounts are written in: the market's own in English, as before, and the admin's own in another language. */
export function analyticsMoneyLocale(marketLocale: string): string {
  const lang = analyticsLang();
  return lang === "en" ? marketLocale : ADMIN_LANG_FACTS[lang].locale;
}

/** The locale the analytics' dates are written in (`Intl`): "October 2026" in English, "oktober 2026" in Norwegian. */
export function analyticsDateLocale(): string {
  return ADMIN_LANG_FACTS[analyticsLang()].locale;
}
