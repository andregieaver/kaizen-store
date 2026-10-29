import type { Metadata } from "next";
import { Suspense } from "react";

import { AdminTextScope } from "@/components/admin/admin-text";
import { DataSkeleton } from "@/components/admin/data/page-parts";
import { requireFeature } from "@/components/admin/feature-off";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { NewStockDocument, StockDocumentList } from "@/components/admin/inventory/stock-documents-view";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { inventoryPaths } from "@/lib/inventory-admin";
import { listLocations } from "@/server/inventory-locations";
import { memberCan, requirePermission } from "@/server/permissions";
import { listTransfers } from "@/server/stock-transfers";

import { createTransferAction } from "./actions";

export const metadata: Metadata = { title: "Stock transfers" };

type Props = PageProps<"/admin/[store]/inventory/transfers">;

/** The store's stock transfers (wave 11 unit D, D383): the list, and a draft made from SKUs for staff who may change products. Read per request. */
export default async function TransfersPage({ params }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "inventory").pages.transfers;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead slug={store.slug} active="transfers" title={w.title} intro={w.intro} lang={lang} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const [transfers, locations] = await Promise.all([listTransfers(store.id), listLocations(store.id)]);
  const base = inventoryPaths(store.slug).transfers;
  const places = locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }));
  return (
    <AdminTextScope texts={adminTexts(adminLangOf(member.account.adminLocale), ["inventory"])}>
      <div className="flex flex-col gap-6">
        <StockDocumentList
          kind="transfer"
          rows={transfers.map((t) => ({
            id: t.id,
            href: `${base}/${t.id}`,
            state: t.state,
            title: `${t.origin} → ${t.destination}`,
            lines: t.lines,
            units: t.units,
            received: t.received,
            createdAt: t.createdAt,
          }))}
        />
        {memberCan(member, "products:write") && places.length >= 2 && (
          <NewStockDocument kind="transfer" places={places} documentBase={base} create={createTransferAction.bind(null, store.slug)} />
        )}
      </div>
    </AdminTextScope>
  );
}
