import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AdminTextScope } from "@/components/admin/admin-text";
import { requireFeature } from "@/components/admin/feature-off";
import { InventoryHead } from "@/components/admin/inventory/inventory-head";
import { StockDocumentDetail } from "@/components/admin/inventory/stock-documents-view";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { inventoryPaths } from "@/lib/inventory-admin";
import { memberCan, requirePermission } from "@/server/permissions";
import { getTransfer } from "@/server/stock-transfers";

import { cancelTransferAction, receiveTransferAction, sendTransferAction } from "../actions";

export const metadata: Metadata = { title: "Stock transfer" };

type Props = PageProps<"/admin/[store]/inventory/transfers/[id]">;

/** One stock transfer (wave 11 unit D, D383): its lines and its next step. Read per request. */
export default async function TransferPage({ params }: Props) {
  const { store: slug, id } = await params;
  const member = await requirePermission(slug, "products:read");
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const transfer = await getTransfer(store.id, id);
  if (!transfer) notFound();
  const lang = adminLangOf(member.account.adminLocale);
  const t = adminText(lang, "inventory");
  const w = t.pages.transfer;
  return (
    <div className="flex flex-col gap-6">
      <InventoryHead
        slug={store.slug}
        active="transfers"
        title={`${w.title}: ${transfer.origin} → ${transfer.destination}`}
        intro={<>{t.documents.transferStates[transfer.state]}{transfer.note ? ` · ${transfer.note}` : ""}</>}
        back={{ href: inventoryPaths(store.slug).transfers, label: w.back }}
        lang={lang}
      />
      <AdminTextScope texts={adminTexts(lang, ["inventory"])}>
        <StockDocumentDetail
          kind="transfer"
          status={transfer.status}
          from={transfer.origin}
          to={transfer.destination}
          items={transfer.items}
          canWrite={memberCan(member, "products:write")}
          tools={{
            advance: sendTransferAction.bind(null, store.slug, transfer.id),
            receive: receiveTransferAction.bind(null, store.slug, transfer.id),
            cancel: cancelTransferAction.bind(null, store.slug, transfer.id),
          }}
        />
      </AdminTextScope>
    </div>
  );
}
