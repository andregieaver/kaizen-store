import type { Metadata } from "next";

import { AnalyticsHeader } from "@/components/admin/analytics/analytics-header";
import { InventoryView, parseInventoryParams } from "@/components/admin/analytics/inventory-view";
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
  const { store, now } = ctx;

  const [report] = await Promise.all([inventoryReport(store, now)]);
  const { status, sort, showAll } = parseInventoryParams(query);

  return (
    <div className="flex flex-col gap-8">
      <AnalyticsHeader
        ctx={ctx}
        path="/analytics/inventory"
        title="Inventory"
        picker={false}
        description="What is in stock and what it is worth, which products are about to run out, and which are not selling. These figures are as of now, not for a period."
      />
      <InventoryView base={ctx.base} locale={store.markets[0]?.locale ?? "en"} report={report} status={status} sort={sort} showAll={showAll} />
    </div>
  );
}
