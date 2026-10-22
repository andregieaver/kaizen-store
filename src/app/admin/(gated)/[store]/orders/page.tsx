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
import { PageHeader } from "@/components/admin/ui";

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
  const w = adminText(adminLangOf(member.account.adminLocale), "orders").page;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={w.title} />
        <nav aria-label={w.tools} className="flex flex-wrap gap-2 text-sm">
          {memberCan(member, "orders:write") && (
            <Link href={`/admin/${store.slug}/orders/drafts/new`} className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 font-medium text-brand-ink">
              {w.makeDraft}
            </Link>
          )}
          <Link href={`/admin/${store.slug}/orders/drafts`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4">
            {w.drafts}
          </Link>
          <Link href={`/admin/${store.slug}/emails`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4">
            {w.emails}
          </Link>
          {/* The order file (D165) holds personal data, so only the owner is offered it. */}
          {memberCan(member, "owner") && (
            <Link href={`/admin/${store.slug}/orders/export`} className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4">
              {w.export}
            </Link>
          )}
        </nav>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-card" />}>
        <OrderListBody storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function OrderListBody({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const member = await requirePermission(storeSlug, "orders:read");
  const { store } = member;
  const resolved = await resolveOrderList(store.id, await searchParams);
  const [page, views, suggestions] = await Promise.all([
    listOrdersPage(store.id, resolved.params, resolved.context),
    listOrderViews(store.id),
    tagSuggestions(store.id),
  ]);
  const lang = adminLangOf(member.account.adminLocale);
  // Dates and totals in the store's own format for English, as before; another admin language writes them its own way.
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "en") : ADMIN_LANG_FACTS[lang].locale;
  const canWrite = memberCan(member, "orders:write");
  // Every country the store had, so past orders in a country no longer offered (D178) can still be found by it.
  const markets = [...new Map(store.allMarkets.map((m) => [m.code, { code: m.code, name: m.name }])).values()];
  return (
    <OrderListView
      slug={store.slug}
      params={resolved.params}
      rows={tableRowsOf(page.rows, { locale, timeZone: store.timeZone })}
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
