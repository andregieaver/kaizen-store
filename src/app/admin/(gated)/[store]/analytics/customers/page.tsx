import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { CustomersView } from "@/components/admin/analytics/customers-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminText, adminTexts } from "@/lib/admin-text";
import { queryText } from "@/lib/analytics-export";
import { analyticsContext } from "@/server/analytics-context";
import { customersReport } from "@/server/analytics-customers-data";
import { featureOn } from "@/lib/store-features";

export const metadata: Metadata = { title: "Customer analytics" };

/**
 * New against returning customers, how often they buy again, what a customer is worth, customer groups and cohorts (D152). Every
 * figure is worked out in code from paid orders; the page only draws the report.
 */
export default async function AnalyticsCustomersPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/customers">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  // Sales analytics are part of the online shop (D178 step 5): hidden while it is off; traffic stays.
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const { store, now } = ctx;

  const report = await customersReport(store, ctx.params.period, ctx.settings, now);

  const locale = ctx.lang === "en" ? (store.markets[0]?.locale ?? "en") : ctx.locale;
  const w = adminText(ctx.lang, "reports");

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["reports", "analytics"])}>
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/customers"
          title={w.pages.customers.title}
          description={w.pages.customers.description}
        />
        <CustomersView base={ctx.base} locale={locale} timeZone={store.timeZone} isOwner={ctx.owner} report={report} bonusOn={featureOn(store, "bonus")} words={w.customers} />
      </div>
    </ExportScope>
    </AdminTextScope>
  );
}
