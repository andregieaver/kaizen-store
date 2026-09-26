import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { fileSize } from "@/lib/file-size";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { getCustomer, ownsOrder } from "@/server/customers";
import { getOrderAdmin } from "@/server/order-admin";
import { getOrderDownloads } from "@/server/orders";
import { resolveShop } from "@/server/shop";
import { getSubscriptionForOrder } from "@/server/subscriptions";

type Props = PageProps<"/s/[store]/[market]/account/orders/[orderId]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** One of the customer's orders in My account (D28): what it held, where it is, and its downloads. */
export default function AccountOrderPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <AccountOrder params={params} />
      </Suspense>
    </div>
  );
}

async function AccountOrder({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, orderId } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const customer = await getCustomer(store.id);
  if (!customer) redirect(`${base}/account`);
  if (!z.uuid().safeParse(orderId).success || !(await ownsOrder(store.id, customer.id, orderId))) notFound();
  const [order, downloads, subscription] = await Promise.all([
    getOrderAdmin(store.id, orderId),
    getOrderDownloads(store.id, orderId),
    getSubscriptionForOrder(store.id, orderId),
  ]);
  if (!order) notFound();
  const m = t(market.lang);
  const a = m.account;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "long" });
  const address = order.shippingAddress;

  return (
    <>
      <Link href={`${base}/account`} className="text-sm underline">
        {a.backToAccount}
      </Link>
      <div>
        <h1 className="text-3xl font-heading tracking-tight">{a.order(order.number)}</h1>
        <p className="text-muted">
          {date(order.placedAt)} · {a.status[order.status] ?? order.status}
        </p>
      </div>

      {order.shipments.length > 0 && (
        <section className="flex flex-col gap-1 rounded-lg border border-border p-4">
          {order.shipments.map((s) => (
            <p key={s.id} className="flex flex-wrap items-center justify-between gap-3">
              <span>
                {date(s.createdAt)}: {s.carrier} {s.trackingNumber && <span className="font-mono">{s.trackingNumber}</span>}
              </span>
              {s.trackingUrl && (
                <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="underline">
                  {a.tracking}
                </a>
              )}
            </p>
          ))}
        </section>
      )}

      <section aria-label={m.orderSummary} className="rounded-lg border border-border p-4">
        <ul className="divide-y divide-border">
          {order.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-4 py-2">
              <span>
                {line.quantity} × {line.title}
                {line.delivery === "digital" && line.variantId && <span className="block text-sm text-muted">{m.digitalDelivery}</span>}
              </span>
              <span className="whitespace-nowrap">{money(line.unitPriceMinor * line.quantity)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          {order.ships && (
            <div className="flex justify-between">
              <dt>{m.shipping}</dt>
              <dd>{order.shippingMinor === 0 ? m.freeShipping : money(order.shippingMinor)}</dd>
            </div>
          )}
          {order.discountMinor > 0 && (
            <div className="flex justify-between">
              <dt>
                {m.discount}
                {order.discountCode && <span className="text-sm text-muted"> ({order.discountCode})</span>}
              </dt>
              <dd>−{money(order.discountMinor)}</dd>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <dt>{m.total}</dt>
            <dd>{money(order.totalMinor)}</dd>
          </div>
          <div className="flex justify-between text-sm text-muted">
            <dt>{m.vatAmount}</dt>
            <dd>{money(order.taxMinor)}</dd>
          </div>
          {order.refundedMinor > 0 && (
            <div className="flex justify-between text-sm">
              <dt>{a.refunded}</dt>
              <dd>−{money(order.refundedMinor)}</dd>
            </div>
          )}
        </dl>
      </section>

      {downloads.length > 0 && (
        <section aria-labelledby="downloads-heading" className="rounded-lg border border-border p-4">
          <h2 id="downloads-heading" className="mb-2 font-medium">{m.downloads}</h2>
          <ul className="divide-y divide-border">
            {downloads.map((file) => (
              <li key={file.token} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-medium">{file.name}</span>
                  <span className="block text-sm text-muted">
                    {[fileSize(file.sizeBytes), !file.gone && file.left !== null && m.downloadsLeft(file.left)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {file.gone ? (
                  <span className="max-w-sm text-sm">{m.downloadGone}</span>
                ) : (
                  <a
                    href={`${base}/download/${file.token}`}
                    className="inline-flex min-h-11 items-center button-primary px-5 text-sm font-medium"
                  >
                    {m.download}
                    <span className="sr-only">: {file.name}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {subscription && subscription.status !== "pending" && subscription.status !== "expired" && (
        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-1 font-medium">{m.subscription}</h2>
          <p>
            {m.planEvery(subscription.interval, subscription.intervalCount)} · {m.subscriptionStatus[subscription.status]}
          </p>
          <Link href={`${base}/subscription/${subscription.manageToken}`} className="mt-2 inline-block underline">
            {m.manageSubscription}
          </Link>
        </section>
      )}

      {order.ships && address.line1 && (
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
    </>
  );
}
