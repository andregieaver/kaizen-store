import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { requireFeature } from "@/components/admin/feature-off";
import { formatMoney } from "@/lib/money";
import { planSummary, renewalState, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { requirePermission } from "@/server/permissions";
import { listSubscriptions } from "@/server/subscriptions";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Subscriptions" };

const SUBSCRIPTION_SIGNAL = { pending: "insight", active: "positive", past_due: "danger", paused: "warning", cancelled: "neutral", expired: "neutral" } as const;

type Props = PageProps<"/admin/[store]/subscriptions">;

export default async function SubscriptionsPage({ params }: Props) {
  const current = await requirePermission((await params).store, "orders:read");
  const off = requireFeature(current, "subscriptions");
  if (off) return off;
  const { store } = current;
  const w = adminText(adminLangOf(current.account.adminLocale), "bookings").subscriptions;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={w.title} />
      <Suspense fallback={<div className="h-40 animate-pulse rounded-lg bg-card" />}>
        <SubscriptionList storeSlug={store.slug} />
      </Suspense>
    </div>
  );
}

async function SubscriptionList({ storeSlug }: { storeSlug: string }) {
  const member = await requirePermission(storeSlug, "orders:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const w = adminText(lang, "bookings").subscriptions;
  const subscriptions = await listSubscriptions(store.id);
  const locale = store.markets[0]?.locale ?? "en";
  const base = `/admin/${store.slug}/subscriptions`;
  const date = (iso: string) => new Date(iso).toLocaleDateString(lang === "en" ? locale : ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });

  if (subscriptions.length === 0) {
    return (
      <p className={`p-8 text-center text-sm ${CARD_CLASS}`}>
        {w.none}
      </p>
    );
  }
  return (
    <Card compact>
      <List label={w.title}>
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
                    {planSummary({ interval: s.interval, intervalCount: s.intervalCount, discountPercent: 0 })} · {countWords(s.items, w.items)}
                  </>
                }
              />
              <RowFact className="hidden sm:block" sub={s.email && s.name ? s.email : undefined}>
                {s.email ? (
                  <Link href={`/admin/${store.slug}/customers/${s.id}`} className="underline-offset-2 hover:underline">
                    {s.name || s.email}
                  </Link>
                ) : (
                  w.noCustomer
                )}
              </RowFact>
              {state && when && (
                <RowFact className="hidden md:block">
                  {fillWords(w.when[state.kind], { when })}
                </RowFact>
              )}
              <Chip signal={SUBSCRIPTION_SIGNAL[s.status]} dot>
                {w.status[s.status] ?? SUBSCRIPTION_STATUS_LABELS[s.status]}
              </Chip>
              <RowAmount>{formatMoney(s.totalMinor, s.currency, locale)}</RowAmount>
            </ListRow>
          );
        })}
      </List>
    </Card>
  );
}
