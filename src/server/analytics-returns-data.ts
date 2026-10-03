import "server-only";

import { sql } from "drizzle-orm";

import { todayIn, type AnalyticsPeriod } from "@/lib/analytics-period";
import {
  MIN_PRODUCT_UNITS,
  MIN_RATE_ORDERS,
  MIN_RATE_UNITS,
  gatedRate,
  maturityNote,
  reasonBreakdown,
  timingOf,
  type Figure,
  type ReasonBreakdown,
  type Timing,
} from "@/lib/analytics-returns";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";
import { DEFAULT_RETURN_SETTINGS } from "@/lib/withdrawal";

import { productNames } from "./analytics-refunds-data";
import { PAID, inPeriod, num, toMainOne, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import { OVERDUE_SQL } from "./return-sql";
import { getReturnSettings } from "./return-settings";
import type { Store } from "./stores";

/**
 * The Returns section of the Traffic page (D153, docs/analytics.md "Returns"): how much comes back, why, which products, how fast
 * the store refunds and what is overdue. Every figure is defined in the document and worked out here once, in code, from
 * `commerce.returns` and `return_lines`; the AI manager repeats the queue, never these numbers.
 *
 * - **Returns made** are counting returns (not declined or cancelled) created in the period; declined and cancelled ones are shown beside.
 * - **Rates** are of the cohort (paid orders of the period with goods on them), whenever their returns were made; they need a minimum
 *   volume and a store that has recorded at least one return, otherwise they are words (`Figure.missing`), never a zero.
 * - **Reasons**, **time to refund** and **refunded for returns** are of what happened in the period (made, refunded).
 * - **Overdue** is the queue's own count right now.
 *
 * Copied orders and hosts' orders never count. Amounts are in the main currency without VAT, each currency group converted by itself
 * at today's rates; an order in a currency with no rate is left out and counted (`unconverted`).
 */

/** How many returned products are listed. */
export const TOP_RETURNED_PRODUCTS = 10;
/** The most refunded returns read for the times (the newest first); the page says so when it is reached. */
export const TIMING_CAP = 5_000;

export const NOT_SEEN_RETURNS_NOTE =
  "Returns made without Kaizen's withdrawal function or a return request (a parcel sent back with no message) are not included.";

export type ReturnKind = "withdrawal" | "return";

export type ReturnKindRow = {
  kind: ReturnKind;
  label: string;
  /** Counting returns made in the period. */
  returns: number;
  /** Units on their accepted lines. */
  units: number;
  /** Voluntary requests the store declined, and returns cancelled, made in the period. */
  declined: number;
  cancelled: number;
  /** Returns of this kind refunded in the period, and what they were refunded (without VAT). */
  refunded: number;
  refundedMinor: number;
};

export type ReturnedProduct = {
  /** The product's id. */
  productId: string;
  name: string;
  /** Units sold of it in the cohort, and units of those that were returned. */
  sold: number;
  returnedUnits: number;
  returnedMinor: number;
  /** Returned / sold, only from `MIN_PRODUCT_UNITS` sold. */
  rate: Figure;
};

export type ReturnsReport = {
  currency: string;
  period: { from: string; to: string; days: number };
  /** Whether the store has recorded any return at all (any time); with none, no rate is a number. */
  tracked: boolean;
  /** The store's return window in days. */
  windowDays: number;
  made: { returns: number; withdrawals: number; voluntary: number; units: number; declined: number; cancelled: number };
  kinds: ReturnKindRow[];
  /** Paid orders of the period with goods, and units sold on them. */
  cohort: { orders: number; unitsSold: number; returnedOrders: number; returnedUnits: number };
  orderRate: Figure;
  unitRate: Figure;
  /** The cohort's accepted lines at what they were sold for, without VAT, before deductions. */
  returnedMinor: number;
  /** Refunded for returns in the period, without VAT, and how many returns and how many of them outside Kaizen's Stripe. */
  refunded: { minor: number; returns: number; outside: number };
  reasons: ReasonBreakdown;
  timing: { requestToRefund: Timing; receivedToRefund: Timing; afterDeadline: { late: number; of: number }; truncated: boolean };
  /** Withdrawal returns past their refund deadline right now (the queue's count). */
  overdue: number;
  products: ReturnedProduct[];
  productCount: number;
  /** Always said: returns outside Kaizen are not seen. */
  notSeenNote: string;
  /** The period reaches into the store's return window: the rates are still rising. */
  maturity: string | null;
  unconverted: number;
  missingRates: string[];
  notes: string[];
};

const KIND_LABELS: Record<ReturnKind, string> = { withdrawal: "Withdrawals", return: "Voluntary returns" };

const rated = (store: Store, currency: string): boolean => canConvert(currency.trim(), mainCurrency(store), store.localization.rates);

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

/** On `commerce.returns r` and `commerce.orders o`: a return that asks for goods back. */
const COUNTING = sql`r.status::text not in ('declined', 'cancelled')`;
/** A return of the store's own order, never a copied or a host's. */
const OWN_ORDER = sql`(o.copied_from is null and o.host_id is null)`;
/** A line of goods that can come back. */
const GOODS = (alias: string) => sql.raw(`(${alias}.variant_id is not null and ${alias}.delivery = 'physical')`);

/** Returns created in the period by kind, status, reason and currency, with the units on their accepted lines. */
async function readMade(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    with rs as (
      select r.id, r.kind, r.status::text as status, r.reason, trim(o.currency) as currency
      from commerce.returns r
      join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
      where r.store_id = ${store.id}::uuid and ${OWN_ORDER} and ${inPeriod(store, sql`r.created_at`, period)}
    ),
    u as (
      select rl.return_id, sum(rl.quantity)::int as units
      from commerce.return_lines rl
      where rl.store_id = ${store.id}::uuid and rl.decision = 'accept'
      group by rl.return_id
    )
    select rs.kind, rs.status, rs.reason, rs.currency, count(*)::int as n, coalesce(sum(u.units), 0)::int as units
    from rs left join u on u.return_id = rs.id
    group by 1, 2, 3, 4
  `);
}

/** Paid orders of the period that have goods on them, and how many have a counting return (made at any time), by currency. */
async function readCohortOrders(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    select trim(o.currency) as currency, count(*)::int as orders, count(rt.order_id)::int as returned_orders
    from commerce.orders o
    left join (
      select distinct r.order_id from commerce.returns r where r.store_id = ${store.id}::uuid and ${COUNTING}
    ) rt on rt.order_id = o.id
    where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)}
      and exists (select 1 from commerce.order_lines g where g.store_id = o.store_id and g.order_id = o.id and ${GOODS("g")})
    group by 1
  `);
}

/** Units sold of goods in the cohort, by product and currency. */
async function readSold(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    select pv.product_id::text as product_id, trim(o.currency) as currency, sum(ol.quantity)::int as sold
    from commerce.orders o
    join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
    join commerce.product_variants pv on pv.store_id = ol.store_id and pv.id = ol.variant_id
    where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)} and ${GOODS("ol")}
    group by 1, 2
  `);
}

/** Units on accepted lines of counting returns of the cohort and their value without VAT, by product and currency. */
async function readReturned(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    select pv.product_id::text as product_id, trim(o.currency) as currency, sum(rl.quantity)::int as units,
      sum(round((ol.total_minor - ol.tax_minor)::numeric * rl.quantity / ol.quantity)) as value
    from commerce.orders o
    join commerce.returns r on r.store_id = o.store_id and r.order_id = o.id and ${COUNTING}
    join commerce.return_lines rl on rl.store_id = r.store_id and rl.return_id = r.id and rl.decision = 'accept'
    join commerce.order_lines ol on ol.store_id = rl.store_id and ol.id = rl.order_line_id
    join commerce.product_variants pv on pv.store_id = ol.store_id and pv.id = ol.variant_id
    where o.store_id = ${store.id}::uuid and ${PAID} and ${inPeriod(store, sql`o.placed_at`, period)} and ${GOODS("ol")}
    group by 1, 2
  `);
}

/** Returns refunded in the period (a refund of more than nothing), the newest first, with the instants the times are made of. */
async function readRefunded(store: Store, period: AnalyticsPeriod): Promise<Row[]> {
  return setBased<Row>(sql`
    select r.id::text as id, r.kind, trim(o.currency) as currency, r.refund_outside,
      extract(epoch from r.refunded_at) * 1000 as refunded_ms,
      extract(epoch from (case when r.kind = 'withdrawal' then coalesce(w.confirmed_at, r.created_at) else r.created_at end)) * 1000 as asked_ms,
      extract(epoch from r.received_at) * 1000 as received_ms,
      extract(epoch from r.refund_deadline) * 1000 as deadline_ms,
      round(r.refund_minor::numeric * (o.total_minor - o.tax_minor) / nullif(o.total_minor, 0)) as value
    from commerce.returns r
    join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    left join commerce.withdrawal_requests w on w.store_id = r.store_id and w.id = r.withdrawal_request_id
    where r.store_id = ${store.id}::uuid and ${OWN_ORDER} and r.refund_minor > 0 and ${inPeriod(store, sql`r.refunded_at`, period)}
    order by r.refunded_at desc, r.id
    limit ${TIMING_CAP + 1}
  `);
}

/** The store's returns in all, and the ones past their refund deadline right now (the queue's condition). */
async function readStanding(store: Store): Promise<{ total: number; overdue: number }> {
  const [row] = await setBased<Row>(sql`
    select count(*)::int as total, count(*) filter (where ${OVERDUE_SQL})::int as overdue
    from commerce.returns r
    join commerce.orders o on o.store_id = r.store_id and o.id = r.order_id
    where r.store_id = ${store.id}::uuid and ${OWN_ORDER}
  `);
  return { total: num(row, "total"), overdue: num(row, "overdue") };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

const ms = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value));

/** The Returns section for a period. See the module's description for what every figure is. */
export async function returnsReport(store: Store, period: AnalyticsPeriod, now: Date = new Date()): Promise<ReturnsReport> {
  const [made, cohortOrders, sold, returned, refundedRows, standing, settings] = await Promise.all([
    readMade(store, period),
    readCohortOrders(store, period),
    readSold(store, period),
    readReturned(store, period),
    readRefunded(store, period),
    readStanding(store),
    getReturnSettings(store.id).catch(() => null),
  ]);
  const windowDays = settings?.windowDays ?? DEFAULT_RETURN_SETTINGS.windowDays;
  const tracked = standing.total > 0;

  let unconverted = 0;
  const missing = new Set<string>();
  const skip = (currency: string, count: number): boolean => {
    if (rated(store, currency)) return false;
    unconverted += count;
    missing.add(currency.trim());
    return true;
  };

  // Returns made: by kind and status, and the reasons of those that count.
  const kinds = new Map<ReturnKind, ReturnKindRow>(
    (["withdrawal", "return"] as const).map((k) => [k, { kind: k, label: KIND_LABELS[k], returns: 0, units: 0, declined: 0, cancelled: 0, refunded: 0, refundedMinor: 0 }]),
  );
  const reasonInputs = new Map<string, { reason: string | null; returns: number; units: number }>();
  for (const r of made) {
    const row = kinds.get(String(r.kind) as ReturnKind);
    if (!row) continue;
    if (skip(String(r.currency), num(r, "n"))) continue;
    const status = String(r.status);
    if (status === "declined") row.declined += num(r, "n");
    else if (status === "cancelled") row.cancelled += num(r, "n");
    else {
      row.returns += num(r, "n");
      row.units += num(r, "units");
      const reason = r.reason === null || r.reason === undefined ? null : String(r.reason);
      const key = reason ?? "";
      const have = reasonInputs.get(key) ?? { reason, returns: 0, units: 0 };
      have.returns += num(r, "n");
      have.units += num(r, "units");
      reasonInputs.set(key, have);
    }
  }
  const withdrawals = kinds.get("withdrawal")!;
  const voluntary = kinds.get("return")!;

  // The cohort. Orders in a currency with no rate are left out, as on every other page.
  let orders = 0;
  let returnedOrders = 0;
  for (const r of cohortOrders) {
    if (skip(String(r.currency), num(r, "orders"))) continue;
    orders += num(r, "orders");
    returnedOrders += num(r, "returned_orders");
  }
  let unitsSold = 0;
  const perProduct = new Map<string, { sold: number; returned: number; byCurrency: Map<string, number> }>();
  const productAcc = (id: string) => perProduct.get(id) ?? { sold: 0, returned: 0, byCurrency: new Map<string, number>() };
  for (const r of sold) {
    if (!rated(store, String(r.currency))) continue;
    unitsSold += num(r, "sold");
    const id = String(r.product_id);
    const acc = productAcc(id);
    acc.sold += num(r, "sold");
    perProduct.set(id, acc);
  }
  let returnedUnits = 0;
  let returnedMinor = 0;
  for (const r of returned) {
    const currency = String(r.currency);
    if (!rated(store, currency)) continue;
    returnedUnits += num(r, "units");
    returnedMinor += toMainOne(store, currency, num(r, "value")) ?? 0;
    const id = String(r.product_id);
    const acc = productAcc(id);
    acc.returned += num(r, "units");
    acc.byCurrency.set(currency, (acc.byCurrency.get(currency) ?? 0) + num(r, "value"));
    perProduct.set(id, acc);
  }

  // Refunded in the period, and the times.
  const timingTruncated = refundedRows.length > TIMING_CAP;
  const refundedUsed = refundedRows.slice(0, TIMING_CAP);
  let refundedMinor = 0;
  let refundedReturns = 0;
  let refundedOutside = 0;
  const requestDays: (number | null)[] = [];
  const receivedDays: (number | null)[] = [];
  let late = 0;
  let withDeadline = 0;
  const DAY = 86_400_000;
  for (const r of refundedUsed) {
    const currency = String(r.currency);
    if (skip(currency, 1)) continue;
    const kind = String(r.kind) as ReturnKind;
    const value = toMainOne(store, currency, num(r, "value")) ?? 0;
    refundedMinor += value;
    refundedReturns += 1;
    if (r.refund_outside === true) refundedOutside += 1;
    const row = kinds.get(kind);
    if (row) {
      row.refunded += 1;
      row.refundedMinor += value;
    }
    const refundedAt = ms(r.refunded_ms);
    const askedAt = ms(r.asked_ms);
    const receivedAt = ms(r.received_ms);
    const deadline = ms(r.deadline_ms);
    requestDays.push(askedAt !== null && refundedAt !== null && refundedAt >= askedAt ? (refundedAt - askedAt) / DAY : null);
    receivedDays.push(receivedAt !== null && refundedAt !== null && refundedAt >= receivedAt ? (refundedAt - receivedAt) / DAY : null);
    if (kind === "withdrawal" && deadline !== null && refundedAt !== null) {
      withDeadline += 1;
      if (refundedAt > deadline) late += 1;
    }
  }

  // Products: the most returned first, with their own rate against what was sold of them.
  const productList = [...perProduct.entries()]
    .filter(([, acc]) => acc.returned > 0)
    .map(([productId, acc]) => {
      let minor = 0;
      for (const [currency, amount] of acc.byCurrency) minor += toMainOne(store, currency, amount) ?? 0;
      return { productId, sold: acc.sold, returnedUnits: acc.returned, returnedMinor: minor };
    })
    .sort((a, b) => b.returnedUnits - a.returnedUnits || b.returnedMinor - a.returnedMinor || (a.productId < b.productId ? -1 : 1));
  const top = productList.slice(0, TOP_RETURNED_PRODUCTS);
  const names = await productNames(store, top.map((p) => p.productId));
  const products: ReturnedProduct[] = top.map((p) => ({
    ...p,
    name: names.get(p.productId) ?? "Unnamed product",
    rate: gatedRate({ part: p.returnedUnits, whole: p.sold, min: MIN_PRODUCT_UNITS, unit: "units", tracked: true }),
  }));

  const notes: string[] = [];
  if (unconverted > 0) {
    notes.push(`${unconverted} ${unconverted === 1 ? "order or return" : "orders and returns"} in ${[...missing].sort().join(", ")} ${unconverted === 1 ? "is" : "are"} left out: the store has no exchange rate for it.`);
  }
  if (timingTruncated) notes.push(`More than ${TIMING_CAP} returns were refunded in this period: the times are made of the latest ones.`);

  const today = todayIn(now, store.timeZone);
  return {
    currency: mainCurrency(store),
    period: { from: period.from, to: period.to, days: period.days },
    tracked,
    windowDays,
    made: {
      returns: withdrawals.returns + voluntary.returns,
      withdrawals: withdrawals.returns,
      voluntary: voluntary.returns,
      units: withdrawals.units + voluntary.units,
      declined: withdrawals.declined + voluntary.declined,
      cancelled: withdrawals.cancelled + voluntary.cancelled,
    },
    kinds: [withdrawals, voluntary],
    cohort: { orders, unitsSold, returnedOrders, returnedUnits },
    orderRate: gatedRate({ part: returnedOrders, whole: orders, min: MIN_RATE_ORDERS, unit: "orders", tracked }),
    unitRate: gatedRate({ part: returnedUnits, whole: unitsSold, min: MIN_RATE_UNITS, unit: "units", tracked }),
    returnedMinor,
    refunded: { minor: refundedMinor, returns: refundedReturns, outside: refundedOutside },
    reasons: reasonBreakdown([...reasonInputs.values()]),
    timing: {
      requestToRefund: timingOf(requestDays, "a request date"),
      receivedToRefund: timingOf(receivedDays, "the goods received first"),
      afterDeadline: { late, of: withDeadline },
      truncated: timingTruncated,
    },
    overdue: standing.overdue,
    products,
    productCount: productList.length,
    notSeenNote: NOT_SEEN_RETURNS_NOTE,
    maturity: orders > 0 ? maturityNote(period, today, windowDays) : null,
    unconverted,
    missingRates: [...missing].sort(),
    notes,
  };
}
