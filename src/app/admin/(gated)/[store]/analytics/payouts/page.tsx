import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { PayoutsView } from "@/components/admin/analytics/payouts-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminText, adminTexts } from "@/lib/admin-text";
import { queryText } from "@/lib/analytics-export";
import { mainCurrency } from "@/lib/markets";
import { analyticsContext } from "@/server/analytics-context";
import { payoutsReport } from "@/server/payouts-report";

export const metadata: Metadata = { title: "Payouts" };

/**
 * The store's Stripe payouts (wave 4 unit C, D290): what arrived at the bank in the period, what each payout settles and whether it adds up. Thin on
 * purpose: it reads the report and hands it to `PayoutsView`. Stored rows only, no Stripe call.
 */
export default async function AnalyticsPayoutsPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/payouts">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const report = await payoutsReport(ctx.store, ctx.params.period);
  const words = adminText(ctx.lang, "finance");
  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["finance", "analytics"])}>
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/payouts"
          title={words.pages.payoutsTitle}
          description={words.pages.payoutsDescription}
          showCompare={false}
          amountsNote={words.pages.payoutsAmounts}
        />
        <PayoutsView base={ctx.base} currency={mainCurrency(ctx.store)} locale={ctx.locale} report={report} words={words} />
      </div>
    </ExportScope>
    </AdminTextScope>
  );
}
