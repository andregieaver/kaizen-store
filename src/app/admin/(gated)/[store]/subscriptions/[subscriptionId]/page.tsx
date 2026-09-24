import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { SubscriptionActions } from "@/components/admin/subscription-actions";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { planSummary, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { requireMember } from "@/server/auth";
import type { OrderStatus } from "@/server/orders";
import { getSubscription } from "@/server/subscriptions";

export const metadata: Metadata = { title: "Subscription" };

export default async function SubscriptionPage({
  params,
}: PageProps<"/admin/[store]/subscriptions/[subscriptionId]">) {
  const { store: slug, subscriptionId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(subscriptionId).success) notFound();
  const subscription = await getSubscription(store.id, subscriptionId);
  if (!subscription) notFound();
  const locale = store.markets[0]?.locale ?? subscription.locale;
  const money = (minor: number) => formatMoney(minor, subscription.currency, locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const live = ["active", "past_due", "paused"].includes(subscription.status);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/subscriptions`} className="text-sm underline">
          Subscriptions
        </Link>
        <h1 className="text-2xl font-semibold">Subscription #{subscription.number}</h1>
        <p className="text-sm text-muted">
          {SUBSCRIPTION_STATUS_LABELS[subscription.status]} ·{" "}
          {planSummary({ interval: subscription.interval, intervalCount: subscription.intervalCount, discountPercent: 0 })}{" "}
          · started {date(subscription.createdAt)} · {subscription.marketCode}
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-6">
          <section aria-labelledby="items" className="rounded-lg border border-border bg-background p-5">
            <h2 id="items" className="mb-3 font-medium">Each renewal</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 font-medium">Product</th>
                  <th scope="col" className="py-2 font-medium">SKU</th>
                  <th scope="col" className="py-2 text-right font-medium">Qty</th>
                  <th scope="col" className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {subscription.lines.map((line) => (
                  <tr key={line.sku} className="border-b border-border">
                    <td className="py-2">
                      {line.title}
                      {line.delivery === "digital" && <span className="block text-xs text-muted">Digital download</span>}
                    </td>
                    <td className="py-2 font-mono text-xs">{line.sku}</td>
                    <td className="py-2 text-right">{line.quantity}</td>
                    <td className="py-2 text-right">{money(line.totalMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="mt-3 flex flex-col gap-1 text-sm">
              {subscription.shippingMinor > 0 && (
                <div className="flex justify-between"><dt>Shipping per delivery</dt><dd>{money(subscription.shippingMinor)}</dd></div>
              )}
              <div className="flex justify-between font-semibold"><dt>Total per renewal</dt><dd>{money(subscription.totalMinor)}</dd></div>
              <div className="flex justify-between text-muted"><dt>VAT included</dt><dd>{money(subscription.taxMinor)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              The customer keeps these prices for as long as the subscription runs.
            </p>
          </section>

          <section aria-labelledby="orders" className="rounded-lg border border-border bg-background p-5 text-sm">
            <h2 id="orders" className="mb-2 font-medium">Orders</h2>
            <ul className="flex flex-col gap-1">
              {subscription.orders.map((order) => (
                <li key={order.id} className="flex justify-between gap-4">
                  <Link href={`/admin/${store.slug}/orders/${order.id}`} className="underline">
                    #{order.number}
                  </Link>
                  <span className="text-muted">
                    {date(order.placedAt)} · {ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status} ·{" "}
                    {money(order.totalMinor)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="customer" className="rounded-lg border border-border bg-background p-5 text-sm">
            <h2 id="customer" className="mb-2 font-medium">Customer</h2>
            {subscription.email ? (
              <a href={`mailto:${subscription.email}`} className="underline">{subscription.email}</a>
            ) : (
              <p className="text-muted">Not known until payment.</p>
            )}
          </section>
          <section aria-labelledby="renewal" className="rounded-lg border border-border bg-background p-5 text-sm">
            <h2 id="renewal" className="mb-2 font-medium">Renewal</h2>
            <p className="mb-3">
              {!live
                ? subscription.cancelledAt
                  ? `Ended ${date(subscription.cancelledAt)}.`
                  : "Not running."
                : subscription.currentPeriodEnd
                  ? subscription.cancelAtPeriodEnd
                    ? `Ends ${date(subscription.currentPeriodEnd)}; no more charges.`
                    : `Renews ${date(subscription.currentPeriodEnd)}.`
                  : "Renewal date not known yet."}
            </p>
            {live && (
              <SubscriptionActions
                storeSlug={store.slug}
                subscriptionId={subscription.id}
                changes={subscription.cancelAtPeriodEnd ? ["resume", "cancel_now"] : ["cancel", "cancel_now"]}
              />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
