import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { ExportScope } from "@/components/admin/analytics/export-scope";
import { InventoryView, parseInventoryParams } from "@/components/admin/analytics/inventory-view";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminText, adminTexts } from "@/lib/admin-text";
import { queryText } from "@/lib/analytics-export";
import { analyticsContext } from "@/server/analytics-context";
import { inventoryReport } from "@/server/analytics-inventory-data";

export const metadata: Metadata = { title: "Inventory analytics" };

/**
 * What is in stock, what it is worth, what is about to run out and what does not sell (D152). The figures are as of now, so the page has
 * no period; it reads the status filter, the sort and "show all" from the address and hands the report to `InventoryView`.
 */
export default async function AnalyticsInventoryPage({ params, searchParams }: PageProps<"/admin/[store]/analytics/inventory">) {
  const query = await searchParams;
  const ctx = await analyticsContext((await params).store, query);
  // Sales analytics are part of the online shop (D178 step 5): hidden while it is off; traffic stays.
  const shopOff = requireFeature(ctx, "shop");
  if (shopOff) return shopOff;
  const { store, now } = ctx;

  const [report] = await Promise.all([inventoryReport(store, now)]);
  const { status, sort, showAll } = parseInventoryParams(query);

  const locale = ctx.lang === "en" ? (store.markets[0]?.locale ?? "en") : ctx.locale;
  const w = adminText(ctx.lang, "reports");

  return (
    <AdminTextScope texts={adminTexts(ctx.lang, ["reports", "analytics"])}>
    <ExportScope base={ctx.base} query={queryText(query)} owner={ctx.owner} canExport={ctx.canExport}>
      <div className="flex flex-col gap-8">
        <AnalyticsHeader
          ctx={ctx}
          path="/analytics/inventory"
          title={w.pages.inventory.title}
          picker={false}
          description={w.pages.inventory.description}
        />
        <InventoryView base={ctx.base} locale={locale} report={report} status={status} sort={sort} showAll={showAll} words={w.inventory} />
      </div>
    </ExportScope>
    </AdminTextScope>
  );
}
