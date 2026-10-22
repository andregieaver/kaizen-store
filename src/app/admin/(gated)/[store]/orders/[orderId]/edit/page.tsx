import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { OrderEditEditor } from "@/components/admin/orders/order-edit-editor";
import type { EditorOrderLine } from "@/lib/order-edit-form";
import { editSummaryView } from "@/lib/order-edit-view";
import { getOrderAdmin } from "@/server/order-admin";
import { orderEditability, previewOrderEdit } from "@/server/order-edits";
import { mayRecordOutsidePayment } from "@/server/order-settings";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { blockTextWords, editProblemText, fillWords } from "@/lib/drafts-words";

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
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(member, "shop");
  if (shopOff) return shopOff;
  const { store } = member;
  if (!z.uuid().safeParse(orderId).success) notFound();
  const [order, editability] = await Promise.all([getOrderAdmin(store.id, orderId), orderEditability(store.id, orderId)]);
  if (!order || !editability) notFound();
  const orderHref = `/admin/${store.slug}/orders/${order.id}`;
  const locale = store.markets[0]?.locale ?? order.locale;
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "drafts");
  const w = words.edit.page;
  const heading = (
    <div>
      <Link href={orderHref} className="text-sm text-muted underline underline-offset-2">
        {fillWords(w.order, { number: order.number })}
      </Link>
      <PageHeader title={fillWords(w.title, { number: order.number })} description={w.description} />
      </div>
  );
  if (!memberCan(member, "orders:write")) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <p className="rounded-panel bg-sunken p-4 text-sm">{w.noWrite}</p>
      </div>
    );
  }
  if (editability.block) {
    return (
      <div className="flex flex-col gap-6">
        {heading}
        <p role="status" className="rounded-panel bg-sunken p-4 text-sm">
          {editability.text === null ? null : blockTextWords(editability.text, words.edit)}
        </p>
        <Link href={orderHref} className="text-sm underline underline-offset-2">
          {w.back}
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
  const summary = initial && "priced" in initial ? editSummaryView(initial) : null;
  return (
    <AdminTextScope texts={adminTexts(lang, ["drafts"])}>
    <div className="flex flex-col gap-6">
      {heading}
      <OrderEditEditor
        orderHref={orderHref}
        number={order.number}
        currency={order.currency}
        locale={locale}
        lines={lines}
        shippingMinor={order.shippingMinor}
        initialSummary={summary && { ...summary, problems: summary.problems.map((p) => ({ ...p, text: editProblemText(p.code, p.text, words.edit) })) }}
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
    </AdminTextScope>
  );
}
