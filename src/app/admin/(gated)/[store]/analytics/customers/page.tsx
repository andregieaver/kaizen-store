import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { CustomersView } from "@/components/admin/analytics/customers-view";
import { analyticsContext } from "@/server/analytics-context";
import { customersReport } from "@/server/analytics-customers-data";

export const metadata: Metadata = { title: "Customer analytics" };

/**
 * New against returning customers, how often they buy again, what a customer is worth, customer groups and cohorts (D152). Every
 * figure is worked out in code from paid orders; the page only draws the report.
 */
export default async function AnalyticsCustomersPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/customers">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const { store, now } = ctx;

  const report = await customersReport(store, ctx.params.period, ctx.settings, now);

  return (
    <div className="flex flex-col gap-8">
      <AnalyticsHeader
        ctx={ctx}
        path="/analytics/customers"
        title="Customers"
        description="Do customers come back, what is a customer worth, and who are your best? The period picks the customers who ordered in it; repeat rates, lifetime value, groups and cohorts always look at the whole history."
      />
      <CustomersView base={ctx.base} locale={store.markets[0]?.locale ?? "en"} timeZone={store.timeZone} isOwner={ctx.owner} report={report} />
    </div>
  );
}
