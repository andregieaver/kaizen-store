import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { OrderEditEditor } from "@/components/admin/orders/order-edit-editor";
import type { EditorOrderLine } from "@/lib/order-edit-form";
import { editSummaryView } from "@/lib/order-edit-view";
import { getOrderAdmin } from "@/server/order-admin";
import { orderEditability, previewOrderEdit } from "@/server/order-edits";
import { mayRecordOutsidePayment } from "@/server/order-settings";
import { memberCan, requirePermission } from "@/server/permissions";

import {
  applyOrderEditAction,
  previewOrderEditAction,
  recordNewEditPaidOutsideAction,
  searchEditVariantsAction,
  sendOrderEditAction,
} from "./actions";

export const metadata: Metadata = { title: "Edit order" };

/**
 * Changing a paid order's items after purchase (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.2): the order's lines as sold, products to add, the shipping, the
 * reason, and the server's summary of what the change does. `orders:read` opens the page (as every page of the orders section); changing needs `orders:write`, which every
 * action checks again. An order that cannot be changed shows why, in words, with a way back.
 */
export default async function OrderEditPage({ params }: PageProps<"/admin/[store]/orders/[orderId]/edit">) {
  const { store: slug, orderId } = await params;
  const member = await requirePermission(slug, "orders:read");
  const { store } = member;
  if (!z.uuid().safeParse(orderId).success) notFound();
  const [order, editability] = await Promise.all([getOrderAdmin(store.id, orderId), orderEditability(store.id, orderId)]);
  if (!order || !editability) notFound();
  const orderHref = `/admin/${store.slug}/orders/${order.id}`;
  const locale = store.markets[0]?.locale ?? order.locale;
  const heading = (
    <div>
      <Link href={orderHref} className="text-sm text-muted underline underline-offset-2">
        Order #{order.number}
      </Link>
      <h1 className="text-2xl font-semibold">Edit the items of order #{order.number}</h1>
      <p className="max-w-3xl text-sm text-muted">
        Items kept keep the price and discounts they were sold with. A lower total is refunded at once; a higher total is paid by the customer through a link before the order changes. The order keeps its
        number, and an invoiced order gets a credit note and an additional invoice that refer to its invoice.
      </p>
    </div>
  );
  if (!memberCan(member, "orders:write")) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">You can look at orders but not change them: that needs the right to change orders.</p>
      </div>
    );
  }
  if (editability.block) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <p role="status" className="rounded-lg border border-border bg-surface p-4 text-sm">
          {editability.text}
        </p>
        <Link href={orderHref} className="text-sm underline underline-offset-2">
          Back to the order
        </Link>
      </div>
    );
  }
  // The summary as the page opens: the order as it is, with nothing changed yet (its base travels with the first save).
  const [initial, mayRecordOutside] = await Promise.all([previewOrderEdit(store.id, order.id, { reason: "other" }), mayRecordOutsidePayment(member)]);
  const lines: EditorOrderLine[] = order.lines.map((l) => ({
    lineId: l.id,
    variantId: l.variantId,
    title: l.title,
    sku: l.sku,
    quantity: l.quantity,
    unitPriceMinor: l.unitPriceMinor,
    totalMinor: l.totalMinor,
    editable: Boolean(l.variantId) && l.delivery === "physical" && !l.custom,
    gift: l.gift,
  }));
  return (
    <div className="flex flex-col gap-6">
      {heading}
      <OrderEditEditor
        orderHref={orderHref}
        number={order.number}
        currency={order.currency}
        locale={locale}
        lines={lines}
        shippingMinor={order.shippingMinor}
        initialSummary={initial && "priced" in initial ? editSummaryView(initial) : null}
        hasEmail={Boolean(order.email)}
        mayRecordOutside={mayRecordOutside}
        actions={{
          preview: previewOrderEditAction.bind(null, store.slug, order.id),
          apply: applyOrderEditAction.bind(null, store.slug, order.id),
          send: sendOrderEditAction.bind(null, store.slug, order.id),
          paidOutside: recordNewEditPaidOutsideAction.bind(null, store.slug, order.id),
          searchVariants: searchEditVariantsAction.bind(null, store.slug, order.id),
        }}
      />
    </div>
  );
}
