import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { SubscriptionButton } from "@/components/subscription-button";
import { SubscriptionContentsForm } from "@/components/subscription-contents-form";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { t, type Messages } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { resolveShop } from "@/server/shop";
import { allowedChanges, getSubscriptionByToken, swapChoices, type SwapChoice } from "@/server/subscriptions";

import { changeMyContents } from "./actions";

type Props = PageProps<"/s/[store]/[market]/subscription/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * A shopper's subscription (D25, D29): what it holds and when it renews;
 * pausing, skipping and changing what comes next; and a one-click cancel
 * that lasts to the end of the paid period (or the commitment). Reached
 * from emails, the order page and My account by a link with a secret in it.
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
  const date = (iso: string) =>
    new Date(iso).toLocaleDateString(market.locale, { dateStyle: "long", timeZone: "Europe/Oslo" });
  const allowed = allowedChanges(subscription);
  const choices = allowed.contents ? await swapChoices(store.id, subscription.id) : new Map<string, SwapChoice[]>();
  const every = m.planEvery(subscription.interval, subscription.intervalCount);
  const base = marketPath(store.slug, market.slug);
  const now = new Date();
  const inTrial = subscription.trialEndsAt !== null && new Date(subscription.trialEndsAt) > now;
  const button = { store: store.slug, market: market.slug, token: subscription.manageToken };
  const busy = { busy: m.savingChange, failed: m.subscriptionChangeFailed };

  return (
    <>
      <h1 className="text-3xl font-heading tracking-tight">{m.subscription}</h1>
      <div role="status" className="flex flex-col gap-1">
        <p>
          <strong>{m.subscriptionStatus[subscription.status]}</strong> · {every} · {m.orderNumber} {subscription.number}
        </p>
        {subscription.endsAt ? (
          <p>{subscription.cancelAtPeriodEnd ? m.endsOn(date(subscription.endsAt)) : m.endsAt(date(subscription.endsAt))}</p>
        ) : subscription.pausedUntil && subscription.nextChargeAt ? (
          <p>{m.pausedUntil(date(subscription.nextChargeAt))}</p>
        ) : (
          subscription.nextChargeAt && <p>{m.nextRenewal(date(subscription.nextChargeAt))}</p>
        )}
        {inTrial && subscription.trialEndsAt && !subscription.endsAt && <p>{m.trialUntil(date(subscription.trialEndsAt))}</p>}
      </div>

      <section aria-label={m.subscription} className="rounded-lg border border-border p-4">
        <ul className="divide-y divide-border">
          {subscription.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-4 py-2">
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

      {(allowed.pause || allowed.skip || allowed.unpause) && (
        <section aria-labelledby="pause-heading" className="flex flex-col gap-3">
          <h2 id="pause-heading" className="text-xl font-heading">
            {m.pauseTitle}
          </h2>
          <div className="flex flex-wrap gap-3">
            {allowed.unpause && (
              <SubscriptionButton {...button} change="unpause" primary labels={{ action: m.resumeNow, ...busy }} />
            )}
            {allowed.skip && <SubscriptionButton {...button} change="skip" labels={{ action: m.skipNext, ...busy }} />}
            {allowed.pause &&
              [2, 3].map((periods) => (
                <SubscriptionButton
                  key={periods}
                  {...button}
                  change="pause"
                  periods={periods}
                  labels={{ action: m.pauseFor(periods), ...busy }}
                />
              ))}
          </div>
        </section>
      )}

      {allowed.contents && (
        <section aria-labelledby="change-heading" className="flex flex-col gap-3">
          <h2 id="change-heading" className="text-xl font-heading">
            {m.changeTitle}
          </h2>
          <p className="text-sm text-muted">{m.changeHelp}</p>
          <SubscriptionContentsForm
            action={changeMyContents.bind(null, store.slug, market.slug, subscription.manageToken)}
            maxQuantity={MAX_LINE_QUANTITY}
            lines={subscription.lines.map((line) => ({
              id: line.id,
              title: line.title,
              quantity: line.quantity,
              variantId: line.variantId,
              choices: (choices.get(line.id) ?? []).map((choice) => ({
                variantId: choice.variantId,
                label: choice.label,
                price: money(choice.unitPriceMinor),
              })),
            }))}
            labels={{
              variant: m.swapTo,
              quantity: m.quantity,
              remove: m.remove,
              save: m.saveChanges,
              saving: m.savingChange,
              saved: m.changesSaved,
              failed: m.subscriptionChangeFailed,
            }}
          />
        </section>
      )}

      {(allowed.cancel || allowed.resume) && (
        <section className="flex flex-col gap-3">
          {allowed.resume ? (
            <SubscriptionButton {...button} change="resume" primary labels={{ action: m.resumeSubscription, ...busy }} />
          ) : (
            <>
              <p className="text-sm text-muted">
                {subscription.commitmentEndsAt ? m.commitmentUntil(date(subscription.commitmentEndsAt)) : m.cancelHelp}
              </p>
              <SubscriptionButton
                {...button}
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
