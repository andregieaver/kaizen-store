import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { FinanceView, type FinancePeriodData } from "@/components/admin/analytics/finance-view";
import { financeStatement } from "@/lib/analytics-finance";
import { bucketFor, type AnalyticsPeriod } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";
import { analyticsContext, type AnalyticsContext } from "@/server/analytics-context";
import { analyticsSetupSummary } from "@/server/analytics-settings-data";
import { periodTotals, seriesByBucket } from "@/server/analytics-totals";

export const metadata: Metadata = { title: "Finance" };

/** One period's totals with its statement worked out, as the view takes them. */
async function periodData(ctx: AnalyticsContext, period: AnalyticsPeriod): Promise<FinancePeriodData> {
  const { totals, unconverted, missingCurrencies } = await periodTotals(ctx.store, period, ctx.settings);
  return { label: period.label, totals, statement: financeStatement(totals, ctx.settings, period.days), unconverted, missingCurrencies };
}

/**
 * From gross sales to operating profit (D152): how much of what the store sells is left, where the rest goes, and how far the
 * figures can be trusted. Thin on purpose: it reads the period and the comparison and hands them to `FinanceView`.
 */
export default async function AnalyticsFinancePage({ params, searchParams }: PageProps<"/admin/[store]/analytics/finance">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const { store, settings } = ctx;
  const { period, compare } = ctx.params;
  const against = compare.previous ?? compare.lastYear;
  const bucket = bucketFor(period);

  const [current, comparison, series, comparisonSeries, setup] = await Promise.all([
    periodData(ctx, period),
    against ? periodData(ctx, against) : Promise.resolve(null),
    seriesByBucket(store, period, bucket, settings),
    against ? seriesByBucket(store, against, bucket, settings) : Promise.resolve(null),
    // How many products lack a cost is a nicety: the page is right without it.
    analyticsSetupSummary(store.id).catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <AnalyticsHeader
        ctx={ctx}
        path="/analytics/finance"
        title="Finance"
        description="How much of what the store sells is left after what it costs, where the rest goes, and how far these figures can be trusted."
      />
      <FinanceView
        base={ctx.base}
        currency={mainCurrency(store)}
        locale={store.markets[0]?.locale ?? "en"}
        isOwner={ctx.owner}
        current={current}
        comparison={comparison && compare.mode !== "none" ? { mode: compare.mode, data: comparison } : null}
        bucket={bucket}
        series={series}
        comparisonSeries={comparisonSeries}
        setup={setup}
      />
    </div>
  );
}
