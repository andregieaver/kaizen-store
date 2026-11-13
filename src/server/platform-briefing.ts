import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { renderEmail } from "@/lib/email-layout";
import { formatMoney } from "@/lib/money";
import {
  briefingDue,
  isBriefingKind,
  isMoneyMetric,
  isTargetMetric,
  monthOf,
  platformAlertsFor,
  targetProgress,
  type BriefingKind,
  type PlatformAlert,
  type PlatformSnapshot,
  type PlatformTarget,
  type TargetMetric,
} from "@/lib/platform-briefing";
import { localNow } from "@/lib/staff-alerts";
import { siteUrl } from "@/lib/site";

import { audit, platformCan, type Account } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";
import { planAnalytics } from "./plan-analytics";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The platform's own figures, targets, alerts and morning briefing (C2 of `docs/platform-parity-plan.md`, D513, `src/lib/platform-briefing.ts`):
 * what the platform home shows above its attention list, the targets set on Plans → Analytics, and the briefing the dispatcher's
 * `platformBriefing` job emails to the platform's owners and its finance role, daily or weekly, once a period. Live payments only; Oslo's day.
 */

const OSLO = "Europe/Oslo";

const TARGET = z.object({ id: col.uuid, metric: col.text, month: col.text, currency: z.string().nullable(), target_value: col.minor });

/** A month's targets (the first of the month), money ones per currency. */
export async function platformTargets(month: string): Promise<PlatformTarget[]> {
  const rows = await typedRows(TARGET, sql`select id, metric, month::text, currency::text as currency, target_value from commerce.platform_targets where month = ${month}::date order by metric, currency`);
  return rows.flatMap((r) => (isTargetMetric(r.metric) ? [{ id: r.id, metric: r.metric, month: r.month, currency: r.currency, targetValue: r.target_value }] : []));
}

export type TargetInput = { metric: TargetMetric; month: string; currency: string | null; targetValue: number };

/** Sets a month's target (one per metric, month and currency), or takes it away (0). The plans area's (an owner or the finance role). Audited. */
export async function savePlatformTarget(admin: Account, input: TargetInput): Promise<boolean> {
  if (!platformCan(admin, "plans") || !isTargetMetric(input.metric) || !/^\d{4}-\d{2}-01$/.test(input.month)) return false;
  const currency = isMoneyMetric(input.metric) ? input.currency : null;
  if (isMoneyMetric(input.metric) && !/^[A-Z]{3}$/.test(currency ?? "")) return false;
  if (!Number.isSafeInteger(input.targetValue) || input.targetValue < 0) return false;
  if (input.targetValue === 0) {
    await db().execute(sql`delete from commerce.platform_targets where metric = ${input.metric} and month = ${input.month}::date and coalesce(currency, '') = ${currency ?? ""}`);
  } else {
    await db().execute(sql`
      insert into commerce.platform_targets (metric, month, currency, target_value, created_by)
      values (${input.metric}, ${input.month}::date, ${currency}, ${input.targetValue}, ${admin.id}::uuid)
      on conflict (metric, month, coalesce(currency, '')) do update set target_value = excluded.target_value, updated_at = now()`);
  }
  await audit(admin.id, null, "platform.target_set", { metric: input.metric, month: input.month, currency, value: input.targetValue });
  return true;
}

const FIGURES = z.object({
  asked_today: col.int,
  opened_today: col.int,
  new_stores: col.int,
  trials_ending: col.int,
  waiting: col.int,
  oldest_hours: z.number().nullable(),
});

/** The platform's figures now: recurring revenue and how it moved, paying and trying stores, sales this month, sign-ups today, requests, targets. */
export async function platformSnapshot(now = new Date()): Promise<PlatformSnapshot> {
  const today = localNow(now, OSLO).date;
  const month = monthOf(today);
  const lastMonth = monthOf(new Date(Date.parse(`${month}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10));
  const sameDayLastMonth = `${lastMonth.slice(0, 8)}${today.slice(8, 10)}`;
  const [analytics, moved, sales, figures, targets] = await Promise.all([
    planAnalytics(30),
    typedRows(
      z.object({ currency: col.currency, month_moved: col.minor, week_moved: col.minor }),
      sql`select currency,
                 coalesce(sum(mrr_after_minor - mrr_before_minor) filter (where (at at time zone ${OSLO})::date >= ${month}::date), 0) as month_moved,
                 coalesce(sum(mrr_after_minor - mrr_before_minor) filter (where at >= ${now.toISOString()}::timestamptz - interval '7 days'), 0) as week_moved
            from commerce.plan_moves where mode = 'live' and currency is not null and at >= ${lastMonth}::date
           group by currency`,
    ),
    typedRows(
      z.object({ currency: col.currency, this_month: col.minor, last_month: col.minor }),
      sql`select currency,
                 coalesce(sum(net_minor) filter (where (paid_at at time zone ${OSLO})::date >= ${month}::date), 0) as this_month,
                 coalesce(sum(net_minor) filter (where (paid_at at time zone ${OSLO})::date between ${lastMonth}::date and least(${sameDayLastMonth}::date, (${month}::date - 1))), 0) as last_month
            from commerce.platform_sales where mode = 'live' and (paid_at at time zone ${OSLO})::date >= ${lastMonth}::date
           group by currency`,
    ),
    typedRow(
      FIGURES,
      sql`select
            (select count(*)::int from commerce.access_requests where (created_at at time zone ${OSLO})::date = ${today}::date) as asked_today,
            (select count(*)::int from commerce.stores s where (s.setup_completed_at at time zone ${OSLO})::date = ${today}::date and not (s.is_template or s.starter or s.sandbox or s.house)) as opened_today,
            (select count(*)::int from commerce.stores s where (s.setup_completed_at at time zone ${OSLO})::date >= ${month}::date and not (s.is_template or s.starter or s.sandbox or s.house)) as new_stores,
            (select count(*)::int from commerce.store_billing b where b.mode::text = 'live' and b.status = 'trialing' and b.trial_ends_at between now() and now() + interval '3 days') as trials_ending,
            (select count(*)::int from commerce.access_requests where status = 'pending') as waiting,
            (select extract(epoch from now() - min(created_at)) / 3600 from commerce.access_requests where status = 'pending')::float8 as oldest_hours`,
    ),
    platformTargets(month),
  ]);
  const live = analytics.live;
  const mrr = live.mrr.map((m) => {
    const move = moved.find((x) => x.currency === m.currency);
    return { currency: m.currency, minor: m.mrrMinor, monthMovedMinor: move?.month_moved ?? 0, weekMovedMinor: move?.week_moved ?? 0 };
  });
  for (const move of moved) {
    if (!mrr.some((m) => m.currency === move.currency) && (move.month_moved !== 0 || move.week_moved !== 0)) {
      mrr.push({ currency: move.currency, minor: 0, monthMovedMinor: move.month_moved, weekMovedMinor: move.week_moved });
    }
  }
  const salesFigures = sales.map((s) => ({ currency: s.currency, monthMinor: s.this_month, lastMonthToDateMinor: s.last_month }));
  const actualOf = (t: PlatformTarget): number => {
    if (t.metric === "mrr") return mrr.find((m) => m.currency === t.currency)?.minor ?? 0;
    if (t.metric === "sales") return salesFigures.find((s) => s.currency === t.currency)?.monthMinor ?? 0;
    if (t.metric === "paying") return live.paying;
    return figures?.new_stores ?? 0;
  };
  return {
    today,
    mrr,
    paying: live.paying,
    trialing: live.trialing,
    late: live.late,
    trialsEnding: figures?.trials_ending ?? 0,
    sales: salesFigures,
    newStores: figures?.new_stores ?? 0,
    signUpsToday: { asked: figures?.asked_today ?? 0, opened: figures?.opened_today ?? 0 },
    requests: { waiting: figures?.waiting ?? 0, oldestHours: figures?.oldest_hours === null || figures?.oldest_hours === undefined ? null : Math.floor(figures.oldest_hours) },
    targets: targets.map((target) => ({ target, progress: targetProgress(target, actualOf(target), today) })),
  };
}

/** The briefing's setting and whether its offer still shows on the platform home (until turned on or put away). */
export async function platformBriefingSetting(): Promise<{ kind: BriefingKind; offered: boolean }> {
  const row = await typedRow(z.object({ briefing: col.text, dismissed: col.bool }), sql`select briefing, briefing_offer_dismissed_at is not null as dismissed from commerce.platform_settings limit 1`);
  const kind = isBriefingKind(row?.briefing) ? row.briefing : "off";
  return { kind, offered: kind === "off" && !row?.dismissed };
}

/** Turns the briefing on (daily, weekly) or off, or puts the offer away. An owner's or the finance role's. Audited. */
export async function setPlatformBriefing(admin: Account, choice: BriefingKind | "dismiss"): Promise<boolean> {
  if (!platformCan(admin, "plans")) return false;
  if (choice === "dismiss") {
    await db().execute(sql`update commerce.platform_settings set briefing_offer_dismissed_at = now()`);
  } else if (isBriefingKind(choice)) {
    await db().execute(sql`update commerce.platform_settings set briefing = ${choice}`);
  } else return false;
  await audit(admin.id, null, "platform.briefing_set", { choice });
  return true;
}

/** Who gets the briefing: the platform's owners and its finance role, each in their language. */
async function briefingRecipients(): Promise<{ id: string; email: string; lang: AdminLang }[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, email: col.text, admin_locale: col.textOrNull }),
    sql`select id, email, admin_locale from commerce.accounts
         where (platform_admin or platform_role = 'finance') and disabled_at is null and email <> '' order by id`,
  );
  return rows.map((r) => ({ id: r.id, email: r.email, lang: adminLangOf(r.admin_locale) }));
}

const PERIOD = z.object({ asked: col.int, opened: col.int, started: col.int, cancelled: col.int });

/** What happened in the period: requests, stores opened, plans started and cancelled. */
async function periodFigures(from: string, to: string) {
  return typedRow(
    PERIOD,
    sql`select
          (select count(*)::int from commerce.access_requests where (created_at at time zone ${OSLO})::date between ${from}::date and ${to}::date) as asked,
          (select count(*)::int from commerce.stores s where (s.setup_completed_at at time zone ${OSLO})::date between ${from}::date and ${to}::date
              and not (s.is_template or s.starter or s.sandbox or s.house)) as opened,
          (select count(*)::int from commerce.plan_moves where mode = 'live' and kind = 'started' and (at at time zone ${OSLO})::date between ${from}::date and ${to}::date) as started,
          (select count(*)::int from commerce.plan_moves where mode = 'live' and kind = 'cancelled' and (at at time zone ${OSLO})::date between ${from}::date and ${to}::date) as cancelled`,
  );
}

/** An alert in a person's words. */
export function alertText(alert: PlatformAlert, lang: AdminLang): string {
  const w = PLATFORM_WORDS[lang].briefing.alerts;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const v = alert.values;
  if (alert.id === "requests_old") return fillWords(w.requests_old, { n: v.n, days: v.days });
  if (alert.id === "late_payments") return countWords(Number(v.n), w.late_payments);
  if (alert.id === "mrr_down") return fillWords(w.mrr_down, { amount: formatMoney(Number(v.minor), String(v.currency), locale) });
  if (alert.id === "target_behind") return fillWords(w.target_behind, { metric: PLATFORM_WORDS[lang].briefing.metrics[v.metric as TargetMetric], pct: v.pct });
  return countWords(Number(v.n), w.trials_ending);
}

/**
 * The dispatcher's `platformBriefing` job: once the period is due (seven in the morning in Oslo; a weekly one on Mondays) and nobody sent
 * it yet, the briefing goes to each recipient in their language: the period's requests, stores opened and plans started and cancelled,
 * recurring revenue and how it moved, sales this month, the alerts and the targets. Claimed in `platform_settings` first, so a period goes
 * once; never throws.
 */
export async function sendPlatformBriefing(options: { now?: Date } = {}): Promise<{ sent: number }> {
  const now = options.now ?? new Date();
  try {
    const setting = await typedRow(z.object({ briefing: col.text, last: col.textOrNull }), sql`select briefing, briefing_last_period as last from commerce.platform_settings limit 1`);
    const kind = isBriefingKind(setting?.briefing) ? setting.briefing : "off";
    const due = briefingDue(kind, setting?.last ?? null, localNow(now, OSLO));
    if (!due) return { sent: 0 };
    const claimed = await typedRow(
      z.object({ ok: col.bool }),
      sql`update commerce.platform_settings set briefing_last_period = ${due.key} where briefing_last_period is distinct from ${due.key} returning true as ok`,
    );
    if (!claimed) return { sent: 0 };
    const [snapshot, period, recipients] = await Promise.all([platformSnapshot(now), periodFigures(due.from, due.to), briefingRecipients()]);
    const alerts = platformAlertsFor(snapshot);
    let sent = 0;
    for (const r of recipients) {
      const w = PLATFORM_WORDS[r.lang].briefing;
      const locale = ADMIN_LANG_FACTS[r.lang].locale;
      const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);
      const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString(locale, { dateStyle: "long", timeZone: "UTC" });
      const when = due.from === due.to ? day(due.to) : `${day(due.from)} – ${day(due.to)}`;
      const lines = [
        countWords(period?.asked ?? 0, w.asked),
        countWords(period?.opened ?? 0, w.opened),
        countWords(period?.started ?? 0, w.started),
        countWords(period?.cancelled ?? 0, w.cancelled),
      ];
      const mrr = snapshot.mrr.map((m) => fillWords(w.mrr, { amount: money(m.minor, m.currency), moved: `${m.monthMovedMinor >= 0 ? "+" : "−"}${money(Math.abs(m.monthMovedMinor), m.currency)}` }));
      const sales = snapshot.sales.map((s) => fillWords(w.sales, { amount: money(s.monthMinor, s.currency), last: money(s.lastMonthToDateMinor, s.currency) }));
      const targets = snapshot.targets.map((t) =>
        fillWords(w.target, {
          metric: w.metrics[t.target.metric],
          actual: t.target.currency ? money(t.progress.actual, t.target.currency) : String(t.progress.actual),
          target: t.target.currency ? money(t.target.targetValue, t.target.currency) : String(t.target.targetValue),
          pct: t.progress.pct,
          status: w.status[t.progress.status],
        }),
      );
      const email = renderEmail({
        subject: fillWords(kind === "weekly" ? w.subjectWeekly : w.subjectDaily, { when }),
        preview: fillWords(w.preview, { paying: snapshot.paying }),
        lang: ADMIN_LANG_FACTS[r.lang].tag,
        footer: [w.footer],
        blocks: [
          { type: "heading", text: fillWords(w.heading, { when }) },
          { type: "paragraph", text: lines.join(" · ") },
          ...[...mrr, ...sales].map((text) => ({ type: "paragraph" as const, text })),
          ...(alerts.length > 0 ? [{ type: "heading" as const, text: w.alertsTitle }, ...alerts.map((a) => ({ type: "paragraph" as const, text: alertText(a, r.lang) }))] : []),
          ...(targets.length > 0 ? [{ type: "heading" as const, text: w.targetsTitle }, ...targets.map((text) => ({ type: "paragraph" as const, text }))] : []),
          { type: "button", text: w.button, url: `${siteUrl()}/admin/platform` },
        ],
      });
      const outcome = await sendEmail({ storeId: null, kind: "platform.briefing", to: r.email, email, fromName: "Kaizena Flow", idempotencyKey: `platform.briefing:${due.key}:${r.id}` });
      if (outcome === "sent" || outcome === "logged") sent += 1;
    }
    return { sent };
  } catch (error) {
    log("error", "platform_briefing.failed", {}, error);
    return { sent: 0 };
  }
}
