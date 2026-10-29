import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { estimatedCogs } from "@/lib/analytics-kpi";
import { lastYearOf, parseAnalyticsParams, previousPeriodOf, type AnalyticsPeriod } from "@/lib/analytics-period";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";
import {
  columnAddsUp,
  DIMENSIONS,
  grainIn,
  isLineDim,
  isMetric,
  needsRestRow,
  OVERLAPPING,
  sortOf,
  specProblems,
  type DimensionKey,
  type MetricKey,
  type ReportSpec,
  type SpecProblem,
} from "@/lib/report-catalogue";

import { CUSTOMER_JOIN, CUSTOMER_KEY, dayOf, GIFT_CARD_LINE, HAS_CUSTOMER, inPeriod, NOT_EDIT_REFUND, PAID, type Row, SOLD_AT, soldIn, toMainOne, VOUCHER_NET } from "./analytics-sql";
import { setBasedReplica } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * The one module that turns a report into SQL (wave 8 unit A, D345, `docs/wave-8-analytics-ai.md` section 3, `docs/analytics.md` Reports).
 * A `ReportSpec` holds only the catalogue's keys (`src/lib/report-catalogue.ts`); every fragment of SQL is written here, beside the
 * definition it implements, and nothing else builds a report query (`report-query.scan.test.ts`).
 *
 * How a report is read:
 *
 * - Paid orders (`PAID`) of the store, by `placed_at` in the store's days, in currencies the store can convert; orders in another are left
 *   out of every figure and counted (`unconverted`), as the analytics pages do. An order of gift cards only is no sale (D300 F4).
 * - Money is summed per currency in SQL and converted into the main currency here, in code (`toMainOne()`); costs are kept in the main
 *   currency already and are not converted. Counts of orders and customers are counted once across currencies (a grouping set without
 *   the currency), so a customer who paid in two currencies is one customer.
 * - An order metric cut or filtered by a line dimension is counted from lines (`grainIn()`); cut by one, its money has a row of its own for
 *   what is in no line (shipping, an order's own discount), the order totals less the lines', so the column still adds up to the period.
 * - Refunds are dated by their own day and scaled to without VAT by their order's share, as Finance counts them.
 * - The totals are read as a report with no dimension, so a column that does not add up (customers, orders by product) still has its true
 *   total. Every read runs through `setBasedReplica()`, read-only, with the store id in every statement.
 */

/** The row for what is in no line, when an order's money is cut by a line dimension. */
export const REST_KEY = "__rest";
/** A line with no product (a sign-up fee and the like), and a custom item staff typed into a draft order (D173). */
export const OTHER_KEY = "other";
export const CUSTOM_KEY = "custom";
/** A line or an order with nothing in the dimension: no category, no code, no visit. */
export const NONE_KEY = "none";

export type ReportValues = Partial<Record<MetricKey, number | null>>;

export type ReportRow = {
  /** The row's value in each of the report's dimensions, as stored (an id, a code, a day); `REST_KEY` for the rest row. */
  keys: string[];
  values: ReportValues;
  /** The same row in the comparison period; null without a comparison (a row that did not exist then has zeros). */
  previous: ReportValues | null;
  /** Share of the row's line revenue whose cost is known, for gross profit; null without lines. */
  coverage: number | null;
  rest: boolean;
};

export type ReportResult = {
  spec: ReportSpec;
  /** The main currency every amount is in, without VAT. */
  currency: string;
  period: AnalyticsPeriod;
  comparison: AnalyticsPeriod | null;
  /** Each metric's column, and whether its rows add up to its total. */
  columns: { metric: MetricKey; addsUp: boolean }[];
  rows: ReportRow[];
  totals: { values: ReportValues; previous: ReportValues | null; coverage: number | null };
  /** Orders and refunds left out because their currency has no rate, and those currencies. */
  unconverted: number;
  missingCurrencies: string[];
  /** Rows past the spec's limit, not shown (the totals still count them). */
  hiddenRows: number;
  /** Whether the dimensions hold the rest row and the line dimension is filtered (no rest row then): the column is the lines' own. */
  linesOnly: boolean;
};

export type ReportOutcome = { ok: true; report: ReportResult } | { ok: false; problems: SpecProblem[] };

// ---------------------------------------------------------------------------
// Currencies
// ---------------------------------------------------------------------------

function knownCurrencies(store: Store): SQL {
  const main = mainCurrency(store);
  const list = new Set<string>([main.trim()]);
  for (const currency of store.localization.rates.keys()) if (canConvert(currency, main, store.localization.rates)) list.add(currency.trim());
  return sql`${`{${[...list].join(",")}}`}::char(3)[]`;
}

// ---------------------------------------------------------------------------
// Dimensions as SQL, over the columns `po` (orders) and `pl` (lines) carry
// ---------------------------------------------------------------------------

/** A payment's method as `methodGroup()` keys it (`src/lib/payment-facts.ts`), so a row is one group on the Payments by method table. */
const METHOD_KEY = (p: string) =>
  sql.raw(`(case when ${p}.provider = 'manual' then 'manual:' || coalesce(${p}.method, 'other')
    when ${p}.provider in ('exchange', 'venue', 'gift_card') then ${p}.provider
    when ${p}.wallet is not null then 'wallet:' || ${p}.wallet
    when ${p}.method_type is not null then 'method:' || ${p}.method_type
    when ${p}.provider is null then '${NONE_KEY}'
    else 'unknown' end)`);

function bucket(key: DimensionKey, day: SQL): SQL {
  switch (key) {
    case "day":
      return sql`(${day})::date::text`;
    case "week":
      return sql`date_trunc('week', (${day})::timestamp)::date::text`;
    case "month":
      return sql`date_trunc('month', (${day})::timestamp)::date::text`;
    default:
      return sql`date_trunc('quarter', (${day})::timestamp)::date::text`;
  }
}

/** The column a dimension is read from in the final select (`x` is `po` or `pl`, with the joins `dimensionJoins()` adds). */
function dimensionColumn(key: DimensionKey, store: Store, x: "po" | "pl"): SQL {
  if (DIMENSIONS[key].level === "time") return bucket(key, dayOf(store, sql.raw(`${x}.placed_at`)));
  switch (key) {
    case "market":
      return sql.raw(`${x}.market_code::text`);
    case "currency":
      return sql.raw(`${x}.currency::text`);
    case "channel":
      return sql.raw(`${x}.d_channel`);
    case "device":
      return sql.raw(`${x}.d_device`);
    case "payment_method":
      return sql.raw(`${x}.d_method`);
    case "customer_type":
      return sql.raw(`${x}.d_customer`);
    case "discount_code":
      return sql.raw(`dcode.code`);
    case "product":
      return sql.raw(`coalesce(pl.product_id::text, case when pl.custom then '${CUSTOM_KEY}' else '${OTHER_KEY}' end)`);
    case "variant":
      return sql.raw(`coalesce(pl.variant_id::text, case when pl.custom then '${CUSTOM_KEY}' else '${OTHER_KEY}' end)`);
    case "kind":
      return sql.raw(`coalesce(pl.kind, case when pl.custom then '${CUSTOM_KEY}' else '${OTHER_KEY}' end)`);
    case "category":
      return sql.raw(`coalesce(tcat.term_id::text, '${NONE_KEY}')`);
    case "tag":
      return sql.raw(`coalesce(ttag.term_id::text, '${NONE_KEY}')`);
    default:
      throw new Error(`report: no column for ${key}`);
  }
}

/** The joins the final select needs for its dimensions: a product's terms, an order's codes (each a row of its own: they overlap). */
function dimensionJoins(used: ReadonlySet<DimensionKey>, x: "po" | "pl"): SQL {
  const joins: SQL[] = [];
  if (used.has("category")) joins.push(sql`left join pterms tcat on tcat.product_id = pl.product_id and tcat.kind = 'category'`);
  if (used.has("tag")) joins.push(sql`left join pterms ttag on ttag.product_id = pl.product_id and ttag.kind = 'tag'`);
  if (used.has("discount_code")) {
    joins.push(sql.raw(`cross join lateral unnest(case when cardinality(${x}.codes) = 0 then array['${NONE_KEY}'] else ${x}.codes end) as dcode(code)`));
  }
  return sql.join(joins, sql` `);
}

// ---------------------------------------------------------------------------
// One read: a grain, a set of dimensions, a period
// ---------------------------------------------------------------------------

type Read = {
  grain: "order" | "line" | "refund";
  metrics: MetricKey[];
  dimensions: DimensionKey[];
  filters: ReportSpec["filters"];
};

/** A grouped row: its keys, and per currency (or `null` for the counts across currencies) its sums. */
type Grouped = { keys: string[]; currency: string | null; sums: Record<string, number | null> };

const rowSchema = z.object({ k: z.array(z.string()), currency: z.string().nullable(), g: z.coerce.number(), s: z.record(z.string(), z.union([z.number(), z.string(), z.null()])) });

function cleanSums(raw: Record<string, number | string | null>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = v === null ? null : Number(v);
  return out;
}

/** The orders of the period every grain starts from, with the order-level dimensions the report needs worked out once per order. */
function ordersCte(store: Store, period: AnalyticsPeriod, used: ReadonlySet<DimensionKey>): SQL {
  const id = store.id;
  const visit = used.has("channel") || used.has("device");
  return sql`
    ${used.has("customer_type") ? sql`firsts as materialized (
      select ${CUSTOMER_KEY} as k, min(o.placed_at) as first_at
      from commerce.orders o ${CUSTOMER_JOIN}
      where o.store_id = ${id}::uuid and ${PAID} and ${HAS_CUSTOMER}
      group by 1
    ),` : sql``}
    po0 as materialized (
      -- A sale's day (D387): an order on terms by when its balance was paid, every other by when it was placed.
      select o.id, o.store_id, o.currency, o.market_code, ${SOLD_AT} as placed_at, o.total_minor, o.tax_minor, o.cart_id, o.discount_code,
        (case when ${HAS_CUSTOMER} then ${CUSTOMER_KEY} end) as ckey,
        (o.currency = any(${knownCurrencies(store)})) as ok,
        ${VOUCHER_NET} as voucher_rev,
        exists (select 1 from commerce.order_lines ol where ol.store_id = o.store_id and ol.order_id = o.id and not ${GIFT_CARD_LINE}) as has_lines
      from commerce.orders o ${CUSTOMER_JOIN}
      where o.store_id = ${id}::uuid and ${PAID} and ${soldIn(store, period)}
    ),
    po as materialized (
      select po0.*,
        ${visit ? sql`(case when c.source = 'agent' then 'ai_agent' else coalesce(vv.channel, ${NONE_KEY}) end)` : sql`null::text`} as d_channel,
        ${visit ? sql`coalesce(vv.device, ${NONE_KEY})` : sql`null::text`} as d_device,
        ${used.has("payment_method") ? sql`coalesce(mp.k, ${NONE_KEY})` : sql`null::text`} as d_method,
        ${used.has("customer_type") ? sql`(case when po0.ckey is null then ${NONE_KEY} when po0.placed_at <= f.first_at then 'new' else 'returning' end)` : sql`null::text`} as d_customer,
        ${
          used.has("discount_code")
            ? sql`coalesce((select array_agg(distinct lower(dc.code)) from commerce.order_discount_codes dc where dc.store_id = po0.store_id and dc.order_id = po0.id),
                case when coalesce(po0.discount_code, '') = '' then array[]::text[] else array[lower(po0.discount_code)] end)`
            : sql`array[]::text[]`
        } as codes
      from po0
      ${visit ? sql`left join commerce.carts c on c.store_id = po0.store_id and c.id = po0.cart_id left join commerce.visits vv on vv.store_id = c.store_id and vv.id = c.visit_id` : sql``}
      ${
        used.has("payment_method")
          ? sql`left join lateral (
              select ${METHOD_KEY("p")} as k from commerce.payments p
              where p.store_id = po0.store_id and p.order_id = po0.id and p.status = 'captured'
              order by p.amount_minor desc, p.id limit 1
            ) mp on true`
          : sql``
      }
      ${used.has("customer_type") ? sql`left join firsts f on f.k = po0.ckey` : sql``}
      where po0.ok and not (not po0.has_lines and po0.voucher_rev > 0)
    )`;
}

/** The lines of those orders (gift cards left out), and each product's categories and tags when the report cuts by them. */
function linesCte(store: Store, used: ReadonlySet<DimensionKey>): SQL {
  const id = store.id;
  const terms = used.has("category") || used.has("tag");
  return sql`,
    pl as materialized (
      select po.*, ol.variant_id, ol.custom, v.product_id, pr.kind,
        round(ol.unit_price_minor::numeric * ol.quantity / (1 + ol.tax_rate)) as gross,
        round((ol.discount_minor - ol.vat_relief_minor)::numeric / (1 + ol.tax_rate)) as disc,
        ol.total_minor - ol.tax_minor as line_rev,
        ol.tax_minor as line_tax,
        case when ol.variant_id is not null and ol.delivery <> 'service' then ol.quantity else 0 end as units,
        ol.unit_cost_minor * ol.quantity as cogs,
        case when (ol.variant_id is not null or ol.custom) and ol.unit_cost_minor is null then 0 else ol.total_minor - ol.tax_minor end as known_rev
      from po
      join commerce.order_lines ol on ol.store_id = po.store_id and ol.order_id = po.id
      left join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
      left join commerce.products pr on pr.store_id = v.store_id and pr.id = v.product_id
      where ol.store_id = ${id}::uuid and not ${GIFT_CARD_LINE}
    )
    ${
      terms
        ? sql`, pterms as materialized (
            select dp.product_id, t.id as term_id, t.kind
            from (select distinct product_id from pl where product_id is not null) dp
            join commerce.terms t on t.store_id = ${id}::uuid and t.content_type = 'product' and t.kind in ('category', 'tag')
            where exists (select 1 from commerce.product_terms pt where pt.store_id = t.store_id and pt.product_id = dp.product_id and pt.term_id = t.id)
              or (t.rules is not null and commerce.product_matches_rules(t.store_id, dp.product_id, t.rules))
          )`
        : sql``
    }`;
}

/** The sums a read selects, by grain: money per currency, counts across currencies (read from the row without a currency). */
function sums(grain: "order" | "line", x: string): SQL {
  const pairs: [string, string][] =
    grain === "order"
      ? [
          ["net", "sum(X.total_minor - X.tax_minor - X.voucher_rev)"],
          ["vat", "sum(X.tax_minor)"],
          ["orders", "count(distinct X.id)"],
          ["customers", "count(distinct X.ckey)"],
        ]
      : [
          ["net", "sum(X.line_rev)"],
          ["vat", "sum(X.line_tax)"],
          ["gross", "sum(X.gross)"],
          ["disc", "sum(X.disc)"],
          ["units", "sum(X.units)"],
          ["cogs", "sum(X.cogs)"],
          ["known", "sum(X.known_rev)"],
          ["orders", "count(distinct X.id)"],
          ["customers", "count(distinct X.ckey)"],
        ];
  return sql.raw(`jsonb_build_object(${pairs.map(([name, expr]) => `'${name}', ${expr.replaceAll("X.", `${x}.`)}`).join(", ")})`);
}

function filterWhere(filters: ReportSpec["filters"], store: Store, x: "po" | "pl"): SQL {
  if (filters.length === 0) return sql`true`;
  return sql.join(
    filters.map((f) => sql`(${dimensionColumn(f.dimension, store, x)}) = any(${`{${f.values.map((v) => `"${v.replace(/["\\]/g, "\\$&")}"`).join(",")}}`}::text[])`),
    sql` and `,
  );
}

/** One grouped read of orders or lines, by the given dimensions, per currency and across currencies. */
async function readOrdersOrLines(store: Store, period: AnalyticsPeriod, read: Read): Promise<Grouped[]> {
  const used = new Set<DimensionKey>([...read.dimensions, ...read.filters.map((f) => f.dimension)]);
  const x = read.grain === "line" ? "pl" : "po";
  // The keys are worked out once per row in `cut`, so the grouping reads plain columns (a time zone is a parameter, and a parameter is
  // never the same expression twice).
  const keyCols = read.dimensions.map((d, i) => sql`${dimensionColumn(d, store, x)} as ${sql.raw(`d${i}`)}`);
  const names = read.dimensions.map((_, i) => `d${i}`);
  const keys = names.length ? sql.raw(`array[${names.join(", ")}]::text[]`) : sql.raw(`array[]::text[]`);
  const query = sql`
    with ${ordersCte(store, period, used)}
    ${read.grain === "line" ? linesCte(store, used) : sql``},
    cut as (
      select ${sql.raw(x)}.*${keyCols.length ? sql`, ${sql.join(keyCols, sql`, `)}` : sql``}
      from ${sql.raw(x)}
      ${dimensionJoins(used, x)}
      where ${filterWhere(read.filters, store, x)}
    )
    select ${keys} as k, cut.currency::text as currency, grouping(cut.currency) as g, ${sums(read.grain === "line" ? "line" : "order", "cut")} as s
    from cut
    group by grouping sets (${sql.raw(`(${[...names, "cut.currency"].join(", ")}), (${names.join(", ")})`)})`;
  const rows = await setBasedReplica<Row>(query);
  return rows.map((r) => {
    const row = rowSchema.parse(r);
    return { keys: row.k, currency: row.g === 1 ? null : row.currency, sums: cleanSums(row.s) };
  });
}

/** Refunds by their own day, cut only by what a refund has; scaled to without VAT by the order's share, as Finance counts them. */
async function readRefunds(store: Store, period: AnalyticsPeriod, read: Read): Promise<{ rows: Grouped[]; left: Map<string, number> }> {
  const id = store.id;
  const used = new Set<DimensionKey>([...read.dimensions, ...read.filters.map((f) => f.dimension)]);
  const column = (key: DimensionKey): SQL => {
    if (DIMENSIONS[key].level === "time") return bucket(key, dayOf(store, sql`r.created_at`));
    switch (key) {
      case "market":
        return sql`o.market_code::text`;
      case "currency":
        return sql`rp.currency::text`;
      case "payment_method":
        return METHOD_KEY("rp");
      case "customer_type":
        return sql`(case when not ${HAS_CUSTOMER} then ${NONE_KEY} when o.placed_at <= f.first_at then 'new' else 'returning' end)`;
      default:
        throw new Error(`report: refunds are not cut by ${key}`);
    }
  };
  const keyCols = read.dimensions.map((d) => sql`(${column(d)})`);
  const keys = keyCols.length ? sql`array[${sql.join(keyCols, sql`, `)}]::text[]` : sql`array[]::text[]`;
  const where = read.filters.length
    ? sql.join(read.filters.map((f) => sql`(${column(f.dimension)}) = any(${`{${f.values.map((v) => `"${v.replace(/["\\]/g, "\\$&")}"`).join(",")}}`}::text[])`), sql` and `)
    : sql`true`;
  const rows = await setBasedReplica<Row>(sql`
    with ${used.has("customer_type") ? sql`firsts as materialized (
      select ${CUSTOMER_KEY} as k, min(o.placed_at) as first_at
      from commerce.orders o ${CUSTOMER_JOIN}
      where o.store_id = ${id}::uuid and ${PAID} and ${HAS_CUSTOMER}
      group by 1
    ),` : sql``}
    rf as (
      select r.created_at, rp.currency, rp.provider, rp.method, rp.wallet, rp.method_type, o.id as order_id, o.market_code, o.placed_at,
        (rp.currency = any(${knownCurrencies(store)})) as ok,
        ${keys} as k,
        round(r.amount_minor::numeric * greatest(o.total_minor - o.tax_minor - ${VOUCHER_NET}, 0) / nullif(o.total_minor, 0)) as amount
      from commerce.refunds r
      join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
      join commerce.orders o on o.store_id = rp.store_id and o.id = rp.order_id
      ${CUSTOMER_JOIN}
      ${used.has("customer_type") ? sql`left join firsts f on f.k = ${CUSTOMER_KEY}` : sql``}
      where r.store_id = ${id}::uuid and r.status = 'succeeded' and ${NOT_EDIT_REFUND} and ${inPeriod(store, sql`r.created_at`, period)}
        and o.copied_from is null and o.host_id is null and ${where}
    )
    select k, currency::text as currency, 0 as g, jsonb_build_object('refunds', sum(amount)) as s from rf where ok group by k, currency
    union all
    select array[]::text[], currency::text, 2, jsonb_build_object('n', count(*)) from rf where not ok group by currency
  `);
  const out: Grouped[] = [];
  const left = new Map<string, number>();
  for (const r of rows) {
    const row = rowSchema.parse(r);
    if (row.g === 2) left.set(String(row.currency).trim(), Number(row.s.n ?? 0));
    else out.push({ keys: row.k, currency: row.currency, sums: cleanSums(row.s) });
  }
  return { rows: out, left };
}

/** Paid orders of the period in a currency the store cannot convert, per currency. */
async function leftOutOrders(store: Store, period: AnalyticsPeriod): Promise<Map<string, number>> {
  const rows = await setBasedReplica<Row>(sql`
    select o.currency::text as currency, count(*) as n from commerce.orders o
    where o.store_id = ${store.id}::uuid and ${PAID} and ${soldIn(store, period)} and not (o.currency = any(${knownCurrencies(store)}))
    group by 1`);
  return new Map(rows.map((r) => [String(r.currency).trim(), Number(r.n)]));
}

// ---------------------------------------------------------------------------
// Folding the grouped rows into the report's rows
// ---------------------------------------------------------------------------

type Acc = { keys: string[]; money: Record<string, number>; counts: Record<string, number>; failed: number };

const keyOf = (keys: readonly string[]) => JSON.stringify(keys);

/** The sums that are counts across currencies (read from the row without a currency), never money. */
const COUNTS = ["orders", "customers", "orders_line", "customers_line"];

function fold(store: Store, grouped: Grouped[], into: Map<string, Acc>): number {
  let failed = 0;
  for (const g of grouped) {
    const k = keyOf(g.keys);
    const acc = into.get(k) ?? { keys: g.keys, money: {}, counts: {}, failed: 0 };
    into.set(k, acc);
    if (g.currency === null) {
      for (const name of COUNTS) if (g.sums[name] !== undefined) acc.counts[name] = g.sums[name] ?? 0;
      continue;
    }
    for (const [name, value] of Object.entries(g.sums)) {
      if (value === null || COUNTS.includes(name)) continue;
      // Units are counts and costs are kept in the main currency already: added as they are.
      if (name === "units" || name === "cogs") {
        acc.money[name] = (acc.money[name] ?? 0) + value;
        continue;
      }
      const main = toMainOne(store, g.currency, value);
      if (main === null) {
        failed += 1;
        acc.failed += 1;
        continue;
      }
      acc.money[name] = (acc.money[name] ?? 0) + main;
    }
  }
  return failed;
}

function valuesOf(metrics: readonly MetricKey[], acc: Acc | undefined, grains: Record<MetricKey, Read["grain"]>): { values: ReportValues; coverage: number | null } {
  const m = acc?.money ?? {};
  const c = acc?.counts ?? {};
  const lineRev = m.net_line ?? m.net ?? 0;
  const known = m.known;
  const coverage = known === undefined || lineRev <= 0 ? null : Math.min(1, Math.max(0, known / lineRev));
  const values: ReportValues = {};
  for (const metric of metrics) {
    switch (metric) {
      case "net_sales":
        values[metric] = (grains[metric] === "line" ? m.net_line : m.net) ?? 0;
        break;
      case "vat":
        values[metric] = (grains[metric] === "line" ? m.vat_line : m.vat) ?? 0;
        break;
      case "gross_sales":
        values[metric] = m.gross ?? 0;
        break;
      case "discounts":
        values[metric] = m.disc ?? 0;
        break;
      case "units":
        values[metric] = m.units ?? 0;
        break;
      case "refunds":
        values[metric] = m.refunds ?? 0;
        break;
      case "orders":
        values[metric] = (grains[metric] === "line" ? c.orders_line : c.orders) ?? 0;
        break;
      case "customers":
        values[metric] = (grains[metric] === "line" ? c.customers_line : c.customers) ?? 0;
        break;
      case "aov": {
        const orders = c.orders ?? 0;
        values[metric] = orders > 0 ? Math.round((m.net ?? 0) / orders) : null;
        break;
      }
      case "gross_profit": {
        const cogs = estimatedCogs({ cogsMinor: m.cogs ?? 0 }, coverage);
        values[metric] = cogs === null ? null : (m.net_line ?? 0) - cogs;
        break;
      }
    }
  }
  return { values, coverage };
}

/** Prefixes a read's sums so an order read and a line read of the same names can share one accumulator. */
function renamed(grouped: Grouped[], suffix: string): Grouped[] {
  return grouped.map((g) => ({ ...g, sums: Object.fromEntries(Object.entries(g.sums).map(([k, v]) => [["net", "vat", "orders", "customers"].includes(k) ? `${k}${suffix}` : k, v])) }));
}

type PeriodRead = { rows: Map<string, Acc>; unconverted: Map<string, number> };

/** Every read one period needs for a spec's dimensions (or none, for the totals), folded into one accumulator per row. */
async function readPeriod(store: Store, spec: ReportSpec, period: AnalyticsPeriod, dimensions: DimensionKey[]): Promise<PeriodRead> {
  const view = { ...spec, dimensions };
  const grains = Object.fromEntries(spec.metrics.map((m) => [m, grainIn(view, m)])) as Record<MetricKey, Read["grain"]>;
  const wantsOrder = spec.metrics.some((m) => grains[m] === "order" || m === "aov");
  const wantsLine = spec.metrics.some((m) => grains[m] === "line");
  const wantsRefund = spec.metrics.some((m) => grains[m] === "refund");
  const reads: Promise<unknown>[] = [];
  const rows = new Map<string, Acc>();
  const unconverted = new Map<string, number>();
  const add = (map: Map<string, number>) => {
    for (const [currency, n] of map) unconverted.set(currency, (unconverted.get(currency) ?? 0) + n);
  };
  if (wantsOrder) reads.push(readOrdersOrLines(store, period, { grain: "order", metrics: spec.metrics, dimensions, filters: spec.filters }).then((g) => fold(store, g, rows)));
  if (wantsLine) {
    reads.push(readOrdersOrLines(store, period, { grain: "line", metrics: spec.metrics, dimensions, filters: spec.filters }).then((g) => fold(store, renamed(g, "_line"), rows)));
  }
  if (wantsRefund) {
    reads.push(
      readRefunds(store, period, { grain: "refund", metrics: spec.metrics, dimensions, filters: spec.filters }).then(({ rows: g, left }) => {
        fold(store, g, rows);
        add(left);
      }),
    );
  }
  if (wantsOrder || wantsLine) reads.push(leftOutOrders(store, period).then(add));
  await Promise.all(reads);
  return { rows, unconverted };
}

/** The rest row of each group of the other dimensions: the orders' money less the lines' (shipping, an order's own discount). */
async function restRows(store: Store, spec: ReportSpec, period: AnalyticsPeriod, lineRows: Map<string, Acc>): Promise<Map<string, Acc>> {
  const lineAt = spec.dimensions.findIndex(isLineDim);
  const others = spec.dimensions.filter((d) => !isLineDim(d));
  const grouped = await readOrdersOrLines(store, period, { grain: "order", metrics: ["net_sales", "vat"], dimensions: others, filters: spec.filters });
  const orders = new Map<string, Acc>();
  fold(store, grouped, orders);
  const rest = new Map<string, Acc>();
  for (const acc of orders.values()) {
    const keys = [...spec.dimensions.map((d, i) => (i === lineAt ? REST_KEY : acc.keys[others.indexOf(d)]))];
    const lines = [...lineRows.values()].filter((l) => spec.dimensions.every((d, i) => i === lineAt || l.keys[i] === acc.keys[others.indexOf(d)]));
    const sum = (name: string) => lines.reduce((t, l) => t + (l.money[name] ?? 0), 0);
    rest.set(keyOf(keys), { keys, money: { net: (acc.money.net ?? 0) - sum("net_line"), vat: (acc.money.vat ?? 0) - sum("vat_line") }, counts: {}, failed: 0 });
  }
  return rest;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/** Resolves a spec's period the way the analytics pages read their address. */
export function reportPeriods(spec: ReportSpec, store: Pick<Store, "timeZone">, now: Date): { period: AnalyticsPeriod; comparison: AnalyticsPeriod | null } {
  const query: Record<string, string> = { period: spec.period.preset, compare: spec.period.compare };
  if (spec.period.from) query.from = spec.period.from;
  if (spec.period.to) query.to = spec.period.to;
  const params = parseAnalyticsParams(query, { now, timeZone: store.timeZone });
  const period = params.period;
  const comparison = spec.period.compare === "previous" ? previousPeriodOf(period) : spec.period.compare === "year" ? lastYearOf(period) : null;
  return { period, comparison };
}

/**
 * Runs a report: refuses a spec the catalogue does not allow (`specProblems()`), reads the period, the comparison and the totals, and
 * returns the rows sorted and cut to the spec's limit, the rest row last.
 */
export async function runReport(store: Store, spec: ReportSpec, now = new Date()): Promise<ReportOutcome> {
  const problems = specProblems(spec);
  if (problems.length > 0) return { ok: false, problems };
  const { period, comparison } = reportPeriods(spec, store, now);
  // No rest row where a line is in several rows (categories, tags): the lines' sum would count it twice.
  const rest = needsRestRow(spec) && !spec.filters.some((f) => isLineDim(f.dimension)) && !spec.dimensions.some((d) => OVERLAPPING.has(d));
  const grainsFull = Object.fromEntries(spec.metrics.map((m) => [m, grainIn(spec, m)])) as Record<MetricKey, Read["grain"]>;
  const grainsTotal = Object.fromEntries(spec.metrics.map((m) => [m, grainIn({ ...spec, dimensions: [] }, m)])) as Record<MetricKey, Read["grain"]>;

  const [now0, then0, total0, totalThen0] = await Promise.all([
    readPeriod(store, spec, period, spec.dimensions),
    comparison ? readPeriod(store, spec, comparison, spec.dimensions) : null,
    readPeriod(store, spec, period, []),
    comparison ? readPeriod(store, spec, comparison, []) : null,
  ]);
  if (rest) {
    for (const [k, acc] of await restRows(store, spec, period, now0.rows)) now0.rows.set(k, acc);
    if (then0) for (const [k, acc] of await restRows(store, spec, comparison!, then0.rows)) then0.rows.set(k, acc);
  }

  const rows: ReportRow[] = [];
  for (const [k, acc] of now0.rows) {
    const isRest = acc.keys.includes(REST_KEY);
    const restGrains = isRest ? ({ ...grainsFull, net_sales: "order", vat: "order" } as Record<MetricKey, Read["grain"]>) : grainsFull;
    const own = valuesOf(spec.metrics, acc, restGrains);
    const values = isRest ? Object.fromEntries(spec.metrics.map((m) => [m, m === "net_sales" || m === "vat" ? (own.values[m] ?? 0) : null])) : own.values;
    const then = then0 ? valuesOf(spec.metrics, then0.rows.get(k), restGrains).values : null;
    const previous = then && isRest ? Object.fromEntries(spec.metrics.map((m) => [m, m === "net_sales" || m === "vat" ? (then[m] ?? 0) : null])) : then;
    rows.push({ keys: acc.keys, values, previous, coverage: isRest ? null : own.coverage, rest: isRest });
  }

  const sort = sortOf(spec);
  const sortIndex = isMetric(sort.key) ? -1 : spec.dimensions.indexOf(sort.key);
  const body = rows.filter((r) => !r.rest);
  body.sort((a, b) => {
    if (sortIndex >= 0) {
      const cmp = a.keys[sortIndex].localeCompare(b.keys[sortIndex]);
      return sort.descending ? -cmp : cmp;
    }
    const av = a.values[sort.key as MetricKey] ?? -Infinity;
    const bv = b.values[sort.key as MetricKey] ?? -Infinity;
    return sort.descending ? bv - av : av - bv;
  });
  const shown = body.slice(0, spec.limit);
  const restShown = rows.filter((r) => r.rest).filter((r) => (r.values.net_sales ?? 0) !== 0 || (r.values.vat ?? 0) !== 0 || (r.previous?.net_sales ?? 0) !== 0);

  const totalAcc = total0.rows.get(keyOf([]));
  const totals = valuesOf(spec.metrics, totalAcc, grainsTotal);
  const totalsThen = totalThen0 ? valuesOf(spec.metrics, totalThen0.rows.get(keyOf([])), grainsTotal).values : null;

  const unconverted = [...total0.unconverted.values()].reduce((a, b) => a + b, 0);
  return {
    ok: true,
    report: {
      spec,
      currency: mainCurrency(store),
      period,
      comparison,
      columns: spec.metrics.map((metric) => ({ metric, addsUp: columnAddsUp(spec, metric) })),
      rows: [...shown, ...restShown],
      totals: { values: totals.values, previous: totalsThen, coverage: totals.coverage },
      unconverted,
      missingCurrencies: [...total0.unconverted.keys()].sort(),
      hiddenRows: Math.max(0, body.length - spec.limit),
      linesOnly: needsRestRow(spec) && !rest,
    },
  };
}

