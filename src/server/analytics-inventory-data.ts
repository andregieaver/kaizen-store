import "server-only";

import { sql } from "drizzle-orm";

import { safeRatio } from "@/lib/analytics-core";
import {
  analyseVariant,
  inventoryValue,
  sellThrough,
  stockWatch,
  stockoutAlerts,
  turnover,
  type InventoryAnalysis,
  type InventoryRow,
  type InventoryValue,
  type StockStatus,
  type StockoutAlert,
} from "@/lib/analytics-inventory";
import { todayIn } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";

import { dayOf, num, OWED_LINE, OWED_UNITS, PAID, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * The Inventory page's figures (D152, docs/analytics.md): what is in stock, how fast it sells, what is stuck and what is about to
 * run out. One set-based query reads every stocked variant with its sales; `@/lib/analytics-inventory` turns the rows into days of
 * stock, statuses and alerts.
 *
 * What counts:
 *
 * - A variant is read when it is active, delivered as a physical good (`kind = 'goods'`), and its product is not archived (a draft's
 *   stock is still stock). Variants with no stock tracking (digital, services) have no figures and are not listed.
 * - On hand is summed over the store's ACTIVE locations only. Reservations are never subtracted: on hand is on hand.
 * - Units sold are goods on lines of paid orders (`PAID`, whatever the order's status afterwards), 7, 30 and 90 days back from `now`
 *   (exact days of 24 hours, up to `now`), less what went back into stock by a refund or a cancellation (the `restocked` items of the
 *   order's `order.refunded` and `order.restocked` events), never below 0 for an order.
 * - Sales are read 365 days back: a variant last sold longer ago has `lastSoldAt` null, which dead stock treats as it treats
 *   "never sold" (it is dead once it has been on offer 90 days, which such a variant has).
 * - Stock value is on hand x the variant's cost today; stock with no cost entered is counted apart (`value.unitsWithoutCost`), never
 *   valued at 0. Turnover is COGS of the last 365 days (the sold lines' kept costs, for the listed variants, net of restocks) over that
 *   value, so it rests on both costs' coverage (`cogs365Coverage` and `value.coverage`).
 * - The price is the variant's current price in the store's main market without VAT, in the main currency.
 * - A negative on hand (a variant that sells on backorder, D172) is shown as it is and counts as 0 in the value, the days of stock, the dead
 *   stock and the sell-through; the units paid orders still wait for are `owed` (`OWED_LINE`). `lowStockThreshold` is the variant's own warning
 *   level; without one, low means "lasts 14 days or fewer".
 */

/** Variants read; the page says so when it is reached (`readTruncated`). The best sellers come first, so what is cut is what never sells. */
export const VARIANT_CAP = 20_000;
/** Rows returned in `rows` (the rest are counted in the totals and alerts). */
export const ROW_CAP = 1_000;
/** Stock-out alerts returned in `alerts` (`alertsTotal` has them all). */
export const ALERT_CAP = 50;
/** How far back sales are read. */
export const SALES_LOOKBACK_DAYS = 365;

export type InventoryReportRow = InventoryAnalysis & {
  /** The product's handle (its address name). */
  handle: string;
  /** The product's title in the store's main language, else its handle; `name` adds the variant's options. */
  title: string;
  /** The variant's options as a list of values ("M", "blue"). */
  options: string[];
  /** The last paid sale, ISO, within the last 365 days; null when none (`lastSoldDaysAgo` is null with it). */
  lastSoldAt: string | null;
  /** Units sold in the last 90 days: the table's third velocity. */
  sold90: number;
  /** The variant's current price in the main market without VAT, in the main currency; null without one. */
  priceExVatMinor: number | null;
};

export type InventoryTotals = {
  /** Variants read (stocked goods). */
  variants: number;
  /** Units, value at cost and how much of the stock has a cost: `inventoryValue()`. */
  value: InventoryValue;
  /** Variants by status; they add up to `variants`. */
  out: number;
  low: number;
  ok: number;
  dead: number;
  /** Units and cost of the dead stock: what is tied up (`deadValueMinor` counts only units with a known cost). */
  deadUnits: number;
  deadValueMinor: number;
  /** COGS of the last 365 days (known costs only) of the listed variants, net of restocks, and the share of those units whose cost was known. */
  cogs365Minor: number;
  cogs365Coverage: number | null;
  /** Times the stock was sold through in a year: `cogs365Minor` / value; null without a value. */
  turnover: number | null;
  /** Units sold in the last 30 days, and `sold / (sold + on hand)`; null when there was neither. */
  sold30: number;
  sellThrough30: number | null;
  /** The owner's own settings (D172): units paid orders still wait for, variants selling on backorder, variants at or below their warning level. */
  owedUnits: number;
  onBackorder: number;
  belowLevel: number;
};

export type InventoryReport = {
  /** The main currency of every amount. */
  currency: string;
  /** The instant and the store's day the figures were made for. */
  now: string;
  today: string;
  lookbackDays: number;
  /** Most urgent first (out, low, dead, ok), at most `ROW_CAP`. */
  rows: InventoryReportRow[];
  /** Variants read, so `rows` is a cut of them when it is shorter. */
  variants: number;
  rowsTruncated: boolean;
  /** More than `VARIANT_CAP` variants were stocked: totals and alerts cover the ones read. */
  readTruncated: boolean;
  totals: InventoryTotals;
  /** Variants that sell and are gone or will be within a week, at most `ALERT_CAP`. */
  alerts: StockoutAlert[];
  alertsTotal: number;
};

const iso = (value: unknown): string | null => (value === null || value === undefined ? null : new Date(value as string | number | Date).toISOString());

const optionValues = (options: unknown): string[] =>
  options && typeof options === "object" && !Array.isArray(options)
    ? Object.values(options as Record<string, unknown>)
        .map((v) => String(v ?? "").trim())
        .filter((v) => v !== "")
    : [];

const RANK: Record<StockStatus, number> = { out: 0, low: 1, dead: 2, ok: 3, untracked: 4 };

/** Out first (best sellers first), then those that will run out soonest, then dead stock with most tied up, then the rest. */
function byAttention(a: InventoryReportRow, b: InventoryReportRow): number {
  if (RANK[a.status] !== RANK[b.status]) return RANK[a.status] - RANK[b.status];
  let order = 0;
  if (a.status === "low") order = (a.daysOfStock ?? Infinity) - (b.daysOfStock ?? Infinity);
  else if (a.status === "dead") order = (b.valueMinor ?? 0) - (a.valueMinor ?? 0) || b.onHand - a.onHand;
  else order = b.sold30 - a.sold30;
  if (order !== 0 && Number.isFinite(order)) return order;
  return a.name.localeCompare(b.name, "en") || (a.variantId < b.variantId ? -1 : a.variantId > b.variantId ? 1 : 0);
}

/**
 * The stock of every stocked variant with how it sells, as of `now`. Pass the clock in (tests do); the page passes `new Date()`.
 */
export async function inventoryReport(store: Store, now: Date): Promise<InventoryReport> {
  const id = store.id;
  const tz = store.timeZone;
  const today = todayIn(now, tz);
  const at = sql`${now.toISOString()}::timestamptz`;
  const locale = store.localization.locales[0] ?? "en";
  const market = store.markets[0];
  const marketCode = market?.code ?? "";

  // Paid orders of the last 365 days, found once. Lines of orders that had stock put back (a refund or a cancellation) are worked out
  // per order and variant, as the rule needs; every other line is added to its variant straight away.
  // (`timestamptz - interval` is not folded to a constant: as a subquery it is worked out once, not for every order and line.)
  const inWindow = sql`o.placed_at > (select ${at} - (${SALES_LOOKBACK_DAYS}::int * interval '1 day')) and o.placed_at <= ${at}`;

  const rows = await setBased<Row>(sql`
    with vs as (
      select v.id, v.product_id, v.sku, v.options, v.cost_minor, v.created_at, v.stock_policy, v.low_stock_threshold, p.handle, p.vat_category
      from commerce.product_variants v
      join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
      where v.store_id = ${id}::uuid and v.active and v.delivery = 'physical' and p.kind = 'goods' and p.status <> 'archived'
    ),
    oh as (
      select il.variant_id, sum(il.on_hand) as on_hand
      from commerce.inventory_levels il
      join commerce.inventory_locations loc on loc.store_id = il.store_id and loc.id = il.location_id and loc.active
      where il.store_id = ${id}::uuid and il.variant_id in (select id from vs)
      group by il.variant_id
    ),
    ow as (
      select ol.variant_id, sum(${OWED_UNITS})::int as owed
      from commerce.orders o
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      where o.store_id = ${id}::uuid and ${OWED_LINE} and ol.variant_id in (select id from vs)
      group by ol.variant_id
    ),
    po as materialized (
      select o.id, o.placed_at
      from commerce.orders o
      where o.store_id = ${id}::uuid and ${PAID} and ${inWindow}
    ),
    rs as (
      select e.order_id, item ->> 'sku' as sku, sum((item ->> 'quantity')::int) as q
      from commerce.order_events e
      cross join lateral jsonb_array_elements(case when jsonb_typeof(e.data -> 'restocked') = 'array' then e.data -> 'restocked' else '[]'::jsonb end) as item
      where e.store_id = ${id}::uuid and e.type in ('order.refunded', 'order.restocked') and e.order_id in (select id from po)
      group by 1, 2
    ),
    ro as materialized (
      select distinct order_id from rs
    ),
    sl as materialized (
      select po.id as order_id, po.placed_at, ol.variant_id, ol.sku, ol.quantity, ol.unit_cost_minor, (ro.order_id is not null) as restocked
      from po
      join commerce.order_lines ol on ol.order_id = po.id
      left join ro on ro.order_id = po.id
      where ol.store_id = ${id}::uuid and ol.variant_id in (select id from vs)
    ),
    plain as (
      select variant_id,
        sum(quantity) filter (where placed_at > (select ${at} - interval '7 days')) as sold7,
        sum(quantity) filter (where placed_at > (select ${at} - interval '30 days')) as sold30,
        sum(quantity) filter (where placed_at > (select ${at} - interval '90 days')) as sold90,
        sum(quantity) as units365,
        max(placed_at) as last_sold,
        sum(unit_cost_minor * quantity) as cogs365,
        sum(quantity) filter (where unit_cost_minor is not null) as known_units365
      from sl
      where not restocked
      group by variant_id
    ),
    sold as (
      select sl.order_id, sl.variant_id, sl.placed_at,
        sum(sl.quantity) as qty,
        greatest(sum(sl.quantity) - coalesce(max(rs.q), 0), 0) as net,
        sum(sl.unit_cost_minor * sl.quantity) as known_cost,
        coalesce(sum(sl.quantity) filter (where sl.unit_cost_minor is not null), 0) as known_qty
      from sl
      left join rs on rs.order_id = sl.order_id and rs.sku = sl.sku
      where sl.restocked
      group by sl.order_id, sl.variant_id, sl.placed_at
    ),
    restocked as (
      select s.variant_id,
        sum(s.net) filter (where s.placed_at > (select ${at} - interval '7 days')) as sold7,
        sum(s.net) filter (where s.placed_at > (select ${at} - interval '30 days')) as sold30,
        sum(s.net) filter (where s.placed_at > (select ${at} - interval '90 days')) as sold90,
        sum(s.net) as units365,
        max(s.placed_at) filter (where s.net > 0) as last_sold,
        sum(case when s.qty > 0 then round(s.known_cost::numeric * s.net / s.qty) else 0 end) as cogs365,
        sum(case when s.qty > 0 then s.known_qty::numeric * s.net / s.qty else 0 end) as known_units365
      from sold s
      group by s.variant_id
    ),
    agg as (
      select variant_id,
        coalesce(sum(sold7), 0) as sold7, coalesce(sum(sold30), 0) as sold30, coalesce(sum(sold90), 0) as sold90,
        coalesce(sum(units365), 0) as units365, max(last_sold) as last_sold,
        coalesce(sum(cogs365), 0) as cogs365, coalesce(sum(known_units365), 0) as known_units365
      from (select * from plain union all select * from restocked) u
      group by variant_id
    ),
    titles as (
      select distinct on (pt.product_id) pt.product_id, pt.title
      from commerce.product_translations pt
      where pt.store_id = ${id}::uuid and pt.product_id in (select product_id from vs)
      order by pt.product_id, (pt.locale = ${locale}) desc, (split_part(pt.locale, '-', 1) = split_part(${locale}, '-', 1)) desc, pt.locale
    ),
    rates as (
      select c.category, commerce.vat_rate(${marketCode}::char(2), c.category) as rate
      from (values ('standard'), ('accommodation'), ('exempt')) as c(category)
    )
    select vs.id::text as variant_id, vs.product_id::text as product_id, vs.sku, vs.options, vs.cost_minor, vs.handle,
      coalesce(t.title, vs.handle) as title,
      coalesce(oh.on_hand, 0) as on_hand, vs.stock_policy, vs.low_stock_threshold, coalesce(ow.owed, 0) as owed,
      coalesce(agg.sold7, 0) as sold7, coalesce(agg.sold30, 0) as sold30, coalesce(agg.sold90, 0) as sold90,
      coalesce(agg.units365, 0) as units365, coalesce(agg.cogs365, 0) as cogs365, coalesce(agg.known_units365, 0) as known_units365,
      agg.last_sold,
      case when agg.last_sold is null then null else greatest(${today}::date - ${dayOf(store, sql`agg.last_sold`)}, 0) end as last_days,
      greatest(${today}::date - ${dayOf(store, sql`vs.created_at`)}, 0) as age_days,
      round(pr.amount_minor::numeric / (1 + coalesce(rt.rate, 0))) as price_ex_vat
    from vs
    left join oh on oh.variant_id = vs.id
    left join ow on ow.variant_id = vs.id
    left join agg on agg.variant_id = vs.id
    left join titles t on t.product_id = vs.product_id
    left join commerce.prices pr on pr.store_id = ${id}::uuid and pr.variant_id = vs.id and pr.market_code = ${marketCode} and pr.valid_to is null
    left join rates rt on rt.category = vs.vat_category
    order by coalesce(agg.sold90, 0) desc, coalesce(oh.on_hand, 0) desc, vs.id
    limit ${VARIANT_CAP + 1}
  `);

  const readTruncated = rows.length > VARIANT_CAP;
  const read = readTruncated ? rows.slice(0, VARIANT_CAP) : rows;

  let cogs365 = 0;
  let units365 = 0;
  let knownUnits365 = 0;
  const analysed: InventoryReportRow[] = read.map((r) => {
    const options = optionValues(r.options);
    const title = String(r.title);
    const row: InventoryRow = {
      variantId: String(r.variant_id),
      productId: String(r.product_id),
      name: options.length > 0 ? `${title} (${options.join(" / ")})` : title,
      sku: r.sku === null ? null : String(r.sku),
      tracked: true,
      onHand: num(r, "on_hand"),
      stockPolicy: r.stock_policy === "continue" ? "continue" : "deny",
      owed: num(r, "owed"),
      sold7: num(r, "sold7"),
      sold30: num(r, "sold30"),
      soldPeriod: num(r, "sold30"),
      lastSoldDaysAgo: r.last_days === null ? null : num(r, "last_days"),
      ageDays: num(r, "age_days"),
      costMinor: r.cost_minor === null ? null : num(r, "cost_minor"),
      lowStockThreshold: r.low_stock_threshold === null ? null : num(r, "low_stock_threshold"),
    };
    cogs365 += num(r, "cogs365");
    units365 += num(r, "units365");
    knownUnits365 += num(r, "known_units365");
    return {
      ...analyseVariant(row),
      handle: String(r.handle),
      title,
      options,
      lastSoldAt: iso(r.last_sold),
      sold90: num(r, "sold90"),
      priceExVatMinor: r.price_ex_vat === null ? null : num(r, "price_ex_vat"),
    };
  });

  const plain: InventoryRow[] = analysed.map((r) => ({
    variantId: r.variantId,
    productId: r.productId,
    name: r.name,
    sku: r.sku,
    tracked: r.tracked,
    onHand: r.onHand,
    stockPolicy: r.stockPolicy,
    owed: r.owed,
    sold7: r.sold7,
    sold30: r.sold30,
    soldPeriod: r.soldPeriod,
    lastSoldDaysAgo: r.lastSoldDaysAgo,
    ageDays: r.ageDays,
    costMinor: r.costMinor,
    lowStockThreshold: r.lowStockThreshold,
  }));
  const value = inventoryValue(plain);
  const count = (status: StockStatus) => analysed.filter((r) => r.status === status).length;
  const dead = analysed.filter((r) => r.status === "dead");
  const sold30 = analysed.reduce((s, r) => s + r.sold30, 0);
  const onHandUnits = analysed.reduce((s, r) => s + Math.max(0, r.onHand), 0);
  const cogs365Minor = Math.round(cogs365);
  const alerts = stockoutAlerts(plain);
  const watch = stockWatch(plain);

  const sorted = [...analysed].sort(byAttention);
  return {
    currency: mainCurrency(store),
    now: now.toISOString(),
    today,
    lookbackDays: SALES_LOOKBACK_DAYS,
    rows: sorted.slice(0, ROW_CAP),
    variants: analysed.length,
    rowsTruncated: sorted.length > ROW_CAP,
    readTruncated,
    totals: {
      variants: analysed.length,
      value,
      out: count("out"),
      low: count("low"),
      ok: count("ok"),
      dead: dead.length,
      deadUnits: dead.reduce((s, r) => s + r.onHand, 0),
      deadValueMinor: dead.reduce((s, r) => s + (r.valueMinor ?? 0), 0),
      cogs365Minor,
      cogs365Coverage: safeRatio(Math.round(knownUnits365), units365 > 0 ? units365 : null),
      turnover: turnover(cogs365Minor, value.valueMinor),
      sold30,
      sellThrough30: sellThrough(sold30, onHandUnits),
      ...watch,
    },
    alerts: alerts.slice(0, ALERT_CAP),
    alertsTotal: alerts.length,
  };
}
