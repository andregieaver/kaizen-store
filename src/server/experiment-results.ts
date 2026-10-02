import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { convertMinor } from "@/lib/currency";
import { harmedVersion, splitCheckP, verdictOf, type VariantFigures, type Verdict } from "@/lib/experiment-results";
import { GOAL_WORDS } from "@/lib/experiments";
import { mainCurrency } from "@/lib/markets";

import type { ExperimentInfo } from "./experiment-admin";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * What an A/B test found (D148, docs/ab-testing.md), worked out in code from the tables on every look: the exposed
 * visitors of each version, who of them ordered (a paid order of a cart they were tied to, after they first saw the version
 * and while the test ran), added to the cart, started checkout or clicked, and what their orders came to without VAT, in
 * the store's main currency at its rates. Copied orders and hosts' orders never count.
 */

const PAID = sql`('paid', 'fulfilled', 'closed')`;

export type DayFigures = { day: string; variants: Record<string, { visitors: number; conversions: number }> };

export type ExperimentResults = {
  /** What was compared, for the primary goal. */
  figures: VariantFigures[];
  /** The funnel for every version, whatever the primary goal: exposed, added to cart, started checkout, ordered. */
  funnel: Record<string, { visitors: number; carts: number; checkouts: number; buyers: number; clicks: number; forms: number }>;
  /** Revenue without VAT per version in the store's main currency (winsorised for the comparison), and the plain sum. */
  revenue: Record<string, { sum: number; plain: number }>;
  currency: string;
  /** Visitors' orders in a currency that could not be converted into the main one: they count as orders, but not in the revenue. */
  unconverted: number;
  daily: DayFigures[];
  /** The primary goal's conversions per version by week since the start, to see whether the first week differed. */
  weekly: { week: number; variants: Record<string, { visitors: number; conversions: number }> }[];
  splitP: number;
  days: number;
  verdict: Verdict;
  /** A version that clearly lowers orders: the guardrail's stop. */
  harmed: string | null;
};

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The value at a share of the sorted values (linear between neighbours). */
function percentile(sorted: number[], share: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * share;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

export async function experimentResults(store: Pick<Store, "id" | "markets" | "localization">, test: ExperimentInfo, now = new Date()): Promise<ExperimentResults> {
  const [exposures, events, orders, daysRows] = await Promise.all([
    db().execute<Row>(sql`
      select variant, count(*)::int as visitors from commerce.experiment_exposures where experiment_id = ${test.id}::uuid and store_id = ${store.id}::uuid group by variant
    `),
    db().execute<Row>(sql`
      select variant, goal, count(distinct visitor)::int as n from commerce.experiment_events where experiment_id = ${test.id}::uuid and store_id = ${store.id}::uuid group by variant, goal
    `),
    db().execute<Row>(sql`
      select x.variant, x.visitor, o.currency, min(o.placed_at) as at, sum(o.total_minor - o.tax_minor)::bigint as net
      from commerce.experiment_exposures x
      join commerce.experiments e on e.id = x.experiment_id
      join commerce.experiment_carts c on c.store_id = x.store_id and c.visitor = x.visitor
      join commerce.orders o on o.store_id = c.store_id and o.cart_id = c.cart_id and o.status in ${PAID} and o.copied_from is null and o.host_id is null
        and o.placed_at >= x.first_seen and o.placed_at <= coalesce(e.stopped_at, ${now.toISOString()}::timestamptz)
      where x.experiment_id = ${test.id}::uuid and x.store_id = ${store.id}::uuid
      group by x.variant, x.visitor, o.currency
    `),
    db().execute<Row>(sql`
      select to_char(first_seen at time zone 'utc', 'YYYY-MM-DD') as day, variant, count(*)::int as n
      from commerce.experiment_exposures where experiment_id = ${test.id}::uuid and store_id = ${store.id}::uuid group by 1, 2
    `),
  ]);

  const keys = test.variants.map((v) => v.key);
  const currency = mainCurrency(store);
  const rates = store.localization.rates;

  // Orders: each visitor's value in the main currency, then capped at the 99th percentile of buyers' values. An order
  // in a currency that cannot be converted at the store's rates still makes its visitor a buyer, but adds no revenue.
  const perVisitor = new Map<string, { variant: string; net: number; at: Date }>();
  let unconverted = 0;
  for (const r of orders) {
    const net = convertMinor(Number(r.net), String(r.currency).trim(), currency, rates);
    if (net === null) unconverted += 1;
    const key = String(r.visitor);
    const at = new Date(String(r.at).replace(/([+-]\d\d)$/, "$1:00"));
    const had = perVisitor.get(key);
    perVisitor.set(key, { variant: String(r.variant), net: (had?.net ?? 0) + (net ?? 0), at: had && had.at < at ? had.at : at });
  }
  const values = [...perVisitor.values()].map((v) => v.net).sort((a, b) => a - b);
  const cap = values.length >= 2 ? percentile(values, 0.99) : (values[0] ?? 0);

  const funnel: ExperimentResults["funnel"] = Object.fromEntries(keys.map((k) => [k, { visitors: 0, carts: 0, checkouts: 0, buyers: 0, clicks: 0, forms: 0 }]));
  for (const r of exposures) if (funnel[String(r.variant)]) funnel[String(r.variant)].visitors = Number(r.visitors);
  for (const r of events) {
    const f = funnel[String(r.variant)];
    if (!f) continue;
    const n = Number(r.n);
    if (r.goal === "cart") f.carts = n;
    else if (r.goal === "checkout") f.checkouts = n;
    else if (r.goal === "click") f.clicks = n;
    else if (r.goal === "form") f.forms = n;
  }
  const revenue: ExperimentResults["revenue"] = Object.fromEntries(keys.map((k) => [k, { sum: 0, plain: 0 }]));
  const sumSq: Record<string, number> = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const v of perVisitor.values()) {
    if (!funnel[v.variant]) continue;
    funnel[v.variant].buyers += 1;
    const capped = Math.min(v.net, cap);
    revenue[v.variant].plain += v.net;
    revenue[v.variant].sum += capped;
    sumSq[v.variant] += capped * capped;
  }

  const goal = test.goal;
  const conversions = (k: string) => (goal === "orders" ? funnel[k].buyers : goal === "cart" ? funnel[k].carts : goal === "checkout" ? funnel[k].checkouts : goal === "click" ? funnel[k].clicks : goal === "form" ? funnel[k].forms : 0);
  const figures: VariantFigures[] = test.variants.map((v) => ({
    key: v.key,
    name: v.name,
    visitors: funnel[v.key].visitors,
    conversions: conversions(v.key),
    money: goal === "revenue" ? { sum: revenue[v.key].sum, sumSq: sumSq[v.key] } : null,
  }));

  // The chart: each day's new visitors and the day each of them first converted, per version.
  const startedAt = test.startedAt ? new Date(test.startedAt) : now;
  const end = test.stoppedAt ? new Date(test.stoppedAt) : now;
  const byDay = new Map<string, DayFigures["variants"]>();
  const touch = (d: string, k: string) => {
    const m = byDay.get(d) ?? Object.fromEntries(keys.map((x) => [x, { visitors: 0, conversions: 0 }]));
    byDay.set(d, m);
    return m[k];
  };
  for (const r of daysRows) if (keys.includes(String(r.variant))) touch(String(r.day), String(r.variant)).visitors += Number(r.n);
  if (goal === "orders") for (const v of perVisitor.values()) if (keys.includes(v.variant)) touch(day(v.at), v.variant).conversions += 1;
  // Cart, checkout, click and form days come from the events.
  if (goal === "cart" || goal === "checkout" || goal === "click" || goal === "form") {
    const rows = await db().execute<Row>(sql`
      select to_char(occurred_at at time zone 'utc', 'YYYY-MM-DD') as day, variant, count(distinct visitor)::int as n
      from commerce.experiment_events where experiment_id = ${test.id}::uuid and store_id = ${store.id}::uuid and goal = ${goal} group by 1, 2
    `);
    for (const r of rows) if (keys.includes(String(r.variant))) touch(String(r.day), String(r.variant)).conversions += Number(r.n);
  }
  const daily = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, variants]) => ({ day: d, variants }));
  const weeks = new Map<number, DayFigures["variants"]>();
  for (const d of daily) {
    const week = Math.max(0, Math.floor((new Date(`${d.day}T00:00:00Z`).getTime() - Date.UTC(startedAt.getUTCFullYear(), startedAt.getUTCMonth(), startedAt.getUTCDate())) / (7 * 86_400_000)));
    const m = weeks.get(week) ?? Object.fromEntries(keys.map((k) => [k, { visitors: 0, conversions: 0 }]));
    weeks.set(week, m);
    for (const k of keys) {
      m[k].visitors += d.variants[k].visitors;
      m[k].conversions += d.variants[k].conversions;
    }
  }
  const weekly = [...weeks.entries()].sort(([a], [b]) => a - b).map(([week, variants]) => ({ week: week + 1, variants }));

  const days = Math.max(0, Math.floor((end.getTime() - startedAt.getTime()) / 86_400_000));
  const splitP = splitCheckP(figures.map((f) => f.visitors), test.variants.map((v) => v.share));
  const verdict = verdictOf({
    goal: GOAL_WORDS[goal] ? goal : "orders",
    figures,
    splitP,
    days,
    minVisitors: test.minVisitors,
    minDays: test.minDays,
    currency,
    locale: store.markets[0]?.locale ?? "en",
  });
  const harmed = harmedVersion(
    figures,
    Object.fromEntries(keys.map((k) => [k, funnel[k].buyers])),
  );
  return { figures, funnel, revenue, currency, unconverted, daily, weekly, splitP, days, verdict, harmed };
}
