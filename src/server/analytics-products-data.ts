import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { change, safeRatio, type Delta } from "@/lib/analytics-core";
import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { allocateRefund, paretoSummary, productTable, type ParetoSummary, type ProductRow, type ProductStat, type ProductTable } from "@/lib/analytics-products";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { dayKey, dayStart, FROM_CHECKOUT, inMain, inPeriod, NOT_EDIT_REFUND, num, PAID, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * The Products page's figures (D152, docs/analytics.md): every product's revenue, units, orders, cost, refunds, views and
 * change since the comparison, ready for `productTable()` and `paretoSummary()`.
 *
 * How it is read:
 *
 * - Lines of paid orders (`PAID`: not copied, not a host's, a captured payment), by the order's `placed_at` in the store's days.
 *   A line's revenue is `total_minor - tax_minor`: after discounts, without VAT. Lines with no variant (sign-up fees and the like)
 *   are one row, "Other lines", whose cost is a known 0 (the document: such lines count as known). A custom item (D173, a line staff typed into a
 *   draft order) is a row of its own, "Custom items", in no ranking, with no views, and with its cost not known (counted against the cost coverage).
 *   A staff-made order's lines are in every figure but the conversion: its orders are not counted against the product's views.
 * - Units are goods only (a variant, not delivered as a service), as the Overview's units are, so they add up to its figure.
 * - Revenue of the product rows plus the shipping charged on the same orders (without VAT, after a free-shipping code's discount, which
 *   is an order's discount beyond its lines') is the period's revenue (`reconciliation`): the line
 *   totals and the order's own shipping and VAT are exact in a currency, and what is left over is the rounding of converting each
 *   product's currency groups, never more than one minor unit per group.
 * - Refunds are the succeeded ones dated by their own date, scaled to without VAT by their order's `(total - tax) / total` (as the
 *   Overview does, so the table's refunds equal its figure) and split over that order's lines by what each was sold for
 *   (`allocateRefund()`, whole minor units that add up exactly). The shipping share of a refund goes to the products with the rest.
 * - Money is grouped by currency in SQL and converted here at today's rates; a currency with no rate is left out of every figure
 *   and counted (`unconverted`). Costs are kept in the main currency already and are added as they are.
 * - Views are `product_views` (only filled while the store counts visits). `views` is null for every product when the period has no
 *   counted day; when counting began inside the period, conversion counts only the orders from the first counted day.
 */

/** Products read per currency (the best by revenue); `truncated` says when a currency had more. */
export const PRODUCT_CAP = 2_000;
/** Refund-and-line rows read for the allocation. */
export const REFUND_ROW_CAP = 100_000;
/** The row for lines that have no product. */
export const OTHER_ID = "other";
export const OTHER_NAME = "Other lines";
/**
 * The row for custom items (D173): lines staff typed into a draft order (`order_lines.custom`). They are in the revenue and VAT but have no product, so
 * they are one row of their own, never in a ranking, with no views and no conversion, and with a cost that is not known (never a cost of 0).
 */
export const CUSTOM_ID = "custom";
export const CUSTOM_NAME = "Custom items";
/** A row that stands for lines with no product: "Other lines" or "Custom items". */
export const isNoProduct = (pid: string): boolean => pid === OTHER_ID || pid === CUSTOM_ID;
const noProductName = (pid: string): string => (pid === CUSTOM_ID ? CUSTOM_NAME : OTHER_NAME);
/** SQL for a line's product id (`ol` the line, `v` its variant, left joined): the product, else the row of its kind of line. */
const PRODUCT_ID = sql`coalesce(v.product_id::text, case when ol.custom then ${CUSTOM_ID} else ${OTHER_ID} end)`;

export type ProductReportRow = ProductStat & {
  /** The product's handle (its address name); null for the "Other lines" row. */
  handle: string | null;
  /** True for the row of lines with no product (sign-up fees and the like). */
  other: boolean;
  /** Units sold per day over the period. */
  unitsPerDay: number;
  /** Product page views in the period; null when the store has no counted day in it, and for "Other lines". */
  views: number | null;
  /** Orders / views (from the first counted day); null without views. A rough measure: a view is a page view, not a visitor. */
  conversion: number | null;
  /** Revenue in the comparison period; null when there is no comparison (0 when the product did not sell then). */
  previousRevenueMinor: number | null;
  previousUnits: number | null;
  /** Revenue now against then; null without a comparison, and `pct` null when it did not sell then. */
  revenueChange: Delta | null;
};

export type ProductsReport = {
  /** The main currency of every amount. */
  currency: string;
  period: { from: string; to: string; days: number };
  compare: { from: string; to: string; days: number } | null;
  /** Ranked by revenue, "Other lines" among them. */
  rows: ProductReportRow[];
  /** `productTable()`'s totals and the share of the period's revenue the rows make. */
  totals: ProductTable["totals"];
  shareOfRevenue: number | null;
  /** The products only (not "Other lines"): "18 % of products make 81 % of revenue". */
  pareto: ParetoSummary | null;
  /** Share of the rows' revenue on lines whose cost is known; null without revenue. */
  costCoverage: number | null;
  /** The period's own figures, from the orders, for checking the table: lines + shipping = revenue within rounding. */
  reconciliation: {
    /** Σ (total - VAT) of the period's paid orders. */
    revenueMinor: number;
    /** Shipping charged without VAT, after a free-shipping code's discount (the shipping part of `revenueMinor`). */
    shippingMinor: number;
    /** Σ of the rows' revenue. */
    linesMinor: number;
    /** `revenueMinor - shippingMinor - linesMinor`: 0 unless currencies were converted or rows were cut off by the cap. */
    differenceMinor: number;
    orders: number;
  };
  /** The comparison's revenue and units over all its rows; null without a comparison. */
  previous: { revenueMinor: number; units: number } | null;
  revenueChange: Delta | null;
  /** First day with counted product views inside the period; null when there is none (views are then unknown, not zero). */
  viewsFrom: string | null;
  /** Orders and refunds left out because their currency has no rate, and those currencies. */
  unconverted: number;
  missingCurrencies: string[];
  /** A currency had more products than `PRODUCT_CAP`, or the refunds more rows than `REFUND_ROW_CAP`: figures may be a little low. */
  truncated: boolean;
};

/** The currencies the store can convert into its main currency, as a Postgres text array literal. */
function convertibleCurrencies(store: Store): { list: Set<string>; literal: string } {
  const main = mainCurrency(store);
  const rates = store.localization.rates;
  const list = new Set<string>([main.trim()]);
  for (const currency of rates.keys()) if (canConvert(currency, main, rates)) list.add(currency.trim());
  return { list, literal: `{${[...list].join(",")}}` };
}

type Lines = {
  rows: Map<string, { revenue: number; knownRevenue: number; units: number; orders: number; ordersSince: number; cogs: number | null }>;
  truncated: boolean;
};

/**
 * The currencies as a `char(3)[]`, the column's own type: comparing `currency::text` instead hides the column's statistics from the
 * planner, which then guesses a hundredth of the rows and picks plans that are slow on a real store.
 */
const currencyList = (known: string) => sql`${known}::char(3)[]`;

/** The lines of a period's paid orders per product, converted into the main currency. `since` is the first day orders count for conversion. */
async function loadLines(store: Store, period: Pick<AnalyticsPeriod, "from" | "to">, since: string, known: string, cap: number): Promise<Lines> {
  // `pl` is one narrow row per line; the sums per currency and product read it once, and the orders (an order counts once for a
  // product, whatever its lines) are counted from the distinct (order, product) pairs, so no wide row is ever sorted.
  const rows = await setBased<Row>(sql`
    with pl as materialized (
      select o.id as oid, o.currency::text as currency, ${PRODUCT_ID} as pid,
        (ol.total_minor - ol.tax_minor) as rev,
        case when ol.variant_id is not null and ol.delivery <> 'service' then ol.quantity else 0 end as units,
        case when ol.custom then null when ol.variant_id is null then 0 else ol.unit_cost_minor * ol.quantity end as cogs,
        case when (ol.variant_id is null and not ol.custom) or ol.unit_cost_minor is not null then ol.total_minor - ol.tax_minor else 0 end as known_rev,
        (o.placed_at >= ${dayStart(store, since)} and ${FROM_CHECKOUT}) as since_ok
      from commerce.orders o
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      left join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)} and o.currency = any(${currencyList(known)})
    ),
    sums as (
      select currency, pid, sum(rev) as rev, sum(units) as units, sum(cogs) as cogs, sum(known_rev) as known_rev
      from pl
      group by currency, pid
    ),
    counts as (
      select currency, pid, count(*) as orders, count(*) filter (where since_ok) as orders_since
      from (select oid, currency, pid, bool_or(since_ok) as since_ok from pl group by oid, currency, pid) d
      group by currency, pid
    ),
    g as (
      select s.currency, s.pid, s.rev, s.units, c.orders, c.orders_since, s.cogs, s.known_rev
      from sums s join counts c on c.currency = s.currency and c.pid = s.pid
    ),
    ranked as (
      select g.*, count(*) over (partition by currency) as n,
        row_number() over (partition by currency order by rev desc, pid) as rn
      from g
    )
    select currency, pid, rev, units, orders, orders_since, cogs, known_rev, n
    from ranked
    where rn <= ${cap}
  `);
  let truncated = false;
  const byProduct = new Map<string, Row[]>();
  for (const r of rows) {
    if (num(r, "n") > cap) truncated = true;
    const key = String(r.pid);
    byProduct.set(key, [...(byProduct.get(key) ?? []), r]);
  }
  const out: Lines["rows"] = new Map();
  for (const [pid, group] of byProduct) {
    const money = inMain(store, group.map((r) => ({ ...r, currency: String(r.currency) })), ["rev", "known_rev"]).values;
    out.set(pid, {
      revenue: money.rev,
      knownRevenue: money.known_rev,
      units: group.reduce((s, r) => s + num(r, "units"), 0),
      orders: group.reduce((s, r) => s + num(r, "orders"), 0),
      ordersSince: group.reduce((s, r) => s + num(r, "orders_since"), 0),
      // Null while no line of the product had a known cost; costs are in the main currency already.
      cogs: group.some((r) => r.cogs !== null) ? group.reduce((s, r) => s + num(r, "cogs"), 0) : null,
    });
  }
  return { rows: out, truncated };
}

/**
 * The period's revenue and the shipping it holds from the orders themselves (not from their lines), and what was left out for want of a
 * rate. The shipping is what shoppers were charged without VAT and after a free-shipping code's discount: revenue = lines + this.
 */
async function loadPeriodFigures(store: Store, period: AnalyticsPeriod, convertible: Set<string>) {
  const rows = await setBased<Row>(sql`
    with po as materialized (
      select o.id, o.currency::text as currency, o.total_minor, o.tax_minor, o.shipping_minor, o.discount_minor, o.vat_relief_minor
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
    ),
    -- Each order's lines once, so an order's discount beyond them (a free-shipping code's) can be taken off its shipping.
    lo as (
      select po.id, sum(ol.tax_minor) as line_tax, sum(ol.discount_minor - ol.vat_relief_minor) as line_disc, sum(ol.vat_relief_minor) as line_relief
      from po
      join commerce.order_lines ol on ol.order_id = po.id
      where ol.store_id = ${store.id}::uuid
      group by po.id
    )
    select o.currency, count(*) as orders, sum(o.total_minor - o.tax_minor) as revenue,
      sum(o.shipping_minor - least(o.shipping_minor, greatest(0, o.discount_minor - o.vat_relief_minor - coalesce(l.line_disc, 0))) - (o.vat_relief_minor - coalesce(l.line_relief, 0)) - (o.tax_minor - coalesce(l.line_tax, 0))) as shipping
    from po o
    left join lo l on l.id = o.id
    group by o.currency
  `);
  const usable = rows.filter((r) => convertible.has(String(r.currency).trim()));
  const money = inMain(store, usable.map((r) => ({ ...r, currency: String(r.currency) })), ["revenue", "shipping"]).values;
  const left = rows.filter((r) => !convertible.has(String(r.currency).trim()));
  return {
    revenue: money.revenue,
    shipping: money.shipping,
    orders: usable.reduce((s, r) => s + num(r, "orders"), 0),
    unconverted: left.reduce((s, r) => s + num(r, "orders"), 0),
    missing: left.map((r) => String(r.currency).trim()),
  };
}

/** Each product's share of the period's succeeded refunds (by their own date), in the main currency. */
async function loadRefunds(store: Store, period: AnalyticsPeriod, known: string) {
  const [lineRows, excluded] = await Promise.all([
    setBased<Row>(sql`
      select r.id::text as refund_id, rp.currency::text as currency,
        round(r.amount_minor::numeric * (o.total_minor - o.tax_minor) / nullif(o.total_minor, 0)) as amount,
        ${PRODUCT_ID} as pid, (ol.total_minor - ol.tax_minor) as line_amount
      from commerce.refunds r
      join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
      join commerce.orders o on o.store_id = rp.store_id and o.id = rp.order_id
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      left join commerce.product_variants v on v.store_id = ol.store_id and v.id = ol.variant_id
      where r.store_id = ${store.id}::uuid and r.status = 'succeeded' and ${NOT_EDIT_REFUND} and ${inPeriod(store, sql`r.created_at`, period)}
        and o.copied_from is null and o.host_id is null and rp.currency = any(${currencyList(known)})
      order by r.id, ol.id
      limit ${REFUND_ROW_CAP + 1}
    `),
    setBased<Row>(sql`
      select rp.currency::text as currency, count(*) as n
      from commerce.refunds r
      join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
      join commerce.orders o on o.store_id = rp.store_id and o.id = rp.order_id
      where r.store_id = ${store.id}::uuid and r.status = 'succeeded' and ${NOT_EDIT_REFUND} and ${inPeriod(store, sql`r.created_at`, period)}
        and o.copied_from is null and o.host_id is null and not (rp.currency = any(${currencyList(known)}))
      group by 1
    `),
  ]);
  const truncated = lineRows.length > REFUND_ROW_CAP;
  const rows = truncated ? lineRows.slice(0, REFUND_ROW_CAP) : lineRows;

  // One refund at a time: its lines (as read, in id order) take the refund by what they were sold for.
  const refunds = new Map<string, { currency: string; amount: number; lines: { pid: string; amountMinor: number }[] }>();
  for (const r of rows) {
    const id = String(r.refund_id);
    let refund = refunds.get(id);
    if (!refund) refunds.set(id, (refund = { currency: String(r.currency), amount: num(r, "amount"), lines: [] }));
    refund.lines.push({ pid: String(r.pid), amountMinor: num(r, "line_amount") });
  }
  const perProduct = new Map<string, Map<string, number>>();
  for (const refund of refunds.values()) {
    const shares = allocateRefund(refund.amount, refund.lines);
    refund.lines.forEach((line, i) => {
      const byCurrency = perProduct.get(line.pid) ?? new Map<string, number>();
      byCurrency.set(refund.currency, (byCurrency.get(refund.currency) ?? 0) + shares[i]);
      perProduct.set(line.pid, byCurrency);
    });
  }
  const amounts = new Map<string, number>();
  for (const [pid, byCurrency] of perProduct) {
    const groups = [...byCurrency].map(([currency, refund]) => ({ currency, refund }));
    amounts.set(pid, inMain(store, groups, ["refund"]).values.refund);
  }
  return {
    amounts,
    truncated,
    unconverted: excluded.reduce((s, r) => s + num(r, "n"), 0),
    missing: excluded.map((r) => String(r.currency).trim()),
  };
}

/** Product page views of the period, per product, and the first day with any. */
async function loadViews(store: Store, period: Pick<AnalyticsPeriod, "from" | "to">) {
  const [perProduct, first] = await Promise.all([
    db().execute<Row>(sql`
      select pv.product_id::text as pid, sum(pv.views) as views
      from commerce.product_views pv
      where pv.store_id = ${store.id}::uuid and pv.day >= ${period.from}::date and pv.day < ${period.to}::date
      group by 1
    `),
    db().execute<Row>(sql`
      select min(pv.day) as first_day
      from commerce.product_views pv
      where pv.store_id = ${store.id}::uuid and pv.day >= ${period.from}::date and pv.day < ${period.to}::date
    `),
  ]);
  const firstDay = first[0]?.first_day;
  return {
    views: new Map(perProduct.map((r) => [String(r.pid), num(r, "views")])),
    firstDay: firstDay === null || firstDay === undefined ? null : dayKey(firstDay),
  };
}

/** The products' names in the store's main language where they have one, else their handle. */
async function loadNames(store: Store, ids: readonly string[]): Promise<Map<string, { name: string; handle: string }>> {
  if (ids.length === 0) return new Map();
  const locale = store.localization.locales[0] ?? "en";
  const rows = await db().execute<Row>(sql`
    select distinct on (p.id) p.id::text as id, p.handle, pt.title
    from commerce.products p
    left join commerce.product_translations pt on pt.store_id = p.store_id and pt.product_id = p.id
    where p.store_id = ${store.id}::uuid and p.id = any(${`{${ids.join(",")}}`}::uuid[])
    order by p.id, (pt.locale = ${locale}) desc nulls last, (split_part(pt.locale, '-', 1) = split_part(${locale}, '-', 1)) desc nulls last, pt.locale
  `);
  return new Map(rows.map((r) => [String(r.id), { name: r.title ? String(r.title) : String(r.handle), handle: String(r.handle) }]));
}

/**
 * The Products page: every product sold in `period` with its figures, and the comparison's revenue for the change column.
 * Works over paid orders only; see the module's notes for what is left out and what is converted.
 */
export async function productsReport(
  store: Store,
  period: AnalyticsPeriod,
  compare?: AnalyticsPeriod | null,
  options: { productCap?: number } = {},
): Promise<ProductsReport> {
  const cap = Math.max(1, options.productCap ?? PRODUCT_CAP);
  const { list, literal } = convertibleCurrencies(store);
  const views = await loadViews(store, period);
  // Orders count for conversion from the first day views were counted (a partly counted period would understate it).
  const since = views.firstDay !== null && views.firstDay > period.from ? views.firstDay : period.from;

  const [lines, before, figures, refunds] = await Promise.all([
    loadLines(store, period, since, literal, cap),
    compare ? loadLines(store, compare, compare.from, literal, cap) : Promise.resolve(null),
    loadPeriodFigures(store, period, list),
    loadRefunds(store, period, literal),
  ]);

  // Names for every product in the table: those that sold, and those that were only refunded in the period.
  const ids = [...new Set([...lines.rows.keys(), ...refunds.amounts.keys()])].filter((pid) => !isNoProduct(pid));
  const names = await loadNames(store, ids);

  const days = Math.max(1, period.days);
  const tableRows: ProductRow[] = [...lines.rows].map(([pid, l]) => ({
    productId: pid,
    name: isNoProduct(pid) ? noProductName(pid) : (names.get(pid)?.name ?? pid),
    revenueMinor: l.revenue,
    units: l.units,
    orders: l.orders,
    cogsMinor: l.cogs,
    knownCostRevenueMinor: l.cogs === null ? 0 : Math.min(l.revenue, l.knownRevenue),
    refundsMinor: refunds.amounts.get(pid) ?? 0,
  }));
  // Refunds of a product that sold nothing in the period (the sale was earlier) still belong to it.
  for (const [pid, amount] of refunds.amounts) {
    if (lines.rows.has(pid) || amount === 0) continue;
    tableRows.push({ productId: pid, name: isNoProduct(pid) ? noProductName(pid) : (names.get(pid)?.name ?? pid), revenueMinor: 0, units: 0, orders: 0, cogsMinor: pid === OTHER_ID ? 0 : null, knownCostRevenueMinor: 0, refundsMinor: amount });
  }
  const table = productTable(tableRows, { revenueMinor: figures.revenue });
  const viewsKnown = views.firstDay !== null;
  const rows: ProductReportRow[] = table.rows.map((r) => {
    const other = isNoProduct(r.productId);
    const l = lines.rows.get(r.productId);
    const seen = viewsKnown && !other ? (views.views.get(r.productId) ?? 0) : null;
    const prior = before ? (before.rows.get(r.productId) ?? null) : null;
    const previousRevenue = before ? (prior?.revenue ?? 0) : null;
    return {
      ...r,
      handle: other ? null : (names.get(r.productId)?.handle ?? null),
      other,
      unitsPerDay: r.units / days,
      views: seen,
      conversion: seen === null || seen <= 0 ? null : safeRatio(l?.ordersSince ?? 0, seen),
      previousRevenueMinor: previousRevenue,
      previousUnits: before ? (prior?.units ?? 0) : null,
      revenueChange: previousRevenue === null ? null : change(r.revenueMinor, previousRevenue),
    };
  });

  const previous = before ? { revenueMinor: [...before.rows.values()].reduce((s, l) => s + l.revenue, 0), units: [...before.rows.values()].reduce((s, l) => s + l.units, 0) } : null;
  const knownRevenue = table.rows.reduce((s, r) => s + r.knownCostRevenueMinor, 0);
  const missing = [...new Set([...figures.missing, ...refunds.missing])].sort();
  return {
    currency: mainCurrency(store),
    period: { from: period.from, to: period.to, days: period.days },
    compare: compare ? { from: compare.from, to: compare.to, days: compare.days } : null,
    rows,
    totals: table.totals,
    shareOfRevenue: table.shareOfRevenue,
    pareto: paretoSummary(table.rows.filter((r) => !isNoProduct(r.productId))),
    costCoverage: safeRatio(knownRevenue, table.totals.revenueMinor > 0 ? table.totals.revenueMinor : null),
    reconciliation: {
      revenueMinor: figures.revenue,
      shippingMinor: figures.shipping,
      linesMinor: table.totals.revenueMinor,
      differenceMinor: figures.revenue - figures.shipping - table.totals.revenueMinor,
      orders: figures.orders,
    },
    previous,
    revenueChange: previous ? change(table.totals.revenueMinor, previous.revenueMinor) : null,
    viewsFrom: views.firstDay,
    unconverted: figures.unconverted + refunds.unconverted,
    missingCurrencies: missing,
    truncated: lines.truncated || (before?.truncated ?? false) || refunds.truncated,
  };
}
