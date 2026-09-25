import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { CustomerBar, storeCustomerBar } from "@/components/admin/customer-bar";
import { SubscriptionActions, type StaffChange } from "@/components/admin/subscription-actions";
import { SubscriptionContentsForm } from "@/components/subscription-contents-form";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { planSummary, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { requireMember } from "@/server/auth";
import { customerSummary } from "@/server/customer-admin";
import type { OrderStatus } from "@/server/orders";
import { allowedChanges, getSubscription, swapChoices } from "@/server/subscriptions";

import { changeContentsAction } from "../actions";

export const metadata: Metadata = { title: "Subscription" };

export default async function SubscriptionPage({
  params,
}: PageProps<"/admin/[store]/subscriptions/[subscriptionId]">) {
  const { store: slug, subscriptionId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(subscriptionId).success) notFound();
  const [subscription, customer] = await Promise.all([
    getSubscription(store.id, subscriptionId),
    customerSummary(store.id, subscriptionId),
  ]);
  if (!subscription) notFound();
  const locale = store.markets[0]?.locale ?? subscription.locale;
  const money = (minor: number) => formatMoney(minor, subscription.currency, locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const live = ["active", "past_due", "paused"].includes(subscription.status);
  const allowed = allowedChanges(subscription);
  const choices = allowed.contents ? await swapChoices(store.id, subscription.id) : null;
  const changes: StaffChange[] = [
    ...(allowed.unpause ? [{ change: "unpause" as const }] : []),
    ...(allowed.skip ? [{ change: "skip" as const }] : []),
    ...(allowed.pause ? [{ change: "pause" as const, periods: 2 }, { change: "pause" as const, periods: 3 }] : []),
    ...(allowed.resume ? [{ change: "resume" as const }] : []),
    ...(allowed.cancel ? [{ change: "cancel" as const }] : []),
    ...(live ? [{ change: "cancel_now" as const }] : []),
  ];
  const trialRunning = subscription.trialEndsAt !== null && new Date(subscription.trialEndsAt) > new Date();

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

      {customer && <CustomerBar customer={storeCustomerBar(store.slug, customer, locale)} />}

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
                  <tr key={line.id} className="border-b border-border">
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
              The customer keeps these prices for as long as the subscription runs, unless the items are changed.
            </p>
          </section>

          {choices && (
            <section aria-labelledby="change" className="rounded-lg border border-border bg-background p-5 text-sm">
              <h2 id="change" className="mb-1 font-medium">Change the next deliveries</h2>
              <p className="mb-3 text-muted">
                A swapped item takes today&apos;s price with the purchase option&apos;s discount. Nothing is charged now; the
                customer is emailed.
              </p>
              <SubscriptionContentsForm
                action={changeContentsAction.bind(null, store.slug, subscription.id)}
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
                  variant: "Variant",
                  quantity: "Quantity",
                  remove: "Remove",
                  save: "Save changes",
                  saving: "Saving …",
                  saved: "Saved. The customer was emailed.",
                  failed: "The change could not be saved. Check it and try again.",
                }}
              />
            </section>
          )}

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
            <h2 id="customer" className="mb-2 font-medium">
              {customer ? (
                <Link href={`/admin/${store.slug}/customers/${customer.key}`} className="underline">
                  {customer.name || "Customer"}
                </Link>
              ) : (
                "Customer"
              )}
            </h2>
            {subscription.email ? (
              <a href={`mailto:${subscription.email}`} className="underline">{subscription.email}</a>
            ) : (
              <p className="text-muted">Not known until payment.</p>
            )}
          </section>
          <section aria-labelledby="renewal" className="rounded-lg border border-border bg-background p-5 text-sm">
            <h2 id="renewal" className="mb-2 font-medium">Renewal</h2>
            <ul className="mb-3 flex flex-col gap-1">
              <li>
                {!live
                  ? subscription.cancelledAt
                    ? `Ended ${date(subscription.cancelledAt)}.`
                    : "Not running."
                  : subscription.endsAt
                    ? `Ends ${date(subscription.endsAt)}${subscription.cancelAtPeriodEnd ? "" : ", when the commitment is met"}; no more charges.`
                    : subscription.nextChargeAt
                      ? `${subscription.pausedUntil ? "Paused. Next charge" : "Renews"} ${date(subscription.nextChargeAt)}.`
                      : "Renewal date not known yet."}
              </li>
              {trialRunning && subscription.trialEndsAt && <li>Free trial until {date(subscription.trialEndsAt)}.</li>}
              {subscription.minCycles > 0 && (
                <li>
                  Commitment: {subscription.paidCycles} of {subscription.minCycles} payments made
                  {subscription.commitmentEndsAt ? `, until ${date(subscription.commitmentEndsAt)}` : ""}.
                </li>
              )}
            </ul>
            {changes.length > 0 && (
              <SubscriptionActions storeSlug={store.slug} subscriptionId={subscription.id} changes={changes} />
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
