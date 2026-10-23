import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { SubscriptionsView } from "@/components/admin/analytics/subscriptions-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminText, adminTexts } from "@/lib/admin-text";
import { queryText } from "@/lib/analytics-export";
import { mainCurrency } from "@/lib/markets";
import { analyticsContext } from "@/server/analytics-context";
import { subscriptionsReport } from "@/server/analytics-subscriptions-data";

export const metadata: Metadata = { title: "Subscription analytics" };

/**
 * Monthly recurring revenue, how it moved over the period, who left and which payments failed (D152). Thin on purpose: it reads the
 * period and the report and hands them to `SubscriptionsView`. The figures are worked out in code from the subscriptions' own rows.
 */
export default async function AnalyticsSubscriptionsPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/subscriptions">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const off = requireFeature(ctx, "subscriptions");
  if (off) return off;
  const { store, now } = ctx;

  const report = await subscriptionsReport(store, ctx.params.period, now);

  const locale = ctx.lang === "en" ? (store.markets[0]?.locale ?? "en") : ctx.locale;
  const w = adminText(ctx.lang, "reports");

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["reports", "analytics"])}>
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/subscriptions"
          title={w.pages.subscriptions.title}
          description={w.pages.subscriptions.description}
        />
        <SubscriptionsView base={ctx.base} currency={mainCurrency(store)} locale={locale} report={report} words={w.subscriptions} />
      </div>
    </ExportScope>
    </AdminTextScope>
  );
}
