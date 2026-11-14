import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireShopOrAfterSale } from "@/components/admin/after-sale-gate";
import { OrderListView } from "@/components/admin/orders/order-list-view";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { tableRowsOf } from "@/lib/order-list-admin";
import { listOrdersPage, resolveOrderList } from "@/server/order-list";
import { listOrderViews } from "@/server/order-views";
import { tagSuggestions } from "@/server/order-tags";
import { memberCan, requirePermission } from "@/server/permissions";
import { AdminLink, PageHeader } from "@/components/admin/ui";
import { MoreMenu } from "@/components/admin/orders/order-folds";
import { countWords, fillWords } from "@/lib/admin-fill";
import { whenWords } from "@/lib/home";
import { orderPreviews, toSendSummary } from "@/server/home";

import { bulkOrdersAction, deleteOrderViewAction, reorderOrderViewsAction, saveOrderViewAction, updateOrderViewAction } from "./list-actions";

export const metadata: Metadata = { title: "Orders" };

type Props = PageProps<"/admin/[store]/orders">;

/**
 * The Orders page (wave 3, D173, `docs/wave-3-orders.md` 2.2): search over number, email, name, product title or SKU, tag and tracking number; filters, sort and columns in the
 * address (a bookmark and the back button work); saved views; and bulk actions on ticked orders. `orders:read` to look, `orders:write` to change. The address is read by one parser
 * (`parseOrderListParams()`), which drops what it does not know, so a bad address is a plain list and never an error page.
 */
export default async function OrdersPage({ params, searchParams }: Props) {
  const member = await requirePermission((await params).store, "orders:read");
  // While the online shop is off (D178 step 5), what was sold stays reachable as long as an order can still be withdrawn from or returned.
  const shopOff = await requireShopOrAfterSale(member);
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "orders").page;
  const sending = await toSendSummary(store.id);
  // Round 2 (D597): the bare address shows what needs sending while anything does, without a second trip; All has its own address (`?show=all`).
  const query = await searchParams;
  const listQuery = sending.count > 0 && Object.keys(query).length === 0 ? { show: "to-send" } : query;
  const canWrite = memberCan(member, "orders:write");
  const when = sending.oldest ? whenWords(sending.oldest, new Date(), store.timeZone, adminText(lang, "home").today.when) : null;
  const menuItem = "flex min-h-10 items-center rounded-panel px-3 text-sm text-ink hover:bg-sunken";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        meta={[sending.count > 0 ? `${countWords(sending.count, w.toSendLead)}${when ? fillWords(w.oldest, { when }) : ""}` : w.nothingToSend]}
        actions={
          <>
            <MoreMenu label={w.more}>
              {canWrite && (
                <Link href={`/admin/${store.slug}/orders/drafts/new`} className={menuItem}>
                  {w.makeDraft}
                </Link>
              )}
              <Link href={`/admin/${store.slug}/orders/drafts`} className={menuItem}>
                {w.drafts}
              </Link>
              <Link href={`/admin/${store.slug}/emails`} className={menuItem}>
                {w.emails}
              </Link>
              {/* The order file (D165) holds personal data, so only the owner is offered it. */}
              {memberCan(member, "owner") && (
                <Link href={`/admin/${store.slug}/orders/export`} className={menuItem}>
                  {w.export}
                </Link>
              )}
            </MoreMenu>
            {sending.firstId && (
              <AdminLink href={`/admin/${store.slug}/orders/${sending.firstId}`} className="inline-flex h-11 items-center gap-2 rounded-pill bg-brand px-5 text-body-strong text-brand-ink hover:bg-brand-hover">
                {w.startPacking} →
              </AdminLink>
            )}
          </>
        }
      />
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-card" />}>
        <OrderListBody storeSlug={store.slug} query={listQuery} toSend={sending.count} />
      </Suspense>
    </div>
  );
}

async function OrderListBody({ storeSlug, query, toSend }: { storeSlug: string; query: Awaited<Props["searchParams"]>; toSend: number }) {
  const member = await requirePermission(storeSlug, "orders:read");
  const { store } = member;
  const resolved = await resolveOrderList(store.id, query);
  const [page, views, suggestions] = await Promise.all([
    listOrdersPage(store.id, resolved.params, resolved.context),
    listOrderViews(store.id),
    tagSuggestions(store.id),
  ]);
  const lang = adminLangOf(member.account.adminLocale);
  // Round 2 (D597): a picture of what is in each order on the page.
  const previews = await orderPreviews(store.id, page.rows.map((r) => r.id));
  const pictures = new Map(previews.map((p) => [p.id, p.lines.map(({ title, picture }) => ({ title, picture }))]));
  // Dates and totals in the store's own format for English, as before; another admin language writes them its own way.
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "en") : ADMIN_LANG_FACTS[lang].locale;
  const canWrite = memberCan(member, "orders:write");
  // Every country the store had, so past orders in a country no longer offered (D178) can still be found by it.
  const markets = [...new Map(store.allMarkets.map((m) => [m.code, { code: m.code, name: m.name }])).values()];
  return (
    <OrderListView
      slug={store.slug}
      params={resolved.params}
      rows={tableRowsOf(page.rows, { locale, timeZone: store.timeZone }).map((row) => ({ ...row, pictures: pictures.get(row.id) }))}
      toSend={toSend}
      count={page.count}
      capped={page.capped}
      hasPrevious={page.hasPrevious}
      previousCursor={page.previousCursor}
      nextCursor={page.nextCursor}
      views={views.map((v) => ({ id: v.id, title: v.title }))}
      openView={resolved.view}
      ignoredInView={resolved.ignored.length > 0}
      truncatedSearch={resolved.truncatedSearch}
      markets={markets}
      tagSuggestions={suggestions.map((s) => s.label)}
      canWrite={canWrite}
      words={adminText(lang, "orders")}
      statusWords={adminText(lang, "common").orderStatus}
      locale={lang === "en" ? "en" : ADMIN_LANG_FACTS[lang].locale}
      bulk={bulkOrdersAction.bind(null, store.slug)}
      viewActions={
        canWrite
          ? {
              save: saveOrderViewAction.bind(null, store.slug),
              update: updateOrderViewAction.bind(null, store.slug),
              remove: deleteOrderViewAction.bind(null, store.slug),
              reorder: reorderOrderViewsAction.bind(null, store.slug),
            }
          : null
      }
    />
  );
}
