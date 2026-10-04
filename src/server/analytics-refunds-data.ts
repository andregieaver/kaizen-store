import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { safeRatio } from "@/lib/analytics-core";
import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { allocateRefund } from "@/lib/analytics-products";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { CUSTOMER_JOIN, CUSTOMER_KEY, HAS_CUSTOMER, PAID, dayStart, inPeriod, num, toMainOne, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * The refunds drill-down (D152, docs/analytics.md): what was given back, how that compares with what was sold, why, for which
 * products, to which kind of customer and in which market.
 *
 * - **Refunds** are succeeded `refunds`, dated by their own date, each scaled to without VAT by its order's
 *   `(total - tax) / total`, exactly as the totals module counts them, so the figure here is the Finance page's. Copied orders'
 *   and hosts' orders never count. Refunds made only in Stripe's dashboard are not seen (`notSeen`).
 * - **Refund rate** is refunds over revenue of the same period (refunds by their own date, revenue by order date). **Share of
 *   orders with a refund** is the cohort of paid orders placed in the period that have any succeeded refund, whenever it was
 *   made, so it keeps growing while the cohort's refunds arrive.
 * - **Reasons** are the staff's free text, normalised (trimmed, lower-cased, spaces collapsed, closing punctuation dropped) and
 *   grouped; the top eight are listed and the rest is `other`.
 * - **Products** share each refund over its order's lines by what they were sold for without VAT (`allocateRefund()`), so the
 *   products add up to the refunds; what went back into stock (`refunds.restocked`) is shown beside as evidence, never as the
 *   figure. A line with no product (a sign-up fee) is "no product".
 * - **Segments**: a refund's customer (the customer key of the doc) is *new* when their first paid order is inside the period
 *   and *returning* when it is earlier; a refund of an order with no customer key is *unknown*.
 *
 * Amounts are in the store's main currency without VAT. Every group is converted by itself at today's rates; refunds in a currency
 * with no rate are left out and counted (`unconverted`).
 */

/** How many reasons are listed. */
export const TOP_REASONS = 8;
/** How many refunded products are listed. */
export const TOP_REFUNDED_PRODUCTS = 10;
/** The most refunds read for the products (the biggest first); the page says so when it is reached. */
export const PRODUCT_REFUND_CAP = 5_000;
/** The most (reason, currency) groups read. */
export const REASON_CAP = 5_000;
/** The longest a reason's text is kept. */
export const REASON_LENGTH = 80;

export type RefundSegmentKey = "new" | "returning" | "unknown";

export const SEGMENT_LABELS: Record<RefundSegmentKey, string> = {
  new: "New customers",
  returning: "Returning customers",
  unknown: "No customer on the order",
};

export type RefundReason = {
  /** The normalised text; empty when no reason was written. */
  reason: string;
  /** For display: the text with a capital, or "No reason given". */
  label: string;
  refunds: number;
  valueMinor: number;
  /** Of the period's refunds by value; null when there were none. */
  share: number | null;
};

export type RefundedProduct = {
  /** The product's id; null for lines with no product (a sign-up fee). */
  productId: string | null;
  name: string;
  /** The refunds' value allocated to it, without VAT. */
  valueMinor: number;
  /** Refunds that reached it. */
  refunds: number;
  /** Units that went back into stock with those refunds (evidence only; 0 when staff did not restock). */
  restockedUnits: number;
  share: number | null;
};

export type RefundSegment = {
  segment: RefundSegmentKey;
  label: string;
  refunds: number;
  /** Different orders refunded. */
  orders: number;
  valueMinor: number;
  share: number | null;
};

export type RefundMarket = {
  /** The order's country code. */
  market: string;
  refunds: number;
  orders: number;
  valueMinor: number;
  /** Revenue of the period's paid orders in the market. */
  revenueMinor: number;
  /** Refunds / revenue of the market; null without revenue. */
  rate: number | null;
};

export type RefundsReport = {
  /** The main currency of every amount. */
  currency: string;
  period: { from: string; to: string; days: number };
  /** Succeeded refunds dated in the period, without VAT. */
  refundsMinor: number;
  refunds: number;
  /** Different orders they were for. */
  refundedOrders: number;
  /** The period's revenue (paid orders placed in it, without VAT) and their number. */
  revenueMinor: number;
  orders: number;
  /** Refunds / revenue; null when there was no revenue. */
  refundRate: number | null;
  /** Paid orders placed in the period, and how many of them have a refund (made at any time). */
  cohort: { orders: number; refundedOrders: number; share: number | null };
  /** The most common reasons; `other` is everything under them. */
  reasons: RefundReason[];
  other: { reasons: number; refunds: number; valueMinor: number };
  /** The products that were refunded most, and how many there were in all. */
  products: RefundedProduct[];
  productCount: number;
  /** More refunds than `PRODUCT_REFUND_CAP` were in the period: the products are made of the biggest ones. */
  productsTruncated: boolean;
  segments: RefundSegment[];
  markets: RefundMarket[];
  /** Always true: Kaizen has no refund webhook, so a refund made only in Stripe's dashboard is not here. */
  notSeen: true;
  notSeenNote: string;
  /** Refunds (and the paid orders of the cohort) left out because their currency has no rate, and those currencies. */
  unconverted: number;
  missingRates: string[];
  notes: string[];
};

export const NOT_SEEN_NOTE =
  "Refunds made only in Stripe's dashboard are not included: Kaizen only sees refunds made from its own admin, and the reasons are free text.";

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

/**
 * A refund's reason as a key: trimmed, lower-cased, spaces (and any run of whitespace) made one, closing punctuation dropped,
 * cut to `REASON_LENGTH`. Empty text stays empty ("no reason given").
 */
export function normaliseReason(text: string | null | undefined): string {
  const collapsed = String(text ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/[\s.,;:!?]+$/u, "");
  return collapsed.slice(0, REASON_LENGTH).trim();
}

const reasonLabel = (reason: string): string => (reason === "" ? "No reason given" : reason.charAt(0).toUpperCase() + reason.slice(1));

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/**
 * The succeeded refunds dated in the period, one row each: the payment's currency, the order's country and customer key, and the
 * refund scaled to without VAT (`value`), as the totals scale it. Copied orders' and hosts' orders are left out.
 */
const refundsOf = (store: Store, period: AnalyticsPeriod) => sql`
  select r.id, r.reason, r.restocked, rp.currency::text as currency, o.id as order_id, o.market_code::text as market,
    case when ${HAS_CUSTOMER} then ${CUSTOMER_KEY} end as ckey,
    round(r.amount_minor::numeric * (o.total_minor - o.tax_minor) / o.total_minor) as value
  from commerce.refunds r
  join commerce.payments rp on rp.store_id = r.store_id and rp.id = r.payment_id
  join commerce.orders o on o.store_id = rp.store_id and o.id = rp.order_id
  ${CUSTOMER_JOIN}
  where r.store_id = ${store.id}::uuid and r.status = 'succeeded' and ${inPeriod(store, sql`r.created_at`, period)}
    and o.copied_from is null and o.host_id is null and o.total_minor > 0
`;

const rated = (store: Store, currency: string): boolean => canConvert(currency.trim(), mainCurrency(store), store.localization.rates);

type Group = { n: number; orders: number; value: number };

/** Refunds by currency, and by market, with the number of different orders. */
async function readTotals(store: Store, period: AnalyticsPeriod): Promise<{ byCurrency: Row[]; byMarket: Row[] }> {
  const [byCurrency, byMarket] = await Promise.all([
    setBased<Row>(sql`
      with rf as (${refundsOf(store, period)})
      select trim(currency) as currency, count(*)::int as n, count(distinct order_id)::int as orders, sum(value) as value
      from rf group by 1
    `),
    setBased<Row>(sql`
      with rf as (${refundsOf(store, period)})
      select trim(market) as market, trim(currency) as currency, count(*)::int as n, count(distinct order_id)::int as orders, sum(value) as value
      from rf group by 1, 2
    `),
  ]);
  return { byCurrency, byMarket };
}

/** Refunds by their normalised reason and currency (the biggest first, one more than the cap, to know). */
async function readReasons(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    with rf as (${refundsOf(store, period)})
    select lower(regexp_replace(trim(reason), '\\s+', ' ', 'g')) as reason, trim(currency) as currency, count(*)::int as n, sum(value) as value
    from rf
    group by 1, 2
    order by sum(value) desc, 1
    limit ${REASON_CAP + 1}
  `);
}

/**
 * Refunds by the kind of customer: new when their first paid order is in the period, returning when earlier. Only the keys of this
 * period's refunds are looked for among the store's paid orders, found through the account (`customer_id`) and through the email of
 * orders with no account: a customer key is an account's email or a guest's. The read is set-based (no nested loops), so the number
 * of refunded customers never multiplies the orders read.
 */
async function readSegments(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    with rf as materialized (${refundsOf(store, period)}),
    keys as (
      select distinct ckey from rf where ckey is not null
    ),
    fr as (
      select t.k, min(t.placed_at) as first_at
      from (
        select lower(c.email) as k, o.placed_at
        from commerce.customers c
        join commerce.orders o on o.store_id = c.store_id and o.customer_id = c.id
        where c.store_id = ${store.id}::uuid and lower(c.email) in (select ckey from keys) and ${PAID} and o.placed_at < ${dayStart(store, period.to)}
        union all
        select lower(o.email), o.placed_at
        from commerce.orders o
        where o.store_id = ${store.id}::uuid and o.customer_id is null and lower(o.email) in (select ckey from keys) and o.restricted_at is null and o.anonymised_at is null and ${PAID} and o.placed_at < ${dayStart(store, period.to)}
      ) t
      group by t.k
    )
    select case when rf.ckey is null or fr.first_at is null then 'unknown'
                when fr.first_at >= ${dayStart(store, period.from)} then 'new' else 'returning' end as segment,
      trim(rf.currency) as currency, count(*)::int as n, count(distinct rf.order_id)::int as orders, sum(rf.value) as value
    from rf left join fr on fr.k = rf.ckey
    group by 1, 2
  `);
}

/** The refunds with their order's lines, the biggest first (one more than the cap, to know): what the products are made of. */
async function readProductRefunds(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    with rf as (${refundsOf(store, period)})
    select rf.id::text as id, trim(rf.currency) as currency, rf.value,
      (select jsonb_agg(jsonb_build_object('product', pv.product_id, 'title', ol.title, 'weight', ol.total_minor - ol.tax_minor) order by ol.id)
       from commerce.order_lines ol
       left join commerce.product_variants pv on pv.store_id = ol.store_id and pv.id = ol.variant_id
       where ol.store_id = ${store.id}::uuid and ol.order_id = rf.order_id) as lines
    from rf
    order by rf.value desc, rf.id
    limit ${PRODUCT_REFUND_CAP + 1}
  `);
}

/** Units put back into stock by the period's refunds, per product (matched by SKU): evidence beside the allocated value. */
async function readRestocked(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    with rf as (${refundsOf(store, period)})
    select pv.product_id::text as product_id, sum((e.item ->> 'quantity')::int) as units
    from rf
    cross join lateral jsonb_array_elements(case when jsonb_typeof(rf.restocked) = 'array' then rf.restocked else '[]'::jsonb end) as e(item)
    join commerce.product_variants pv on pv.store_id = ${store.id}::uuid and pv.sku = e.item ->> 'sku'
    where e.item ->> 'quantity' ~ '^[0-9]+$'
    group by 1
  `);
}

/** The period's paid orders, their revenue and how many have a refund (at any time), by country and currency. */
async function readCohort(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  // The orders with a succeeded refund are found once (there are few) and joined, not looked up order by order.
  return setBased<Row>(sql`
    select o.market_code::text as market, trim(o.currency) as currency, count(*)::int as orders, sum(o.total_minor - o.tax_minor) as revenue,
      count(rfo.order_id)::int as refunded_orders
    from commerce.orders o
    left join (
      select distinct p.order_id
      from commerce.refunds r
      join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      where r.store_id = ${store.id}::uuid and r.status = 'succeeded'
    ) rfo on rfo.order_id = o.id
    where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
    group by 1, 2
  `);
}

/** The products' own names, in the store's main language where there is one. */
export async function productNames(store: Store, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const locale = store.localization.locales[0] ?? "en";
  const rows = await db().execute<Row>(sql`
    select distinct on (pt.product_id) pt.product_id::text as id, pt.title
    from commerce.product_translations pt
    where pt.store_id = ${store.id}::uuid and pt.product_id = any(${`{${ids.join(",")}}`}::uuid[])
    order by pt.product_id, (pt.locale = ${locale}) desc, (split_part(pt.locale, '-', 1) = split_part(${locale}, '-', 1)) desc, pt.locale
  `);
  return new Map(rows.map((r) => [String(r.id), String(r.title)]));
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

type LineJson = { product: string | null; title: string; weight: number };

/**
 * The Refunds drill-down for a period. See the module's description for what every figure is.
 */
export async function refundsReport(store: Store, period: AnalyticsPeriod): Promise<RefundsReport> {
  const [{ byCurrency, byMarket }, reasonRows, segmentRows, productRows, restockedRows, cohortRows] = await Promise.all([
    readTotals(store, period),
    readReasons(store, period),
    readSegments(store, period),
    readProductRefunds(store, period),
    readRestocked(store, period),
    readCohort(store, period),
  ]);

  let unconverted = 0;
  const missing = new Set<string>();
  const skip = (currency: string, count: number): boolean => {
    if (rated(store, currency)) return false;
    unconverted += count;
    missing.add(currency.trim());
    return true;
  };

  // The totals. What cannot be converted is counted here, once.
  let refundsMinor = 0;
  let refunds = 0;
  let refundedOrders = 0;
  for (const r of byCurrency) {
    if (skip(String(r.currency), num(r, "n"))) continue;
    refundsMinor += toMainOne(store, String(r.currency), num(r, "value")) ?? 0;
    refunds += num(r, "n");
    refundedOrders += num(r, "orders");
  }

  // The cohort and revenue, by market.
  const revenueByMarket = new Map<string, number>();
  let revenueMinor = 0;
  let orders = 0;
  let cohortRefunded = 0;
  for (const r of cohortRows) {
    const currency = String(r.currency);
    if (!rated(store, currency)) {
      missing.add(currency.trim());
      continue;
    }
    const revenue = toMainOne(store, currency, num(r, "revenue")) ?? 0;
    revenueMinor += revenue;
    orders += num(r, "orders");
    cohortRefunded += num(r, "refunded_orders");
    const market = String(r.market).trim();
    revenueByMarket.set(market, (revenueByMarket.get(market) ?? 0) + revenue);
  }

  // Reasons: group by the normalised text (the database's grouping is coarser than the code's), then rank by value.
  const reasonsByKey = new Map<string, { refunds: number; valueMinor: number }>();
  for (const r of reasonRows.slice(0, REASON_CAP)) {
    if (!rated(store, String(r.currency))) continue;
    const key = normaliseReason(String(r.reason ?? ""));
    const have = reasonsByKey.get(key) ?? { refunds: 0, valueMinor: 0 };
    have.refunds += num(r, "n");
    have.valueMinor += toMainOne(store, String(r.currency), num(r, "value")) ?? 0;
    reasonsByKey.set(key, have);
  }
  const reasonList = [...reasonsByKey.entries()]
    .map(([reason, v]) => ({ reason, ...v }))
    .sort((a, b) => b.valueMinor - a.valueMinor || b.refunds - a.refunds || (a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0));
  const top = reasonList.slice(0, TOP_REASONS);
  const rest = reasonList.slice(TOP_REASONS);
  const reasons: RefundReason[] = top.map((t) => ({
    reason: t.reason,
    label: reasonLabel(t.reason),
    refunds: t.refunds,
    valueMinor: t.valueMinor,
    share: safeRatio(t.valueMinor, refundsMinor > 0 ? refundsMinor : null),
  }));

  // Segments, and markets.
  const segments = new Map<RefundSegmentKey, Group>((["new", "returning", "unknown"] as const).map((k) => [k, { n: 0, orders: 0, value: 0 }]));
  for (const r of segmentRows) {
    if (!rated(store, String(r.currency))) continue;
    const g = segments.get(String(r.segment) as RefundSegmentKey)!;
    g.n += num(r, "n");
    g.orders += num(r, "orders");
    g.value += toMainOne(store, String(r.currency), num(r, "value")) ?? 0;
  }
  const segmentsOut: RefundSegment[] = [...segments.entries()].map(([segment, g]) => ({
    segment,
    label: SEGMENT_LABELS[segment],
    refunds: g.n,
    orders: g.orders,
    valueMinor: g.value,
    share: safeRatio(g.value, refundsMinor > 0 ? refundsMinor : null),
  }));

  const marketGroups = new Map<string, Group>();
  for (const r of byMarket) {
    if (!rated(store, String(r.currency))) continue;
    const market = String(r.market).trim();
    const g = marketGroups.get(market) ?? { n: 0, orders: 0, value: 0 };
    g.n += num(r, "n");
    g.orders += num(r, "orders");
    g.value += toMainOne(store, String(r.currency), num(r, "value")) ?? 0;
    marketGroups.set(market, g);
  }
  const marketCodes = new Set<string>([...marketGroups.keys(), ...revenueByMarket.keys()]);
  const markets: RefundMarket[] = [...marketCodes]
    .map((market) => {
      const g = marketGroups.get(market) ?? { n: 0, orders: 0, value: 0 };
      const revenue = revenueByMarket.get(market) ?? 0;
      return { market, refunds: g.n, orders: g.orders, valueMinor: g.value, revenueMinor: revenue, rate: safeRatio(g.value, revenue > 0 ? revenue : null) };
    })
    .sort((a, b) => b.valueMinor - a.valueMinor || b.revenueMinor - a.revenueMinor || (a.market < b.market ? -1 : 1));

  // Products: each refund shared over its lines, then added by product and currency and converted once.
  const productsTruncated = productRows.length > PRODUCT_REFUND_CAP;
  type Acc = { title: string; refunds: number; byCurrency: Map<string, number> };
  const NONE = "";
  const accs = new Map<string, Acc>();
  for (const row of productRows.slice(0, PRODUCT_REFUND_CAP)) {
    const currency = String(row.currency);
    if (!rated(store, currency)) continue;
    const lines = (row.lines ?? []) as LineJson[];
    const value = num(row, "value");
    const shares = allocateRefund(value, lines.map((l) => ({ amountMinor: Number(l.weight) })));
    const touched = new Set<string>();
    if (lines.length === 0) {
      const acc = accs.get(NONE) ?? { title: "No product", refunds: 0, byCurrency: new Map() };
      acc.byCurrency.set(currency, (acc.byCurrency.get(currency) ?? 0) + value);
      acc.refunds += 1;
      accs.set(NONE, acc);
      continue;
    }
    lines.forEach((l, i) => {
      const key = l.product ?? NONE;
      const acc = accs.get(key) ?? { title: l.product ? String(l.title) : "No product", refunds: 0, byCurrency: new Map() };
      acc.byCurrency.set(currency, (acc.byCurrency.get(currency) ?? 0) + shares[i]);
      if (!touched.has(key)) {
        acc.refunds += 1;
        touched.add(key);
      }
      accs.set(key, acc);
    });
  }
  const restocked = new Map(restockedRows.map((r) => [String(r.product_id), num(r, "units")]));
  const productList: RefundedProduct[] = [...accs.entries()]
    .map(([key, acc]) => {
      let valueMinor = 0;
      for (const [currency, minor] of acc.byCurrency) valueMinor += toMainOne(store, currency, minor) ?? 0;
      return {
        productId: key === NONE ? null : key,
        name: acc.title,
        valueMinor,
        refunds: acc.refunds,
        restockedUnits: key === NONE ? 0 : (restocked.get(key) ?? 0),
        share: safeRatio(valueMinor, refundsMinor > 0 ? refundsMinor : null),
      };
    })
    .sort((a, b) => b.valueMinor - a.valueMinor || b.refunds - a.refunds || String(a.productId).localeCompare(String(b.productId)));
  const products = productList.slice(0, TOP_REFUNDED_PRODUCTS);
  const names = await productNames(store, products.flatMap((p) => (p.productId ? [p.productId] : [])));
  for (const p of products) if (p.productId) p.name = names.get(p.productId) ?? p.name;

  const notes: string[] = [];
  if (unconverted > 0) {
    notes.push(`${unconverted} refund${unconverted === 1 ? "" : "s"} in ${[...missing].sort().join(", ")} ${unconverted === 1 ? "is" : "are"} left out: the store has no exchange rate for it.`);
  } else if (missing.size > 0) {
    notes.push(`Paid orders in ${[...missing].sort().join(", ")} are left out of revenue: the store has no exchange rate for it.`);
  }
  if (productsTruncated) notes.push(`More than ${PRODUCT_REFUND_CAP} refunds were made: the products are made of the biggest ones.`);
  if (reasonRows.length > REASON_CAP) notes.push("The reasons are made of the biggest refunds only: there were very many different texts.");

  return {
    currency: mainCurrency(store),
    period: { from: period.from, to: period.to, days: period.days },
    refundsMinor,
    refunds,
    refundedOrders,
    revenueMinor,
    orders,
    refundRate: safeRatio(refundsMinor, revenueMinor > 0 ? revenueMinor : null),
    cohort: { orders, refundedOrders: cohortRefunded, share: safeRatio(cohortRefunded, orders > 0 ? orders : null) },
    reasons,
    other: { reasons: rest.length, refunds: rest.reduce((a, r) => a + r.refunds, 0), valueMinor: rest.reduce((a, r) => a + r.valueMinor, 0) },
    products,
    productCount: productList.length,
    productsTruncated,
    segments: segmentsOut,
    markets,
    notSeen: true,
    notSeenNote: NOT_SEEN_NOTE,
    unconverted,
    missingRates: [...missing].sort(),
    notes,
  };
}
