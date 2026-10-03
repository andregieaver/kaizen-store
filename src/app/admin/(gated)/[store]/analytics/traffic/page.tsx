import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { RefundsView } from "@/components/admin/analytics/refunds-view";
import { ReturnsView } from "@/components/admin/analytics/returns-view";
import { TrafficView } from "@/components/admin/analytics/traffic-view";
import { mainCurrency } from "@/lib/markets";
import { analyticsContext } from "@/server/analytics-context";
import { geoReport } from "@/server/analytics-geo-data";
import { refundsReport } from "@/server/analytics-refunds-data";
import { returnsReport } from "@/server/analytics-returns-data";
import { searchReport } from "@/server/analytics-search-data";
import { timeReport } from "@/server/analytics-time-data";
import { trafficReport } from "@/server/analytics-traffic-data";

export const metadata: Metadata = { title: "Traffic analytics" };

/**
 * Where visitors drop out on the way to a purchase, which devices and countries sell, what shoppers search for and when the store sells,
 * with refunds and returns at the bottom (D152, D153). Thin on purpose: it reads the period and the reports and hands them to the views. What needs visit
 * counting says so on the page, while the figures that come from orders and searches show either way.
 */
export default async function AnalyticsTrafficPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/traffic">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const { store, now } = ctx;
  const { period } = ctx.params;

  const [traffic, geo, search, time, refunds, returns] = await Promise.all([
    trafficReport(store, period, now),
    geoReport(store, period),
    searchReport(store, period, now),
    timeReport(store, period),
    refundsReport(store, period),
    returnsReport(store, period, now),
  ]);
  const currency = mainCurrency(store);
  const locale = store.markets[0]?.locale ?? "en";

  return (
    <div className="flex flex-col gap-8">
      <AnalyticsHeader
        ctx={ctx}
        path="/analytics/traffic"
        title="Traffic"
        description="Where visitors drop out on the way to a purchase, which devices and countries sell, what shoppers search for and when the store is busiest. Refunds and returns are at the bottom."
      />
      <TrafficView base={ctx.base} currency={currency} locale={locale} timeZone={store.timeZone} traffic={traffic} geo={geo} search={search} time={time} />
      <RefundsView currency={currency} locale={locale} report={refunds} marketNames={Object.fromEntries(store.markets.map((m) => [m.code, m.name]))} />
      <ReturnsView currency={currency} locale={locale} report={returns} queueHref={`${ctx.base}/returns?overdue=1`} />
    </div>
  );
}
