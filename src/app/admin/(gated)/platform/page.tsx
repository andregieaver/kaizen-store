import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { AskCard } from "@/components/admin/home/ask-card";
import { DotChip, HomeCard, HomeColumns, HomeHeader, Initials, LinkRow, NextUp } from "@/components/admin/home/home-parts";
import type { AttentionItem } from "@/components/admin/overview-parts";
import { CARD_CLASS } from "@/components/admin/ui/card";
import { firstName, partOfDay, whenWords } from "@/lib/home";
import { mrrByMonth, signUpFunnel, waitingRequests } from "@/server/platform-home";
import { ShareBar } from "@/components/admin/ui/bars";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import { formatMoney } from "@/lib/money";
import { platformAlertsFor } from "@/lib/platform-briefing";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { alertText, platformBriefingSetting, platformSnapshot } from "@/server/platform-briefing";
import { platformOverview } from "@/server/platform-overview";
import { cronJobRows } from "@/server/cron-runs";
import { failedWebhookEvents } from "@/server/stripe-webhooks";
import { jobsNeedingLook } from "@/lib/cron-health";
import { AdminLink } from "@/components/admin/ui";
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
  const [o, jobs, snapshot, briefing, failedEvents] = await Promise.all([
    platformOverview(),
    cronJobRows(),
    platformSnapshot(),
    platformBriefingSetting(),
    failedWebhookEvents(),
  ]);
  const lateJobs = jobsNeedingLook(jobs);
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
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
  if (failedEvents > 0) attention.push({ text: countWords(failedEvents, w.paymentEvents), href: "/admin/platform/stripe", action: w.seeStripe, urgent: true });
  if (o.stores.overdue > 0) attention.push({ text: countWords(o.stores.overdue, w.overdue), href: "/admin/platform/stores", action: w.openStores, urgent: true });
  if (o.emails.failed > 0) attention.push({ text: countWords(o.emails.failed, w.emailsFailed), href: "/admin/platform/emails", action: w.openEmails });
  if (o.stores.suspended > 0) attention.push({ text: countWords(o.stores.suspended, w.suspended), href: "/admin/platform/stores", action: w.openStores });
  if (o.stores.withoutPlan > 0) attention.push({ text: countWords(o.stores.withoutPlan, w.noPlan), href: "/admin/platform/stores", action: w.openStores });
  if (o.ai.failed > 0) attention.push({ text: countWords(o.ai.failed, w.aiFailed), href: "/admin/platform/ai/usage", action: w.seeAi });
  for (const alert of alerts) attention.push({ text: alertText(alert, lang), href: alert.href, action: w.review, urgent: alert.severity === "urgent" });

  // Kaizena Flow's own Home in the store's pattern (admin redesign round 1, step 3, D595): a greeting and one sentence, the one next step,
  // recurring revenue as bars, the funnel from sign-up to paying, and the system's health apart from the business.
  const t = w.today;
  const home = adminText(lang, "home").today;
  const now = new Date();
  const zone = "Europe/Oslo";
  const [requests, months, funnel] = await Promise.all([
    o.requests.waiting > 0 ? waitingRequests(4) : Promise.resolve([]),
    mrr ? mrrByMonth(mrr.currency, mrr.minor, 6, now) : Promise.resolve([]),
    signUpFunnel(6, now),
  ]);
  const name = firstName(account.name);
  const lastMonthMrr = mrr ? mrr.minor - mrr.monthMovedMinor : 0;
  const mrrPct = mrr && lastMonthMrr > 0 ? Math.round((mrr.monthMovedMinor / lastMonthMrr) * 100) : null;
  const show = (minor: number, currency: string) => formatMoney(minor, currency, locale, { decimals: "hide_whole" });
  const lead = o.requests.waiting > 0 ? countWords(o.requests.waiting, t.requestsLead) : null;
  const rest = !mrr
    ? t.noMrr
    : mrrPct === null || mrrPct === 0
      ? fillWords(t.mrrFlat, { amount: show(mrr.minor, mrr.currency) })
      : fillWords(mrrPct > 0 ? t.mrrUp : t.mrrDown, { amount: show(mrr.minor, mrr.currency), n: Math.abs(mrrPct) });
  const healthy = lateJobs.length === 0 && failedEvents === 0 && o.emails.failed === 0 && o.ai.failed === 0;
  const needs = attention.filter((item) => !(o.requests.waiting > 0 && item.href === "/admin/platform/requests" && item === attention[0]));
  const maxMonth = Math.max(1, ...months.map((m) => m.minor));
  const targetsOfMrr = snapshot.targets.find(({ target }) => target.metric === "mrr" && target.currency === mrr?.currency);
  const scaleTop = Math.max(maxMonth, targetsOfMrr ? targetsOfMrr.target.targetValue : 0);
  const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString(locale, { month: "short", timeZone: "UTC" });

  const nextUp =
    requests.length > 0 ? (
      <NextUp
        eyebrow={home.nextUp}
        title={countWords(o.requests.waiting, t.answerRequests)}
        text={fillWords(t.oldestRequest, { when: whenWords(requests[0].createdAt, now, zone, home.when) })}
        action={platformCan(account, "stores") ? { href: "/admin/platform/requests", label: t.reviewRequests } : undefined}
      >
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(220px,100%),1fr))]">
          {requests.map((request) => (
            <li key={request.id} className="flex items-center gap-3 rounded-card bg-sunken p-4">
              <Initials name={request.name} size={44} strong />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-strong text-ink">{request.storeName}</span>
                <span className="truncate text-caption text-muted">{request.name}</span>
                <span className="text-caption text-ink-2">{fillWords(t.since, { when: whenWords(request.createdAt, now, zone, home.when) })}</span>
              </span>
            </li>
          ))}
        </ul>
      </NextUp>
    ) : needs[0] ? (
      <NextUp eyebrow={home.nextUp} title={needs[0].text} action={{ href: needs[0].href, label: needs[0].action }} />
    ) : (
      <NextUp eyebrow={home.nextUp} title={home.caughtUp} text={w.empty} />
    );
  const restNeeds = requests.length > 0 ? needs : needs.slice(1);

  return (
    <div className="flex flex-col gap-6">
      <HomeHeader
        eyebrow={fillWords(t.eyebrow, { date: now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long", timeZone: zone }) })}
        title={name ? fillWords(home.greeting[partOfDay(now, zone)], { name }) : w.title}
        lead={lead}
        rest={rest}
        chips={healthy ? <DotChip tone="positive">{t.running}</DotChip> : <DotChip tone="warning">{t.needsLook}</DotChip>}
      />
      <HomeColumns
        main={
          <>
            {nextUp}
            {mrr && months.length > 0 && (
              <section aria-labelledby="mrr-heading" className={`${CARD_CLASS} flex flex-col gap-5 p-6 sm:p-7`}>
                <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                  <div className="flex flex-col gap-1.5">
                    <h2 id="mrr-heading" className="text-title text-ink">
                      {t.mrr}
                    </h2>
                    <div className="flex flex-wrap items-baseline gap-3">
                      <span className="text-metric-lg text-ink">{show(mrr.minor, mrr.currency)}</span>
                      <span className="text-body text-muted">{t.aMonth}</span>
                      {mrrPct !== null && mrrPct !== 0 && (
                        <span className={`inline-flex h-6.5 items-center rounded-pill px-2.5 text-caption ${mrrPct > 0 ? "bg-positive-soft text-positive-text" : "bg-warning-soft text-warning-text"}`}>
                          {fillWords(t.onLastMonth, { sign: mrrPct > 0 ? "+" : "−", n: Math.abs(mrrPct) })}
                        </span>
                      )}
                    </div>
                  </div>
                  <dl className="flex gap-8">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-caption text-muted">{t.paying}</dt>
                      <dd className="text-metric text-ink">{snapshot.paying}</dd>
                      {snapshot.trialing > 0 && <dd className="text-caption text-muted">{fillWords(t.onTrial, { n: snapshot.trialing })}</dd>}
                    </div>
                    {sales && (
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-caption text-muted">{bw.salesLabel}</dt>
                        <dd className="text-metric text-ink">{show(sales.monthMinor, sales.currency)}</dd>
                        <dd className="text-caption text-muted">{fillWords(bw.salesSub, { amount: money(sales.lastMonthToDateMinor, sales.currency) })}</dd>
                      </div>
                    )}
                    {snapshot.paying > 0 && (
                      <div className="flex flex-col gap-0.5">
                        <dt className="text-caption text-muted">{t.averagePlan}</dt>
                        <dd className="text-metric text-ink">{show(Math.round(mrr.minor / snapshot.paying), mrr.currency)}</dd>
                        <dd className="text-caption text-muted">{t.aMonth}</dd>
                      </div>
                    )}
                  </dl>
                </div>
                <div
                  role="img"
                  aria-label={fillWords(t.chartLabel, { from: show(months[0].minor, mrr.currency), to: show(months[months.length - 1].minor, mrr.currency) })}
                  className="flex flex-col gap-2"
                >
                  <div className="relative grid h-52 grid-cols-6 items-end gap-3 border-b border-line sm:gap-4">
                    {targetsOfMrr && (
                      <>
                        <div aria-hidden className="absolute inset-x-0 border-t-2 border-dashed border-faint" style={{ bottom: Math.round((targetsOfMrr.target.targetValue / scaleTop) * 180) }} />
                        <span className="absolute right-0 bg-card pl-2 text-caption text-ink-2" style={{ bottom: Math.round((targetsOfMrr.target.targetValue / scaleTop) * 180) + 4 }}>
                          {bw.metrics.mrr} · {show(targetsOfMrr.target.targetValue, mrr.currency)}
                        </span>
                      </>
                    )}
                    {months.map((m, i) => (
                      <div key={m.month} className="flex flex-col items-center justify-end gap-1.5">
                        {i === months.length - 1 && <span className="text-caption whitespace-nowrap text-positive-text">{show(m.minor, mrr.currency)}</span>}
                        <span style={{ height: m.minor > 0 ? Math.max(3, Math.round((m.minor / scaleTop) * 180)) : 0 }} className={`w-6 rounded-t-[4px] sm:w-10 ${i === months.length - 1 ? "bg-brand" : "bg-ink"}`} />
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-6 gap-3 text-center text-caption text-muted sm:gap-4">
                    {months.map((m, i) => (
                      <span key={m.month} className={i === months.length - 1 ? "text-ink" : undefined}>
                        {monthName(m.month)}
                      </span>
                    ))}
                  </div>
                  <div className="mt-1 flex justify-end text-caption">
                    <AdminLink href="/admin/platform/plans/analytics" className="text-ink-2 hover:text-ink">
                      {w.seeAnalytics} ›
                    </AdminLink>
                  </div>
                </div>
              </section>
            )}
            {funnel.asked > 0 && (
              <HomeCard title={t.funnel}>
                <p className="-mt-2 text-caption text-muted">{t.funnelSub}</p>
                <ul className="flex flex-col gap-2.5">
                  {(
                    [
                      [funnel.asked, t.asked, "bg-ink text-inverse-ink", null],
                      [funnel.opened, t.opened, "bg-ink-2 text-inverse-ink", null],
                      [funnel.setUp, t.setUp, "bg-muted text-inverse-ink", funnel.opened - funnel.setUp],
                      [funnel.paying, t.paid, "bg-brand text-brand-ink", null],
                    ] as const
                  ).map(([n, label, look, stuck]) => (
                    <li key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(9rem,14rem)] items-center gap-4">
                      <span
                        style={{ width: `${Math.max(8, Math.round((n / funnel.asked) * 100))}%` }}
                        className={`flex h-9 items-center rounded-card px-3 text-body tabular-nums ${look}`}
                      >
                        {n}
                      </span>
                      <span className="text-body text-ink-2">
                        {label}
                        {stuck !== null && stuck > 0 && (
                          <>
                            {" "}
                            <AdminLink href="/admin/platform/stores" className="whitespace-nowrap text-warning-text hover:underline">
                              {fillWords(t.stuck, { n: stuck })} ›
                            </AdminLink>
                          </>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </HomeCard>
            )}
          </>
        }
        aside={
          <>
            <HomeCard title={home.needs} compact>
              {restNeeds.length === 0 ? (
                <p className="text-body text-muted">{w.empty}</p>
              ) : (
                <ul className="flex flex-col">
                  {restNeeds.slice(0, 6).map((item) => (
                    <LinkRow
                      key={`${item.href}-${item.text}`}
                      href={item.href}
                      start={<span aria-hidden className={`size-2 shrink-0 rounded-pill ${item.urgent ? "bg-danger-solid" : "bg-warning-solid"}`} />}
                      title={<span className="whitespace-normal">{item.text}</span>}
                      end={<span className="shrink-0 text-body text-brand-text">{item.action} ›</span>}
                    />
                  ))}
                </ul>
              )}
            </HomeCard>
            <HomeCard title={t.health} compact>
              <ul className="flex flex-col gap-2 text-body">
                {(
                  [
                    [t.emails, fillWords(t.emailsLine, { sent: o.emails.sent, failed: o.emails.failed }), o.emails.failed === 0, "/admin/platform/emails"],
                    [t.ai, fillWords(t.aiLine, { n: o.ai.requests, failed: o.ai.failed }), o.ai.failed === 0, "/admin/platform/ai/usage"],
                    [t.jobs, lateJobs.length === 0 ? t.jobsOk : countWords(lateJobs.length, t.jobsLate), lateJobs.length === 0, "/admin/platform/capacity#jobs"],
                    [t.stripe, failedEvents === 0 ? t.stripeOk : countWords(failedEvents, t.stripeFailed), failedEvents === 0, "/admin/platform/stripe"],
                  ] as const
                ).map(([label, line, ok, href]) => (
                  <li key={label}>
                    <AdminLink href={href} className="flex items-center gap-2.5 hover:underline">
                      <span aria-hidden className={`size-2 shrink-0 rounded-pill ${ok ? "bg-insight-solid" : "bg-warning-solid"}`} />
                      <span className="flex-1 text-ink">{label}</span>
                      <span className={ok ? "text-muted" : "text-warning-text"}>{line}</span>
                    </AdminLink>
                  </li>
                ))}
              </ul>
              <p className="text-caption text-muted">{t.healthSub}</p>
            </HomeCard>
            {snapshot.targets.length > 0 && (
              <HomeCard title={t.targets} compact>
                <div className="flex flex-col gap-3">
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
              </HomeCard>
            )}
            {account.platformAdmin && <AskCard title={home.ask} placeholder={home.askPlaceholder} asks={t.asks} />}
          </>
        }
      />
      {briefing.offered && platformCan(account, "plans") && (
        <section aria-labelledby="briefing-offer" className={`${CARD_CLASS} flex flex-col gap-3 p-5`}>
          <h2 id="briefing-offer" className="text-body-strong text-ink">
            {bw.offerTitle}
          </h2>
          <p className="max-w-prose text-sm text-ink-2">{bw.offerText}</p>
          <div className="flex flex-wrap gap-2">
            {(["weekly", "daily", "dismiss"] as const).map((choice) => (
              <ActionForm key={choice} action={setBriefingAction}>
                <input type="hidden" name="briefing" value={choice} />
                <SubmitButton variant="secondary">{choice === "dismiss" ? bw.notNow : bw[choice]}</SubmitButton>
              </ActionForm>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
