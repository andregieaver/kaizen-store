import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { safeRatio } from "@/lib/analytics-core";
import { paymentFees, shippingCostsFor } from "@/lib/analytics-finance";
import { addDays, todayIn, type AnalyticsPeriod } from "@/lib/analytics-period";
import {
  channelLabel,
  channelTable,
  funnel,
  landingKind,
  STAFF_CHANNEL,
  UNKNOWN_CHANNEL,
  isNotAChannel,
  type ChannelInput,
  type ChannelTable,
  type Funnel,
  type FunnelCounts,
  type LandingKind,
} from "@/lib/analytics-traffic";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { getAnalyticsSettings } from "./analytics-settings";
import { CUSTOMER_JOIN, CUSTOMER_KEY, dayKey, dayStart, FROM_CHECKOUT, HAS_CUSTOMER, inMain, inPeriod, num, PAID, STAFF_MADE, toMainOne, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * Traffic and marketing reads (D152, docs/analytics.md, "Visit counting", "Traffic", "Marketing"): sessions, the funnel, devices,
 * countries, landing pages, and the channel table with its cost figures. Visits exist only while the store counts them
 * (`stores.visit_counting`), and only from the first counted day, so every report says what it covers:
 *
 * - `coverage.firstDay` is the first day with a counted visit; a period that starts before it is `partial`, and everything
 *   that divides orders by sessions (conversion, funnel, channels) is worked out over the covered days only, orders included.
 *   Orders on earlier days are reported apart (`uncoveredOrders`), never mixed into a rate.
 * - An order is tied to a visit through its cart (`orders.cart_id` → `carts.visit_id`); one without is "unknown": it was bought
 *   with counting off, from a browser that was not counted, on another day than the visit, or from a cart made some other way.
 * - A staff-made order (D173, `orders.source = 'draft'`) was not a visit: the funnel never sees it (a draft has no cart), the device, market and
 *   landing-page tables and the conversion take orders `FROM_CHECKOUT` only, and the report names the staff-made ones apart (`staffOrders`). In the
 *   channel table (Marketing) it is the row `STAFF_CHANNEL`, so the table's revenue still adds up.
 * - Amounts are the store's main currency without VAT, converted from per-currency groups in code (`inMain()`); a currency
 *   with no rate is left out and counted (`unconverted`), as in the totals.
 * - Nothing here reads a cookie, an address or a user agent: `visits` holds none.
 */

// ---------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------

export type Coverage = {
  /** Visit counting is on. When it is off nothing here is known and every count is null. */
  counting: boolean;
  /** The first day with a counted visit, ever; null when none. */
  firstDay: string | null;
  /** The period starts before `firstDay` (or no day was counted yet), so figures cover only part of it. */
  partial: boolean;
  /** The covered days `[from, to)`: the period from the first counted day, up to today; null when no day of it is covered. */
  from: string | null;
  to: string | null;
  /** Number of covered days. */
  days: number;
};

type Range = { from: string; to: string };

function coverageOf(store: Store, period: AnalyticsPeriod, firstDay: string | null, now: Date | undefined): { coverage: Coverage; range: Range | null } {
  if (!store.visitCounting) return { coverage: { counting: false, firstDay: null, partial: false, from: null, to: null, days: 0 }, range: null };
  const today = now ? addDays(todayIn(now, store.timeZone), 1) : period.to;
  const from = firstDay !== null && firstDay > period.from ? firstDay : period.from;
  const to = today < period.to ? today : period.to;
  const covered = firstDay !== null && from < to;
  return {
    coverage: {
      counting: true,
      firstDay,
      partial: firstDay === null || firstDay > period.from,
      from: covered ? from : null,
      to: covered ? to : null,
      days: covered ? Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) : 0,
    },
    range: covered ? { from, to } : null,
  };
}

async function firstCountedDay(store: Store): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`select min(day)::text as first_day from commerce.visits where store_id = ${store.id}::uuid`);
  return row?.first_day ? dayKey(row.first_day) : null;
}

const visitsIn = (store: Store, range: Range): SQL => sql`v.store_id = ${store.id}::uuid and v.day >= ${range.from}::date and v.day < ${range.to}::date`;

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export type SessionTotals = {
  /** Visitor-days in the period; null when counting is off or the period has no counted visit. */
  sessions: number | null;
  /** The first day with counted visits, ever; null when none or counting is off. */
  firstDay: string | null;
  /** Visitor-days per day (days with none are left out). */
  byDay: Record<string, number>;
};

/** The sessions of a period, for the overview and the sparklines. Two indexed reads of `visits`. */
export async function sessionTotals(store: Store, period: Pick<AnalyticsPeriod, "from" | "to">): Promise<SessionTotals> {
  if (!store.visitCounting) return { sessions: null, firstDay: null, byDay: {} };
  const [days, firstDay] = await Promise.all([
    db().execute<Row>(sql`
      select v.day::text as day, count(*) as n from commerce.visits v
      where ${visitsIn(store, period)} group by v.day
    `),
    firstCountedDay(store),
  ]);
  const byDay: Record<string, number> = {};
  let sessions = 0;
  for (const row of days) {
    byDay[dayKey(row.day)] = num(row, "n");
    sessions += num(row, "n");
  }
  return { sessions: sessions > 0 ? sessions : null, firstDay, byDay };
}

// ---------------------------------------------------------------------------
// Orders and their visits
// ---------------------------------------------------------------------------

/**
 * The currencies the store can convert into its main currency, as a `char(3)[]` (as the totals do): compared with the column as it
 * is, not as text, so the planner keeps the column's statistics (`currency::text` hides them and it guesses a hundredth of the rows).
 */
function convertibleCurrencies(store: Store): SQL {
  const main = mainCurrency(store);
  const rates = store.localization.rates;
  const list = new Set<string>([main]);
  for (const currency of rates.keys()) if (canConvert(currency, main, rates)) list.add(currency);
  return sql`${`{${[...list].map((c) => c.trim()).join(",")}}`}::char(3)[]`;
}

/** What `orders o` is joined with: its cart and that cart's visit (`c`, `v`), both left, so an order with none is still there. */
const ORDER_VISIT = sql`left join commerce.carts c on c.store_id = o.store_id and c.id = o.cart_id
  left join commerce.visits v on v.store_id = o.store_id and v.id = c.visit_id`;

/**
 * Paid orders of a range grouped by `key` (SQL over `o` and `v`) and currency: orders and revenue without VAT. `extra` narrows the orders.
 */
async function ordersBy(store: Store, range: Range, key: SQL, options: { extra?: SQL } = {}): Promise<Row[]> {
  return setBased<Row>(sql`
    select (${key})::text as k, o.currency::text as currency, count(*) as orders, sum(o.total_minor - o.tax_minor) as revenue
    from commerce.orders o ${ORDER_VISIT}
    where o.store_id = ${store.id}::uuid and ${PAID} and ${FROM_CHECKOUT} and ${inPeriod(store, sql`o.placed_at`, range)}
      and o.currency = any(${convertibleCurrencies(store)}) ${options.extra ?? sql``}
    group by 1, 2
  `);
}

/**
 * Several `ordersBy()` groupings of the same orders from one read: the paid orders of the range are found and joined to their
 * visits once, and each key (SQL over `o` and `v`) is its own grouping of that.
 */
async function ordersByKeys<K extends string>(store: Store, range: Range, keys: Record<K, SQL>): Promise<Record<K, Row[]>> {
  const names = Object.keys(keys) as K[];
  const rows = await setBased<Row>(sql`
    with po as materialized (
      select o.currency::text as currency, (o.total_minor - o.tax_minor) as revenue,
        ${sql.join(names.map((name, i) => sql`(${keys[name]})::text as k${sql.raw(String(i))}`), sql`, `)}
      from commerce.orders o ${ORDER_VISIT}
      where o.store_id = ${store.id}::uuid and ${PAID} and ${FROM_CHECKOUT} and ${inPeriod(store, sql`o.placed_at`, range)} and o.currency = any(${convertibleCurrencies(store)})
    )
    ${sql.join(
      names.map((name, i) => sql`select ${name} as kind, k${sql.raw(String(i))} as k, currency, count(*) as orders, sum(revenue) as revenue from po group by k${sql.raw(String(i))}, currency`),
      sql` union all `,
    )}
  `);
  const out = Object.fromEntries(names.map((name) => [name, [] as Row[]])) as Record<K, Row[]>;
  for (const row of rows) out[String(row.kind) as K].push(row);
  return out;
}

type Money = { orders: number; revenueMinor: number };

/** The staff-made paid orders of a range (D173): they are no visit's orders, so the visit tables leave them out and the report names them. */
async function staffMadeIn(store: Store, range: Range): Promise<Money> {
  const rows = await setBased<Row>(sql`
    select o.currency::text as currency, count(*) as orders, sum(o.total_minor - o.tax_minor) as revenue
    from commerce.orders o
    where o.store_id = ${store.id}::uuid and ${PAID} and ${STAFF_MADE} and ${inPeriod(store, sql`o.placed_at`, range)}
      and o.currency = any(${convertibleCurrencies(store)})
    group by 1
  `);
  return { orders: rows.reduce((s, r) => s + num(r, "orders"), 0), revenueMinor: inMain(store, rows.map((r) => ({ ...r, currency: String(r.currency) })), ["revenue"]).values.revenue };
}

/** Rows from `ordersBy()` folded into the main currency, per key. */
function foldByKey(store: Store, rows: Row[]): Map<string, Money & { unconverted: number }> {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const list = groups.get(String(row.k)) ?? [];
    list.push(row);
    groups.set(String(row.k), list);
  }
  const out = new Map<string, Money & { unconverted: number }>();
  for (const [k, list] of groups) {
    const sums = inMain(store, list.map((r) => ({ ...r, currency: String(r.currency) })), ["revenue"]);
    out.set(k, { orders: list.reduce((s, r) => s + num(r, "orders"), 0), revenueMinor: sums.values.revenue, unconverted: sums.unconverted });
  }
  return out;
}

const sumMoney = (maps: Iterable<Money>): Money => {
  const total = { orders: 0, revenueMinor: 0 };
  for (const m of maps) {
    total.orders += m.orders;
    total.revenueMinor += m.revenueMinor;
  }
  return total;
};

/**
 * What the period's paid orders leave out, from one read: those that fall outside the covered days (before counting began or after
 * today), in currencies the store can convert, with their revenue; and those in currencies it has no rate for, left out of every
 * figure, with the currencies.
 */
async function orderGaps(store: Store, period: AnalyticsPeriod, range: Range | null): Promise<{ uncovered: Money; excluded: { unconverted: number; missing: string[] } }> {
  const outside = range ? sql`not ${inPeriod(store, sql`o.placed_at`, range)}` : sql`true`;
  const rows = await setBased<Row>(sql`
    select o.currency::text as currency, (o.currency = any(${convertibleCurrencies(store)})) as converts, (${outside}) as outside,
      count(*) as orders, sum(o.total_minor - o.tax_minor) as revenue
    from commerce.orders o
    where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
    group by 1, 2, 3
  `);
  const uncoveredRows = rows.filter((r) => r.converts === true && r.outside === true);
  const left = rows.filter((r) => r.converts !== true);
  return {
    uncovered: {
      orders: uncoveredRows.reduce((s, r) => s + num(r, "orders"), 0),
      revenueMinor: inMain(store, uncoveredRows.map((r) => ({ ...r, currency: String(r.currency) })), ["revenue"]).values.revenue,
    },
    excluded: { unconverted: left.reduce((s, r) => s + num(r, "orders"), 0), missing: [...new Set(left.map((r) => String(r.currency).trim()))].sort() },
  };
}

const count = (rows: Row[], key: string, field = "n"): Map<string, number> => new Map(rows.map((r) => [String(r[key]), num(r, field)]));

const money = (n: number) => n.toLocaleString("en-US");

function commonNotes(coverage: Coverage, excluded: { unconverted: number; missing: string[] }, uncovered: Money): string[] {
  const notes: string[] = [];
  if (!coverage.counting) notes.push("Visit counting is off, so visits, the funnel and where orders came from are not known. Switch it on in the analytics settings.");
  else if (coverage.firstDay === null) notes.push("No visit has been counted yet.");
  else if (coverage.partial) notes.push(`Visits have been counted since ${coverage.firstDay}, so these figures cover only the days from then.`);
  if (coverage.counting && uncovered.orders > 0) notes.push(`${money(uncovered.orders)} paid ${uncovered.orders === 1 ? "order" : "orders"} fall outside the days with counted visits and are left out of the rates.`);
  if (excluded.unconverted > 0) notes.push(`${money(excluded.unconverted)} paid ${excluded.unconverted === 1 ? "order" : "orders"} in ${excluded.missing.join(", ")} could not be converted, so they are left out.`);
  return notes;
}

// ---------------------------------------------------------------------------
// The traffic report
// ---------------------------------------------------------------------------

export type SegmentRow = {
  key: string;
  label: string;
  /** Visitor-days; null for the unknown row (orders with no visit). */
  sessions: number | null;
  orders: number;
  revenueMinor: number;
  /** Orders over sessions; null without sessions. */
  conversion: number | null;
  aov: number | null;
};

export type LandingRow = SegmentRow & {
  /** The path the visits landed on, as the browser had it. */
  path: string;
  kind: LandingKind;
  /** A product page's handle. */
  handle: string | null;
};

export type TrafficReport = {
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  counting: boolean;
  coverage: Coverage;
  /** Visitor-days over the covered days; null when counting is off or nothing is covered. */
  sessions: number | null;
  funnel: Funnel;
  /** Paid orders over visitor-days, both over the covered days. */
  conversion: { orders: number; sessions: number | null; rate: number | null };
  /** Mobile, tablet, desktop (always all three), then "unknown" when orders had no visit. Orders and revenue come through the carts' visits. */
  byDevice: SegmentRow[];
  /** The store's countries by their sessions: orders and revenue are by the order's own market; a row for the front door has sessions only. */
  byMarket: SegmentRow[];
  /** The 15 pages most visits began on, with the orders that came from those visits. */
  landingPages: LandingRow[];
  /** There were more landing pages than the 15 shown. */
  landingTruncated: boolean;
  /** Paid orders on covered days that are not tied to a visit. */
  unknownOrders: Money;
  /**
   * Paid orders on covered days that staff made from a draft order (D173): not a visit's, so in none of the tables above and in no rate, but real
   * sales that the period's revenue holds.
   */
  staffOrders: Money;
  /** Paid orders of the period on days with no counted visit (before counting, or later than today): not in any rate. */
  uncoveredOrders: Money;
  unconverted: number;
  missingCurrencies: string[];
  notes: string[];
};

export const LANDING_LIMIT = 15;

const DEVICES = [
  { key: "mobile", label: "Mobile" },
  { key: "tablet", label: "Tablet" },
  { key: "desktop", label: "Desktop" },
] as const;

function segment(key: string, label: string, sessions: number | null, m: Money | undefined): SegmentRow {
  const orders = m?.orders ?? 0;
  const revenueMinor = m?.revenueMinor ?? 0;
  return { key, label, sessions, orders, revenueMinor, conversion: safeRatio(orders, sessions), aov: orders > 0 ? Math.round(revenueMinor / orders) : null };
}

/** What the funnel counts, over the covered days: visits, then those that viewed a product, made a cart, reached checkout, bought. */
async function funnelCounts(store: Store, range: Range): Promise<FunnelCounts> {
  // `cc` is driven from the carts that have a visit in the range (a fraction of the visits), not from every visit of the range. The
  // visits that reached checkout are those that say so plus those whose cart became an order (`ordered_only`, the two never overlap).
  const [row] = await setBased<Row>(sql`
    with cc as (
      select c.visit_id, bool_or(o.id is not null) as ordered, bool_or(o.id is not null and ${PAID}) as paid, bool_or(vv.checkout_at is not null) as has_checkout
      from commerce.carts c
      join commerce.visits vv on vv.store_id = c.store_id and vv.id = c.visit_id
      left join commerce.orders o on o.store_id = c.store_id and o.cart_id = c.id and o.copied_from is null and o.host_id is null and ${FROM_CHECKOUT}
      where c.store_id = ${store.id}::uuid and c.visit_id is not null and vv.day >= ${range.from}::date and vv.day < ${range.to}::date
      group by c.visit_id
    )
    select v.sessions, v.product_viewers, v.with_checkout, c.carts, c.ordered_only, c.purchases
    from (
      select count(*) as sessions, count(*) filter (where v.product_views > 0) as product_viewers, count(*) filter (where v.checkout_at is not null) as with_checkout
      from commerce.visits v
      where ${visitsIn(store, range)}
    ) v,
    (
      select count(*) as carts, count(*) filter (where ordered and not has_checkout) as ordered_only, count(*) filter (where paid) as purchases
      from cc
    ) c
  `);
  return {
    sessions: num(row, "sessions"),
    productViewers: num(row, "product_viewers"),
    carts: num(row, "carts"),
    checkouts: num(row, "with_checkout") + num(row, "ordered_only"),
    purchases: num(row, "purchases"),
  };
}

/**
 * The traffic page's figures for a period (docs/analytics.md, "Traffic"): the funnel from a visit to a purchase, devices,
 * countries and landing pages, and the paid orders that no visit explains. With counting off, or no covered day, the
 * visit figures are null (the funnel's stages unknown) and the report says how to get them.
 */
export async function trafficReport(store: Store, period: AnalyticsPeriod, now: Date): Promise<TrafficReport> {
  const firstDay = store.visitCounting ? await firstCountedDay(store) : null;
  const { coverage, range } = coverageOf(store, period, firstDay, now);
  const { uncovered, excluded } = await orderGaps(store, period, range);
  const base = { currency: mainCurrency(store), counting: coverage.counting, coverage, uncoveredOrders: uncovered, unconverted: excluded.unconverted, missingCurrencies: excluded.missing };
  if (!range) {
    return {
      ...base,
      sessions: null,
      funnel: funnel({ sessions: null, productViewers: null, carts: null, checkouts: null, purchases: null }),
      conversion: { orders: 0, sessions: null, rate: null },
      byDevice: [],
      byMarket: [],
      landingPages: [],
      landingTruncated: false,
      unknownOrders: { orders: 0, revenueMinor: 0 },
      staffOrders: { orders: 0, revenueMinor: 0 },
      notes: commonNotes(coverage, excluded, uncovered),
    };
  }

  const [counts, deviceSessions, marketSessions, topPaths, { device: deviceOrders, market: marketOrders }, staff] = await Promise.all([
    funnelCounts(store, range),
    db().execute<Row>(sql`select v.device as k, count(*) as n from commerce.visits v where ${visitsIn(store, range)} group by 1`),
    db().execute<Row>(sql`select coalesce(v.market_code, '') as k, count(*) as n from commerce.visits v where ${visitsIn(store, range)} group by 1`),
    db().execute<Row>(sql`
      select v.landing_path as k, count(*) as n from commerce.visits v where ${visitsIn(store, range)}
      group by 1 order by n desc, k limit ${LANDING_LIMIT + 1}
    `),
    ordersByKeys(store, range, { device: sql`coalesce(v.device, 'unknown')`, market: sql`o.market_code` }),
    staffMadeIn(store, range),
  ]);

  const sessions = counts.sessions ?? 0;
  const devices = foldByKey(store, deviceOrders);
  const deviceCounts = count(deviceSessions, "k");
  const unknown = devices.get("unknown") ?? { orders: 0, revenueMinor: 0 };
  const byDevice = [...DEVICES.map((d) => segment(d.key, d.label, deviceCounts.get(d.key) ?? 0, devices.get(d.key)))];
  if (unknown.orders > 0) byDevice.push(segment("unknown", "Unknown", null, unknown));

  const markets = foldByKey(store, marketOrders);
  const marketCounts = count(marketSessions, "k");
  const marketKeys = new Set<string>([...marketCounts.keys(), ...markets.keys()]);
  const byMarket = [...marketKeys]
    .map((k) =>
      k === ""
        ? segment("front_door", "Front door (country chooser)", marketCounts.get(k) ?? 0, undefined)
        : segment(k, store.markets.find((m) => m.code === k)?.name ?? k, marketCounts.get(k) ?? 0, markets.get(k)),
    )
    .sort((a, b) => (b.sessions ?? 0) - (a.sessions ?? 0) || b.revenueMinor - a.revenueMinor || a.key.localeCompare(b.key));

  const landingTruncated = topPaths.length > LANDING_LIMIT;
  const paths = topPaths.slice(0, LANDING_LIMIT).map((r) => String(r.k));
  const landingOrders =
    paths.length > 0
      ? foldByKey(store, await ordersBy(store, range, sql`v.landing_path`, { extra: sql`and v.landing_path = any(array[${sql.join(paths.map((p) => sql`${p}`), sql`, `)}]::text[])` }))
      : new Map<string, Money & { unconverted: number }>();
  const landingPages = paths.map((path): LandingRow => {
    const landing = landingKind(path);
    return { ...segment(path, path, num(topPaths.find((r) => String(r.k) === path), "n"), landingOrders.get(path)), path, kind: landing.kind, handle: landing.handle };
  });

  const covered = sumMoney([...devices.values()]);
  return {
    ...base,
    sessions,
    funnel: funnel(counts),
    conversion: { orders: covered.orders, sessions, rate: safeRatio(covered.orders, sessions) },
    byDevice,
    byMarket,
    landingPages,
    landingTruncated,
    unknownOrders: { orders: unknown.orders, revenueMinor: unknown.revenueMinor },
    staffOrders: staff,
    notes: [
      ...commonNotes(coverage, excluded, uncovered),
      ...(staff.orders > 0 ? [`${money(staff.orders)} staff-made paid ${staff.orders === 1 ? "order" : "orders"} (draft orders) are left out of these tables and of conversion: they were not visits. They are in the period's revenue and in the Marketing page's channel table as Staff-made.`] : []),
      ...(landingTruncated ? [`Only the ${LANDING_LIMIT} landing pages with most visits are shown.`] : []),
      ...funnel(counts).notes,
    ],
  };
}

// ---------------------------------------------------------------------------
// The marketing report
// ---------------------------------------------------------------------------

export type MarketingReport = {
  currency: string;
  counting: boolean;
  coverage: Coverage;
  /**
   * The channel table over the covered days (spend too, so CAC and ROAS compare like with like); null when counting is off or
   * no day is covered, because orders cannot then be told apart by where they came from.
   */
  table: ChannelTable | null;
  /** Marketing spend the owner entered in the period, by channel. */
  spend: {
    totalMinor: number;
    byChannel: { channel: string; label: string; amountMinor: number }[];
    /** Spend on days outside the covered ones: in `byChannel` and `totalMinor`, but not in the table. */
    outsideCoverageMinor: number;
  };
  /** Paid orders on covered days with no visit, the table's "Unknown" row. */
  unknownOrders: Money;
  uncoveredOrders: Money;
  unconverted: number;
  missingCurrencies: string[];
  notes: string[];
};

type Acc = { sessions: number; orders: number; revenue: number; newCustomers: number; spend: number; cogs: number; knownRev: number; physical: number; platform: number; fees: number };
const blank = (): Acc => ({ sessions: 0, orders: 0, revenue: 0, newCustomers: 0, spend: 0, cogs: 0, knownRev: 0, physical: 0, platform: 0, fees: 0 });

/**
 * The covered orders by channel, from one read of the paid orders (joined to their visits once): per channel and currency the orders,
 * revenue, cost of goods, line revenue whose cost was known (shipping income is no line, so it never counts as known) and orders with a physical line (`orders`); Kaizen's fees on the captured
 * payments (`platform`); and, with payment fees on, the orders' distinct totals with how many have each (`fees`: the fee is worked
 * out per order by the caller). Orders in a currency the store cannot convert are left out of all three.
 */
async function channelOrders(store: Store, range: Range, feesOn: boolean): Promise<{ orders: Row[]; platform: Row[]; fees: Row[] }> {
  const known = convertibleCurrencies(store);
  // A staff-made order (D173) came from no visit: its own row, whatever cart or visit it might be tied to.
  const channel = sql`(case when ${STAFF_MADE} then ${STAFF_CHANNEL} else coalesce(v.channel, ${UNKNOWN_CHANNEL}) end)`;
  const rows = await setBased<Row>(sql`
    with po0 as materialized (
      select o.id, o.store_id, o.currency::text as currency, (o.currency = any(${known})) as ok, o.total_minor, o.tax_minor, (${channel})::text as k
      from commerce.orders o ${ORDER_VISIT}
      where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, range)}
    ),
    by_order as (
      select k, currency, count(*) as orders, sum(total_minor - tax_minor) as revenue
      from po0
      where ok
      group by k, currency
    ),
    pl as materialized (
      select po0.id, po0.k, po0.currency, ol.unit_cost_minor * ol.quantity as cost,
        ol.total_minor - ol.tax_minor as line_rev,
        case when (ol.variant_id is not null or ol.custom) and ol.unit_cost_minor is null then ol.total_minor - ol.tax_minor else 0 end as unknown_rev,
        (ol.delivery = 'physical') as physical
      from po0
      join commerce.order_lines ol on ol.order_id = po0.id
      where po0.ok and ol.store_id = ${store.id}::uuid
    ),
    by_line as (
      select k, currency, sum(cost) as cogs, sum(line_rev - unknown_rev) as known_rev
      from pl
      group by k, currency
    ),
    by_phys as (
      select k, currency, count(*) as physical_orders
      from (select distinct id, k, currency from pl where physical) d
      group by k, currency
    ),
    orders_agg as (
      select o.k, o.currency, o.orders, o.revenue, coalesce(l.cogs, 0) as cogs, coalesce(l.known_rev, 0) as known_rev,
        coalesce(ph.physical_orders, 0) as physical_orders
      from by_order o
      left join by_line l on l.k = o.k and l.currency = o.currency
      left join by_phys ph on ph.k = o.k and ph.currency = o.currency
    ),
    platform as (
      select po0.k as ch, pp.currency::text as currency, sum(pp.kaizen_fee_minor) as fee
      from po0
      join commerce.payments pp on pp.order_id = po0.id
      where pp.store_id = ${store.id}::uuid and pp.status = 'captured' and pp.currency = any(${known})
      group by po0.k, pp.currency
    )
    select 'orders' as kind, to_jsonb(t) as r from orders_agg t
    union all select 'platform', to_jsonb(t) from platform t
    ${
      feesOn
        ? sql`union all select 'fees', to_jsonb(t) from (select k as ch, currency, total_minor, count(*) as n from po0 where ok group by k, currency, total_minor) t`
        : sql``
    }
  `);
  const out = { orders: [] as Row[], platform: [] as Row[], fees: [] as Row[] };
  for (const { kind, r } of rows as unknown as { kind: keyof typeof out; r: Row }[]) out[kind].push(r);
  return out;
}

/**
 * Customers whose first paid order is in the range, by the channel of the visit behind that order. One pass over the store's paid
 * orders up to the range's end finds the customer keys that qualify (a grouped minimum, no sorting); only their first orders are
 * then followed to a cart and its visit.
 */
async function newCustomersByChannel(store: Store, range: Range): Promise<Map<string, number>> {
  const rows = await setBased<Row>(sql`
    with ko as materialized (
      select ${CUSTOMER_KEY} as k, o.placed_at, o.id, o.cart_id, (o.source = 'draft') as staff_made, (o.currency = any(${convertibleCurrencies(store)})) as ok
      from commerce.orders o ${CUSTOMER_JOIN}
      where o.store_id = ${store.id}::uuid and ${PAID} and ${HAS_CUSTOMER} and o.placed_at < ${dayStart(store, range.to)}
    ),
    q as (
      select k, min(placed_at) as first_at
      from ko
      group by k
      having min(placed_at) >= ${dayStart(store, range.from)} and bool_or(placed_at >= ${dayStart(store, range.from)} and ok)
    ),
    fr as (
      select distinct on (q.k) q.k, ko.cart_id, ko.staff_made
      from q join ko on ko.k = q.k and ko.placed_at = q.first_at
      order by q.k, ko.placed_at, ko.id
    )
    select (case when fr.staff_made then ${STAFF_CHANNEL} else coalesce(v.channel, ${UNKNOWN_CHANNEL}) end) as ch, count(*) as n
    from fr
    left join commerce.carts c on c.store_id = ${store.id}::uuid and c.id = fr.cart_id
    left join commerce.visits v on v.store_id = ${store.id}::uuid and v.id = c.visit_id
    group by 1
  `);
  return count(rows, "ch");
}

async function spendByChannel(store: Store, from: string, to: string): Promise<Map<string, number>> {
  const rows = await db().execute<Row>(sql`
    select s.channel as ch, sum(s.amount_minor) as amount from commerce.marketing_spend s
    where s.store_id = ${store.id}::uuid and s.day >= ${from}::date and s.day < ${to}::date
    group by 1
  `);
  return count(rows, "ch", "amount");
}

/**
 * The marketing page's channel table for a period (docs/analytics.md, "Marketing"): per channel its visits, the paid orders and
 * revenue of those visits, new customers, the spend entered, and what the orders left before marketing (revenue less cost of
 * goods, estimated payment fees, Kaizen's fees and estimated shipping: null while their product costs are unknown). CAC, ROAS and
 * profit ROAS are `channelTable()`'s. An "Unknown" row holds the orders no visit explains; channels with spend and no visits are
 * rows too. The blended row's contribution is null when any channel's is unknown, since a partial sum would flatter it.
 */
export async function marketingReport(store: Store, period: AnalyticsPeriod, now?: Date): Promise<MarketingReport> {
  const [settings, firstDay] = await Promise.all([getAnalyticsSettings(store.id), store.visitCounting ? firstCountedDay(store) : Promise.resolve(null)]);
  const { coverage, range } = coverageOf(store, period, firstDay, now);
  const [{ uncovered, excluded }, spendAll] = await Promise.all([orderGaps(store, period, range), spendByChannel(store, period.from, period.to)]);
  const totalSpend = [...spendAll.values()].reduce((s, n) => s + n, 0);
  const byChannel = [...spendAll.entries()]
    .map(([channel, amountMinor]) => ({ channel, label: channelLabel(channel), amountMinor }))
    .sort((a, b) => b.amountMinor - a.amountMinor || a.channel.localeCompare(b.channel));
  const base = { currency: mainCurrency(store), counting: coverage.counting, coverage, uncoveredOrders: uncovered, unconverted: excluded.unconverted, missingCurrencies: excluded.missing };
  const notes = commonNotes(coverage, excluded, uncovered);
  if (!range) {
    return { ...base, table: null, spend: { totalMinor: totalSpend, byChannel, outsideCoverageMinor: totalSpend }, unknownOrders: { orders: 0, revenueMinor: 0 }, notes };
  }

  const feesOn = settings.paymentFeeBps > 0 || settings.paymentFeeFixedMinor > 0;
  const [sessionRows, { orders: orderRows, platform, fees }, fresh, spend] = await Promise.all([
    db().execute<Row>(sql`select v.channel as ch, count(*) as n from commerce.visits v where ${visitsIn(store, range)} group by 1`),
    channelOrders(store, range, feesOn),
    newCustomersByChannel(store, range),
    spendByChannel(store, range.from, range.to),
  ]);

  const acc = new Map<string, Acc>();
  const at = (key: string) => {
    let a = acc.get(key);
    if (!a) acc.set(key, (a = blank()));
    return a;
  };
  for (const r of sessionRows) at(String(r.ch)).sessions = num(r, "n");
  const orderGroups = new Map<string, Row[]>();
  for (const r of orderRows) orderGroups.set(String(r.k), [...(orderGroups.get(String(r.k)) ?? []), r]);
  for (const [key, rows] of orderGroups) {
    const a = at(key);
    const sums = inMain(store, rows.map((r) => ({ ...r, currency: String(r.currency) })), ["revenue", "known_rev"]).values;
    a.orders = rows.reduce((s, r) => s + num(r, "orders"), 0);
    a.revenue = sums.revenue;
    a.knownRev = sums.known_rev;
    a.cogs = rows.reduce((s, r) => s + num(r, "cogs"), 0);
    a.physical = rows.reduce((s, r) => s + num(r, "physical_orders"), 0);
  }
  const platformGroups = new Map<string, Row[]>();
  for (const r of platform) platformGroups.set(String(r.ch), [...(platformGroups.get(String(r.ch)) ?? []), r]);
  for (const [key, rows] of platformGroups) at(key).platform = inMain(store, rows.map((r) => ({ ...r, currency: String(r.currency) })), ["fee"]).values.fee;
  for (const r of fees) {
    const total = toMainOne(store, String(r.currency), num(r, "total_minor"));
    if (total !== null) at(String(r.ch)).fees += paymentFees([total], settings) * num(r, "n");
  }
  for (const [key, n] of fresh) at(key).newCustomers = n;
  for (const [key, amount] of spend) at(key).spend = amount;

  // Costs are unknown for a channel when it sold something and none of what it sold has a cost.
  const unknownCosts = (a: Acc) => a.revenue > 0 && a.knownRev <= 0;
  const anyUnknown = [...acc.values()].some(unknownCosts);
  const inputs: ChannelInput[] = [...acc.entries()].map(([key, a]) => ({
    channel: key,
    sessions: isNotAChannel(key) ? null : a.sessions,
    orders: a.orders,
    revenueMinor: a.revenue,
    newCustomers: a.newCustomers,
    spendMinor: a.spend,
    contributionBeforeMarketingMinor:
      a.revenue === 0 ? (anyUnknown ? null : 0) : unknownCosts(a) ? null : a.revenue - a.cogs - a.fees - a.platform - shippingCostsFor(a.physical, settings),
  }));
  const table = channelTable(inputs);
  // A sum of the channels whose costs are known would read as the whole's.
  // The blended contribution (every channel) is also left out; its profit ROAS is over the spend channels only, which the table works out.
  const guarded: ChannelTable = anyUnknown ? { ...table, blended: { ...table.blended, contributionBeforeMarketingMinor: null } } : table;
  const unknown = foldByKey(store, orderRows).get(UNKNOWN_CHANNEL) ?? { orders: 0, revenueMinor: 0 };
  const inRange = [...spend.values()].reduce((s, n) => s + n, 0);
  return {
    ...base,
    table: guarded,
    spend: { totalMinor: totalSpend, byChannel, outsideCoverageMinor: totalSpend - inRange },
    unknownOrders: { orders: unknown.orders, revenueMinor: unknown.revenueMinor },
    notes: [...notes, ...(anyUnknown ? ["Product costs are missing for some channels' sales, so their contribution and the blended one are not shown."] : []), ...(totalSpend > inRange ? ["Spend entered for days with no counted visits is left out of CAC and ROAS."] : [])],
  };
}
