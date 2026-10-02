import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { safeRatio } from "@/lib/analytics-core";
import { todayIn, type AnalyticsPeriod } from "@/lib/analytics-period";
import { arr, churnRate, monthlyMinor, mrrMovements, type MrrMovements } from "@/lib/analytics-subscriptions";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { PAID, dayStart, inPeriod, num, toMainOne, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * The Subscriptions page's figures (D152, docs/analytics.md): monthly recurring revenue and how it moved, churn, failed
 * renewals, what renewals brought in and how long subscriptions last. The arithmetic of a month's value, ARR, churn and the
 * MRR bridge is `@/lib/analytics-subscriptions`; this module reads the rows.
 *
 * **What is known and what is not.** A subscription keeps only its status as it is now, when it was created and when it ended
 * (`cancelled_at`, Stripe's `ended_at`). It has no status history, so nothing here is made up from one:
 *
 * - *Active at a time T* is: it started (not "waiting for first payment" and not "never started"), was created before T and
 *   has not ended by T (`cancelled_at` is empty and the status is not cancelled, or it ended at T or later). A subscription
 *   that is paused or in failed payment today is counted as active at earlier times; the headline MRR is today's status.
 * - **MRR** is the headline: active and past-due subscriptions *today* (the doc's definition), a month's worth of each
 *   renewal without VAT (`total_minor - tax_minor`, `monthlyMinor()`), worked out per subscription in its own currency and
 *   converted one by one, so every sum below is of the same per-subscription values. Trials are in it, as the doc says, and
 *   are counted beside it (`trialing`). A subscription that is paused is not.
 * - **Failed renewals** (`pastDue`) are a snapshot of the subscriptions in failed payment now; there is no history of failures.
 * - **Movements** (`movements`): start MRR is those active at the period's start; new are subscriptions created in the period,
 *   churned those that ended in it. The end is today's MRR when the period reaches today, else those active at the period's
 *   end by the same rule. Whatever is left is `otherMinor`, said plainly (paused or past-due subscriptions, other
 *   currencies' rounding). Expansion, contraction and reactivation are not tracked (`notTracked`), never zero.
 * - *New subscriptions* are started ones created in the period. A subscription that never got its first payment is not one;
 *   a free trial's first payment is Stripe's, so "started" is read from the status, not from a captured payment.
 * - **Renewal revenue** is the period's paid orders of a subscription other than the one it started with, without VAT.
 */

/** The most price points (currency, interval, amount) read; the page says so when reached. */
export const GROUP_CAP = 5_000;
/** Fewer subscriptions than this at the start and a churn rate moves a lot with each cancellation: it is flagged, not hidden. */
export const MIN_CHURN_BASE = 20;

export type NotTracked = { key: "expansion" | "contraction" | "reactivation" | "history"; label: string; why: string };

/** Said on the page, never shown as 0: Kaizen keeps no history of a subscription's price, quantity or status. */
export const NOT_TRACKED: readonly NotTracked[] = [
  { key: "expansion", label: "Expansion", why: "A subscription's price or quantity is kept only as it is now, so an increase cannot be told from a new subscription." },
  { key: "contraction", label: "Contraction", why: "A subscription's price or quantity is kept only as it is now, so a decrease cannot be seen." },
  { key: "reactivation", label: "Reactivation", why: "There is no status history, so a return cannot be told from a new subscription." },
  { key: "history", label: "Paused and failed payments over time", why: "Only today's status is kept: past-due and paused subscriptions are a snapshot, and earlier periods count them as active." },
];

export type MrrFigure = { count: number; mrrMinor: number };

export type SubscriptionsReport = {
  /** The main currency of every amount. */
  currency: string;
  period: { from: string; to: string; days: number };
  /** The store's day and the instant the snapshot is of. */
  today: string;
  now: string;
  /** Active and past-due subscriptions now: the headline. */
  active: MrrFigure & { arrMinor: number };
  /** Of them in failed payment (a snapshot, not a history): the MRR at risk. */
  pastDue: MrrFigure & { snapshot: true };
  /** Active subscriptions still in their free trial: in the MRR above, as the doc counts them. */
  trialing: MrrFigure;
  /** Paused now: not in the MRR. */
  paused: MrrFigure;
  /** Active or past due and already set to end (at the period's end or after the commitment): MRR that will leave. */
  cancelling: MrrFigure;
  /** Subscriptions that began in the period, with their monthly value. */
  new: MrrFigure;
  /** Subscriptions that ended in the period (all of them, also those begun in it), with their monthly value, and how many of them were active at the start (`fromStart`: the churn rate's numerator). */
  cancelled: MrrFigure & { fromStart: number };
  /** Active at the period's start by the rule above. */
  activeAtStart: MrrFigure;
  /** Active at the period's end: today's snapshot when the period reaches today, else by the rule. */
  activeAtEnd: MrrFigure & { basis: "now" | "periodEnd" };
  churn: {
    /** Of the subscriptions active at the period's start, the share cancelled during it (`cancelled.fromStart` over `activeAtStart`, `churnRate()`); null when none were active at the start. */
    rate: number | null;
    /** MRR of those cancelled subscriptions that were active at the start, over the start MRR; null without start MRR. */
    revenueRate: number | null;
    /** Fewer than `MIN_CHURN_BASE` were active at the start: say so beside the rate. */
    lowVolume: boolean;
  };
  /** The start, the movements and the end of MRR, reconciled; the end and the difference are explicit. */
  movements: MrrMovements;
  /** The period's paid orders of subscriptions other than their first, and what they brought in without VAT. */
  renewals: { orders: number; revenueMinor: number; aovMinor: number | null };
  /** The period's paid first orders of subscriptions. */
  firstOrders: { orders: number; revenueMinor: number };
  /** Average value of the period's paid subscription orders, first orders and renewals together. */
  aovMinor: number | null;
  /** How long ended subscriptions lasted (created to ended), in days. */
  duration: { endedInPeriod: number; avgDaysInPeriod: number | null; endedTotal: number; avgDaysTotal: number | null };
  notTracked: readonly NotTracked[];
  /** Subscriptions and orders left out because their currency has no rate, and those currencies. */
  unconverted: { subscriptions: number; orders: number };
  missingRates: string[];
  /** More price points than `GROUP_CAP`: the figures are made of the most common ones. */
  truncated: boolean;
  /** Words for what the figures leave out or cannot say, empty when nothing is. */
  notes: string[];
};

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * Started subscriptions grouped by price point (currency, interval, count, amount without VAT), with how many fall in each of the
 * sets the report needs. A price point has many subscriptions, so the rows are few and each is valued once.
 */
async function readGroups(store: Store, period: AnalyticsPeriod, now: Date): Promise<Row[]> {
  const from = dayStart(store, period.from);
  const to = dayStart(store, period.to);
  const nowAt = sql`${now.toISOString()}::timestamptz`;
  const liveAt = (t: ReturnType<typeof dayStart>) =>
    sql`(s.created_at < ${t} and ((s.cancelled_at is null and s.status <> 'cancelled') or s.cancelled_at >= ${t}))`;
  const cancelledIn = sql`(s.cancelled_at >= ${from} and s.cancelled_at < ${to})`;
  return db().execute<Row>(sql`
    select trim(s.currency) as currency, s."interval"::text as "interval", s.interval_count, (s.total_minor - s.tax_minor) as amount,
      count(*)::int as n,
      count(*) filter (where s.status in ('active', 'past_due'))::int as live_n,
      count(*) filter (where s.status = 'past_due')::int as past_due_n,
      count(*) filter (where s.status = 'paused')::int as paused_n,
      count(*) filter (where s.status = 'active' and s.trial_ends_at > ${nowAt})::int as trial_n,
      count(*) filter (where s.status in ('active', 'past_due') and (s.cancel_at_period_end or s.cancel_at is not null))::int as cancelling_n,
      count(*) filter (where ${liveAt(from)})::int as start_n,
      count(*) filter (where ${liveAt(to)})::int as end_n,
      count(*) filter (where s.created_at >= ${from} and s.created_at < ${to})::int as new_n,
      count(*) filter (where ${cancelledIn})::int as cancelled_n,
      count(*) filter (where ${cancelledIn} and ${liveAt(from)})::int as cancelled_start_n
    from commerce.subscriptions s
    where s.store_id = ${store.id}::uuid and s.status not in ('pending', 'expired')
    group by 1, 2, 3, 4
    order by count(*) desc, 1, 2, 3, 4
    limit ${GROUP_CAP + 1}
  `);
}

/** The period's paid subscription orders, split into the one a subscription started with and its renewals, by currency. */
async function readOrders(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    select trim(o.currency) as currency, (o.id = s.first_order_id) as first, count(*)::int as n, sum(o.total_minor - o.tax_minor) as revenue
    from commerce.orders o
    join commerce.subscriptions s on s.store_id = o.store_id and s.id = o.subscription_id
    where o.store_id = ${store.id}::uuid and o.subscription_id is not null and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
    group by 1, 2
  `);
}

/** How long ended subscriptions lasted, over all of them and over those that ended in the period; and ones that ended with no date. */
async function readDurations(store: Store, period: AnalyticsPeriod): Promise<Row | undefined> {
  const days = sql`greatest(extract(epoch from (s.cancelled_at - s.created_at)) / 86400, 0)`;
  const inside = sql`(s.cancelled_at >= ${dayStart(store, period.from)} and s.cancelled_at < ${dayStart(store, period.to)})`;
  const [row] = await db().execute<Row>(sql`
    select count(*) filter (where s.cancelled_at is not null)::int as ended_total,
      avg(${days}) filter (where s.cancelled_at is not null) as avg_total,
      count(*) filter (where ${inside})::int as ended_period,
      avg(${days}) filter (where ${inside}) as avg_period,
      count(*) filter (where s.status = 'cancelled' and s.cancelled_at is null)::int as undated
    from commerce.subscriptions s
    where s.store_id = ${store.id}::uuid and s.status not in ('pending', 'expired')
  `);
  return row;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const round1 = (n: number | null): number | null => (n === null ? null : Math.round(n * 10) / 10);

/**
 * The Subscriptions page's report for a period. `now` is the instant the snapshot (active, past due, trials, paused) is of and
 * the store's today is worked out from it: nothing here reads the clock.
 */
export async function subscriptionsReport(store: Store, period: AnalyticsPeriod, now: Date): Promise<SubscriptionsReport> {
  const main = mainCurrency(store);
  const rates = store.localization.rates;
  const today = todayIn(now, store.timeZone);
  const [groups, orderRows, durations] = await Promise.all([readGroups(store, period, now), readOrders(store, period), readDurations(store, period)]);
  const truncated = groups.length > GROUP_CAP;

  const missing = new Set<string>();
  let unconvertedSubscriptions = 0;
  let unvalued = 0;
  const sets = {
    live: { count: 0, mrr: 0 },
    pastDue: { count: 0, mrr: 0 },
    trial: { count: 0, mrr: 0 },
    paused: { count: 0, mrr: 0 },
    cancelling: { count: 0, mrr: 0 },
    start: { count: 0, mrr: 0 },
    end: { count: 0, mrr: 0 },
    created: { count: 0, mrr: 0 },
    cancelled: { count: 0, mrr: 0 },
    cancelledStart: { count: 0, mrr: 0 },
  };
  const add = (set: { count: number; mrr: number }, n: number, each: number) => {
    set.count += n;
    set.mrr += n * each;
  };
  for (const g of groups.slice(0, GROUP_CAP)) {
    const currency = String(g.currency);
    if (!canConvert(currency, main, rates)) {
      unconvertedSubscriptions += num(g, "n");
      missing.add(currency);
      continue;
    }
    const monthly = monthlyMinor(num(g, "amount"), String(g.interval), num(g, "interval_count"));
    if (monthly === null) {
      unvalued += num(g, "n");
      continue;
    }
    // One subscription's month in the main currency: every set below is a count of these, so they add up exactly.
    const each = toMainOne(store, currency, monthly) ?? 0;
    add(sets.live, num(g, "live_n"), each);
    add(sets.pastDue, num(g, "past_due_n"), each);
    add(sets.trial, num(g, "trial_n"), each);
    add(sets.paused, num(g, "paused_n"), each);
    add(sets.cancelling, num(g, "cancelling_n"), each);
    add(sets.start, num(g, "start_n"), each);
    add(sets.end, num(g, "end_n"), each);
    add(sets.created, num(g, "new_n"), each);
    add(sets.cancelled, num(g, "cancelled_n"), each);
    add(sets.cancelledStart, num(g, "cancelled_start_n"), each);
  }

  // The bridge. A period that reaches today ends at today's headline; an earlier one at the same rule as its start.
  const endsNow = period.to > today;
  const endMrr = endsNow ? sets.live.mrr : sets.end.mrr;
  const movements = mrrMovements({ startMrr: sets.start.mrr, newMrr: sets.created.mrr, churnedMrr: sets.cancelled.mrr, endMrr }, 0);

  // Orders: first orders and renewals, converted by currency group.
  let unconvertedOrders = 0;
  const renewals = { orders: 0, revenue: 0 };
  const firsts = { orders: 0, revenue: 0 };
  for (const r of orderRows) {
    const currency = String(r.currency);
    if (!canConvert(currency, main, rates)) {
      unconvertedOrders += num(r, "n");
      missing.add(currency);
      continue;
    }
    const target = r.first === true ? firsts : renewals;
    target.orders += num(r, "n");
    target.revenue += toMainOne(store, currency, num(r, "revenue")) ?? 0;
  }
  const allOrders = renewals.orders + firsts.orders;
  const aov = safeRatio(renewals.revenue + firsts.revenue, allOrders);
  const renewalAov = safeRatio(renewals.revenue, renewals.orders);

  const base = sets.start.count;
  const notes: string[] = [];
  if (unconvertedSubscriptions + unconvertedOrders > 0) {
    notes.push(`${unconvertedSubscriptions} subscription${unconvertedSubscriptions === 1 ? "" : "s"} and ${unconvertedOrders} order${unconvertedOrders === 1 ? "" : "s"} in ${[...missing].sort().join(", ")} are left out: the store has no exchange rate for it.`);
  }
  if (unvalued > 0) notes.push(`${unvalued} subscription${unvalued === 1 ? "" : "s"} with an unusable renewal interval are left out of the figures.`);
  if (truncated) notes.push(`There are more than ${GROUP_CAP} different prices: the most common are counted.`);
  const undated = num(durations, "undated");
  if (undated > 0) notes.push(`${undated} cancelled subscription${undated === 1 ? " has" : "s have"} no end date and ${undated === 1 ? "is" : "are"} left out of churn and the movements.`);
  if (sets.paused.count > 0 && endsNow) notes.push(`${sets.paused.count} paused subscription${sets.paused.count === 1 ? " is" : "s are"} not in the MRR now, but ${sets.paused.count === 1 ? "is" : "are"} counted as active at the start: the difference is in "other".`);

  return {
    currency: main,
    period: { from: period.from, to: period.to, days: period.days },
    today,
    now: now.toISOString(),
    active: { count: sets.live.count, mrrMinor: sets.live.mrr, arrMinor: arr(sets.live.mrr) },
    pastDue: { count: sets.pastDue.count, mrrMinor: sets.pastDue.mrr, snapshot: true },
    trialing: { count: sets.trial.count, mrrMinor: sets.trial.mrr },
    paused: { count: sets.paused.count, mrrMinor: sets.paused.mrr },
    cancelling: { count: sets.cancelling.count, mrrMinor: sets.cancelling.mrr },
    new: { count: sets.created.count, mrrMinor: sets.created.mrr },
    cancelled: { count: sets.cancelled.count, mrrMinor: sets.cancelled.mrr, fromStart: sets.cancelledStart.count },
    activeAtStart: { count: sets.start.count, mrrMinor: sets.start.mrr },
    activeAtEnd: { count: endsNow ? sets.live.count : sets.end.count, mrrMinor: endMrr, basis: endsNow ? "now" : "periodEnd" },
    churn: {
      // Only what was active at the start can have churned out of it: a subscription begun and cancelled inside the period is in the
      // MRR bridge's churned line (`cancelled`), not in this rate, or the rate could pass 100 %.
      rate: churnRate(sets.cancelledStart.count, base),
      revenueRate: safeRatio(sets.cancelledStart.mrr, sets.start.mrr > 0 ? sets.start.mrr : null),
      lowVolume: base < MIN_CHURN_BASE,
    },
    movements,
    renewals: { orders: renewals.orders, revenueMinor: renewals.revenue, aovMinor: renewalAov === null ? null : Math.round(renewalAov) },
    firstOrders: { orders: firsts.orders, revenueMinor: firsts.revenue },
    aovMinor: aov === null ? null : Math.round(aov),
    duration: {
      endedInPeriod: num(durations, "ended_period"),
      avgDaysInPeriod: round1(durations?.avg_period == null ? null : Number(durations.avg_period)),
      endedTotal: num(durations, "ended_total"),
      avgDaysTotal: round1(durations?.avg_total == null ? null : Number(durations.avg_total)),
    },
    notTracked: NOT_TRACKED,
    unconverted: { subscriptions: unconvertedSubscriptions, orders: unconvertedOrders },
    missingRates: [...missing].sort(),
    truncated,
    notes,
  };
}
