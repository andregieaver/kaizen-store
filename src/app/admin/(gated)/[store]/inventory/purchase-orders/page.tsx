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
import { mainCurrency } from "@/lib/markets";
import { listLocations } from "@/server/inventory-locations";
import { memberCan, requirePermission } from "@/server/permissions";
import { listPurchaseOrders, reorderDraft } from "@/server/purchase-orders";
import { Card } from "@/components/admin/ui";
import { countWords } from "@/lib/admin-fill";

import { createPurchaseOrderAction } from "./actions";

export const metadata: Metadata = { title: "Purchase orders" };

type Props = PageProps<"/admin/[store]/inventory/purchase-orders">;

/** The store's purchase orders (wave 11 unit D, D383): the list, and a draft for staff who may change products. Read per request. */
export default async function PurchaseOrdersPage({ params, searchParams }: Props) {
  const gated = await requirePermission((await params).store, "products:read");
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "inventory").pages.purchaseOrders;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead slug={store.slug} active="purchase_orders" title={w.title} intro={w.intro} lang={lang} />
      <Suspense fallback={<DataSkeleton />}>
        <Body storeSlug={store.slug} reorder={(await searchParams).reorder === "1"} />
      </Suspense>
    </div>
  );
}

async function Body({ storeSlug, reorder }: { storeSlug: string; reorder: boolean }) {
  const member = await requirePermission(storeSlug, "products:read");
  const { store } = member;
  const mayWrite = memberCan(member, "products:write");
  // *Prepare reorder* from the briefing (D416): the form filled in from what is running out, saved only when the person presses Create.
  const [orders, locations, draft] = await Promise.all([listPurchaseOrders(store.id), listLocations(store.id), reorder && mayWrite ? reorderDraft(store) : Promise.resolve(null)]);
  const lang = adminLangOf(member.account.adminLocale);
  const rw = adminText(lang, "inventory").pages.purchaseOrders.reorder;
  const noCost = draft ? draft.lines.filter((l) => l.unitCost === "").length : 0;
  const base = inventoryPaths(store.slug).purchase_orders;
  const places = locations.filter((l) => l.active).map((l) => ({ id: l.id, name: l.name }));
  return (
    <AdminTextScope texts={adminTexts(adminLangOf(member.account.adminLocale), ["inventory"])}>
      <div className="flex flex-col gap-6">
        {draft && (
          <Card title={rw.title} compact>
            <div className="flex flex-col gap-2 text-sm" data-reorder-prepared>
              <p>{draft.lines.length > 0 ? rw.intro : rw.none}</p>
              {noCost > 0 && <p className="text-muted">{countWords(noCost, rw.noCost, { n: noCost })}</p>}
            </div>
          </Card>
        )}
        <StockDocumentList
          kind="order"
          rows={orders.map((o) => ({
            id: o.id,
            href: `${base}/${o.id}`,
            state: o.state,
            title: o.reference ? `${o.supplier} · ${o.reference}` : o.supplier,
            place: o.location,
            lines: o.lines,
            units: o.units,
            received: o.received,
            total: { minor: o.totalMinor, currency: o.currency },
            expectedOn: o.expectedOn,
            createdAt: o.createdAt,
          }))}
        />
        {mayWrite && places.length > 0 && (
          <NewStockDocument
            key={draft ? "reorder" : "blank"}
            initial={draft && draft.lines.length > 0 ? { supplier: draft.supplier, lines: draft.lines.map((l) => ({ sku: l.sku, quantity: l.quantity, unitCost: l.unitCost })) } : undefined}
            kind="order"
            places={places}
            currencies={[...store.localization.rates.keys()].sort()}
            mainCurrency={mainCurrency(store)}
            documentBase={base}
            create={createPurchaseOrderAction.bind(null, store.slug)}
          />
        )}
      </div>
    </AdminTextScope>
  );
}
