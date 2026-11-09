import type { Metadata } from "next";

import { AdminTextScope } from "@/components/admin/admin-text";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { SalesView } from "@/components/admin/analytics/sales-view";
import { requireFeature } from "@/components/admin/feature-off";
import { adminText, adminTexts } from "@/lib/admin-text";
import { todayIn } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import { analyticsContext } from "@/server/analytics-context";
import { salesReport } from "@/server/sales-reports";

export const metadata: Metadata = { title: "Sales analytics" };

/**
 * Analytics → Sales (S6, D519): the deals' forecast, stages, people and time to win, from the store's deals (D464). Thin on purpose: it reads
 * the period, the pipeline and the currency asked for, and hands the report to `SalesView`. Behind the store's Sales feature, as the deals are.
 */
export default async function AnalyticsSalesPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/sales">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const off = requireFeature(ctx, "sales");
  if (off) return off;
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
  const w = adminText(ctx.lang, "reports");
  const kept = Object.fromEntries(Object.entries(query).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["reports", "analytics"])}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader ctx={ctx} path="/analytics/sales" title={w.pages.sales.title} description={w.pages.sales.description} />
        <SalesView report={report} base={ctx.base} query={kept} locale={ctx.locale} words={w.sales} />
      </div>
    </AdminTextScope>
  );
}
