import "server-only";

import { sql } from "drizzle-orm";

import {
  couponTable,
  detectCreeping,
  discountSummary,
  type CouponRow,
  type CouponStat,
  type DiscountMonth,
  type DiscountOrderRow,
  type DiscountSummary,
} from "@/lib/analytics-discounts";
import { addDays, addMonths, startOfMonth, type AnalyticsPeriod } from "@/lib/analytics-period";
import { safeRatio } from "@/lib/analytics-core";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { PAID, inPeriod, num, toMainOne, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * Discounts and coupons for the Marketing page (D152, docs/analytics.md): how much of the business is sold at a discount,
 * whether that is creeping up, what kind of discount it is and what each code did. Rates and verdicts are worked out by
 * `@/lib/analytics-discounts`; this module reads paid orders and their lines and hands it rows.
 *
 * Money is in the store's main currency without VAT. SQL groups by the currency the shopper saw and converts nothing; each
 * group is converted here, at today's rates, one amount at a time (`toMainOne()`). Orders in a currency with no rate are left
 * out of every figure and counted in `unconverted`, never silently understated.
 *
 * A discount without VAT is the line's discount over (1 + the line's VAT rate), rounded per line, as the totals module does,
 * so a period's discounts on goods here are `periodTotals().discountsMinor` less the shipping discount (a free-shipping code takes
 * nothing off a line: Finance counts it under Discounts, here the order is discounted but no goods discount is given). The kind of a discount is read from
 * the lines' own split columns (group, campaign, bonus credit, referral); what is left of a line's discount is the code's.
 * Every figure is a paid order's (`PAID`: copied and hosts' orders never count).
 */

/** The months of the trend, ending with the month the period ends in. */
export const TREND_MONTHS = 12;
/** The most (code, currency) groups read; the page says so when reached. */
export const COUPON_CAP = 1_000;
/** How many codes are listed. */
export const COUPONS_LISTED = 50;

export type DiscountKind = "campaign" | "group" | "referral" | "credit" | "code";

export const DISCOUNT_KIND_LABELS: Record<DiscountKind, string> = {
  campaign: "Campaigns",
  group: "Customer groups",
  referral: "Welcome discounts (referral)",
  credit: "Bonus credits",
  code: "Discount codes",
};

const KIND_ORDER: readonly DiscountKind[] = ["campaign", "group", "referral", "credit", "code"];

/** A month of the 12-month trend: a month still in progress (the period does not reach its last day) is `partial`. */
export type TrendMonth = DiscountMonth & { partial: boolean };

export type DiscountKindRow = {
  kind: DiscountKind;
  label: string;
  /** Paid orders in the period with a discount of this kind (an order can have several kinds). */
  orders: number;
  /** What this kind took off, positive, without VAT. */
  discountMinor: number;
  /** Of all the kinds' discounts together; null when there were none. */
  share: number | null;
};

/** A code's row as the report gives it: the table's figures, what kind of code it is, and whether it is still on. */
export type CouponReportRow = CouponStat & {
  /** `percent`, `fixed` or `free_shipping`; null when the code has since been deleted. A free-shipping code takes nothing off goods. */
  codeKind: string | null;
  /** Whether the code can still be used; null when it has been deleted. */
  active: boolean | null;
};

export type DiscountsReport = {
  /** The main currency of every amount. */
  currency: string;
  period: { from: string; to: string; days: number };
  /**
   * The period's own figures (orders, dependency, average discount, AOV with and without a discount), with the trend of the
   * last 12 months (whatever the period is) and the verdict on it. Creeping is judged on whole months only.
   */
  summary: DiscountSummary;
  /** The share of discounted orders by month, oldest first, up to the month the period ends in (months with no orders left out). */
  trend: TrendMonth[];
  /** The first day of the trend's window and the day after its last (the period's end), `YYYY-MM-DD`. */
  trendWindow: { from: string; to: string };
  breakdown: {
    kinds: DiscountKindRow[];
    /** The period's discounts (the summary's `discountMinor` taken over all paid orders, discounted or not). */
    totalMinor: number;
    /** Total less the kinds added up: rounding of lines and of conversion, never a missing kind. */
    roundingMinor: number;
  };
  /** The codes used in the period by revenue, at most `COUPONS_LISTED`. */
  coupons: CouponReportRow[];
  /** How many different codes were used in the period (more than are listed when this is over `COUPONS_LISTED`). */
  couponCount: number;
  /** More (code, currency) groups than `COUPON_CAP` were used: the codes read are the biggest by revenue. */
  couponsTruncated: boolean;
  /** Paid orders left out because their currency has no rate, and those currencies. */
  unconverted: number;
  missingRates: string[];
  /** Words for what the figures leave out, empty when nothing is. */
  notes: string[];
};

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * A line's amount without VAT, rounded the way the totals round it. A line with nothing to take off is 0 without the division: most
 * lines have no discount, and a decimal division per line and kind is what this report spends most of its time on.
 */
const lineExVat = (col: string) => sql.raw(`(case when ${col} > 0 then round(${col}::numeric / (1 + ol.tax_rate)) else 0 end)`);

/**
 * Paid orders of a window of whole days by month, discounted or not, and currency (`orders` only: the trend needs no more, and reads
 * a year whatever the period is, so it never touches the order lines).
 */
async function readTrendRows(store: Store, window: Pick<AnalyticsPeriod, "from" | "to">): Promise<Row[]> {
  return setBased<Row>(sql`
    select to_char(o.placed_at at time zone ${store.timeZone}, 'YYYY-MM') as month,
      (o.discount_minor - o.vat_relief_minor > 0 or o.discount_code_id is not null) as discounted, trim(o.currency) as currency, count(*)::int as orders
    from commerce.orders o
    where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, window)}
    group by 1, 2, 3
  `);
}

/**
 * The period's paid orders by month, discounted or not and currency: the rows `discountSummary()` takes. Orders are counted and
 * summed once (`by_order`) and their lines once (`by_line`), each straight into the groups: both are plain sums, so no order is
 * worked out on its own.
 */
async function readOrderRows(store: Store, period: Pick<AnalyticsPeriod, "from" | "to">): Promise<Row[]> {
  return setBased<Row>(sql`
    with po as materialized (
      select o.id, trim(o.currency) as currency, (o.total_minor - o.tax_minor) as revenue,
        to_char(o.placed_at at time zone ${store.timeZone}, 'YYYY-MM') as month,
        (o.discount_minor - o.vat_relief_minor > 0 or o.discount_code_id is not null) as discounted
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
    ),
    by_order as (
      select month, discounted, currency, count(*)::int as orders, sum(revenue) as revenue
      from po
      group by month, discounted, currency
    ),
    by_line as (
      select po.month, po.discounted, po.currency,
        sum(round(ol.unit_price_minor::numeric * ol.quantity / (1 + ol.tax_rate))) as gross,
        sum(${lineExVat("(ol.discount_minor - ol.vat_relief_minor)")}) as disc
      from po
      join commerce.order_lines ol on ol.order_id = po.id
      where ol.store_id = ${store.id}::uuid
      group by po.month, po.discounted, po.currency
    )
    select o.month, o.discounted, o.currency, o.orders, o.revenue, coalesce(l.gross, 0) as gross, coalesce(l.disc, 0) as disc
    from by_order o
    left join by_line l on l.month = o.month and l.discounted = o.discounted and l.currency = o.currency
  `);
}

/** A discount's kinds over the period's paid orders, by currency: what each took off without VAT, and how many orders had it. */
async function readKinds(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  const code = "ol.discount_minor - ol.vat_relief_minor - ol.member_discount_minor - ol.campaign_discount_minor - ol.bonus_discount_minor - ol.referral_discount_minor";
  return setBased<Row>(sql`
    select trim(o.currency) as currency,
      sum(${lineExVat("(ol.discount_minor - ol.vat_relief_minor)")}) as total,
      sum(${lineExVat("ol.member_discount_minor")}) as member,
      sum(${lineExVat("ol.campaign_discount_minor")}) as campaign,
      sum(${lineExVat("ol.referral_discount_minor")}) as referral,
      sum(${lineExVat("ol.bonus_discount_minor")}) as credit,
      sum(${lineExVat(`(${code})`)}) as code,
      count(distinct ol.order_id) filter (where ol.member_discount_minor > 0)::int as member_orders,
      count(distinct ol.order_id) filter (where ol.campaign_discount_minor > 0)::int as campaign_orders,
      count(distinct ol.order_id) filter (where ol.referral_discount_minor > 0)::int as referral_orders,
      count(distinct ol.order_id) filter (where ol.bonus_discount_minor > 0)::int as credit_orders,
      count(distinct ol.order_id) filter (where ${sql.raw(code)} > 0)::int as code_orders
    from commerce.orders o
    join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
    where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
    group by trim(o.currency)
  `);
}

/** The codes used by the period's paid orders, by code and currency, the biggest by revenue first (one more than the cap, to know). */
async function readCoupons(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    with po as materialized (
      select o.id, trim(o.currency) as currency, (o.total_minor - o.tax_minor) as revenue,
        upper(coalesce(dc.code, nullif(o.discount_code, ''))) as code, dc.kind as code_kind, dc.active as code_active
      from commerce.orders o
      left join commerce.discount_codes dc on dc.store_id = o.store_id and dc.id = o.discount_code_id
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
        and (o.discount_code_id is not null or nullif(o.discount_code, '') is not null)
    ),
    by_order as (
      select code, currency, max(code_kind) as code_kind, bool_or(code_active) as code_active, count(*)::int as orders, sum(revenue) as revenue
      from po
      where code is not null
      group by code, currency
    ),
    by_line as (
      select po.code, po.currency,
        sum(round(ol.unit_price_minor::numeric * ol.quantity / (1 + ol.tax_rate))) as gross,
        sum(${lineExVat("greatest(ol.discount_minor - ol.vat_relief_minor - ol.member_discount_minor - ol.campaign_discount_minor - ol.bonus_discount_minor - ol.referral_discount_minor, 0)")}) as code_off
      from po
      join commerce.order_lines ol on ol.order_id = po.id
      where po.code is not null and ol.store_id = ${store.id}::uuid
      group by po.code, po.currency
    )
    select o.code, o.code_kind, o.code_active, o.currency, o.orders, o.revenue, coalesce(l.gross, 0) as gross, coalesce(l.code_off, 0) as code_off
    from by_order o
    left join by_line l on l.code = o.code and l.currency = o.currency
    order by o.revenue desc, o.code
    limit ${COUPON_CAP + 1}
  `);
}

// ---------------------------------------------------------------------------
// Folding rows into the main currency
// ---------------------------------------------------------------------------

/** Whether the store can show this currency in its main one. */
const rated = (store: Store, currency: string): boolean => canConvert(currency.trim(), mainCurrency(store), store.localization.rates);

/** Order rows into `DiscountOrderRow`s, one per month and flag, each currency group converted by itself; unrated currencies are skipped. */
function foldOrderRows(store: Store, rows: readonly Row[]): DiscountOrderRow[] {
  const merged = new Map<string, DiscountOrderRow>();
  for (const r of rows) {
    const currency = String(r.currency);
    if (!rated(store, currency)) continue;
    const month = String(r.month);
    const discounted = r.discounted === true;
    const key = `${month}|${discounted}`;
    const row = merged.get(key) ?? { month, discounted, orders: 0, revenueMinor: 0, grossGoodsMinor: 0, discountMinor: 0 };
    row.orders += num(r, "orders");
    row.revenueMinor += toMainOne(store, currency, num(r, "revenue")) ?? 0;
    row.grossGoodsMinor += toMainOne(store, currency, num(r, "gross")) ?? 0;
    row.discountMinor += toMainOne(store, currency, num(r, "disc")) ?? 0;
    merged.set(key, row);
  }
  return [...merged.values()];
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

/**
 * The Marketing page's discounts and coupons for a period. The period's summary is the period's own paid orders; the trend is
 * the share of discounted orders by calendar month over the 12 months up to the month the period ends in, whatever the period's
 * length, and `creeping` is judged on the months that were over (a month the period does not finish is shown, `partial`, but
 * never counted in the verdict).
 */
export async function discountsReport(store: Store, period: AnalyticsPeriod): Promise<DiscountsReport> {
  const lastDay = addDays(period.to, -1);
  const lastMonth = startOfMonth(lastDay);
  const trendFrom = addMonths(lastMonth, -(TREND_MONTHS - 1));
  const lastMonthPartial = !period.to.endsWith("-01");

  const [periodRows, trendRows, kindRows, couponRows] = await Promise.all([
    readOrderRows(store, period),
    readTrendRows(store, { from: trendFrom, to: period.to }),
    readKinds(store, period),
    readCoupons(store, period),
  ]);

  // What is left out: the period's paid orders in a currency with no rate (the trend's are only named).
  let unconverted = 0;
  const missing = new Set<string>();
  for (const r of periodRows) {
    if (!rated(store, String(r.currency))) {
      unconverted += num(r, "orders");
      missing.add(String(r.currency));
    }
  }
  for (const r of trendRows) if (!rated(store, String(r.currency))) missing.add(String(r.currency));
  const summaryRows = foldOrderRows(store, periodRows);
  const trendFolded = foldOrderRows(store, trendRows);

  const own = discountSummary(summaryRows);
  const windowTrend = discountSummary(trendFolded).trend;
  const trend: TrendMonth[] = windowTrend.map((m) => ({ ...m, partial: lastMonthPartial && m.month === lastMonth.slice(0, 7) }));
  const complete: DiscountMonth[] = trend.filter((m) => !m.partial).map(({ month, orders, discountedOrders, share }) => ({ month, orders, discountedOrders, share }));
  const summary: DiscountSummary = { ...own, trend, creeping: detectCreeping(complete) };

  // The kinds: every currency group converted by itself, so the kinds add up to the total in a store with one currency.
  const kinds = new Map<DiscountKind, { orders: number; minor: number }>(KIND_ORDER.map((k) => [k, { orders: 0, minor: 0 }]));
  let totalMinor = 0;
  const keyOf: Record<DiscountKind, string> = { campaign: "campaign", group: "member", referral: "referral", credit: "credit", code: "code" };
  for (const r of kindRows) {
    const currency = String(r.currency);
    if (!rated(store, currency)) continue;
    totalMinor += toMainOne(store, currency, num(r, "total")) ?? 0;
    for (const kind of KIND_ORDER) {
      const k = kinds.get(kind)!;
      k.minor += toMainOne(store, currency, num(r, keyOf[kind])) ?? 0;
      k.orders += num(r, `${keyOf[kind]}_orders`);
    }
  }
  const kindsTotal = [...kinds.values()].reduce((a, k) => a + k.minor, 0);
  const kindRowsOut: DiscountKindRow[] = KIND_ORDER.map((kind) => {
    const k = kinds.get(kind)!;
    return { kind, label: DISCOUNT_KIND_LABELS[kind], orders: k.orders, discountMinor: k.minor, share: safeRatio(k.minor, kindsTotal > 0 ? kindsTotal : null) };
  }).sort((a, b) => b.discountMinor - a.discountMinor || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));

  // The codes: groups by code and currency, converted one by one, added by code in `couponTable()`.
  const couponsTruncated = couponRows.length > COUPON_CAP;
  const extras = new Map<string, { codeKind: string | null; active: boolean | null }>();
  const couponInput: CouponRow[] = [];
  for (const r of couponRows.slice(0, COUPON_CAP)) {
    const currency = String(r.currency);
    const code = String(r.code);
    if (!rated(store, currency)) continue;
    couponInput.push({
      code,
      orders: num(r, "orders"),
      revenueMinor: toMainOne(store, currency, num(r, "revenue")) ?? 0,
      grossGoodsMinor: toMainOne(store, currency, num(r, "gross")) ?? 0,
      discountMinor: toMainOne(store, currency, num(r, "code_off")) ?? 0,
    });
    extras.set(code.toLowerCase(), { codeKind: r.code_kind === null ? null : String(r.code_kind), active: r.code_active === null ? null : r.code_active === true });
  }
  const table = couponTable(couponInput);
  const coupons: CouponReportRow[] = table.slice(0, COUPONS_LISTED).map((c) => ({ ...c, ...(extras.get(c.code.toLowerCase()) ?? { codeKind: null, active: null }) }));

  const notes: string[] = [];
  if (unconverted > 0) {
    notes.push(`${unconverted} paid order${unconverted === 1 ? "" : "s"} in ${[...missing].sort().join(", ")} ${unconverted === 1 ? "is" : "are"} left out: the store has no exchange rate for it.`);
  }
  if (couponsTruncated) notes.push(`More than ${COUPON_CAP} codes were used: the biggest by revenue are shown.`);

  return {
    currency: mainCurrency(store),
    period: { from: period.from, to: period.to, days: period.days },
    summary,
    trend,
    trendWindow: { from: trendFrom, to: period.to },
    breakdown: { kinds: kindRowsOut, totalMinor, roundingMinor: totalMinor - kindsTotal },
    coupons,
    couponCount: table.length,
    couponsTruncated,
    unconverted,
    missingRates: [...missing].sort(),
    notes,
  };
}
