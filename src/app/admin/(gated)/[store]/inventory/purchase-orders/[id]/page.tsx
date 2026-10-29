import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { StockDocumentDetail } from "@/components/admin/inventory/stock-documents-view";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { inventoryPaths } from "@/lib/inventory-admin";
import { mainCurrency } from "@/lib/markets";
import { memberCan, requirePermission } from "@/server/permissions";
import { getPurchaseOrder } from "@/server/purchase-orders";

import { cancelPurchaseOrderAction, placePurchaseOrderAction, receivePurchaseOrderAction } from "../actions";

export const metadata: Metadata = { title: "Purchase order" };

type Props = PageProps<"/admin/[store]/inventory/purchase-orders/[id]">;

/** One purchase order (wave 11 unit D, D383): its lines, its costs and its next step. Read per request. */
export default async function PurchaseOrderPage({ params }: Props) {
  const { store: slug, id } = await params;
  const member = await requirePermission(slug, "products:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const order = await getPurchaseOrder(store.id, id);
  if (!order) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const t = adminText(lang, "inventory");
  const w = t.pages.purchaseOrder;
  const facts = [t.documents.orderStates[order.state], order.reference, order.expectedOn ? `${t.documents.expectedCol}: ${order.expectedOn}` : null, order.note].filter(Boolean);
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="purchase_orders"
        title={`${w.title}: ${order.supplier}`}
        intro={<>{facts.join(" · ")}</>}
        back={{ href: inventoryPaths(store.slug).purchase_orders, label: w.back }}
        lang={lang}
      />
      <AdminTextScope texts={adminTexts(lang, ["inventory"])}>
        <StockDocumentDetail
          kind="order"
          status={order.status}
          to={order.location}
          currency={order.currency}
          mainCurrency={mainCurrency(store)}
          items={order.items}
          canWrite={memberCan(member, "products:write")}
          csvHref={`${inventoryPaths(store.slug).purchase_orders}/${order.id}/csv`}
          tools={{
            advance: placePurchaseOrderAction.bind(null, store.slug, order.id),
            receive: receivePurchaseOrderAction.bind(null, store.slug, order.id),
            cancel: cancelPurchaseOrderAction.bind(null, store.slug, order.id),
          }}
        />
      </AdminTextScope>
    </div>
  );
}
