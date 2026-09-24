import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { RefreshOnce, RefreshWhile } from "@/components/refresh-while";
import { t, type Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { getShopperOrder } from "@/server/orders";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/order/[orderId]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Everything here depends on the order in the address, so it all renders per request. */
export default function OrderPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
      <OrderDetails params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function OrderDetails({
  params,
  searchParams,
}: {
  params: Props["params"];
  searchParams: Props["searchParams"];
}) {
  const { store: storeSlug, market: marketSlug, orderId } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const sessionId = (await searchParams).session_id;
  if (!z.uuid().safeParse(orderId).success || typeof sessionId !== "string") notFound();
  const order = await getShopperOrder(store.id, orderId, sessionId);
  if (!order) notFound();
  const m: Messages = t(market.lang);
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const address = order.shippingAddress;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <RefreshWhile waiting={order.status === "pending_payment"} />
      {/* The paid order has emptied the cart; show the header without it. */}
      {order.status !== "pending_payment" && <RefreshOnce id={`order:${order.id}:${order.status}`} />}
      <div role="status" aria-live="polite">
        <h1 className="text-3xl font-semibold tracking-tight">
          {order.status === "cancelled" ? m.orderCancelled : m.thanks}
        </h1>
        {order.status === "pending_payment" && <p className="mt-2">{m.paymentPending}</p>}
      </div>
      <p>
        {m.orderNumber}: <strong>{order.number}</strong>. {order.status !== "cancelled" && m.keepNumber}
      </p>

      <section aria-label={m.cart} className="rounded-lg border border-border p-4">
        <ul className="divide-y divide-border">
          {order.lines.map((line) => (
            <li key={line.sku} className="flex justify-between gap-4 py-2">
              <span>
                {line.quantity} × {line.title}
              </span>
              <span>{money(line.totalMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          <div className="flex justify-between">
            <dt>{m.shipping}</dt>
            <dd>{order.shippingMinor === 0 ? m.freeShipping : money(order.shippingMinor)}</dd>
          </div>
          <div className="flex justify-between font-semibold">
            <dt>{m.total}</dt>
            <dd>{money(order.totalMinor)}</dd>
          </div>
          <div className="flex justify-between text-sm text-muted">
            <dt>{m.vatAmount}</dt>
            <dd>{money(order.taxMinor)}</dd>
          </div>
        </dl>
      </section>

      {address.line1 && (
        <section>
          <h2 className="mb-1 font-medium">{m.deliverTo}</h2>
          <address className="not-italic">
            {[address.name, address.line1, address.line2, `${address.postalCode ?? ""} ${address.city ?? ""}`]
              .filter((part) => part && part.trim())
              .map((part) => (
                <span key={part} className="block">
                  {part}
                </span>
              ))}
          </address>
        </section>
      )}

      <Link href={marketPath(store.slug, market.slug)} className="underline">
        {m.continueShopping}
      </Link>
    </div>
  );
}
