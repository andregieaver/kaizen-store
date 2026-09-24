import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { formatMoney } from "@/lib/money";
import { planSummary, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { requireMember } from "@/server/auth";
import { listSubscriptions } from "@/server/subscriptions";

export const metadata: Metadata = { title: "Subscriptions" };

type Props = PageProps<"/admin/[store]/subscriptions">;

export default async function SubscriptionsPage({ params }: Props) {
  const { store } = await requireMember((await params).store);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Subscriptions</h1>
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-background" />}>
        <SubscriptionList storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function SubscriptionList({ storeSlug }: { storeSlug: string }) {
  const { store } = await requireMember(storeSlug);
  const subscriptions = await listSubscriptions(store.id);
  const locale = store.markets[0]?.locale ?? "en";
  const base = `/admin/${store.slug}/subscriptions`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });

  if (subscriptions.length === 0) {
    return (
      <p className="rounded-lg border border-border bg-background p-8 text-center text-sm">
        No subscriptions yet. Offer one under a product&apos;s Subscriptions section; each shopper who
        subscribes appears here.
      </p>
    );
  }
  return (
    <table className="w-full rounded-lg border border-border bg-background text-left text-sm">
      <thead>
        <tr className="border-b border-border">
          <th scope="col" className="px-4 py-2 font-medium">Subscription</th>
          <th scope="col" className="px-4 py-2 font-medium">Customer</th>
          <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Next renewal</th>
          <th scope="col" className="px-4 py-2 font-medium">Status</th>
          <th scope="col" className="px-4 py-2 text-right font-medium">Each renewal</th>
        </tr>
      </thead>
      <tbody>
        {subscriptions.map((s) => (
          <tr key={s.id} className="border-b border-border last:border-0">
            <td className="px-4 py-2">
              <Link href={`${base}/${s.id}`} className="font-medium underline-offset-2 hover:underline">
                #{s.number}
              </Link>
              <span className="block text-xs text-muted">
                {planSummary({ interval: s.interval, intervalCount: s.intervalCount, discountPercent: 0 })} ·{" "}
                {s.items} {s.items === 1 ? "item" : "items"}
              </span>
            </td>
            <td className="px-4 py-2">{s.name || s.email || "–"}</td>
            <td className="hidden px-4 py-2 sm:table-cell">
              {s.status === "cancelled" || !s.currentPeriodEnd
                ? "–"
                : s.cancelAtPeriodEnd
                  ? `Ends ${date(s.currentPeriodEnd)}`
                  : date(s.currentPeriodEnd)}
            </td>
            <td className="px-4 py-2">{SUBSCRIPTION_STATUS_LABELS[s.status]}</td>
            <td className="px-4 py-2 text-right">{formatMoney(s.totalMinor, s.currency, locale)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
