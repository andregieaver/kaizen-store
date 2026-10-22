import type { Metadata } from "next";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { HistoryView } from "@/components/admin/inventory/history-view";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { INVENTORY_RETENTION_MONTHS } from "@/lib/inventory";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
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
  const gated = await requirePermission((await params).store, "products:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "inventory").pages.history;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead slug={store.slug} active="history" title={w.title} intro={fillWords(w.intro, { months: INVENTORY_RETENTION_MONTHS })} lang={lang} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const query = historyQuery(await searchParams);
  const [history, locations] = await Promise.all([
    stockHistory(store, { variantId: query.variant, sku: query.sku || null, locationId: query.location, reason: query.reason, from: query.from, to: query.to, after: query.after }),
    listLocations(store.id),
  ]);
  return <HistoryView slug={store.slug} rows={history.rows} nextCursor={history.nextCursor} query={query} locations={locations} timeZone={store.timeZone} lang={adminLangOf(member.account.adminLocale)} />;
}
