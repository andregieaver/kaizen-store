import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { PayoutsView } from "@/components/admin/analytics/payouts-view";
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
  return (
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/payouts"
          title="Payouts"
          description="What Stripe paid to your bank, what each payout settles, and whether it adds up to your orders."
          showCompare={false}
          amountsNote="Each payout in its own currency, as Stripe paid it; totals in the main currency."
        />
        <PayoutsView base={ctx.base} currency={mainCurrency(ctx.store)} locale={ctx.store.markets[0]?.locale ?? "en"} report={report} />
      </div>
    </ExportScope>
  );
}
