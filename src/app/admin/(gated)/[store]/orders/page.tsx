import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { formatMoney } from "@/lib/money";
import { requireMember } from "@/server/auth";
import { ORDER_STATUS_LABELS as STATUS_LABELS } from "@/lib/order-status";
import { listOrders } from "@/server/orders";

export const metadata: Metadata = { title: "Orders" };

type Props = PageProps<"/admin/[store]/orders">;


export default async function OrdersPage({ params, searchParams }: Props) {
  const { store } = await requireMember((await params).store);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Orders</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-background" />}>
        <OrderList storeSlug={store.slug} searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function OrderList({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  const { store } = await requireMember(storeSlug);
  const show = (await searchParams).show;
  const unpaid = show === "unpaid";
  const toSend = show === "to-send";
  const orders = await listOrders(store.id, { unpaid, toSend });
  const locale = store.markets[0]?.locale ?? "en";
  const base = `/admin/${store.slug}/orders`;

  return (
    <>
      <nav aria-label="Order filters" className="flex gap-2 text-sm">
        <Link href={base} aria-current={unpaid || toSend ? undefined : "page"} className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold">
          Orders
        </Link>
        <Link href={`${base}?show=to-send`} aria-current={toSend ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold">
          To send
        </Link>
        <Link href={`${base}?show=unpaid`} aria-current={unpaid ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-background aria-[current=page]:font-semibold">
          Unfinished checkouts
        </Link>
        <Link href={`/admin/${store.slug}/emails`} className="ml-auto rounded px-2 py-1 underline">
          Emails to customers
        </Link>
      </nav>
      {orders.length === 0 ? (
        <p className="rounded-lg border border-border bg-background p-8 text-center text-sm">
          {unpaid
            ? "No unfinished checkouts."
            : toSend
              ? "Nothing to send: every paid order with something to ship has been sent."
              : "No orders yet. They appear here as soon as they are paid."}
        </p>
      ) : (
        <table className="w-full rounded-lg border border-border bg-background text-left text-sm">
          <thead>
            <tr className="border-b border-border">
              <th scope="col" className="px-4 py-2 font-medium">Order</th>
              <th scope="col" className="px-4 py-2 font-medium">Customer</th>
              <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Placed</th>
              <th scope="col" className="px-4 py-2 font-medium">Status</th>
              <th scope="col" className="px-4 py-2 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <Link href={`${base}/${order.id}`} className="font-medium underline-offset-2 hover:underline">
                    #{order.number}
                  </Link>
                  <span className="block text-xs text-muted">
                    {order.items} {order.items === 1 ? "item" : "items"}
                  </span>
                </td>
                <td className="px-4 py-2">{order.name || order.email || "–"}</td>
                <td className="hidden px-4 py-2 sm:table-cell">
                  <time dateTime={order.placedAt}>
                    {new Date(order.placedAt).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" })}
                  </time>
                </td>
                <td className="px-4 py-2">
                  {order.status === "cancelled" && !unpaid ? "Cancelled and refunded" : STATUS_LABELS[order.status]}
                </td>
                <td className="px-4 py-2 text-right">{formatMoney(order.totalMinor, order.currency, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
