import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Attention, Section, Stat, StatGrid, type AttentionItem } from "@/components/admin/overview-parts";
import { requirePlatformAdmin } from "@/server/auth";
import { platformOverview } from "@/server/platform-overview";
import { PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Platform home" };

/** The operator's first look at Kaizen (D107): what waits for them, and the state of stores, plans, email and AI. */
export default async function PlatformOverviewPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformAdmin();
  const w = adminText(adminLangOf(account.adminLocale), "platform").overview;
  const o = await platformOverview();

  const attention: AttentionItem[] = [];
  if (o.requests.waiting > 0) {
    attention.push({
      text: `${countWords(o.requests.waiting, w.requests)}${o.requests.oldest ? fillWords(w.oldest, { date: o.requests.oldest.slice(0, 10) }) : ""}.`,
      href: "/admin/platform/requests",
      action: w.review,
      urgent: true,
    });
  }
  if (o.stores.overdue > 0) attention.push({ text: countWords(o.stores.overdue, w.overdue), href: "/admin/platform/stores", action: w.openStores, urgent: true });
  if (o.emails.failed > 0) attention.push({ text: countWords(o.emails.failed, w.emailsFailed), href: "/admin/platform/emails", action: w.openEmails });
  if (o.stores.suspended > 0) attention.push({ text: countWords(o.stores.suspended, w.suspended), href: "/admin/platform/stores", action: w.openStores });
  if (o.stores.withoutPlan > 0) attention.push({ text: countWords(o.stores.withoutPlan, w.noPlan), href: "/admin/platform/stores", action: w.openStores });
  if (o.ai.failed > 0) attention.push({ text: countWords(o.ai.failed, w.aiFailed), href: "/admin/platform/ai/usage", action: w.seeAi });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={w.description} />

      <Attention items={attention} empty={w.empty} />

      <Section id="numbers-heading" title={w.storesAndPlans} action={<Link href="/admin/platform/stores" className="text-sm underline">{w.allStores}</Link>}>
        <StatGrid>
          <Stat label={w.stores} value={o.stores.total} sub={o.stores.newThisWeek > 0 ? fillWords(w.newThisWeek, { n: o.stores.newThisWeek }) : w.noneNew} href="/admin/platform/stores" />
          <Stat label={w.paying} value={o.stores.paying} sub={o.stores.overdue > 0 ? fillWords(w.overdueSub, { n: o.stores.overdue }) : undefined} href="/admin/platform/stores" />
          <Stat label={w.notOpen} value={o.stores.notOpen} sub={w.setupNotFinished} href="/admin/platform/stores" />
          <Stat label={w.plansOnOffer} value={o.plans.total} href="/admin/platform/plans" />
        </StatGrid>
      </Section>

      <Section id="activity-heading" title={w.last7}>
        <StatGrid>
          <Stat label={w.requestsWaiting} value={o.requests.waiting} href="/admin/platform/requests" />
          <Stat label={w.emailsSent} value={o.emails.sent} sub={o.emails.failed > 0 ? fillWords(w.failedOrBounced, { n: o.emails.failed }) : w.noneFailed} href="/admin/platform/emails" />
          <Stat label={w.aiRequests} value={o.ai.requests} sub={o.ai.failed > 0 ? fillWords(w.failed, { n: o.ai.failed }) : w.noneFailed} href="/admin/platform/ai/usage" />
        </StatGrid>
      </Section>
    </div>
  );
}
