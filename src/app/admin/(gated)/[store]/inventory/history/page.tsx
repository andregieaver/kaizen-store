import type { Metadata } from "next";
import { Suspense } from "react";

import { DataSkeleton } from "@/components/admin/data/page-parts";
import { HistoryView } from "@/components/admin/inventory/history-view";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { INVENTORY_RETENTION_MONTHS } from "@/lib/inventory";
import { historyQuery } from "@/lib/inventory-admin";
import { stockHistory } from "@/server/inventory";
import { listLocations } from "@/server/inventory-locations";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Stock history" };

type Props = PageProps<"/admin/[store]/inventory/history">;

/**
 * The stock history (wave 3, D172, `docs/wave-3-inventory.md` 2.2): every change of a stock level with its reason and who or what made it, newest first.
 * `products:read`. Read per request, never cached.
 */
export default async function StockHistoryPage({ params, searchParams }: Props) {
  const { store } = await requirePermission((await params).store, "products:read");
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="history"
        title="Stock history"
        intro={`Every change of a stock level: from a count or a delivery, a sale, a refund, a return, a file or the AI manager. Kept ${INVENTORY_RETENTION_MONTHS} months.`}
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const { store } = await requirePermission(storeSlug, "products:read");
  const query = historyQuery(await searchParams);
  const [history, locations] = await Promise.all([
    stockHistory(store, { variantId: query.variant, sku: query.sku || null, locationId: query.location, reason: query.reason, from: query.from, to: query.to, after: query.after }),
    listLocations(store.id),
  ]);
  return <HistoryView slug={store.slug} rows={history.rows} nextCursor={history.nextCursor} query={query} locations={locations} timeZone={store.timeZone} />;
}
