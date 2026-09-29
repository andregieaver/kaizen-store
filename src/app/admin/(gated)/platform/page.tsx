import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { Attention, Section, Stat, StatGrid, type AttentionItem } from "@/components/admin/overview-parts";
import { requirePlatformAdmin } from "@/server/auth";
import { platformOverview } from "@/server/platform-overview";

export const metadata: Metadata = { title: "Platform overview" };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The operator's first look at Kaizen (D107): what waits for them, and the state of stores, plans, email and AI. */
export default async function PlatformOverviewPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const o = await platformOverview();

  const attention: AttentionItem[] = [];
  if (o.requests.waiting > 0) {
    attention.push({
      text: `${plural(o.requests.waiting, "access request is", "access requests are")} waiting${o.requests.oldest ? `, the oldest since ${o.requests.oldest.slice(0, 10)}` : ""}.`,
      href: "/admin/platform/requests",
      action: "Review",
      urgent: true,
    });
  }
  if (o.stores.overdue > 0) attention.push({ text: `${plural(o.stores.overdue, "store has", "stores have")} an overdue plan payment.`, href: "/admin/platform/stores", action: "Open stores", urgent: true });
  if (o.emails.failed > 0) attention.push({ text: `${plural(o.emails.failed, "email", "emails")} failed or bounced in the last 7 days.`, href: "/admin/platform/emails", action: "Open emails" });
  if (o.stores.suspended > 0) attention.push({ text: `${plural(o.stores.suspended, "store is", "stores are")} suspended.`, href: "/admin/platform/stores", action: "Open stores" });
  if (o.stores.withoutPlan > 0) attention.push({ text: `${plural(o.stores.withoutPlan, "store has", "stores have")} no plan.`, href: "/admin/platform/stores", action: "Open stores" });
  if (o.ai.failed > 0) attention.push({ text: `${plural(o.ai.failed, "AI request", "AI requests")} failed in the last 7 days.`, href: "/admin/platform/ai/usage", action: "See AI usage" });

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-muted">How Kaizen is doing, and what needs the team.</p>
      </div>

      <Attention items={attention} empty="Nothing is waiting. No requests, overdue plans or failed emails." />

      <Section id="numbers-heading" title="Stores and plans" action={<Link href="/admin/platform/stores" className="text-sm underline">All stores</Link>}>
        <StatGrid>
          <Stat label="Stores" value={o.stores.total} sub={o.stores.newThisWeek > 0 ? `${o.stores.newThisWeek} new this week` : "None new this week"} href="/admin/platform/stores" />
          <Stat label="On a paying plan" value={o.stores.paying} sub={o.stores.overdue > 0 ? `${o.stores.overdue} overdue` : undefined} href="/admin/platform/stores" />
          <Stat label="Not open yet" value={o.stores.notOpen} sub="Setup not finished" href="/admin/platform/stores" />
          <Stat label="Plans on offer" value={o.plans.total} href="/admin/platform/plans" />
        </StatGrid>
      </Section>

      <Section id="activity-heading" title="Last 7 days">
        <StatGrid>
          <Stat label="Access requests waiting" value={o.requests.waiting} href="/admin/platform/requests" />
          <Stat label="Emails sent" value={o.emails.sent} sub={o.emails.failed > 0 ? `${o.emails.failed} failed or bounced` : "None failed"} href="/admin/platform/emails" />
          <Stat label="AI requests" value={o.ai.requests} sub={o.ai.failed > 0 ? `${o.ai.failed} failed` : "None failed"} href="/admin/platform/ai/usage" />
        </StatGrid>
      </Section>
    </div>
  );
}
