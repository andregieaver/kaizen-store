import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { MarketCheckView } from "@/components/admin/analytics/market-check-view";
import { MarketRivalsSection } from "@/components/admin/analytics/market-rivals-section";
import { countWords } from "@/lib/admin-fill";
import { areaTexts } from "@/lib/admin-area";
import { ANALYTICS_EXPORT_WORDS } from "@/lib/admin-words/analytics-export";
import { MARKET_CHECK_WORDS } from "@/lib/admin-words/market-check";
import { formatCount } from "@/lib/analytics-core";
import { queryText } from "@/lib/analytics-export";
import { analyticsContext } from "@/server/analytics-context";
import { analyticsCaptions } from "@/server/analytics-say";
import { marketCheck } from "@/server/market-check";
import { rivalProductChoices } from "@/server/market-rivals";
import { countryName } from "@/lib/vat-text";

import { addRivalAction, readRivalOfferAction, removeRivalAction } from "./actions";

export const metadata: Metadata = { title: "Markets" };

/**
 * The market check's first step (D900 M1, `docs/market-check.md` 3, `docs/analytics.md` "Markets"): the store's countries side by side
 * over the period picked, and what to do in them. Thin on purpose: the reads are `marketCheck()`, the findings `marketFindings()`, the
 * drawing `MarketCheckView`.
 */
export default async function MarketsPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/markets">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const { store, now } = ctx;
  const words = MARKET_CHECK_WORDS[ctx.lang];
  const { period } = ctx.params;
  const [check, products] = await Promise.all([marketCheck(store, period, { now, locale: ctx.locale }), rivalProductChoices(store)]);
  // Amounts as the Traffic page writes them: the first market's locale in English, the admin's own otherwise.
  const locale = ctx.lang === "en" ? (store.markets[0]?.locale ?? "en") : ctx.locale;
  const found = check.findings.length;
  // Rivals (D900 M2) where prices apply; their forms for a member who may change analytics.
  const countries = [...new Map(store.markets.map((m) => [m.code, countryName(m.code, ctx.locale)])).entries()].map(([code, name]) => ({ code, name }));
  const rivals = check.sells ? (
    <MarketRivalsSection
      lang={ctx.lang}
      locale={locale}
      timeZone={store.timeZone}
      words={words.rivals}
      rivals={check.rivals}
      offers={check.offers}
      countries={countries}
      products={products}
      actions={
        ctx.canExport
          ? { add: addRivalAction.bind(null, store.slug), remove: removeRivalAction.bind(null, store.slug), read: readRivalOfferAction.bind(null, store.slug) }
          : null
      }
      now={now}
    />
  ) : null;
  return (
    <AdminTextScope texts={areaTexts(ctx.lang, { analyticsExport: ANALYTICS_EXPORT_WORDS })}>
      <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport} captions={analyticsCaptions(ctx.lang)}>
        <div className="flex flex-col gap-8">
          <AnalyticsHeader
            ctx={ctx}
            path="/analytics/markets"
            title={words.title}
            description={
              <>
                <span className="sm:hidden">{words.phoneLead}</span>
                <span className="max-sm:hidden">{words.description}</span>
              </>
            }
            lead={found > 0 ? countWords(found, words.lead, { n: formatCount(found) }) : undefined}
            showCompare={false}
          />
          <MarketCheckView base={ctx.base} lang={ctx.lang} locale={locale} check={check} periodLabel={period.label} words={words} rivals={rivals} />
        </div>
      </ExportScope>
    </AdminTextScope>
  );
}
