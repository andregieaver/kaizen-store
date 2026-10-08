import type { Metadata } from "next";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { InventoryView } from "@/components/admin/inventory/inventory-view";
import { listQuery } from "@/lib/inventory-admin";
import { inventoryPage } from "@/server/inventory";
import { memberCan, requirePermission } from "@/server/permissions";

import { adjustStockAction, setPoliciesAction } from "./actions";

export const metadata: Metadata = { title: "Inventory" };

type Props = PageProps<"/admin/[store]/inventory">;

/**
 * The Inventory page (wave 3, D172, `docs/wave-3-inventory.md` 2.2): every variant that is shipped with its stock at each location, what checkouts in
 * progress hold, what is owed on backorder, and the saves with a reason. `products:read` to look, `products:write` to change; the figures are read per
 * request (never cached: a sale moves them).
 */
export default async function InventoryPage({ params, searchParams }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="list"
        title="Inventory"
        intro="Stock for each variant and location. On hand is what is counted and not yet drawn by a paid order; committed is what checkouts in progress hold; available is the difference. Change a figure with a reason: every change is kept in the history."
      />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const query = listQuery(await searchParams);
  const page = await inventoryPage(store, { search: query.search, locationId: query.location, status: query.status, after: query.after });
  return (
    <InventoryView
      slug={store.slug}
      page={page}
      query={query}
      canWrite={memberCan(member, "products:write")}
      tools={{ adjust: adjustStockAction.bind(null, store.slug), setPolicy: setPoliciesAction.bind(null, store.slug) }}
    />
  );
}
