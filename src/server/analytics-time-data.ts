import "server-only";

import { sql } from "drizzle-orm";

import { safeRatio } from "@/lib/analytics-core";
import { buildHeatmap, type Heatmap, type HeatmapRow } from "@/lib/analytics-heatmap";
import { addDays, type AnalyticsPeriod } from "@/lib/analytics-period";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { dayKey, dayOf, inMain, inPeriod, num, PAID, REVENUE_EX_VAT, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * Sales by weekday, hour and day for the Traffic page (D152, docs/analytics.md).
 *
 * How it is read:
 *
 * - Paid orders (`PAID`), by `placed_at` in the store's time zone: its weekday (ISO, 1 = Monday), hour (0-23) and calendar day.
 *   Revenue is `total_minor - tax_minor`, without VAT. Two reads, one grouped by weekday, hour and currency (at most 168 rows per
 *   currency) and one by day and currency (one row per day with sales), each converted at today's rates in code; so in a
 *   store selling in several currencies the two sums can differ from each other by the rounding of converting each group (a minor
 *   unit or so), never otherwise. Orders in a currency with no rate are left out and counted (`unconverted`).
 * - The days of the period are all there, with zeros for the days with no sale; `weekdayDays` says how many of each weekday the
 *   period holds, so a page can show per-day averages and not favour a weekday the period had more of.
 * - An hour that daylight saving repeats (the autumn change) lands in one cell, and the spring's missing hour has none.
 */

export type DailyPoint = {
  /** `YYYY-MM-DD`, the store's day. */
  day: string;
  /** 1 (Monday) to 7 (Sunday). */
  weekday: number;
  orders: number;
  revenueMinor: number;
};

export type TimePeak = { orders: number; revenueMinor: number };

export type TimeReport = {
  /** The main currency of every amount. */
  currency: string;
  period: { from: string; to: string; days: number };
  /** The weekday x hour rows (only cells with sales), as `buildHeatmap()` takes them. */
  rows: HeatmapRow[];
  /** `buildHeatmap(rows)`: cells, totals, peaks. */
  heatmap: Heatmap;
  /** How many of each weekday the period holds, Monday first (7 numbers). */
  weekdayDays: number[];
  /** The weekday with the most orders (the earlier one on a tie, as the heatmap's `peakWeekday`); null with no orders. */
  bestWeekday: ({ weekday: number } & TimePeak) | null;
  /** The hour of the day (0-23, in the store's time zone) with the most orders (the earlier one on a tie); null with no orders. */
  bestHour: ({ hour: number } & TimePeak) | null;
  /** The day of the period with the most revenue (orders break a tie, then the earlier day); null with no sales. */
  bestDay: DailyPoint | null;
  /** Every day of the period, in order. */
  daily: DailyPoint[];
  /** The period's figures, from the daily points. */
  totals: { orders: number; revenueMinor: number; aovMinor: number | null };
  /** Orders left out because their currency has no rate, and those currencies. */
  unconverted: number;
  missingCurrencies: string[];
};

function convertibleCurrencies(store: Store): Set<string> {
  const main = mainCurrency(store).trim();
  const rates = store.localization.rates;
  const list = new Set<string>([main]);
  for (const currency of rates.keys()) if (canConvert(currency, main, rates)) list.add(currency.trim());
  return list;
}

const asCurrency = (r: Row) => ({ ...r, currency: String(r.currency).trim() });

/** The ISO weekday (1-7) of a `YYYY-MM-DD` day. */
function isoWeekday(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

export async function timeReport(store: Store, period: Pick<AnalyticsPeriod, "from" | "to" | "days">): Promise<TimeReport> {
  const convertible = convertibleCurrencies(store);
  const inRange = inPeriod(store, sql`o.placed_at`, period);
  const local = sql`(o.placed_at at time zone ${store.timeZone})`;

  const [cellRows, dayRows] = await Promise.all([
    setBased<Row>(sql`
      select extract(isodow from ${local})::int as weekday, extract(hour from ${local})::int as hour, o.currency::text as currency,
        count(*) as orders, sum(${REVENUE_EX_VAT}) as revenue
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inRange}
      group by 1, 2, 3
    `),
    setBased<Row>(sql`
      select (${dayOf(store, sql`o.placed_at`)})::text as day, o.currency::text as currency, count(*) as orders, sum(${REVENUE_EX_VAT}) as revenue
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inRange}
      group by 1, 2
    `),
  ]);

  // The weekday x hour matrix.
  const cells = new Map<string, { weekday: number; hour: number; rows: Row[] }>();
  for (const r of cellRows) {
    if (!convertible.has(String(r.currency).trim())) continue;
    const key = `${num(r, "weekday")}:${num(r, "hour")}`;
    const cell = cells.get(key) ?? { weekday: num(r, "weekday"), hour: num(r, "hour"), rows: [] };
    cell.rows.push(r);
    cells.set(key, cell);
  }
  const rows: HeatmapRow[] = [...cells.values()]
    .map((c) => ({
      weekday: c.weekday,
      hour: c.hour,
      orders: c.rows.reduce((s, r) => s + num(r, "orders"), 0),
      revenueMinor: inMain(store, c.rows.map(asCurrency), ["revenue"]).values.revenue,
    }))
    .sort((a, b) => a.weekday - b.weekday || a.hour - b.hour);
  const heatmap = buildHeatmap(rows);

  // The days, with zeros where nothing sold.
  const byDay = new Map<string, Row[]>();
  for (const r of dayRows) {
    if (!convertible.has(String(r.currency).trim())) continue;
    const key = dayKey(r.day);
    byDay.set(key, [...(byDay.get(key) ?? []), r]);
  }
  const daily: DailyPoint[] = [];
  const weekdayDays = Array.from({ length: 7 }, () => 0);
  for (let day = period.from; day < period.to; day = addDays(day, 1)) {
    const group = byDay.get(day) ?? [];
    const weekday = isoWeekday(day);
    weekdayDays[weekday - 1] += 1;
    daily.push({
      day,
      weekday,
      orders: group.reduce((s, r) => s + num(r, "orders"), 0),
      revenueMinor: group.length === 0 ? 0 : inMain(store, group.map(asCurrency), ["revenue"]).values.revenue,
    });
  }
  let bestDay: DailyPoint | null = null;
  for (const p of daily) {
    if (p.revenueMinor > 0 && (!bestDay || p.revenueMinor > bestDay.revenueMinor || (p.revenueMinor === bestDay.revenueMinor && p.orders > bestDay.orders))) bestDay = p;
  }

  const totalOrders = daily.reduce((s, p) => s + p.orders, 0);
  const totalRevenue = daily.reduce((s, p) => s + p.revenueMinor, 0);

  const bestRow = heatmap.peakWeekday === null ? null : heatmap.rowTotals[heatmap.peakWeekday - 1];
  const bestCol = heatmap.peakHour === null ? null : heatmap.colTotals[heatmap.peakHour];

  const left = [...cellRows, ...dayRows].filter((r) => !convertible.has(String(r.currency).trim()));
  const leftDay = dayRows.filter((r) => !convertible.has(String(r.currency).trim()));

  return {
    currency: mainCurrency(store),
    period: { from: period.from, to: period.to, days: period.days },
    rows,
    heatmap,
    weekdayDays,
    bestWeekday: bestRow && heatmap.peakWeekday !== null ? { weekday: heatmap.peakWeekday, orders: bestRow.orders, revenueMinor: bestRow.revenueMinor } : null,
    bestHour: bestCol && heatmap.peakHour !== null ? { hour: heatmap.peakHour, orders: bestCol.orders, revenueMinor: bestCol.revenueMinor } : null,
    bestDay,
    daily,
    totals: { orders: totalOrders, revenueMinor: totalRevenue, aovMinor: aov(totalRevenue, totalOrders) },
    // Each unconverted order is in both reads; count the day read's.
    unconverted: leftDay.reduce((s, r) => s + num(r, "orders"), 0),
    missingCurrencies: [...new Set(left.map((r) => String(r.currency).trim()))].sort(),
  };
}

function aov(revenue: number, orders: number): number | null {
  const mean = safeRatio(revenue, orders);
  return mean === null ? null : Math.round(mean);
}
