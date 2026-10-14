import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { formatMoney } from "@/lib/money";
import { planSummary, renewalState, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { requirePermission } from "@/server/permissions";
import { listSubscriptions } from "@/server/subscriptions";
import { Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Subscriptions" };

const SUBSCRIPTION_SIGNAL = { pending: "insight", active: "positive", past_due: "danger", paused: "warning", cancelled: "neutral", expired: "neutral" } as const;

type Props = PageProps<"/admin/[store]/subscriptions">;

export default async function SubscriptionsPage({ params }: Props) {
  const current = await requirePermission((await params).store, "orders:read");
  const off = requireFeature(current, "subscriptions");
  if (off) return off;
  const { store } = current;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Subscriptions" />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-card" />}>
        <SubscriptionList storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function SubscriptionList({ storeSlug }: { storeSlug: string }) {
  const { store } = await requirePermission(storeSlug, "orders:read");
  const subscriptions = await listSubscriptions(store.id);
  const locale = store.markets[0]?.locale ?? "en";
  const base = `/admin/${store.slug}/subscriptions`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });

  if (subscriptions.length === 0) {
    return (
      <p className={`p-8 text-center text-sm ${CARD_CLASS}`}>
        No subscriptions yet. Offer one under a product&apos;s Subscriptions section; each shopper who
        subscribes appears here.
      </p>
    );
  }
  return (
    <Card compact>
      <List label="Subscriptions">
        {subscriptions.map((s) => {
          const state = s.status === "cancelled" ? null : renewalState(s);
          const when = state ? date(state.date.toISOString()) : null;
          return (
            <ListRow key={s.id}>
              <RowLead
                title={`#${s.number}`}
                href={`${base}/${s.id}`}
                sub={
                  <>
                    {planSummary({ interval: s.interval, intervalCount: s.intervalCount, discountPercent: 0 })} · {s.items}{" "}
                    {s.items === 1 ? "item" : "items"}
                  </>
                }
              />
              <RowFact className="hidden sm:block" sub={s.email && s.name ? s.email : undefined}>
                {s.email ? (
                  <Link href={`/admin/${store.slug}/customers/${s.id}`} className="underline-offset-2 hover:underline">
                    {s.name || s.email}
                  </Link>
                ) : (
                  "No customer yet"
                )}
              </RowFact>
              {state && when && (
                <RowFact className="hidden md:block">
                  {{ ends: `Ends ${when}`, paused: `Paused, then ${when}`, trial: `Trial, then ${when}`, renews: `Renews ${when}` }[state.kind]}
                </RowFact>
              )}
              <Chip signal={SUBSCRIPTION_SIGNAL[s.status]} dot>
                {SUBSCRIPTION_STATUS_LABELS[s.status]}
              </Chip>
              <RowAmount>{formatMoney(s.totalMinor, s.currency, locale)}</RowAmount>
            </ListRow>
          );
        })}
      </List>
    </Card>
  );
}
