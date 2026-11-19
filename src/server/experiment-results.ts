import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { zoneOf } from "@/lib/admin-date";
import { convertMinor } from "@/lib/currency";
import { splitCheckP, verdictOf, type VariantFigures, type Verdict } from "@/lib/experiment-results";
import {
  checkGuardrail,
  guardrailStop,
  RETURNS_DAYS,
  returnsStillComing,
  SLOW_LCP_MS,
  type GuardrailCheck,
  type StoppingGuardrail,
} from "@/lib/experiment-guardrails";
import type { ExperimentsMessages } from "@/lib/admin-messages/experiments.en";
import { GOAL_WORDS } from "@/lib/experiments";
import { mainCurrency } from "@/lib/markets";
import { dayIn, daysBetween } from "@/lib/work-dates";

import type { ExperimentInfo } from "./experiment-admin";
import { col, typedRows } from "./typed-rows";
import type { Store } from "./stores";
import { experimentsEn } from "@/lib/admin-messages/experiments.en";

type Row = Record<string, unknown>;

/**
 * What an A/B test found (D148, docs/ab-testing.md), worked out in code from the tables on every look: the exposed
 * visitors of each version, who of them ordered (a paid order of a cart they were tied to, after they first saw the version
 * and while the test ran), added to the cart, started checkout or clicked, and what their orders came to without VAT, in
 * the store's main currency at its rates. Copied orders and hosts' orders never count.
 *
 * Days are the store's own (D812): an exposure, a conversion and a test's start fall on the day of the store's clock (`store.timeZone`), as the
 * store's visits do (`visits.day`), so an evening visitor in New York or a morning one in Auckland is counted on the day the store saw them.
 * Kaizena Flow's own store has the platform's zone, so its tests read the platform's days.
 */

const PAID = sql`('paid', 'fulfilled', 'closed')`;

/** A day's new visitors, or a day's conversions, per version: the day is the store's (D812). */
const DAY_ROW = z.object({ day: col.text, variant: col.text, n: col.int });

/** `day` is a calendar day on the store's clock, `YYYY-MM-DD` (D812). */
export type DayFigures = { day: string; variants: Record<string, { visitors: number; conversions: number }> };

export type ExperimentResults = {
  /** What was compared, for the primary goal. */
  figures: VariantFigures[];
  /** The funnel for every version, whatever the primary goal: exposed, added to cart, started checkout, ordered. */
  funnel: Record<string, { visitors: number; carts: number; checkouts: number; buyers: number; clicks: number; forms: number; signups: number; pages: number }>;
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
  /** The version a guardrail stops the test for (D148 phase 19: fewer orders, failed payments at checkout or slower pages), and which. */
  harmed: string | null;
  harmedBy: StoppingGuardrail | null;
  /** Every guardrail's state, in the order orders, speed, checkout, returns. */
  guardrails: GuardrailCheck[];
};

/** The value at a share of the sorted values (linear between neighbours). */
function percentile(sorted: number[], share: number): number {
  if (sorted.length === 0) return 0;
  const at = (sorted.length - 1) * share;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
}

/** `say` writes the verdict in the account's words (D312 A7); without it the verdict is English, as the AI manager's tools read it. */
export async function experimentResults(
  store: Pick<Store, "id" | "markets" | "localization" | "visitCounting" | "timeZone">,
  test: ExperimentInfo,
  now = new Date(),
  say?: { words: ExperimentsMessages; numberLocale: string },
): Promise<ExperimentResults> {
  const zone = zoneOf(store);
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
    typedRows(
      DAY_ROW,
      sql`
        select to_char(first_seen at time zone ${zone}, 'YYYY-MM-DD') as day, variant, count(*)::int as n
        from commerce.experiment_exposures where experiment_id = ${test.id}::uuid and store_id = ${store.id}::uuid group by 1, 2
      `,
    ),
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

  const funnel: ExperimentResults["funnel"] = Object.fromEntries(keys.map((k) => [k, { visitors: 0, carts: 0, checkouts: 0, buyers: 0, clicks: 0, forms: 0, signups: 0, pages: 0 }]));
  for (const r of exposures) if (funnel[String(r.variant)]) funnel[String(r.variant)].visitors = Number(r.visitors);
  for (const r of events) {
    const f = funnel[String(r.variant)];
    if (!f) continue;
    const n = Number(r.n);
    if (r.goal === "cart") f.carts = n;
    else if (r.goal === "checkout") f.checkouts = n;
    else if (r.goal === "click") f.clicks = n;
    else if (r.goal === "form") f.forms = n;
    else if (r.goal === "signup") f.signups = n;
    else if (r.goal === "page") f.pages = n;
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
  const conversions = (k: string) => (goal === "orders" ? funnel[k].buyers : goal === "cart" ? funnel[k].carts : goal === "checkout" ? funnel[k].checkouts : goal === "click" ? funnel[k].clicks : goal === "form" ? funnel[k].forms : goal === "signup" ? funnel[k].signups : goal === "page" ? funnel[k].pages : 0);
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
  for (const r of daysRows) if (keys.includes(r.variant)) touch(r.day, r.variant).visitors += r.n;
  if (goal === "orders") for (const v of perVisitor.values()) if (keys.includes(v.variant)) touch(dayIn(v.at, zone), v.variant).conversions += 1;
  // Cart, checkout, click, form, sign-up and page days come from the events.
  if (goal === "cart" || goal === "checkout" || goal === "click" || goal === "form" || goal === "signup" || goal === "page") {
    const rows = await typedRows(
      DAY_ROW,
      sql`
        select to_char(occurred_at at time zone ${zone}, 'YYYY-MM-DD') as day, variant, count(distinct visitor)::int as n
        from commerce.experiment_events where experiment_id = ${test.id}::uuid and store_id = ${store.id}::uuid and goal = ${goal} group by 1, 2
      `,
    );
    for (const r of rows) if (keys.includes(r.variant)) touch(r.day, r.variant).conversions += r.n;
  }
  const daily = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, variants]) => ({ day: d, variants }));
  const weeks = new Map<number, DayFigures["variants"]>();
  const startDay = dayIn(startedAt, zone);
  for (const d of daily) {
    const week = Math.max(0, Math.floor(daysBetween(startDay, d.day) / 7));
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
    words: say?.words ?? experimentsEn,
    ...(say && { numberLocale: say.numberLocale }),
  });
  const watched = await guardrailCounts(store, test, now, zone);
  const count = (pick: (k: string) => { n: number; bad: number }) => keys.map((key) => ({ key, ...pick(key) }));
  const guardrails = [
    checkGuardrail("orders", count((k) => ({ n: funnel[k].visitors, bad: funnel[k].buyers }))),
    checkGuardrail("speed", count((k) => watched.speed.get(k) ?? { n: 0, bad: 0 }), { off: !store.visitCounting }),
    checkGuardrail("checkout", count((k) => ({ n: funnel[k].checkouts, bad: watched.failed.get(k) ?? 0 }))),
    checkGuardrail("returns", count((k) => watched.returns.get(k) ?? { n: 0, bad: 0 }), {
      stillComing: returnsStillComing(test.stoppedAt ? new Date(test.stoppedAt) : null, now),
    }),
  ];
  const stop = guardrailStop(guardrails);
  return { figures, funnel, revenue, currency, unconverted, daily, weekly, splitP, days, verdict, harmed: stop?.version ?? null, harmedBy: stop?.kind ?? null, guardrails };
}

/**
 * What the guardrails count beyond the funnel (D148 phase 19), per version:
 * - **speed**: the page loads whose A/B cookie confirmed this version (`speed_samples.ab`, kept only while the store counts visits), and
 *   those slower than `SLOW_LCP_MS` to show their main content;
 * - **failed**: visitors who started checkout and whose order, placed after they first saw the version and while the test ran, has a failed
 *   payment, and who never got a paid order in that time;
 * - **returns**: visitors with a paid order in the test (one cancelled after it was paid included) and those of them with a return asked for
 *   or a refund made within `RETURNS_DAYS` of the order (a refund of an order change or an exchange is neither).
 * Copied orders and hosts' orders never count, as in the funnel.
 */
async function guardrailCounts(store: { id: string }, test: ExperimentInfo, now: Date, zone: string) {
  // `speed_samples.day` is the store's day, as the start's here; a day before it is kept for a store whose zone changed meanwhile.
  const startedDay = dayIn(test.startedAt ? new Date(test.startedAt) : now, zone);
  const until = (test.stoppedAt ? new Date(test.stoppedAt) : now).toISOString();
  const [speedRows, failedRows, returnRows] = await Promise.all([
    typedRows(
      z.object({ tag: col.text, loads: col.int, slow: col.int }),
      sql`
        select t.tag, count(*)::int as loads, count(*) filter (where s.lcp_ms > ${SLOW_LCP_MS})::int as slow
        from commerce.speed_samples s cross join unnest(s.ab) as t(tag)
        where s.store_id = ${store.id}::uuid and s.day >= ${startedDay}::date - 1 and s.lcp_ms is not null and t.tag like ${`${test.id}:%`}
        group by t.tag
      `,
    ),
    typedRows(
      z.object({ variant: col.text, n: col.int }),
      sql`
        select x.variant, count(distinct x.visitor)::int as n
        from commerce.experiment_exposures x
        join commerce.experiment_carts c on c.store_id = x.store_id and c.visitor = x.visitor
        join commerce.orders o on o.store_id = c.store_id and o.cart_id = c.cart_id and o.copied_from is null and o.host_id is null
          and o.placed_at >= x.first_seen and o.placed_at <= ${until}::timestamptz
        where x.experiment_id = ${test.id}::uuid and x.store_id = ${store.id}::uuid
          and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'failed')
          and not exists (
            select 1 from commerce.experiment_carts c2
            join commerce.orders o2 on o2.store_id = c2.store_id and o2.cart_id = c2.cart_id and o2.status in ${PAID}
              and o2.copied_from is null and o2.host_id is null and o2.placed_at >= x.first_seen and o2.placed_at <= ${until}::timestamptz
            where c2.store_id = x.store_id and c2.visitor = x.visitor
          )
        group by x.variant
      `,
    ),
    typedRows(
      z.object({ variant: col.text, buyers: col.int, returned: col.int }),
      sql`
        select variant, count(*)::int as buyers, count(*) filter (where returned)::int as returned
        from (
          select x.variant, x.visitor, bool_or(
            exists (
              select 1 from commerce.returns r
              where r.store_id = o.store_id and r.order_id = o.id and r.status <> 'cancelled'
                and r.created_at <= o.placed_at + make_interval(days => ${RETURNS_DAYS})
            )
            or exists (
              select 1 from commerce.refunds f join commerce.payments p on p.store_id = f.store_id and p.id = f.payment_id
              where p.store_id = o.store_id and p.order_id = o.id and f.status = 'succeeded' and f.kind in ('money', 'store_credit')
                and f.order_edit_id is null and f.exchange_id is null and f.created_at <= o.placed_at + make_interval(days => ${RETURNS_DAYS})
            )
          ) as returned
          from commerce.experiment_exposures x
          join commerce.experiment_carts c on c.store_id = x.store_id and c.visitor = x.visitor
          join commerce.orders o on o.store_id = c.store_id and o.cart_id = c.cart_id and o.copied_from is null and o.host_id is null
            and o.placed_at >= x.first_seen and o.placed_at <= ${until}::timestamptz
            and (o.status in ${PAID} or (o.status = 'cancelled'
              and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured')))
          where x.experiment_id = ${test.id}::uuid and x.store_id = ${store.id}::uuid
          group by x.variant, x.visitor
        ) per_visitor
        group by variant
      `,
    ),
  ]);
  const speed = new Map<string, { n: number; bad: number }>();
  for (const r of speedRows) {
    const key = r.tag.slice(test.id.length + 1);
    const had = speed.get(key) ?? { n: 0, bad: 0 };
    speed.set(key, { n: had.n + r.loads, bad: had.bad + r.slow });
  }
  return {
    speed,
    failed: new Map(failedRows.map((r) => [r.variant, r.n])),
    returns: new Map(returnRows.map((r) => [r.variant, { n: r.buyers, bad: r.returned }])),
  };
}
