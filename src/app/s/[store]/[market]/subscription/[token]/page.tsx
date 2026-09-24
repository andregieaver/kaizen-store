import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SubscriptionButton } from "@/components/subscription-button";
import { t, type Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { resolveShop } from "@/server/shop";
import { getSubscriptionByToken } from "@/server/subscriptions";

type Props = PageProps<"/s/[store]/[market]/subscription/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A shopper's subscription (D25): what it holds, when it renews, and a
 * one-click cancel that lasts to the end of the paid period. Reached from
 * the order page by a link with a secret in it.
 */
export default function SubscriptionPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <Details params={params} />
      </Suspense>
    </div>
  );
}

/** Everything here depends on the link's secret, so it all renders per request. */
async function Details({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const m: Messages = t(market.lang);
  const subscription = /^[0-9a-f]{64}$/.test(token) ? await getSubscriptionByToken(store.id, token) : null;
  if (!subscription) notFound();
  const money = (minor: number) => formatMoney(minor, subscription.currency, market.locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(market.locale, { dateStyle: "long" });
  const live = subscription.status === "active" || subscription.status === "past_due" || subscription.status === "paused";
  const every = m.planEvery(subscription.interval, subscription.intervalCount);
  const base = marketPath(store.slug, market.slug);

  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">{m.subscription}</h1>
      <div role="status" className="flex flex-col gap-1">
        <p>
          <strong>{m.subscriptionStatus[subscription.status]}</strong> · {every} · {m.orderNumber} {subscription.number}
        </p>
        {live && subscription.currentPeriodEnd && (
          <p>
            {subscription.cancelAtPeriodEnd
              ? m.endsOn(date(subscription.currentPeriodEnd))
              : m.nextRenewal(date(subscription.currentPeriodEnd))}
          </p>
        )}
      </div>

      <section aria-label={m.subscription} className="rounded-lg border border-border p-4">
        <ul className="divide-y divide-border">
          {subscription.lines.map((line) => (
            <li key={line.sku} className="flex justify-between gap-4 py-2">
              <span>
                {line.quantity} × {line.title}
                {line.delivery === "digital" && <span className="block text-sm text-muted">{m.digitalDelivery}</span>}
              </span>
              <span>{money(line.totalMinor)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          {subscription.shippingMinor > 0 && (
            <div className="flex justify-between">
              <dt>
                {m.shipping} <span className="text-sm text-muted">{m.perDelivery}</span>
              </dt>
              <dd>{money(subscription.shippingMinor)}</dd>
            </div>
          )}
          <div className="flex justify-between font-semibold">
            <dt>{m.perRenewal}</dt>
            <dd>{money(subscription.totalMinor)}</dd>
          </div>
          <div className="flex justify-between text-sm text-muted">
            <dt>{m.vatAmount}</dt>
            <dd>{money(subscription.taxMinor)}</dd>
          </div>
        </dl>
      </section>

      {live && (
        <section className="flex flex-col gap-3">
          {subscription.cancelAtPeriodEnd ? (
            <SubscriptionButton
              store={store.slug}
              market={market.slug}
              token={subscription.manageToken}
              change="resume"
              labels={{ action: m.resumeSubscription, busy: m.savingChange, failed: m.subscriptionChangeFailed }}
            />
          ) : (
            <>
              <p className="text-sm text-muted">{m.cancelHelp}</p>
              <SubscriptionButton
                store={store.slug}
                market={market.slug}
                token={subscription.manageToken}
                change="cancel"
                labels={{ action: m.cancelSubscription, busy: m.cancelling, failed: m.subscriptionChangeFailed }}
              />
            </>
          )}
        </section>
      )}

      <Link href={base} className="underline">
        {m.continueShopping}
      </Link>
    </>
  );
}
