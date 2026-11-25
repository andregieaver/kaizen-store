import "server-only";

import { MARKET_CHECK_WORDS } from "@/lib/admin-words/market-check";
import { formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { addDays, customPeriod, todayIn } from "@/lib/analytics-period";
import { languageNames } from "@/lib/legal-admin-words";
import { conversionOf, findingText, FIX_PATHS, MIN_ORDERS, MIN_VISITS } from "@/lib/market-check";
import type { OwnerToolInput } from "@/lib/owner-tools";

import { adminLink, BASIS, mainLocale, periodWords, type Ctx } from "./analytics-tools";
import { marketCheck } from "./market-check";

/**
 * The AI manager's `market_check` (D900 M1, `docs/market-check.md` 3.4), in a module of its own: the tools' map loads it when it is called,
 * so the market check's words are not in every admin page that reaches the tools.
 */
/**
 * The market check (D900 M1, `docs/market-check.md` 3.4): each country's facts and the findings, as Analytics → Markets reads and words
 * them (`marketCheck()`, `findingText()`), for the last `days` store days. A figure that cannot be known says so; nothing is worked out here.
 */
export async function marketCheckTool({ store }: Ctx, { days }: OwnerToolInput<"market_check">) {
  const now = new Date();
  const today = todayIn(now, store.timeZone);
  const period = customPeriod(addDays(today, 1 - days), today);
  const check = await marketCheck(store, period, { now, locale: "en-GB" });
  const w = MARKET_CHECK_WORDS.en;
  const locale = mainLocale(store);
  const money = (minor: number | null) => (minor === null ? null : formatAmount(minor, check.currency, locale));
  const names = new Map(check.markets.map((m) => [m.code, m.name]));
  const languageName = (code: string) => languageNames([code.split("-")[0]], "en");
  const notCounted = check.coverage.counting ? "no day of the period was counted" : "visit counting is off (Analytics → Settings)";
  return {
    period: periodWords(period),
    basis: `${BASIS} Visits and conversion are counted as on the Traffic page; orders are those placed in each country.`,
    countries: check.markets.map((m) => ({
      country: m.name,
      code: m.code,
      offered: m.sells,
      visits: m.visits ?? `not known: ${notCounted}`,
      conversion: m.visits === null ? `not known: ${notCounted}` : formatPercent(conversionOf(m)),
      ...(check.sells && {
        orders: m.orders,
        revenue: money(m.revenueMinor),
        average_order: m.orders && m.revenueMinor !== null ? money(Math.round(m.revenueMinor / m.orders)) : null,
        products_without_price: m.unpriced,
      }),
      searches: m.searches ?? "not known: searches are kept 90 days",
      found_nothing: m.misses,
      most_missed: m.missedTerms.map((t) => `${t.term} (${t.misses})`),
      ...(m.locale && { products_without_a_name_in: { language: languageName(m.locale), products: m.untranslated } }),
    })),
    findings: check.findings.map((f) => ({ kind: f.kind, text: findingText(f, w.finding, names, languageName), page: adminLink(store, FIX_PATHS[f.kind]) })),
    notes: [
      check.house ? w.notes.house : !check.sells ? w.notes.noShop : null,
      `A country is compared with the rest only when both have at least ${MIN_VISITS} visits and the rest at least ${MIN_ORDERS} orders, and the difference is too large to be chance.`,
      check.findings.length === 0 ? w.nothingToDo : null,
    ].filter((n): n is string => n !== null),
    page: adminLink(store, `/analytics/markets?period=custom&from=${period.from}&to=${addDays(period.to, -1)}`),
  };
}
