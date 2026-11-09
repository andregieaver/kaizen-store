import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { Attention, Section, Stat, StatGrid, type AttentionItem } from "@/components/admin/overview-parts";
import { ShareBar } from "@/components/admin/ui/bars";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { formatMoney } from "@/lib/money";
import { platformAlertsFor } from "@/lib/platform-briefing";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { alertText, platformBriefingSetting, platformSnapshot } from "@/server/platform-briefing";
import { platformOverview } from "@/server/platform-overview";
import { cronJobRows } from "@/server/cron-runs";
import { jobsNeedingLook } from "@/lib/cron-health";
import { PageHeader } from "@/components/admin/ui";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

import { setBriefingAction } from "./plans/analytics/actions";

export const metadata: Metadata = { title: "Platform home" };

/**
 * The operator's first look at Kaizen (D107): what waits for them, this month's revenue, sales and sign-ups with the targets (D513), and the
 * state of stores, plans, email and AI; the morning briefing offered once.
 */
export default async function PlatformOverviewPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "platform").overview;
  const bw = adminText(lang, "platform").briefing;
  const [o, jobs, snapshot, briefing] = await Promise.all([platformOverview(), cronJobRows(), platformSnapshot(), platformBriefingSetting()]);
  const lateJobs = jobsNeedingLook(jobs);
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
  const signed = (minor: number, currency: string) => `${minor >= 0 ? "+" : "−"}${money(Math.abs(minor), currency)}`;
  // What the figures raise (D513) that the list below does not already say (requests and overdue plans are there).
  const alerts = platformAlertsFor(snapshot).filter((a) => a.id !== "requests_old" && a.id !== "late_payments");
  const mrr = snapshot.mrr[0];
  const sales = snapshot.sales[0];

  const attention: AttentionItem[] = [];
  if (o.requests.waiting > 0) {
    attention.push({
      text: `${countWords(o.requests.waiting, w.requests)}${o.requests.oldest ? fillWords(w.oldest, { date: o.requests.oldest.slice(0, 10) }) : ""}.`,
      href: "/admin/platform/requests",
      action: w.review,
      urgent: true,
    });
  }
  if (lateJobs.length > 0) {
    attention.push({ text: countWords(lateJobs.length, w.jobs), href: "/admin/platform/capacity#jobs", action: w.seeJobs, urgent: lateJobs.some((j) => j.health === "failing") });
  }
  if (o.stores.overdue > 0) attention.push({ text: countWords(o.stores.overdue, w.overdue), href: "/admin/platform/stores", action: w.openStores, urgent: true });
  if (o.emails.failed > 0) attention.push({ text: countWords(o.emails.failed, w.emailsFailed), href: "/admin/platform/emails", action: w.openEmails });
  if (o.stores.suspended > 0) attention.push({ text: countWords(o.stores.suspended, w.suspended), href: "/admin/platform/stores", action: w.openStores });
  if (o.stores.withoutPlan > 0) attention.push({ text: countWords(o.stores.withoutPlan, w.noPlan), href: "/admin/platform/stores", action: w.openStores });
  if (o.ai.failed > 0) attention.push({ text: countWords(o.ai.failed, w.aiFailed), href: "/admin/platform/ai/usage", action: w.seeAi });
  for (const alert of alerts) attention.push({ text: alertText(alert, lang), href: alert.href, action: w.review, urgent: alert.severity === "urgent" });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={w.description} />

      <Attention items={attention} empty={w.empty} />

      <Section id="month-heading" title={bw.thisMonth} action={<Link href="/admin/platform/plans/analytics" className="text-sm underline">{w.seeAnalytics}</Link>}>
        <StatGrid>
          <Stat
            label={bw.mrrLabel}
            value={mrr ? money(mrr.minor, mrr.currency) : "–"}
            sub={mrr ? fillWords(bw.mrrSub, { moved: signed(mrr.monthMovedMinor, mrr.currency) }) : bw.noMoney}
            href="/admin/platform/plans/analytics"
          />
          <Stat label={bw.paying} value={snapshot.paying} sub={snapshot.trialing > 0 ? fillWords(bw.payingSub, { n: snapshot.trialing }) : undefined} href="/admin/platform/stores" />
          <Stat
            label={bw.salesLabel}
            value={sales ? money(sales.monthMinor, sales.currency) : "–"}
            sub={sales ? fillWords(bw.salesSub, { amount: money(sales.lastMonthToDateMinor, sales.currency) }) : undefined}
            href="/admin/platform/plans/analytics"
          />
          <Stat label={bw.today} value={snapshot.signUpsToday.asked} sub={fillWords(bw.todaySub, { asked: snapshot.signUpsToday.asked, opened: snapshot.signUpsToday.opened })} href="/admin/platform/requests" />
        </StatGrid>
        {snapshot.targets.length > 0 && (
          <div className="mt-2 flex flex-col gap-3 rounded-panel border border-edge bg-card p-5">
            <h3 className="text-body-strong text-ink">{bw.targetsTitle}</h3>
            {snapshot.targets.map(({ target, progress }) => (
              <ShareBar
                key={target.id}
                label={`${bw.metrics[target.metric]}${target.currency ? ` (${target.currency})` : ""} · ${bw.status[progress.status]}`}
                figure={`${target.currency ? money(progress.actual, target.currency) : progress.actual} / ${target.currency ? money(target.targetValue, target.currency) : target.targetValue}`}
                share={Math.min(progress.pct, 100) / 100}
                signal={progress.status === "behind" ? "warning" : progress.status === "reached" || progress.status === "ahead" ? "positive" : "neutral"}
              />
            ))}
          </div>
        )}
      </Section>

      {briefing.offered && platformCan(account, "plans") && (
        <section aria-labelledby="briefing-offer" className="flex flex-col gap-3 rounded-panel border border-edge bg-card p-5">
          <h2 id="briefing-offer" className="text-body-strong text-ink">
            {bw.offerTitle}
          </h2>
          <p className="max-w-prose text-sm text-ink-2">{bw.offerText}</p>
          <div className="flex flex-wrap gap-2">
            {(["weekly", "daily", "dismiss"] as const).map((choice) => (
              <ActionForm key={choice} action={setBriefingAction}>
                <input type="hidden" name="briefing" value={choice} />
                <SubmitButton variant={choice === "weekly" ? undefined : "secondary"}>{choice === "dismiss" ? bw.notNow : bw[choice]}</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </section>
      )}

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
