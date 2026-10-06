import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ALERT_RULES, alertsFor, type Alert, type AlertSnapshot, type ChannelCacRow, type DailyPoint, type ProductRefundRow, type ReturningMonth } from "@/lib/analytics-alerts";
import {
  explainChange,
  type ChangeExplanation,
  type PeriodFigures as DiagnosisFigures,
  type SegmentRow as DiagnosisSegment,
  type SegmentTable,
} from "@/lib/analytics-diagnosis";
import { forecastMonth, HISTORY_DAYS as FORECAST_HISTORY_DAYS, type MonthForecast } from "@/lib/analytics-forecast";
import { derive } from "@/lib/analytics-kpi";
import { addDays, addMonths, addYears, customPeriod, lastYearOf, previousPeriodOf, startOfMonth, todayIn, type AnalyticsParams, type AnalyticsPeriod } from "@/lib/analytics-period";
import { targetProgress, type DailyActual, type TargetProgress } from "@/lib/analytics-targets";
import { isNotAChannel, UNKNOWN_CHANNEL } from "@/lib/analytics-traffic";
import { mainCurrency } from "@/lib/markets";

import { geoReport } from "./analytics-geo-data";
import { discountsReport } from "./analytics-discounts-data";
import { inventoryReport } from "./analytics-inventory-data";
import { OTHER_ID, productsReport } from "./analytics-products-data";
import { getAnalyticsSettings, listTargets, type StoredAnalyticsSettings } from "./analytics-settings";
import { CUSTOMER_JOIN, CUSTOMER_KEY, dayStart, HAS_CUSTOMER, inMain, inPeriod, num, PAID, type Row } from "./analytics-sql";
import { periodTotals, seriesByBucket, setBased } from "./analytics-totals";
import { marketingReport, sessionTotals, trafficReport, type MarketingReport, type TrafficReport } from "./analytics-traffic-data";
import type { Store } from "./stores";

/**
 * What the store's own figures say needs a look, where sales are heading and why they moved (D152, docs/analytics.md, "Alerts,
 * targets, forecast, diagnosis"). The rules, the forecast and the explanation are the pure libraries'
 * (`analytics-alerts.ts`, `analytics-forecast.ts`, `analytics-diagnosis.ts`); this module only reads the store's reports and
 * hands them over. There is no model in it and nothing is stored: everything is worked out on read.
 *
 * Every read is set-based and the reads of one answer run in parallel. One failing report never breaks the others: an alert
 * whose input could not be read is left out (as if its rule had nothing to say), a forecast or explanation that cannot be made is
 * null, and nothing here throws to a page. What is logged on a failure is the name of the report and of the error, never its
 * message (a database message can carry values).
 *
 * Days are the store's (`store.timeZone`); amounts are minor units of the main currency without VAT.
 */

/** Complete days before today the daily history reaches: the best-day rule's 90 days (the longest window any rule or forecast uses). */
export const HISTORY_DAYS = 90;

/** Windows of the "last 7 days against the 28 days before" rules (CAC, checkout abandonment): as the alert rules' own. */
const RECENT_DAYS = 7;
const BASELINE_DAYS = 28;

/** Runs one read of an answer; `null` (and a note in the log) when it fails, so the others carry on. */
async function safe<T>(label: string, read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    console.warn(`analytics insights: ${label} could not be read (${error instanceof Error ? error.name : "error"})`);
    return null;
  }
}

/** How much of today has passed in the store's time zone, 0 to 1, so a quiet morning is not read as falling behind. */
export function shareOfToday(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? Number.NaN);
  const share = (at("hour") * 60 + at("minute")) / 1440;
  return Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 1;
}

// ---------------------------------------------------------------------------
// The daily history
// ---------------------------------------------------------------------------

export type HistoryDay = {
  day: string;
  orders: number;
  /** Of them, the orders from a shopper's checkout (conversion counts these only: a staff-made order was not a visit). */
  checkoutOrders: number;
  /** Revenue before refunds, and net of them, without VAT. */
  revenueMinor: number;
  netRevenueMinor: number;
  /** Visitor-days; null where visits were not counted (never 0 for "not known"). */
  sessions: number | null;
};

export type DailyHistory = {
  currency: string;
  today: string;
  /** How much of today has passed, 0 to 1. */
  dayShare: number;
  /**
   * Every day from the store's first sale in the window to today (today's row partial), zeros included. A day before the first
   * sale is left out: nothing is known of it, and a store that had not sold yet must not look as if it had quiet days. Empty when
   * nothing was sold in the window.
   */
  days: HistoryDay[];
};

/**
 * The store's last `HISTORY_DAYS` days and today, per day: one read of the orders and one of the visits. Pass it to the functions
 * below (as a promise, started once) to read it once for a page.
 */
export async function dailyHistory(store: Store, now: Date, settings?: StoredAnalyticsSettings): Promise<DailyHistory> {
  const today = todayIn(now, store.timeZone);
  const period = customPeriod(addDays(today, -HISTORY_DAYS), today);
  const [points, sessions] = await Promise.all([
    seriesByBucket(store, period, "day", settings),
    // A failing visit read leaves the sessions unknown, not the orders.
    safe("visits", () => sessionTotals(store, period)),
  ]);
  const counted = sessions !== null && store.visitCounting && sessions.firstDay !== null;
  const all: HistoryDay[] = points.map((p) => ({
    day: p.key,
    orders: p.orders,
    checkoutOrders: p.checkoutOrders ?? p.orders,
    revenueMinor: p.revenueMinor,
    netRevenueMinor: p.netRevenueMinor,
    sessions: counted && p.key >= (sessions.firstDay as string) ? (sessions.byDay[p.key] ?? 0) : null,
  }));
  const first = all.findIndex((d) => d.orders > 0 || d.netRevenueMinor !== 0);
  return { currency: mainCurrency(store), today, dayShare: shareOfToday(now, store.timeZone), days: first < 0 ? [] : all.slice(first) };
}

type HistoryOption = { history?: Promise<DailyHistory> };

// ---------------------------------------------------------------------------
// This month's target
// ---------------------------------------------------------------------------

/**
 * This month's net revenue against its target, whatever period a page shows. The month so far and the weekday pattern come from the
 * daily history (days before the store's first sale are not in it, so a new store is not read as having had quiet days).
 */
export function targetFrom(history: DailyHistory, targetMinor: number | null): TargetProgress {
  const monthStart = startOfMonth(history.today);
  const actualMinor = history.days.filter((d) => d.day >= monthStart && d.day <= history.today).reduce((sum, d) => sum + d.netRevenueMinor, 0);
  const dailyActuals: DailyActual[] = history.days.map((d) => ({ day: d.day, revenueMinor: d.netRevenueMinor }));
  return targetProgress({ targetMinor, actualMinor, monthStart, today: history.today, dailyActuals, todayShare: history.dayShare });
}

/** This month's target in the store's main currency, or null when none is set. */
export async function monthTargetMinor(store: Store, today: string): Promise<number | null> {
  const key = startOfMonth(today).slice(0, 7);
  return (await listTargets(store.id)).find((t) => t.month.slice(0, 7) === key)?.revenueTargetMinor ?? null;
}

// ---------------------------------------------------------------------------
// Alerts: the inputs the daily history does not give
// ---------------------------------------------------------------------------

/**
 * Units sold and refunded per product, in the last 14 complete days and in the 90 days before them (disjoint windows), for the
 * products that could raise the refund alert (the rule's own minimums, read from `ALERT_RULES`, narrow the rows in SQL). Sold units
 * are dated by their order, refunded units by their refund. Kaizen keeps a refund as an amount, not as units: a refund counts as
 * the share of the order it paid back (refund over order total) of each goods line's quantity, so a full refund of a line is all
 * of its units and a partial one a part of them (rounded whole once added up). Copied and hosts' orders never count.
 */
export async function productRefundRows(store: Store, today: string): Promise<ProductRefundRow[]> {
  const r = ALERT_RULES.refunds;
  const recent = { from: addDays(today, -r.recentDays), to: today };
  const baseline = { from: addDays(today, -(r.recentDays + r.baselineDays)), to: recent.from };
  const whole = { from: baseline.from, to: recent.to };
  const rows = await setBased<Row>(sql`
    with sold as (
      select v.product_id,
        coalesce(sum(ol.quantity) filter (where ${inPeriod(store, sql`o.placed_at`, recent)}), 0) as sold_recent,
        coalesce(sum(ol.quantity) filter (where ${inPeriod(store, sql`o.placed_at`, baseline)}), 0) as sold_baseline
      from commerce.orders o
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, whole)} and ol.delivery <> 'service'
      group by v.product_id
      having coalesce(sum(ol.quantity) filter (where ${inPeriod(store, sql`o.placed_at`, recent)}), 0) >= ${r.minSold}
        and coalesce(sum(ol.quantity) filter (where ${inPeriod(store, sql`o.placed_at`, baseline)}), 0) >= ${r.minBaselineSold}
    ),
    refunded as (
      select v.product_id,
        coalesce(sum(ol.quantity * r.amount_minor::numeric / o.total_minor) filter (where ${inPeriod(store, sql`r.created_at`, recent)}), 0) as refunded_recent,
        coalesce(sum(ol.quantity * r.amount_minor::numeric / o.total_minor) filter (where ${inPeriod(store, sql`r.created_at`, baseline)}), 0) as refunded_baseline
      from commerce.refunds r
      join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
      join commerce.orders o on o.store_id = rp.store_id and o.id = rp.order_id
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
      where r.store_id = ${store.id}::uuid and r.status = 'succeeded' and ${inPeriod(store, sql`r.created_at`, whole)}
        and o.copied_from is null and o.host_id is null and o.total_minor > 0 and ol.delivery <> 'service'
        and v.product_id in (select product_id from sold)
      group by v.product_id
    )
    select s.product_id::text as product_id, s.sold_recent, s.sold_baseline, f.refunded_recent, f.refunded_baseline
    from sold s
    join refunded f on f.product_id = s.product_id
    where f.refunded_recent >= ${r.minRefunded - 0.5}
    order by f.refunded_recent desc, s.product_id
    limit 50
  `);
  if (rows.length === 0) return [];
  const names = await productNames(store, rows.map((row) => String(row.product_id)));
  return rows.map((row) => ({
    productId: String(row.product_id),
    name: names.get(String(row.product_id)) ?? "A product",
    sold14: num(row, "sold_recent"),
    refunded14: Math.round(num(row, "refunded_recent")),
    soldBaseline: num(row, "sold_baseline"),
    refundedBaseline: Math.round(num(row, "refunded_baseline")),
  }));
}

/** The products' names in the store's main language where they have one, else their handle. */
async function productNames(store: Store, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const locale = store.localization.locales[0] ?? "en";
  const rows = await db().execute<Row>(sql`
    select distinct on (p.id) p.id::text as id, p.handle, pt.title
    from commerce.products p
    left join commerce.product_translations pt on pt.store_id = p.store_id and pt.product_id = p.id
    where p.store_id = ${store.id}::uuid and p.id = any(${`{${ids.join(",")}}`}::uuid[])
    order by p.id, (pt.locale = ${locale}) desc nulls last, (split_part(pt.locale, '-', 1) = split_part(${locale}, '-', 1)) desc nulls last, pt.locale
  `);
  return new Map(rows.map((row) => [String(row.id), row.title ? String(row.title) : String(row.handle)]));
}

/**
 * Revenue and orders of returning customers (a paid order in the month, the customer's first one before the month began) for the last
 * twelve completed months, oldest first, without VAT and before refunds, in the main currency. A month before the store's first
 * order with a customer on it is left out (nothing is known of it); a month after it with no such order is 0.
 */
export async function returningMonths(store: Store, today: string): Promise<ReturningMonth[]> {
  const thisMonth = startOfMonth(today);
  const from = addMonths(thisMonth, -ALERT_RULES.returningHigh.months);
  const rows = await setBased<Row>(sql`
    with ko as materialized (
      select ${CUSTOMER_KEY} as k, o.placed_at, o.currency::text as currency, (o.total_minor - o.tax_minor) as revenue
      from commerce.orders o ${CUSTOMER_JOIN}
      where o.store_id = ${store.id}::uuid and ${PAID} and ${HAS_CUSTOMER} and o.placed_at < ${dayStart(store, thisMonth)}
    ),
    first_order as (
      select k, min(placed_at) as first_at from ko group by k
    )
    select to_char(date_trunc('month', ko.placed_at at time zone ${store.timeZone}), 'YYYY-MM') as month, ko.currency, count(*) as orders, sum(ko.revenue) as revenue,
      (select to_char(date_trunc('month', min(first_at) at time zone ${store.timeZone}), 'YYYY-MM') from first_order) as store_first
    from ko
    join first_order f on f.k = ko.k
    where ko.placed_at >= ${dayStart(store, from)} and f.first_at < date_trunc('month', ko.placed_at at time zone ${store.timeZone}) at time zone ${store.timeZone}
    group by 1, 2
  `);
  // The store's first month with a customer comes from the same read; with no returning order at all, from a read of its own.
  let storeFirst = rows.length > 0 ? String(rows[0].store_first) : null;
  if (storeFirst === null) {
    const [first] = await db().execute<Row>(sql`
      select to_char(date_trunc('month', min(o.placed_at) at time zone ${store.timeZone}), 'YYYY-MM') as month
      from commerce.orders o ${CUSTOMER_JOIN}
      where o.store_id = ${store.id}::uuid and ${PAID} and ${HAS_CUSTOMER}
    `);
    storeFirst = first?.month ? String(first.month) : null;
  }
  if (storeFirst === null) return [];
  const byMonth = new Map<string, Row[]>();
  for (const row of rows) byMonth.set(String(row.month), [...(byMonth.get(String(row.month)) ?? []), row]);
  const out: ReturningMonth[] = [];
  for (let i = 0; i < ALERT_RULES.returningHigh.months; i++) {
    const month = addMonths(from, i).slice(0, 7);
    if (month < storeFirst) continue;
    const group = byMonth.get(month) ?? [];
    out.push({ month, orders: group.reduce((sum, row) => sum + num(row, "orders"), 0), revenueMinor: group.length > 0 ? inMain(store, group.map((row) => ({ ...row, currency: String(row.currency) })), ["revenue"]).values.revenue : 0 });
  }
  return out;
}

/** The last 7 complete days and the 28 before them, as the alert rules read them. */
function windows(today: string): { recent: AnalyticsPeriod; baseline: AnalyticsPeriod } {
  return {
    recent: customPeriod(addDays(today, -RECENT_DAYS), addDays(today, -1)),
    baseline: customPeriod(addDays(today, -(RECENT_DAYS + BASELINE_DAYS)), addDays(today, -(RECENT_DAYS + 1))),
  };
}

/** Spend and new customers per channel in the two windows, for the cost-per-new-customer rule; null without visit counting (no customer is tied to a channel then). */
async function channelCacRows(store: Store, now: Date, today: string): Promise<ChannelCacRow[] | null> {
  if (!store.visitCounting) return null;
  const { recent, baseline } = windows(today);
  const [r, b] = await Promise.all([marketingReport(store, recent, now), marketingReport(store, baseline, now)]);
  if (!r.table || !b.table) return null;
  const now7 = new Map(r.table.rows.map((row) => [row.channel, row]));
  const before = new Map(b.table.rows.map((row) => [row.channel, row]));
  const channels = new Set([...now7.keys(), ...before.keys()]);
  channels.delete(UNKNOWN_CHANNEL);
  for (const key of [...channels]) if (isNotAChannel(key)) channels.delete(key);
  return [...channels]
    .map((channel): ChannelCacRow => {
      const a = now7.get(channel);
      const c = before.get(channel);
      return {
        channel,
        label: (a ?? c)?.label ?? channel,
        spend7Minor: a?.spendMinor ?? 0,
        newCustomers7: a?.newCustomers ?? 0,
        spendPrev28Minor: c?.spendMinor ?? 0,
        newCustomersPrev28: c?.newCustomers ?? 0,
      };
    })
    .filter((row) => row.spend7Minor > 0 || row.spendPrev28Minor > 0);
}

/** Checkouts started and completed in the two windows, from the traffic report's funnel; null when visits are not counted or a stage is not known. */
async function checkoutCounts(store: Store, now: Date, today: string): Promise<AlertSnapshot["checkout"]> {
  if (!store.visitCounting) return null;
  const { recent, baseline } = windows(today);
  const [r, b] = await Promise.all([trafficReport(store, recent, now), trafficReport(store, baseline, now)]);
  const counts = (report: typeof r) => {
    const stage = (key: string) => report.funnel.stages.find((s) => s.key === key)?.count ?? null;
    const started = stage("checkouts");
    const completed = stage("purchases");
    return started === null || completed === null ? null : { started, completed };
  };
  const recentCounts = counts(r);
  const baselineCounts = counts(b);
  return recentCounts && baselineCounts ? { recent: recentCounts, baseline: baselineCounts } : null;
}

/** The share of discounted orders, month after month, over the months that are over: the discounts report's own verdict. */
async function discountCreeping(store: Store, today: string): Promise<AlertSnapshot["discountCreeping"]> {
  const thisMonth = startOfMonth(today);
  const lastMonth = addMonths(thisMonth, -1);
  return (await discountsReport(store, customPeriod(lastMonth, addDays(thisMonth, -1)))).summary.creeping;
}

/** Cost coverage over the last 28 days (today included) and the paid orders in them. */
async function costCoverage(store: Store, today: string, settings: StoredAnalyticsSettings): Promise<AlertSnapshot["costs"]> {
  const days = 28;
  const { totals } = await periodTotals(store, customPeriod(addDays(today, -(days - 1)), today), settings);
  return { coverage: derive(totals, settings, days).costCoverage, orders: totals.orders };
}

// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

/**
 * Everything `alertsFor()` reads, from the store's reports, all at once. An input that cannot be read is left out (the rule that
 * needs it raises nothing). `history` is the shared daily history when the caller has one.
 */
export async function alertSnapshotFor(store: Store, now: Date, options: HistoryOption = {}): Promise<AlertSnapshot> {
  const settings = await getAnalyticsSettings(store.id);
  const history = options.history ?? dailyHistory(store, now, settings);
  const h = await history;
  const today = h.today;
  const [productRefunds, channelCac, stockouts, checkout, creeping, targetMinor, costs, returningMonthly] = await Promise.all([
    safe("refunds by product", () => productRefundRows(store, today)),
    safe("channels", () => channelCacRows(store, now, today)),
    safe("stock", async () => (await inventoryReport(store, now)).alerts),
    safe("checkouts", () => checkoutCounts(store, now, today)),
    safe("discounts", () => discountCreeping(store, today)),
    safe("target", () => monthTargetMinor(store, today)),
    safe("costs", () => costCoverage(store, today, settings)),
    safe("returning customers", () => returningMonths(store, today)),
  ]);
  const daily: DailyPoint[] = h.days.map((d) => ({ day: d.day, orders: d.orders, checkoutOrders: d.checkoutOrders, revenueMinor: d.netRevenueMinor, sessions: d.sessions }));
  return {
    currency: h.currency,
    locale: store.markets[0]?.locale ?? "en",
    today,
    dayShare: h.dayShare,
    daily,
    productRefunds,
    channelCac,
    stockouts,
    checkout,
    discountCreeping: creeping,
    // A target that could not be read is no target: the rule that needs one raises nothing.
    target: targetMinor === null ? null : targetFrom(h, targetMinor),
    costs,
    returningMonthly,
  };
}

/**
 * What needs a look today, most pressing first (`alertsFor()`); hrefs are paths after the store's admin base. An empty list is an
 * answer; so is a failure, which never throws: the page just has nothing to say.
 */
export async function alertsForStore(store: Store, now: Date, options: HistoryOption = {}): Promise<Alert[]> {
  const snapshot = await safe("the alert inputs", () => alertSnapshotFor(store, now, options));
  if (!snapshot) return [];
  return (await safe("the alerts", async () => alertsFor(snapshot))) ?? [];
}

// ---------------------------------------------------------------------------
// The forecast
// ---------------------------------------------------------------------------

export type StoreForecast = {
  currency: string;
  /** The first day of the month forecast. */
  monthStart: string;
  forecast: MonthForecast;
  /** The month's target; null when none is set. */
  targetMinor: number | null;
};

/** Net revenue of last year's days the seasonal factor reads: the eight weeks before this year's today, and the rest of this month, a year back. Days before last year's first sale are not in it. */
async function lastYearDays(store: Store, today: string, monthStart: string): Promise<{ day: string; value: number }[]> {
  const monthEnd = addDays(addMonths(monthStart, 1), -1);
  const from = addDays(addYears(today, -1), -FORECAST_HISTORY_DAYS);
  const to = addYears(monthEnd, -1);
  if (to < from) return [];
  const points = await seriesByBucket(store, customPeriod(from, to), "day");
  const first = points.findIndex((p) => p.orders > 0 || p.netRevenueMinor !== 0);
  return first < 0 ? [] : points.slice(first).map((p) => ({ day: p.key, value: p.netRevenueMinor }));
}

/**
 * Where this month's net revenue is heading (`forecastMonth()`): an estimate with a range, or an honest "too little history". Null
 * when it could not be worked out.
 */
export async function forecastForStore(store: Store, now: Date, options: HistoryOption = {}): Promise<StoreForecast | null> {
  return safe("the forecast", async () => {
    const history = await (options.history ?? dailyHistory(store, now));
    const monthStart = startOfMonth(history.today);
    const [lastYear, targetMinor] = await Promise.all([safe("last year", () => lastYearDays(store, history.today, monthStart)), safe("target", () => monthTargetMinor(store, history.today))]);
    const forecast = forecastMonth({
      monthStart,
      today: history.today,
      dailyHistory: history.days.map((d) => ({ day: d.day, value: d.netRevenueMinor })),
      ...(lastYear && lastYear.length > 0 ? { lastYear } : {}),
      todayShare: history.dayShare,
    });
    return { currency: history.currency, monthStart, forecast, targetMinor };
  });
}

// ---------------------------------------------------------------------------
// The diagnosis
// ---------------------------------------------------------------------------

export type StoreDiagnosis = {
  currency: string;
  explanation: ChangeExplanation;
  period: AnalyticsPeriod;
  /** What it is compared with, and how the address asked for it (`previous` when there was no comparison chosen). */
  comparedWith: AnalyticsPeriod;
  compare: "previous" | "year";
  /** What the figures are, for the section: revenue before refunds, without VAT. */
  basis: string;
  /** What the explanation leaves out or rests on: tables skipped, a period that includes today. */
  notes: string[];
};

/** Products with the largest change are the ones the explanation looks at. */
const PRODUCT_MOVERS = 40;

type Seg = { key: string; label: string; orders: number; revenueMinor: number; sessions: number | null };

/** Two lists of segments (now and before) as one table: a segment missing in one period is nothing there (orders 0, sessions as given). */
function mergeSegments(dimension: SegmentTable["dimension"], current: readonly Seg[], previous: readonly Seg[], missingSessions: number | null): SegmentTable {
  const before = new Map(previous.map((s) => [s.key, s]));
  const now = new Map(current.map((s) => [s.key, s]));
  const keys = new Set([...now.keys(), ...before.keys()]);
  const figures = (s: Seg | undefined): DiagnosisFigures => ({ revenueMinor: s?.revenueMinor ?? 0, orders: s?.orders ?? 0, sessions: s ? s.sessions : missingSessions });
  const rows = [...keys].map((key): DiagnosisSegment => ({ key, label: (now.get(key) ?? before.get(key))?.label ?? key, current: figures(now.get(key)), previous: figures(before.get(key)) }));
  return { dimension, rows };
}

/** How the diagnosis reads the traffic and marketing reports: a page that shows the same reports passes the readers it shares, so each is read once. */
export type DiagnosisReads = {
  traffic?: (period: AnalyticsPeriod) => Promise<TrafficReport>;
  marketing?: (period: AnalyticsPeriod) => Promise<MarketingReport>;
};

/**
 * Why revenue changed between a period and the one it is compared with (`explainChange()`): sessions x conversion x average order,
 * and the devices, channels, markets and products that carry the change. The comparison is the address's (`previous` or `year`);
 * with none chosen it is the previous period. Revenue here is before refunds, without VAT: that is what visits, orders and the
 * average order add up to, and what the tables by device, channel, market and product show. Sessions are used only when visits were
 * counted from before both periods began; the device and channel tables only then too. Null when the figures of a period could
 * not be read.
 */
export async function diagnosisFor(store: Store, params: AnalyticsParams, now: Date, reads: DiagnosisReads = {}): Promise<StoreDiagnosis | null> {
  const trafficOf = reads.traffic ?? ((period: AnalyticsPeriod) => trafficReport(store, period, now));
  const marketingOf = reads.marketing ?? ((period: AnalyticsPeriod) => marketingReport(store, period, now));
  return safe("the diagnosis", async () => {
    const { period } = params;
    const compare: "previous" | "year" = params.compare.mode === "year" ? "year" : "previous";
    const comparedWith = compare === "year" ? lastYearOf(period) : previousPeriodOf(period);
    const today = todayIn(now, store.timeZone);
    const settings = await getAnalyticsSettings(store.id);
    const counting = store.visitCounting;

    const [current, previous, traffic, trafficBefore, marketing, marketingBefore, geo, geoBefore, products, productsBefore, daily] = await Promise.all([
      periodTotals(store, period, settings),
      periodTotals(store, comparedWith, settings),
      counting ? safe("devices", () => trafficOf(period)) : null,
      counting ? safe("devices before", () => trafficOf(comparedWith)) : null,
      counting ? safe("channels", () => marketingOf(period)) : null,
      counting ? safe("channels before", () => marketingOf(comparedWith)) : null,
      safe("markets", () => geoReport(store, period)),
      safe("markets before", () => geoReport(store, comparedWith)),
      safe("products", () => productsReport(store, period)),
      safe("products before", () => productsReport(store, comparedWith)),
      // The days of the period that are over: today's partial day would read as a fall.
      safe("daily revenue", async () => (await seriesByBucket(store, period, "day", settings)).filter((p) => p.key < today).map((p) => ({ day: p.key, revenueMinor: p.revenueMinor }))),
    ]);

    // Visits count only where they cover a period from its first day.
    const covered = (r: typeof traffic) => (r && r.counting && !r.coverage.partial && r.sessions !== null ? r.sessions : null);
    const sessions = covered(traffic);
    const sessionsBefore = covered(trafficBefore);
    const visitsInBoth = sessions !== null && sessionsBefore !== null;

    const tables: SegmentTable[] = [];
    const notes: string[] = [];
    if (traffic && trafficBefore && visitsInBoth) {
      const device = (r: typeof traffic): Seg[] => r.byDevice.filter((row) => row.key !== "unknown").map((row) => ({ key: row.key, label: row.label, orders: row.orders, revenueMinor: row.revenueMinor, sessions: row.sessions }));
      tables.push(mergeSegments("device", device(traffic), device(trafficBefore), 0));
    }
    if (marketing?.table && marketingBefore?.table && visitsInBoth) {
      const channel = (r: NonNullable<typeof marketing>): Seg[] =>
        (r.table?.rows ?? []).filter((row) => !isNotAChannel(row.channel)).map((row) => ({ key: row.channel, label: row.label, orders: row.orders, revenueMinor: row.revenueMinor, sessions: row.sessions }));
      tables.push(mergeSegments("channel", channel(marketing), channel(marketingBefore), 0));
    }
    if (!visitsInBoth) {
      notes.push(counting ? "Visits were not counted for the whole of both periods, so devices and channels are left out and traffic is not separated from conversion." : "Visit counting is off, so devices and channels are left out and traffic is not separated from conversion.");
    }
    if (geo && geoBefore) {
      const market = (r: typeof geo): Seg[] => r.countries.map((row) => ({ key: row.code, label: row.name, orders: row.orders, revenueMinor: row.revenueMinor, sessions: null }));
      tables.push(mergeSegments("market", market(geo), market(geoBefore), null));
    }
    if (products && productsBefore) {
      const product = (r: typeof products): Seg[] => r.rows.filter((row) => !row.other && row.productId !== OTHER_ID).map((row) => ({ key: row.productId, label: row.name, orders: row.orders, revenueMinor: row.revenueMinor, sessions: null }));
      const table = mergeSegments("product", product(products), product(productsBefore), null);
      const moved = [...table.rows].sort((a, b) => Math.abs(b.current.revenueMinor - b.previous.revenueMinor) - Math.abs(a.current.revenueMinor - a.previous.revenueMinor) || (a.key < b.key ? -1 : 1)).slice(0, PRODUCT_MOVERS);
      tables.push({ dimension: "product", rows: moved });
    }
    if (period.to > addDays(today, 0) && period.from <= today) notes.push("This period includes today so far, so it is not a whole period against a whole one.");
    // Staff-made orders (D173) are paid orders for revenue, but were not visits: the conversion in this explanation is every paid order over sessions, which is not the Overview's rate.
    const staffNow = current.totals.orders - (current.totals.checkoutOrders ?? current.totals.orders);
    const staffBefore = previous.totals.orders - (previous.totals.checkoutOrders ?? previous.totals.orders);
    if (staffNow + staffBefore > 0) {
      notes.push(
        `Orders here include ${staffNow} staff-made ${staffNow === 1 ? "order" : "orders"} in this period and ${staffBefore} in the one compared with. They were not visits, so conversion in this explanation counts every paid order over sessions: it is not the Overview's conversion rate, which leaves them out.`,
      );
    }

    const explanation = explainChange({
      current: { revenueMinor: current.totals.revenueMinor, orders: current.totals.orders, sessions },
      previous: { revenueMinor: previous.totals.revenueMinor, orders: previous.totals.orders, sessions: sessionsBefore },
      segments: tables,
      ...(daily ? { daily } : {}),
      previousDays: comparedWith.days,
      currency: mainCurrency(store),
      locale: store.markets[0]?.locale ?? "en",
    });
    return { currency: mainCurrency(store), explanation, period, comparedWith, compare, basis: "Revenue before refunds, without VAT", notes };
  });
}
