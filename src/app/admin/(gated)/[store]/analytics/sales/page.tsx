import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { SalesView } from "@/components/admin/analytics/sales-view";
import { requireFeature } from "@/components/admin/feature-off";
import { todayIn } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import { areaTexts } from "@/lib/admin-area";
import { ANALYTICS_EXPORT_WORDS } from "@/lib/admin-words/analytics-export";
import { REPORTS_WORDS } from "@/lib/admin-words/reports";
import { analyticsContext } from "@/server/analytics-context";
import { salesReport } from "@/server/sales-reports";
import { requireExtension } from "@/components/admin/extension-off";

export const metadata: Metadata = { title: "Sales analytics" };

/**
 * Analytics → Sales (S6, D520): the deals' forecast, stages, people and time to win, from the store's deals (D464). Thin on purpose: it reads
 * the period, the pipeline and the currency asked for, and hands the report to `SalesView`. Behind the store's Sales feature, as the deals are.
 */
export default async function AnalyticsSalesPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/sales">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const off = requireFeature(ctx, "sales");
  if (off) return off;
  const notInAccount = requireExtension(ctx, "deals");
  if (notInAccount) return notInAccount;
  const { store, now } = ctx;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
  const report = await salesReport(store.id, {
    main: mainCurrency(store),
    currency: one(query.currency),
    pipelineId: one(query.pipeline),
    from: ctx.params.period.from,
    to: ctx.params.period.to,
    today: todayIn(now, store.timeZone),
  });
  const w = REPORTS_WORDS[ctx.lang];
  const kept = Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

  return (
    <AdminTextScope texts={areaTexts(ctx.lang, { analyticsExport: ANALYTICS_EXPORT_WORDS })}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader ctx={ctx} path="/analytics/sales" title={w.pages.sales.title} description={w.pages.sales.description} />
        <SalesView report={report} base={ctx.base} query={kept} locale={ctx.locale} words={w.sales} />
      </div>
    </AdminTextScope>
  );
}
