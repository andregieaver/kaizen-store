import { analyticsEn, type AnalyticsMessages } from "./admin-messages/analytics.en";
import { analyticsNb } from "./admin-messages/analytics.nb";
import { fillWords } from "./admin-fill";
import type { AdminLang } from "./admin-lang";
import { analyticsLang } from "./analytics-lang";

/**
 * The analytics' shared words in the request's language (D312 A9, `setAnalyticsLang()`): English outside an analytics page's render, so a
 * route, a job, the AI manager's tools and the tests read the English they always did.
 */
export function analyticsWords(): AnalyticsMessages {
  return analyticsLang() === "nb" ? analyticsNb : analyticsEn;
}

/** The same words for a language known outside a page's render (a server action's member, a route's). */
export function analyticsWordsIn(lang: AdminLang): AnalyticsMessages {
  return lang === "nb" ? analyticsNb : analyticsEn;
}

export { analyticsEn };

/** A count's pair in the request's language: `{ one, many }`, `{n}` filled with the count as the figures write it. */
export function countText(pair: { one: string; many: string }, n: number, values: Record<string, string | number> = {}, nText?: string): string {
  return fillWords(n === 1 ? pair.one : pair.many, { n: nText ?? String(n), ...values });
}
