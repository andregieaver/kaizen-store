import "server-only";

import { sql, type SQL, type SQLWrapper } from "drizzle-orm";

import { db } from "@/db/client";
import { paymentFees, shippingCostsFor } from "@/lib/analytics-finance";
import {
  coverageText,
  derive,
  EMPTY_TOTALS,
  KPI_CARDS,
  kpiValue,
  type Derived,
  type KpiId,
  type Totals,
} from "@/lib/analytics-kpi";
import {
  addDays,
  bucketFor,
  bucketKey,
  daysBetween,
  enumerateBuckets,
  lastYearOf,
  parseAnalyticsParams,
  previousPeriodOf,
  type AnalyticsParams,
  type AnalyticsPeriod,
  type Bucket,
  type BucketSpan,
} from "@/lib/analytics-period";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { getAnalyticsSettings, type StoredAnalyticsSettings } from "./analytics-settings";
import { dayKey, dayOf, dayStart, inMain, inPeriod, num, PAID, toMainOne, type Row } from "./analytics-sql";
import type { Store } from "./stores";

/**
 * The totals every analytics page starts from (D152, docs/analytics.md): one period's figures, the same figures per bucket
 * (day, week or month) for a chart, and the overview's data. The definitions are the document's; the SQL adds up paid orders
 * once, per currency, and the conversion into the store's main currency is done here, in code.
 *
 * How a period is read:
 *
 * - Orders in a currency the store has no rate for are left out of every figure (orders, customers, costs, fees) and counted in
 *   `unconverted`, with the currencies in `missingCurrencies`, so the page can say so instead of understating a total silently.
 * - Series points are each converted from their own currency groups, so in a store with several currencies their sum can
 *   differ from the period's total by rounding (never in a store selling in its main currency only).
 * - The only scan of the store's whole history is the customers' first paid order, for the keys that ordered in the period.
 */

/**
 * Reads that are set-based over a store's orders (every report's big statements) run with nested loops and JIT off. Such a statement
 * walks a period or a whole history, so a hash or merge join is always what it wants; a nested loop is only chosen when the planner
 * believes a side has about one row, which is what it believes of a table it has no statistics for yet, and a nested loop that
 * re-reads a side per row is quadratic (one report ran for minutes on a store of 60 000 orders). JIT is switched off for the same
 * reason: its start-up costs a second when a statement's estimated cost is large. Both settings last for this transaction only.
 */
export function setBased<TRow extends Record<string, unknown> = Record<string, unknown>>(query: SQLWrapper): Promise<TRow[]> {
  return db().transaction(
    async (tx) => {
      await tx.execute(sql`select set_config('enable_nestloop', 'off', true), set_config('jit', 'off', true)`);
      return tx.execute<TRow>(query);
    },
    { accessMode: "read only" },
  );
}

// ---------------------------------------------------------------------------
// What is exported
// ---------------------------------------------------------------------------

export type PeriodTotals = {
  totals: Totals;
  /** Paid orders and refunds left out because their currency has no rate. */
  unconverted: number;
  /** Those currencies, each once. */
  missingCurrencies: string[];
};

export type SeriesPoint = {
  /** The bucket's own start (a Monday for weeks, the first for months); what `enumerateBuckets()` calls `key`. */
  key: string;
  label: string;
  /** First day and the day after the last, cut to the period. */
  from: string;
  to: string;
  orders: number;
  revenueMinor: number;
  refundsMinor: number;
  netRevenueMinor: number;
  cogsMinor: number;
  /** Null while no sold line in the bucket has a known cost. */
  grossProfitMinor: number | null;
  contributionMinor: number | null;
  /** Customers whose first paid order is in the bucket. */
  newCustomers: number;
  /** Customers with a paid order in the bucket and an earlier first one (a customer can be returning in several buckets). */
  returningCustomers: number;
};

export type TopProduct = {
  /** The product's id. */
  productId: string;
  name: string;
  revenueMinor: number;
  units: number;
  /** Revenue less cost of the lines whose cost was known, before refunds; null when none of its lines had a cost. */
  profitMinor: number | null;
  /** Share of its revenue on lines with a known cost; null without revenue. */
  costCoverage: number | null;
};

export type TopProducts = {
  byRevenue: TopProduct[];
  byProfit: TopProduct[];
  /** A currency had more products than were read (`TOP_CANDIDATES` each by revenue and by profit): a rank may be a little off. */
  truncated: boolean;
};

/** Visits as the traffic module knows them; the overview passes it so this module never reads the visit tables. */
export type SessionsFor = (period: AnalyticsPeriod) => Promise<{
  /** Visitor-days in the period, or null when counting is off or has no day in it. */
  sessions: number | null;
  /** The first day with counted visits (`YYYY-MM-DD`), null when none. */
  firstDay: string | null;
  /** Visitor-days per day, for the sparklines. */
  byDay?: Record<string, number>;
}>;

export type PeriodFigures = {
  period: AnalyticsPeriod;
  totals: Totals;
  derived: Derived;
  /** When visits were counted from a day inside the period: that day, and conversion and per-visitor figures cover only from it. Else null. */
  visitsFrom: string | null;
};

export type OverviewData = {
  params: AnalyticsParams;
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  settings: StoredAnalyticsSettings;
  bucket: Bucket;
  current: PeriodFigures;
  previous: PeriodFigures;
  lastYear: PeriodFigures;
  series: {
    current: SeriesPoint[];
    /** The comparison the address chose (previous period or last year), one entry per current bucket; null where it has no bucket, and null altogether for "none". */
    comparison: (SeriesPoint | null)[] | null;
  };
  /** One series per overview card, a value per current bucket (null where it cannot be known). */
  sparklines: Record<KpiId, (number | null)[]>;
  topProducts: TopProducts;
  unconverted: number;
  missingCurrencies: string[];
  /** Words for the unconverted orders, empty when there are none. */
  notes: string[];
  /** "based on 83 % of sales", for the profit cards. */
  costCoverageText: string;
  costCoverage: number | null;
};

/** The overview without its best sellers: what the page's first screen needs, so it does not wait for the top lists (`topProducts()` is read on its own). */
export type OverviewHead = Omit<OverviewData, "topProducts">;

/** Products read per currency by revenue and by profit for the top lists. */
export const TOP_CANDIDATES = 100;
/** How many products each top list holds. */
export const TOP_N = 5;

// ---------------------------------------------------------------------------
// Raw rows
// ---------------------------------------------------------------------------

/** What a figure is grouped by: the whole period, a chart bucket, or an explicit list of span starts (ascending: a span runs to the next start). */
type Grain = Bucket | "period" | readonly string[];

type Bundle = {
  orders: Row[];
  refunds: Row[];
  platform: Row[];
  fees: Row[];
  customers: Row[];
  spend: number;
};

const emptyBundle = (): Bundle => ({ orders: [], refunds: [], platform: [], fees: [], customers: [], spend: 0 });

/** The currencies the store can convert into its main currency, as a Postgres text array literal. */
function convertibleCurrencies(store: Store): string {
  const main = mainCurrency(store);
  const rates = store.localization.rates;
  const list = new Set<string>([main]);
  for (const currency of rates.keys()) if (canConvert(currency, main, rates)) list.add(currency);
  return `{${[...list].map((c) => c.trim()).join(",")}}`;
}

/**
 * The currencies as a `char(3)[]`, the column's own type: comparing `currency::text` instead hides the column's statistics from
 * the planner, which then guesses a hundredth of the rows and picks plans that are slow on a real store.
 */
const knownCurrencies = (store: Store): SQL => sql`${convertibleCurrencies(store)}::char(3)[]`;

/** SQL for the key of the bucket a date (or a date column) falls in; one key for the whole period under the grain "period". */
function bucketOf(grain: Grain, period: Pick<AnalyticsPeriod, "from">, day: SQL): SQL {
  if (typeof grain !== "string") {
    const starts = `{${grain.join(",")}}`;
    return sql`(${starts}::date[])[width_bucket((${day})::date, ${starts}::date[])]`;
  }
  switch (grain) {
    case "period":
      return sql`${period.from}::date`;
    case "day":
      return sql`(${day})::date`;
    case "week":
      return sql`date_trunc('week', (${day})::timestamp)::date`;
    case "month":
      return sql`date_trunc('month', (${day})::timestamp)::date`;
  }
}

const periodKey = (grain: Grain, period: Pick<AnalyticsPeriod, "from">, key: string) => (grain === "period" ? period.from : key);

/** A customer key's first paid order, as a day (`YYYY-MM-DD`) in the store's time zone. */
type FirstDays = Map<string, string>;

/**
 * The first paid order's day of every customer key with a paid order at or after `from`. One pass over the store's paid orders
 * (the only read of its whole history here), grouped by the key; a customer's first order is the same whichever period asks, so
 * the overview reads it once for all of its periods. Only the grouped min is converted to a day (the conversion is monotonic).
 */
async function firstOrderDays(store: Store, from: string): Promise<FirstDays> {
  // Orders are first grouped by the account (or, for a guest, their lower-cased email) and only then by the key, which is worked
  // out once per group instead of once per order: `lower(coalesce(c.email, o.email))` is the customer key of the document.
  const rows = await setBased<Row>(sql`
    with g as (
      select o.customer_id,
        case when o.restricted_at is not null or o.anonymised_at is not null then 'order:' || o.id::text when o.customer_id is null then lower(o.email) end as guest,
        min(o.placed_at) as first_at, max(o.placed_at) as last_at
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and ${PAID}
      group by 1, 2
    )
    select k, (min(first_at) at time zone ${store.timeZone})::date::text as first_day
    from (
      select lower(coalesce(c.email, g.guest)) as k, g.first_at, g.last_at
      from g left join commerce.customers c on c.id = g.customer_id and c.store_id = ${store.id}::uuid
      where coalesce(c.email, g.guest) <> ''
    ) t
    group by k
    having max(last_at) >= ${dayStart(store, from)}
  `);
  return new Map(rows.map((r) => [String(r.k), dayKey(r.first_day)]));
}

type Loaded = {
  bundles: Map<string, Bundle>;
  /** Paid orders and refunds left out for want of a rate, per currency (every bucket together). */
  excluded: Map<string, number>;
};

/**
 * Everything the period's figures are made from, one bundle per bucket key (the period's `from` under "period"). Paid orders are
 * found once (`po0`) and every figure that starts from them reads that set: the orders with their lines, the platform fees, the
 * per-order payment fees and the customers active in each bucket; refunds are by their own date. The customers' first orders
 * come from `first` (read here unless the caller shares one). The planner is given the table's own columns to join on, never
 * a derived table's, which it cannot estimate.
 */
async function loadBundles(
  store: Store,
  settings: Pick<StoredAnalyticsSettings, "paymentFeeBps" | "paymentFeeFixedMinor">,
  period: AnalyticsPeriod,
  grain: Grain,
  first?: Promise<FirstDays>,
): Promise<Loaded> {
  const id = store.id;
  const known = knownCurrencies(store);
  const placed = dayOf(store, sql`o.placed_at`);
  const feesOn = settings.paymentFeeBps > 0 || settings.paymentFeeFixedMinor > 0;
  const firstDays = first ?? firstOrderDays(store, period.from);

  // Paid orders of every currency (`po0`), with the bucket they fall in and whether the store can convert their currency. Orders and
  // lines are summed per bucket and currency in two small aggregates (a line-level one, an order-level one), never per order.
  const main = setBased<Row>(sql`
    with po0 as materialized (
      select o.id, o.store_id, o.customer_id, o.email, o.restricted_at, o.anonymised_at, o.currency, o.total_minor, o.tax_minor, o.shipping_minor, o.discount_minor, o.vat_relief_minor,
        coalesce(o.shipping_tax_rate, commerce.vat_rate(o.market_code, 'standard', o.placed_at)) as ship_rate,
        (o.currency = any(${known})) as ok, (${bucketOf(grain, period, placed)})::text as bk
      from commerce.orders o
      where o.store_id = ${id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
    ),
    pl as materialized (
      select po0.id, po0.bk, po0.currency,
        round(ol.unit_price_minor::numeric * ol.quantity / (1 + ol.tax_rate)) as gross,
        round((ol.discount_minor - ol.vat_relief_minor)::numeric / (1 + ol.tax_rate)) as disc,
        (ol.discount_minor - ol.vat_relief_minor) as raw_disc,
        ol.vat_relief_minor as line_relief,
        ol.tax_minor as line_tax,
        case when ol.variant_id is not null and ol.delivery <> 'service' then ol.quantity else 0 end as units,
        ol.unit_cost_minor * ol.quantity as cogs,
        ol.total_minor - ol.tax_minor as line_rev,
        case when ol.variant_id is not null and ol.unit_cost_minor is null then ol.total_minor - ol.tax_minor else 0 end as unknown_rev,
        (ol.delivery = 'physical') as physical
      from po0
      join commerce.order_lines ol on ol.order_id = po0.id
      where po0.ok and ol.store_id = ${id}::uuid
    ),
    -- Each order's lines once: an order's discount beyond its lines' is a discount of its shipping (a free-shipping code), taken
    -- with VAT off the total and off the shipping's VAT (placeOrder()), so shipping income must be worked out around it.
    lo as (
      select id, sum(raw_disc) as line_disc, sum(line_relief) as line_relief from pl group by id
    ),
    by_order as (
      select bk, currency::text as currency, count(*) as orders, sum(tax_minor) as vat, sum(total_minor - tax_minor) as revenue,
        sum(shipping_minor) as shipping_in, sum(ship_disc) as ship_disc, sum(ship_relief) as ship_relief, sum(round(ship_disc::numeric / (1 + ship_rate))) as ship_disc_ex,
        sum(case when has_lines then 0 else total_minor - tax_minor end) as lineless_rev
      from (
        select po0.*, (lo.id is not null) as has_lines,
          least(po0.shipping_minor, greatest(0, po0.discount_minor - po0.vat_relief_minor - coalesce(lo.line_disc, 0))) as ship_disc,
          po0.vat_relief_minor - coalesce(lo.line_relief, 0) as ship_relief
        from po0 left join lo on lo.id = po0.id
        where po0.ok
      ) o
      group by bk, currency
    ),
    by_line as (
      select bk, currency::text as currency, sum(gross) as gross, sum(disc) as disc, sum(line_tax) as line_tax, sum(units) as units, sum(cogs) as cogs,
        sum(line_rev) as line_rev, sum(line_rev - unknown_rev) as known_rev
      from pl group by bk, currency
    ),
    by_phys as (
      select bk, currency::text as currency, count(*) as physical_orders
      from (select distinct id, bk, currency from pl where physical) d
      group by bk, currency
    ),
    orders_agg as (
      select o.bk, o.currency, o.orders,
        coalesce(l.gross, 0) as gross,
        coalesce(l.disc, 0) + o.ship_disc_ex as disc,
        o.shipping_in - o.ship_disc - o.ship_relief - (o.vat - coalesce(l.line_tax, 0)) + o.ship_disc_ex as shipping,
        o.vat, o.revenue,
        coalesce(l.units, 0) as units,
        coalesce(l.cogs, 0) as cogs,
        -- An order with no line at all has nothing to cost, like a line with no variant: it counts as known.
        coalesce(l.line_rev, 0) + o.lineless_rev as line_rev,
        coalesce(l.known_rev, 0) + o.lineless_rev as known_rev,
        coalesce(ph.physical_orders, 0) as physical_orders
      from by_order o
      left join by_line l on l.bk = o.bk and l.currency = o.currency
      left join by_phys ph on ph.bk = o.bk and ph.currency = o.currency
    ),
    platform as (
      select po0.bk, pp.currency::text as currency, sum(pp.kaizen_fee_minor) as fee
      from po0
      join commerce.payments pp on pp.order_id = po0.id
      where pp.store_id = ${id}::uuid and pp.status = 'captured' and pp.currency = any(${known})
      group by po0.bk, pp.currency
    ),
    left_out as (
      select currency::text as currency, count(*) as n from po0 where not ok group by currency
    )
    select 'orders' as kind, to_jsonb(t) as r from orders_agg t
    union all select 'platform', to_jsonb(t) from platform t
    union all select 'left_out', to_jsonb(t) from left_out t
    ${
      feesOn
        ? sql`union all select 'fees', to_jsonb(t) from (select bk, currency::text as currency, total_minor, count(*) as n from po0 where ok group by bk, currency, total_minor) t`
        : sql``
    }
    union all select 'customers', to_jsonb(t) from (
      select o.bk, (case when o.restricted_at is not null or o.anonymised_at is not null then 'order:' || o.id::text else lower(coalesce(c.email, o.email)) end) as k
      from po0 o left join commerce.customers c on c.id = o.customer_id and c.store_id = ${id}::uuid
      where o.ok and (o.restricted_at is not null or o.anonymised_at is not null or coalesce(c.email, o.email) <> '') group by o.bk, 2
    ) t
  `);

  // Succeeded refunds by their own date, each scaled to without VAT by its order's share; a currency with no rate is counted.
  const refundDay = dayOf(store, sql`r.created_at`);
  const refunds = setBased<Row>(sql`
    select (${bucketOf(grain, period, refundDay)})::text as bk, rp.currency::text as currency, (rp.currency = any(${known})) as converts, count(*) as n,
      sum(round(r.amount_minor::numeric * (o.total_minor - o.tax_minor) / nullif(o.total_minor, 0))) as amount
    from commerce.refunds r
    join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
    join commerce.orders o on o.store_id = rp.store_id and o.id = rp.order_id
    where r.store_id = ${id}::uuid and r.status = 'succeeded' and ${inPeriod(store, sql`r.created_at`, period)}
      and o.copied_from is null and o.host_id is null
    group by 1, 2, 3
  `);

  const spend = db().execute<Row>(sql`
    select (${bucketOf(grain, period, sql`s.day`)})::text as bk, sum(s.amount_minor) as amount
    from commerce.marketing_spend s
    where s.store_id = ${id}::uuid and s.day >= ${period.from}::date and s.day < ${period.to}::date
    group by 1
  `);

  const [mainRows, refundRows, spendRows, firsts] = await Promise.all([main, refunds, spend, firstDays]);
  const bundles = new Map<string, Bundle>();
  const excluded = new Map<string, number>();
  const at = (key: string) => {
    const k = periodKey(grain, period, key);
    let bundle = bundles.get(k);
    if (!bundle) bundles.set(k, (bundle = emptyBundle()));
    return bundle;
  };
  const kinds: Record<string, (row: Row) => void> = {
    orders: (r) => at(String(r.bk)).orders.push(r),
    platform: (r) => at(String(r.bk)).platform.push(r),
    fees: (r) => at(String(r.bk)).fees.push(r),
    left_out: (r) => excluded.set(String(r.currency).trim(), (excluded.get(String(r.currency).trim()) ?? 0) + num(r, "n")),
  };
  // Customers: the keys active in each bucket, and of them those whose first paid order falls on or after the bucket's first day.
  const active = new Map<string, { active: number; fresh: number }>();
  for (const { kind, r } of mainRows as unknown as { kind: string; r: Row }[]) {
    if (kind === "customers") {
      const first = firsts.get(String(r.k));
      if (first === undefined) continue;
      const bk = String(r.bk);
      const counts = active.get(bk) ?? { active: 0, fresh: 0 };
      counts.active += 1;
      if (first >= (bk > period.from ? bk : period.from)) counts.fresh += 1;
      active.set(bk, counts);
    } else kinds[kind](r);
  }
  for (const [bk, counts] of active) at(bk).customers.push(counts);
  for (const r of refundRows) {
    if (r.converts === true) at(String(r.bk)).refunds.push(r);
    else excluded.set(String(r.currency).trim(), (excluded.get(String(r.currency).trim()) ?? 0) + num(r, "n"));
  }
  for (const r of spendRows) at(String(r.bk)).spend += num(r, "amount");
  return { bundles, excluded };
}

// ---------------------------------------------------------------------------
// Folding a bundle into Totals
// ---------------------------------------------------------------------------

/**
 * One bucket's `Totals`. Every row here is in a currency the store can convert (the queries leave the others out), so
 * `inMain()` leaves nothing out; costs are kept in the main currency already and are added as they are.
 */
function fold(store: Store, settings: Pick<StoredAnalyticsSettings, "paymentFeeBps" | "paymentFeeFixedMinor" | "shippingCostMinor">, bundle: Bundle): Totals {
  const orders = inMain(store, bundle.orders.map((r) => ({ ...r, currency: String(r.currency) })), ["gross", "disc", "shipping", "vat", "revenue", "known_rev", "line_rev"]).values;
  const refunds = inMain(store, bundle.refunds.map((r) => ({ ...r, currency: String(r.currency) })), ["amount"]).values;
  const platform = inMain(store, bundle.platform.map((r) => ({ ...r, currency: String(r.currency) })), ["fee"]).values;

  let paymentFeesMinor = 0;
  for (const r of bundle.fees) {
    const total = toMainOne(store, String(r.currency), num(r, "total_minor"));
    if (total !== null) paymentFeesMinor += paymentFees([total], settings) * num(r, "n");
  }

  const sum = (rows: Row[], key: string) => rows.reduce((s, r) => s + num(r, key), 0);
  const active = sum(bundle.customers, "active");
  const fresh = sum(bundle.customers, "fresh");
  return {
    ...EMPTY_TOTALS,
    orders: sum(bundle.orders, "orders"),
    grossSalesMinor: orders.gross,
    discountsMinor: orders.disc,
    shippingMinor: orders.shipping,
    vatMinor: orders.vat,
    revenueMinor: orders.revenue,
    refundsMinor: refunds.amount,
    cogsMinor: sum(bundle.orders, "cogs"),
    knownCostRevenueMinor: orders.known_rev,
    lineRevenueMinor: orders.line_rev,
    paymentFeesMinor,
    platformFeesMinor: platform.fee,
    shippingCostsMinor: shippingCostsFor(sum(bundle.orders, "physical_orders"), settings),
    marketingMinor: bundle.spend,
    sessions: null,
    newCustomers: fresh,
    returningCustomers: active - fresh,
    units: sum(bundle.orders, "units"),
  };
}

// ---------------------------------------------------------------------------
// Totals of a period
// ---------------------------------------------------------------------------

async function totalsOf(store: Store, settings: StoredAnalyticsSettings, period: AnalyticsPeriod, first?: Promise<FirstDays>): Promise<PeriodTotals> {
  const { bundles, excluded } = await loadBundles(store, settings, period, "period", first);
  return {
    totals: fold(store, settings, bundles.get(period.from) ?? emptyBundle()),
    unconverted: [...excluded.values()].reduce((sum, n) => sum + n, 0),
    missingCurrencies: [...excluded.keys()].sort(),
  };
}

/**
 * A period's figures (docs/analytics.md, Definitions), in the store's main currency without VAT. `sessions` is always null here:
 * visits are counted by the traffic module and joined by `overviewData()`. The cost settings are read unless given.
 */
export async function periodTotals(store: Store, period: AnalyticsPeriod, settings?: StoredAnalyticsSettings): Promise<PeriodTotals> {
  return totalsOf(store, settings ?? (await getAnalyticsSettings(store.id)), period);
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

type BucketTotals = { span: BucketSpan; totals: Totals };

async function bucketTotals(store: Store, settings: StoredAnalyticsSettings, period: AnalyticsPeriod, bucket: Bucket, first?: Promise<FirstDays>): Promise<BucketTotals[]> {
  const { bundles } = await loadBundles(store, settings, period, bucket, first);
  return enumerateBuckets(period, bucket).map((span) => ({ span, totals: fold(store, settings, bundles.get(span.key) ?? emptyBundle()) }));
}

/**
 * The comparison period's days that line up, day for day, with each of the current period's buckets: the current bucket's offset from
 * the period's start, applied to the comparison's. A week or month bucket cut by the period's edge is then held against as many days
 * of the comparison, never against a whole one that starts on another weekday or day of the month. Null where the comparison has
 * fewer days than the bucket (it ends first), as such a point would not be like with like.
 */
export function alignedSpans(period: Pick<AnalyticsPeriod, "from">, comparison: Pick<AnalyticsPeriod, "from" | "to">, spans: readonly BucketSpan[]): (BucketSpan | null)[] {
  return spans.map((span) => {
    const from = addDays(comparison.from, daysBetween(period.from, span.from));
    const to = addDays(comparison.from, daysBetween(period.from, span.to));
    return to <= comparison.to ? { key: from, from, to, label: span.label } : null;
  });
}

/** The comparison's totals for the spans `alignedSpans()` gives, null where a bucket has no counterpart. */
async function comparisonTotals(
  store: Store,
  settings: StoredAnalyticsSettings,
  period: AnalyticsPeriod,
  comparison: AnalyticsPeriod,
  bucket: Bucket,
  first?: Promise<FirstDays>,
): Promise<(BucketTotals | null)[]> {
  const spans = alignedSpans(period, comparison, enumerateBuckets(period, bucket));
  const live = spans.filter((span): span is BucketSpan => span !== null);
  if (live.length === 0) return spans.map(() => null);
  // Only the days the spans cover are read: a longer comparison must not pour its extra days into the last span.
  const covered = { ...comparison, from: live[0].from, to: live[live.length - 1].to, days: daysBetween(live[0].from, live[live.length - 1].to) };
  const { bundles } = await loadBundles(store, settings, covered, live.map((span) => span.from), first);
  return spans.map((span) => (span ? { span, totals: fold(store, settings, bundles.get(span.key) ?? emptyBundle()) } : null));
}

function pointOf(settings: StoredAnalyticsSettings, { span, totals }: BucketTotals): SeriesPoint {
  const derived = derive(totals, settings, daysBetween(span.from, span.to));
  return {
    key: span.key,
    label: span.label,
    from: span.from,
    to: span.to,
    orders: totals.orders,
    revenueMinor: totals.revenueMinor,
    refundsMinor: totals.refundsMinor,
    netRevenueMinor: derived.netRevenue,
    cogsMinor: totals.cogsMinor,
    grossProfitMinor: derived.grossProfit,
    contributionMinor: derived.contributionProfit,
    newCustomers: totals.newCustomers,
    returningCustomers: totals.returningCustomers,
  };
}

/** A point for every bucket the period touches, in order, zero-filled; each bucket converted from its own currency groups. */
export async function seriesByBucket(store: Store, period: AnalyticsPeriod, bucket: Bucket, settings?: StoredAnalyticsSettings): Promise<SeriesPoint[]> {
  const s = settings ?? (await getAnalyticsSettings(store.id));
  return (await bucketTotals(store, s, period, bucket)).map((b) => pointOf(s, b));
}

// ---------------------------------------------------------------------------
// Top products
// ---------------------------------------------------------------------------

/**
 * The period's best products by revenue and by profit, from paid orders' lines (goods with a product only: a sign-up fee is not
 * one). Profit is before refunds and only over lines with a known cost. A few hundred rows are read at most (per currency).
 */
export async function topProducts(store: Store, period: AnalyticsPeriod): Promise<TopProducts> {
  const known = knownCurrencies(store);
  const rows = await setBased<Row>(sql`
    with li as (
      select o.currency::text as currency, v.product_id::text as product_id, max(ol.title) as title,
        sum(ol.total_minor - ol.tax_minor) as rev,
        coalesce(sum(ol.quantity) filter (where ol.delivery <> 'service'), 0) as units,
        sum(ol.unit_cost_minor * ol.quantity) as cogs,
        sum(ol.total_minor - ol.tax_minor) filter (where ol.unit_cost_minor is not null) as known_rev
      from commerce.orders o
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)} and o.currency = any(${known})
      group by 1, 2
    ),
    ranked as (
      select li.*, count(*) over (partition by currency) as n,
        row_number() over (partition by currency order by rev desc, product_id) as r_rev,
        row_number() over (partition by currency order by (case when cogs is null then null else known_rev - cogs end) desc nulls last, product_id) as r_profit
      from li
    )
    select currency, product_id, title, rev, units, cogs, known_rev, n
    from ranked
    where r_rev <= ${TOP_CANDIDATES} or (cogs is not null and r_profit <= ${TOP_CANDIDATES})
  `);

  const byProduct = new Map<string, Row[]>();
  let truncated = false;
  for (const r of rows) {
    if (num(r, "n") > TOP_CANDIDATES) truncated = true;
    const key = String(r.product_id);
    byProduct.set(key, [...(byProduct.get(key) ?? []), r]);
  }

  const products: TopProduct[] = [...byProduct].map(([productId, group]) => {
    const money = inMain(store, group.map((r) => ({ ...r, currency: String(r.currency) })), ["rev", "known_rev"]).values;
    const hasCost = group.some((r) => r.cogs !== null);
    const cogs = group.reduce((s, r) => s + num(r, "cogs"), 0);
    return {
      productId,
      name: String(group[0].title),
      revenueMinor: money.rev,
      units: group.reduce((s, r) => s + num(r, "units"), 0),
      profitMinor: hasCost ? money.known_rev - cogs : null,
      costCoverage: money.rev > 0 ? Math.min(1, money.known_rev / money.rev) : null,
    };
  });

  const byRevenue = [...products].sort((a, b) => b.revenueMinor - a.revenueMinor || a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId)).slice(0, TOP_N);
  const byProfit = products
    .filter((p) => p.profitMinor !== null)
    .sort((a, b) => b.profitMinor! - a.profitMinor! || a.name.localeCompare(b.name) || a.productId.localeCompare(b.productId))
    .slice(0, TOP_N);

  // The names are the product's own, in the store's main language where it has one; the line's title is the fallback.
  const ids = [...new Set([...byRevenue, ...byProfit].map((p) => p.productId))];
  if (ids.length > 0) {
    const locale = store.localization.locales[0] ?? "en";
    const names = await db().execute<Row>(sql`
      select distinct on (pt.product_id) pt.product_id::text as id, pt.title
      from commerce.product_translations pt
      where pt.store_id = ${store.id}::uuid and pt.product_id = any(${`{${ids.join(",")}}`}::uuid[])
      order by pt.product_id, (pt.locale = ${locale}) desc, (split_part(pt.locale, '-', 1) = split_part(${locale}, '-', 1)) desc, pt.locale
    `);
    const titles = new Map(names.map((r) => [String(r.id), String(r.title)]));
    for (const p of [...byRevenue, ...byProfit]) p.name = titles.get(p.productId) ?? p.name;
  }
  return { byRevenue, byProfit, truncated };
}

// ---------------------------------------------------------------------------
// The overview
// ---------------------------------------------------------------------------

type Query = Parameters<typeof parseAnalyticsParams>[0];

/** The figures of one period with its visits joined in: from the first counted day, so conversion is not understated by days with none. */
type Visits = Awaited<ReturnType<SessionsFor>>;
type Figures = PeriodFigures & { unconverted: number; missingCurrencies: string[]; visits: Visits | null };

async function figuresOf(store: Store, settings: StoredAnalyticsSettings, period: AnalyticsPeriod, sessionsFor: SessionsFor | undefined, first: Promise<FirstDays>): Promise<Figures> {
  const base = await totalsOf(store, settings, period, first);
  const visits = sessionsFor ? await sessionsFor(period) : null;
  const counted = visits && visits.sessions !== null && visits.firstDay !== null && visits.firstDay < period.to;
  if (!visits || !counted) {
    return { period, totals: base.totals, derived: derive(base.totals, settings, period.days), visitsFrom: null, unconverted: base.unconverted, missingCurrencies: base.missingCurrencies, visits };
  }
  const totals: Totals = { ...base.totals, sessions: visits.sessions };
  const partial = visits.firstDay! > period.from;
  const visitTotals: Totals = partial
    ? { ...(await totalsOf(store, settings, { ...period, from: visits.firstDay!, days: daysBetween(visits.firstDay!, period.to) }, first)).totals, sessions: visits.sessions }
    : totals;
  return { period, totals, derived: derive(totals, settings, period.days, visitTotals), visitsFrom: partial ? visits.firstDay : null, unconverted: base.unconverted, missingCurrencies: base.missingCurrencies, visits };
}

/** A bucket's totals with the visits of its days; sessions are unknown (null) where the bucket starts before the first counted day. */
function withSessions(buckets: BucketTotals[], bucket: Bucket, visits: Visits | null): BucketTotals[] {
  if (!visits || visits.sessions === null || visits.firstDay === null || !visits.byDay) return buckets;
  const perBucket = new Map<string, number>();
  for (const [day, n] of Object.entries(visits.byDay)) perBucket.set(bucketKey(day, bucket), (perBucket.get(bucketKey(day, bucket)) ?? 0) + n);
  return buckets.map((b) => ({ ...b, totals: { ...b.totals, sessions: b.span.from >= visits.firstDay! ? (perBucket.get(b.span.key) ?? 0) : null } }));
}

/**
 * Everything the Overview's first screen needs, computed once: the figures and cards, the sparklines and the net revenue and profit
 * series. No best sellers (`topProducts()`: the page streams those in on their own). `params` is the page's search params (or a
 * `URLSearchParams`); `extra.settings` are the store's analytics settings when the caller has them.
 */
export async function overviewHead(store: Store, params: Query, now: Date, extra?: { sessions?: SessionsFor; settings?: StoredAnalyticsSettings }): Promise<OverviewHead> {
  const parsed = parseAnalyticsParams(params, { now, timeZone: store.timeZone });
  const { period } = parsed;
  // The page has read the settings already (`analyticsContext()`): a caller that has them passes them, so the head starts its reads at once.
  const settings = extra?.settings ?? (await getAnalyticsSettings(store.id));
  const bucket = bucketFor(period);
  const previousPeriod = previousPeriodOf(period);
  const lastYearPeriod = lastYearOf(period);
  const comparisonPeriod = parsed.compare.mode === "previous" ? previousPeriod : parsed.compare.mode === "year" ? lastYearPeriod : null;
  const sessionsFor = extra?.sessions;

  // The customers' first orders are the same for every period, so they are read once, from the earliest day any of them needs.
  const earliest = [period.from, previousPeriod.from, lastYearPeriod.from].reduce((a, b) => (a < b ? a : b));
  const first = firstOrderDays(store, earliest);
  const [current, previous, lastYear, currentBuckets, comparisonBuckets] = await Promise.all([
    figuresOf(store, settings, period, sessionsFor, first),
    figuresOf(store, settings, previousPeriod, sessionsFor, first),
    figuresOf(store, settings, lastYearPeriod, sessionsFor, first),
    bucketTotals(store, settings, period, bucket, first),
    comparisonPeriod ? comparisonTotals(store, settings, period, comparisonPeriod, bucket, first) : Promise.resolve(null),
  ]);

  const points = currentBuckets.map((b) => pointOf(settings, b));
  // Each point is the comparison's days at the same offsets into its period, so a partial first or last bucket compares like with like.
  const comparison = comparisonBuckets ? comparisonBuckets.map((b) => (b ? pointOf(settings, b) : null)) : null;

  const withVisits = withSessions(currentBuckets, bucket, current.visits);
  const sparklines = {} as Record<KpiId, (number | null)[]>;
  for (const card of KPI_CARDS) {
    sparklines[card.id] = withVisits.map(({ span, totals }) => kpiValue(card, derive(totals, settings, daysBetween(span.from, span.to))));
  }

  const missing = [...new Set([...current.missingCurrencies, ...previous.missingCurrencies, ...lastYear.missingCurrencies])].sort();
  const main = mainCurrency(store);
  const notes =
    current.unconverted > 0
      ? [
          `${current.unconverted} ${current.unconverted === 1 ? "order or refund" : "orders and refunds"} in ${current.missingCurrencies.join(", ")} ${current.unconverted === 1 ? "is" : "are"} left out of these figures because the store has no rate to ${main}. Set the rate under Languages and currencies.`,
        ]
      : [];

  const strip = (f: Figures): PeriodFigures => ({ period: f.period, totals: f.totals, derived: f.derived, visitsFrom: f.visitsFrom });
  return {
    params: parsed,
    currency: main,
    settings,
    bucket,
    current: strip(current),
    previous: strip(previous),
    lastYear: strip(lastYear),
    series: { current: points, comparison },
    sparklines,
    unconverted: current.unconverted,
    missingCurrencies: missing,
    notes,
    costCoverageText: coverageText(current.derived.costCoverage),
    costCoverage: current.derived.costCoverage,
  };
}

/** Everything the Overview page shows, computed once: the head and the best sellers, read side by side. */
export async function overviewData(store: Store, params: Query, now: Date, extra?: { sessions?: SessionsFor }): Promise<OverviewData> {
  const { period } = parseAnalyticsParams(params, { now, timeZone: store.timeZone });
  const [head, top] = await Promise.all([overviewHead(store, params, now, extra), topProducts(store, period)]);
  return { ...head, topProducts: top };
}
