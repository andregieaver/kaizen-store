import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { CustomerBar, storeCustomerBar } from "@/components/admin/customer-bar";
import { SubscriptionActions, type StaffChange } from "@/components/admin/subscription-actions";
import { SubscriptionContentsForm } from "@/components/subscription-contents-form";
import { MAX_LINE_QUANTITY } from "@/lib/cart";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { planSummary, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { requirePermission } from "@/server/permissions";
import { customerSummary } from "@/server/customer-admin";
import type { OrderStatus } from "@/server/orders";
import { allowedChanges, getSubscription, swapChoices } from "@/server/subscriptions";
import { Card, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { changeContentsAction } from "../actions";

export const metadata: Metadata = { title: "Subscription" };

export default async function SubscriptionPage({
  params,
}: PageProps<"/admin/[store]/subscriptions/[subscriptionId]">) {
  const { store: slug, subscriptionId } = await params;
  const current = await requirePermission(slug, "orders:read");
  const off = requireFeature(current, "subscriptions");
  if (off) return off;
  const { store } = current;
  if (!z.uuid().safeParse(subscriptionId).success) notFound();
  const [subscription, customer] = await Promise.all([
    getSubscription(store.id, subscriptionId),
    customerSummary(store.id, subscriptionId),
  ]);
  if (!subscription) notFound();
  const lang = adminLangOf(current.account.adminLocale);
  const t = adminText(lang, "bookings").subscriptions;
  const w = t.page;
  const statuses = adminText(lang, "common").orderStatus;
  const locale = store.markets[0]?.locale ?? subscription.locale;
  const money = (minor: number) => formatMoney(minor, subscription.currency, locale);
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "en" ? locale : ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
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
      <PageHeader
        back={{ href: `/admin/${store.slug}/subscriptions`, label: t.title }}
        title={fillWords(w.title, { number: subscription.number })}
        description={<>{t.status[subscription.status] ?? SUBSCRIPTION_STATUS_LABELS[subscription.status]} ·{" "}{planSummary({ interval: subscription.interval, intervalCount: subscription.intervalCount, discountPercent: 0 })}{" "}· {fillWords(w.started, { date: date(subscription.createdAt) })} · {subscription.marketCode}</>}
      />

      {customer && <CustomerBar customer={storeCustomerBar(store.slug, customer, locale)} />}

      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <div className="flex flex-col gap-6">
          <Card title={w.each} compact>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th scope="col" className="py-2 font-medium">{w.product}</th>
                  <th scope="col" className="py-2 font-medium">SKU</th>
                  <th scope="col" className="py-2 text-right font-medium">{w.qty}</th>
                  <th scope="col" className="py-2 text-right font-medium">{w.total}</th>
                </tr>
              </thead>
              <tbody>
                {subscription.lines.map((line) => (
                  <tr key={line.id} className="border-b border-line">
                    <td className="py-2">
                      {line.title}
                      {line.delivery === "digital" && <span className="block text-xs text-muted">{w.digital}</span>}
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
                <div className="flex justify-between"><dt>{w.shipping}</dt><dd>{money(subscription.shippingMinor)}</dd></div>
              )}
              <div className="flex justify-between font-medium"><dt>{w.perRenewal}</dt><dd>{money(subscription.totalMinor)}</dd></div>
              <div className="flex justify-between text-muted"><dt>{w.vat}</dt><dd>{money(subscription.taxMinor)}</dd></div>
            </dl>
            <p className="mt-3 text-xs text-muted">
              {w.keepsPrices}
            </p>
          </Card>

          {choices && (
            <Card title={w.change} className="text-sm" compact>
              <p className="mb-3 text-muted">
                {w.changeHint}
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
                  variant: w.form.variant,
                  quantity: w.form.quantity,
                  remove: w.form.remove,
                  save: w.form.save,
                  saving: w.form.saving,
                  saved: w.form.saved,
                  failed: w.form.failed,
                }}
              />
            </Card>
          )}

          <Card title={w.orders} className="text-sm" compact>
            <ul className="flex flex-col gap-1">
              {subscription.orders.map((order) => (
                <li key={order.id} className="flex justify-between gap-4">
                  <Link href={`/admin/${store.slug}/orders/${order.id}`} className="underline">
                    #{order.number}
                  </Link>
                  <span className="text-muted">
                    {date(order.placedAt)} · {statuses[order.status as OrderStatus] ?? ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status} ·{" "}
                    {money(order.totalMinor)}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-6">
          <Card
            title={
              customer ? (
                <Link href={`/admin/${store.slug}/customers/${customer.key}`} className="underline">
                  {customer.name || w.customer}
                </Link>
              ) : (
                w.customer
              )
            }
            className="text-sm"
            compact
          >
            {subscription.email ? (
              <a href={`mailto:${subscription.email}`} className="underline">{subscription.email}</a>
            ) : (
              <p className="text-muted">{w.unknown}</p>
            )}
          </Card>
          <Card title={w.renewal} className="text-sm" compact>
            <ul className="mb-3 flex flex-col gap-1">
              <li>
                {!live
                  ? subscription.cancelledAt
                    ? fillWords(w.ended, { date: date(subscription.cancelledAt) })
                    : w.notRunning
                  : subscription.endsAt
                    ? fillWords(subscription.cancelAtPeriodEnd ? w.ends : w.endsCommitment, { date: date(subscription.endsAt) })
                    : subscription.nextChargeAt
                      ? fillWords(subscription.pausedUntil ? w.pausedNext : w.renews, { date: date(subscription.nextChargeAt) })
                      : w.unknownDate}
              </li>
              {trialRunning && subscription.trialEndsAt && <li>{fillWords(w.trial, { date: date(subscription.trialEndsAt) })}</li>}
              {subscription.minCycles > 0 && (
                <li>
                  {subscription.commitmentEndsAt
                    ? fillWords(w.commitmentUntil, { paid: subscription.paidCycles, of: subscription.minCycles, date: date(subscription.commitmentEndsAt) })
                    : fillWords(w.commitment, { paid: subscription.paidCycles, of: subscription.minCycles })}
                </li>
              )}
            </ul>
            {changes.length > 0 && (
              <SubscriptionActions storeSlug={store.slug} subscriptionId={subscription.id} changes={changes} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
