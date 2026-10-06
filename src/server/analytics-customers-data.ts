import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  buildCohorts,
  cohortTrend,
  ltvHistoric,
  ltvPredicted,
  newVsReturning,
  purchaseFrequency,
  repeatRates,
  rfm,
  RFM_MIN_CUSTOMERS,
  segmentSummary,
  type CohortTable,
  type CohortTrend,
  type CustomerAggregate,
  type HistoricLtv,
  type NewVsReturning,
  type OrderMonth,
  type PeriodCustomer,
  type PredictedLtv,
  type RepeatRate,
  type SegmentSummary,
} from "@/lib/analytics-customers";
import { todayIn, type AnalyticsPeriod } from "@/lib/analytics-period";
import type { AnalyticsSettings } from "@/lib/analytics-settings";
import { convertMinor } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { CUSTOMER_JOIN, CUSTOMER_KEY, HAS_CUSTOMER, dayStart, inPeriod, num, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * The Customers page's figures (D152, docs/analytics.md): new and returning customers, repeat purchase rate, purchase
 * frequency, lifetime value, cohorts and RFM segments. One set-based query reads every customer's paid orders to date
 * (the customer key of the doc, an account's orders following the account), aggregated per customer; a second one names
 * the twenty best customers. Everything that is a rate, a score or a verdict is worked out by `@/lib/analytics-customers`.
 *
 * Money is in the store's main currency without VAT. SQL groups each customer's amounts by the currency the shopper saw
 * and by month (in the store's time zone); they are converted here, at today's rates, one amount at a time, so a
 * customer's figure is always the sum of their months'. Costs are already in the main currency and are never converted.
 */

/** The most customers read; the page says so when it is reached (`truncated`). The most recently active are kept. */
export const CUSTOMER_CAP = 200_000;
/** How many of the best customers are listed. */
export const TOP_CUSTOMERS = 20;
/** Cohorts shown: 13 months, so that a cohort a year and a month old can have its month 12. */
export const COHORT_COUNT = 13;
/** The longest month offset of the cohort table. */
export const COHORT_MONTHS = 12;

export type TopCustomer = {
  /** The customer key: their email, lower-cased. */
  key: string;
  email: string;
  /** Their account's name, else the name on their latest order; null when neither is filled in. */
  name: string | null;
  /** The id in the customer's admin address, `/admin/{store}/customers/{customerId}`: the account's, else their latest order's. */
  customerId: string;
  /** Whether they have an account. */
  account: boolean;
  /** Paid orders placed in the period, and what they came to (net of refunds, without VAT). */
  orders: number;
  revenueMinor: number;
  /** Paid orders to date. */
  lifetimeOrders: number;
  /** Their latest paid order, ISO. */
  lastOrderAt: string;
};

export type CustomersReport = {
  /** The main currency of every amount. */
  currency: string;
  /** The period asked for, and what day and instant the figures were made for (cohort months are in the store's time zone). */
  period: { from: string; to: string; days: number };
  today: string;
  now: string;
  /** Customers with a paid order to date, among those read. */
  customers: number;
  newVsReturning: NewVsReturning;
  /** Repeat purchase rate for 30, 90, 180 and 365 days. */
  repeatRates: RepeatRate[];
  /** Paid orders over distinct customers in the 365 days up to `now`. */
  frequency: { orders365: number; customers365: number; perCustomer: number | null };
  ltv: {
    historic: HistoricLtv;
    predicted: PredictedLtv;
    /** What the predicted figure was made of, for the page to show. */
    inputs: {
      /** Contribution of an order before marketing spend, over the customers whose costs are known; null when none are. */
      contributionPerOrderMinor: number | null;
      revenuePerOrderMinor: number | null;
      ordersPerYear: number | null;
      lifespanYears: number;
      /** Customers (and their orders) the contribution per order is made of. */
      contributionCustomers: number;
      contributionOrders: number;
    };
  };
  cohorts: CohortTable;
  cohortTrend: CohortTrend;
  segments: {
    /** Fewer customers than this and the segments are too thin to show without saying so. */
    enough: boolean;
    minCustomers: number;
    /** Customers scored. */
    customers: number;
    summary: SegmentSummary[];
  };
  /** The best customers by net revenue in the period. */
  topCustomers: TopCustomer[];
  /** More customers than `cap` have paid orders: only the cap's worth with the latest orders were read. */
  truncated: boolean;
  cap: number;
  /** Customers with an amount in a currency that has no rate: left out of the money figures that need it, never counted as zero. */
  unconverted: number;
  /** Those currencies. */
  missingRates: string[];
};

/** What the aggregate query returns for a customer: their months and their period, as JSON. */
type MonthRow = { month: string; currency: string; orders: number; net: number; contribution: number };
type PeriodRow = { currency: string; orders: number; net: number };

const iso = (value: unknown): string => new Date(value as string | Date).toISOString();

/**
 * Everything about the store's customers to date, in a form the pure library takes: one row per customer, the most recently
 * active first, at most `CUSTOMER_CAP + 1` (the extra one only says there are more).
 */
async function readCustomers(store: Store, period: AnalyticsPeriod, settings: AnalyticsSettings, now: Date, cap: number): Promise<Row[]> {
  const nowIso = now.toISOString();
  const id = store.id;
  // `ord` is one row per paid order with what the figures need of its payments, refunds and lines. Those three are summed per order
  // in subqueries of their own table, joined to the orders on the table's own column, so the planner can estimate every join from
  // statistics (a join between two derived tables is guessed at 1/200 of their product, which made this a ten-second query).
  // An inner join to the captured payments is the paid-order rule (a captured payment exists). Each order's net revenue and
  // contribution are worked out once, here; the groupings below (`m` per customer, month and currency, `cust` per customer, `during`
  // per customer and currency in the period) are narrow sums over that, so none of them outgrows the memory a hash aggregate gets.
  return setBased<Row>(sql`
    with ord as materialized (
      select ${CUSTOMER_KEY} as customer_key, o.placed_at, trim(o.currency) as currency,
        ${inPeriod(store, sql`o.placed_at`, period)} as in_period,
        to_char(o.placed_at at time zone ${store.timeZone}, 'YYYY-MM') as month,
        n.net, n.net - o.total_minor::numeric * ${settings.paymentFeeBps}::numeric / 10000 - coalesce(pf.fee, 0) as contribution,
        coalesce(ln.cogs, 0) + ${settings.paymentFeeFixedMinor}::bigint + case when coalesce(ln.physical, false) then ${settings.shippingCostMinor}::bigint else 0 end as cost_main,
        coalesce(ln.unknown, false) as unknown
      from commerce.orders o
      ${CUSTOMER_JOIN}
      join (
        select p.order_id, sum(p.kaizen_fee_minor) as fee
        from commerce.payments p
        where p.store_id = ${id}::uuid and p.status = 'captured'
        group by p.order_id
      ) pf on pf.order_id = o.id
      left join (
        select p.order_id, sum(r.amount_minor)::numeric as amount
        from commerce.refunds r
        join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
        where r.store_id = ${id}::uuid and r.status = 'succeeded'
        group by p.order_id
      ) rf on rf.order_id = o.id
      left join (
        select ol.order_id, sum(coalesce(ol.unit_cost_minor, 0) * ol.quantity)::bigint as cogs,
          bool_or((ol.variant_id is not null or ol.custom) and ol.unit_cost_minor is null) as unknown,
          bool_or(ol.delivery = 'physical') as physical
        from commerce.order_lines ol
        where ol.store_id = ${id}::uuid
        group by ol.order_id
      ) ln on ln.order_id = o.id
      cross join lateral (
        select (o.total_minor - o.tax_minor)::numeric - coalesce(rf.amount * (o.total_minor - o.tax_minor)::numeric / nullif(o.total_minor::numeric, 0), 0) as net
      ) n
      where o.store_id = ${id}::uuid and o.copied_from is null and o.host_id is null and ${HAS_CUSTOMER}
    ),
    cust as (
      select customer_key, min(placed_at) as first_at, max(placed_at) as last_at, count(*)::int as orders,
        count(*) filter (where placed_at > (select ${nowIso}::timestamptz - interval '365 days') and placed_at <= ${nowIso}::timestamptz)::int as orders_365,
        sum(cost_main) as cost_main, bool_or(unknown) as unknown, (array_agg(placed_at order by placed_at))[2] as second_at
      from ord
      group by customer_key
    ),
    capped as (
      select * from cust order by last_at desc, customer_key limit ${cap + 1}
    ),
    months as (
      select m.customer_key, json_agg(json_build_object('month', m.month, 'currency', m.currency, 'orders', m.n, 'net', round(m.net), 'contribution', round(m.contribution))) as months
      from (
        select customer_key, month, currency, count(*)::int as n, sum(net) as net, sum(contribution) as contribution
        from ord
        group by customer_key, month, currency
      ) m
      join capped using (customer_key)
      group by m.customer_key
    ),
    during as (
      select d.customer_key, json_agg(json_build_object('currency', d.currency, 'orders', d.n, 'net', round(d.net))) as period
      from (
        select customer_key, currency, count(*)::int as n, sum(net) as net
        from ord
        where in_period
        group by customer_key, currency
      ) d
      join capped using (customer_key)
      group by d.customer_key
    )
    select c.customer_key, c.first_at, c.second_at, c.last_at, c.orders, c.orders_365, c.cost_main, c.unknown, mo.months, d.period
    from capped c
    left join months mo using (customer_key)
    left join during d using (customer_key)
    order by c.last_at desc, c.customer_key
  `);
}

/**
 * `PAID`, written so that it can only be read order by order through the payments' index: a scalar subquery with a limit is never
 * turned into a join, and its two keys are parameters, where an `exists` can be planned as a join that scans the store's whole index
 * once per order. For reads that look up a few customers' orders (`PAID` is for reads that walk a period).
 */
const PAID_BY_ORDER = sql`(o.copied_from is null and o.host_id is null and (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured' limit 1) is not null)`;

/**
 * The best customers' details: their account, name and the id their admin page is at (the account's, else their latest order's).
 * A customer key is an account's email or a guest's, so their orders are found through the account (`customer_id`) and through
 * the email of orders with no account, both indexed, instead of working the key out for every order of the store.
 */
async function readTopDetails(store: Store, keys: readonly string[]): Promise<Map<string, { customerId: string; account: boolean; name: string | null }>> {
  const details = new Map<string, { customerId: string; account: boolean; name: string | null }>();
  if (keys.length === 0) return details;
  const list = sql.join(
    keys.map((k) => sql`${k}`),
    sql`, `,
  );
  const rows = await db().execute<Row>(sql`
    select distinct on (t.customer_key) t.customer_key, t.order_id, t.account_id, t.account_name, t.ship_name
    from (
      select lower(c.email) as customer_key, o.id as order_id, c.id as account_id, nullif(c.name, '') as account_name,
        nullif(o.shipping_address ->> 'name', '') as ship_name, o.placed_at
      from commerce.customers c
      join commerce.orders o on o.store_id = c.store_id and o.customer_id = c.id
      where c.store_id = ${store.id}::uuid and lower(c.email) in (${list}) and c.email <> '' and ${PAID_BY_ORDER}
      union all
      select lower(o.email), o.id, null::uuid, null::text, nullif(o.shipping_address ->> 'name', ''), o.placed_at
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and o.customer_id is null and lower(o.email) in (${list}) and o.email <> '' and ${PAID_BY_ORDER}
        and o.restricted_at is null and o.anonymised_at is null
    ) t
    order by t.customer_key, t.placed_at desc, t.order_id
  `);
  for (const row of rows) {
    details.set(String(row.customer_key), {
      customerId: String(row.account_id ?? row.order_id),
      account: row.account_id !== null,
      name: row.account_name !== null ? String(row.account_name) : row.ship_name !== null ? String(row.ship_name) : null,
    });
  }
  return details;
}

/** The instants the period starts and ends at, in the store's time zone. */
async function periodBounds(store: Store, period: AnalyticsPeriod): Promise<{ start: Date; end: Date }> {
  const [row] = await db().execute<Row>(sql`select ${dayStart(store, period.from)} as s, ${dayStart(store, period.to)} as e`);
  return { start: new Date(String(row.s)), end: new Date(String(row.e)) };
}

/** A customer with everything the pure library may ask of one: the second order and the months. */
type Customer = CustomerAggregate & { secondOrderAt: string | null; orderMonths: readonly OrderMonth[] };

type Folded = {
  aggregates: Customer[];
  /** Per aggregate (same order): orders in the last 365 days, and whether an amount could not be converted. */
  orders365: number[];
  affected: boolean[];
  period: PeriodCustomer[];
  unconverted: number;
  missing: string[];
};

/** Rows from the database as the pure library's customers, amounts converted into the main currency one by one. */
function fold(store: Store, rows: readonly Row[]): Folded {
  const main = mainCurrency(store);
  const rates = store.localization.rates;
  const missing = new Set<string>();
  const out: Folded = { aggregates: [], orders365: [], affected: [], period: [], unconverted: 0, missing: [] };
  for (const row of rows) {
    let lost = false;
    const convert = (minor: number, currency: string): number => {
      if (!minor) return 0;
      const converted = convertMinor(minor, currency.trim(), main, rates);
      if (converted === null) {
        lost = true;
        missing.add(currency.trim());
        return 0;
      }
      return converted;
    };
    const byMonth = new Map<string, OrderMonth>();
    let contribution = 0;
    for (const m of (row.months ?? []) as MonthRow[]) {
      const net = convert(Number(m.net), m.currency);
      const had = byMonth.get(m.month);
      if (had) {
        had.orders += Number(m.orders);
        had.revenueMinor += net;
      } else {
        byMonth.set(m.month, { month: m.month, orders: Number(m.orders), revenueMinor: net });
      }
      contribution += convert(Number(m.contribution), m.currency);
    }
    const orderMonths = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1));
    const revenueMinor = orderMonths.reduce((a, m) => a + m.revenueMinor, 0);
    const costsKnown = row.unknown === false || row.unknown === null;
    const customerKey = String(row.customer_key);
    const periodRows = (row.period ?? []) as PeriodRow[];
    let periodOrders = 0;
    let periodNet = 0;
    for (const p of periodRows) {
      // As the Overview does: orders in a currency with no rate are left out of the period's orders and customers (the customer is
      // counted in `unconverted`), never counted with an amount of 0.
      const net = convertMinor(Number(p.net), p.currency.trim(), main, rates);
      if (net === null) {
        lost = true;
        missing.add(p.currency.trim());
        continue;
      }
      periodOrders += Number(p.orders);
      periodNet += net;
    }
    out.aggregates.push({
      key: customerKey,
      firstOrderAt: iso(row.first_at),
      lastOrderAt: iso(row.last_at),
      orders: num(row, "orders"),
      revenueMinor,
      // Contribution before marketing spend; known only when every goods line of their orders had a cost and every amount converted.
      contributionMinor: costsKnown && !lost ? contribution - Math.round(num(row, "cost_main")) : null,
      secondOrderAt: row.second_at ? iso(row.second_at) : null,
      orderMonths,
    });
    out.orders365.push(num(row, "orders_365"));
    out.affected.push(lost);
    if (lost) out.unconverted += 1;
    if (periodOrders > 0) {
      out.period.push({ key: customerKey, firstOrderAt: iso(row.first_at), ordersInPeriod: periodOrders, revenueMinor: periodNet });
    }
  }
  out.missing = [...missing];
  return out;
}

/**
 * The Customers page's report for a period. `now` is the instant the figures are made for (recency, repeat windows and
 * the last 365 days count from it) and the store's today, which cohort months stop at, is worked out from it in the store's
 * time zone: nothing here reads the clock.
 */
export async function customersReport(
  store: Store,
  period: AnalyticsPeriod,
  settings: AnalyticsSettings,
  now: Date,
  /** `cap` is for tests: how many customers are read at most (`CUSTOMER_CAP`). */
  options: { cap?: number } = {},
): Promise<CustomersReport> {
  const cap = Math.max(1, Math.floor(options.cap ?? CUSTOMER_CAP));
  const [rows, bounds] = await Promise.all([readCustomers(store, period, settings, now, cap), periodBounds(store, period)]);
  const truncated = rows.length > cap;
  const folded = fold(store, truncated ? rows.slice(0, cap) : rows);
  const { aggregates } = folded;
  const today = todayIn(now, store.timeZone);

  // Lifetime value counts only customers whose every amount could be converted: a part of their money would understate it.
  const whole = aggregates.filter((_, i) => !folded.affected[i]);
  const known = whole.filter((a) => a.contributionMinor !== null);
  const contributionOrders = known.reduce((a, c) => a + c.orders, 0);
  const wholeOrders = whole.reduce((a, c) => a + c.orders, 0);
  const frequencyOrders = folded.orders365.reduce((a, n) => a + n, 0);
  const frequencyCustomers = folded.orders365.filter((n) => n > 0).length;
  const perCustomer = purchaseFrequency(frequencyOrders, frequencyCustomers);
  const contributionPerOrderMinor =
    contributionOrders > 0 ? Math.round(known.reduce((a, c) => a + (c.contributionMinor as number), 0) / contributionOrders) : null;
  const revenuePerOrderMinor = wholeOrders > 0 ? Math.round(whole.reduce((a, c) => a + c.revenueMinor, 0) / wholeOrders) : null;

  const cohorts = buildCohorts(aggregates, today, COHORT_COUNT, COHORT_MONTHS);
  const scored = rfm(aggregates, now);

  // A customer whose amounts could not all be converted has no revenue to rank by: they are counted in `unconverted`, not listed at zero.
  const unranked = new Set(aggregates.filter((_, i) => folded.affected[i]).map((a) => a.key));
  const best = folded.period
    .filter((c) => !unranked.has(c.key))
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.ordersInPeriod - a.ordersInPeriod || (a.key < b.key ? -1 : 1))
    .slice(0, TOP_CUSTOMERS);
  const details = await readTopDetails(store, best.map((c) => c.key));
  const byKey = new Map(aggregates.map((a) => [a.key, a]));
  const topCustomers = best.flatMap((c): TopCustomer[] => {
    const own = byKey.get(c.key);
    const detail = details.get(c.key);
    if (!own || !detail) return [];
    return [
      {
        key: c.key,
        email: c.key,
        name: detail.name,
        customerId: detail.customerId,
        account: detail.account,
        orders: c.ordersInPeriod,
        revenueMinor: c.revenueMinor,
        lifetimeOrders: own.orders,
        lastOrderAt: own.lastOrderAt,
      },
    ];
  });

  return {
    currency: mainCurrency(store),
    period: { from: period.from, to: period.to, days: period.days },
    today,
    now: now.toISOString(),
    customers: aggregates.length,
    newVsReturning: newVsReturning(folded.period, bounds.start, bounds.end),
    repeatRates: repeatRates(aggregates, now),
    frequency: { orders365: frequencyOrders, customers365: frequencyCustomers, perCustomer },
    ltv: {
      historic: ltvHistoric(whole),
      predicted: ltvPredicted({ contributionPerOrderMinor, revenuePerOrderMinor, ordersPerYear: perCustomer, lifespanYears: settings.ltvLifespanYears }),
      inputs: {
        contributionPerOrderMinor,
        revenuePerOrderMinor,
        ordersPerYear: perCustomer,
        lifespanYears: settings.ltvLifespanYears,
        contributionCustomers: known.length,
        contributionOrders,
      },
    },
    cohorts,
    cohortTrend: cohortTrend(cohorts),
    segments: {
      enough: scored.length >= RFM_MIN_CUSTOMERS,
      minCustomers: RFM_MIN_CUSTOMERS,
      customers: scored.length,
      summary: segmentSummary(scored),
    },
    topCustomers,
    truncated,
    cap,
    unconverted: folded.unconverted,
    missingRates: folded.missing,
  };
}
