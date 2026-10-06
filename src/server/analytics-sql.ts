import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { toMain } from "@/lib/analytics-core";
import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { mainCurrency } from "@/lib/markets";

import type { Store } from "./stores";

/**
 * The shared pieces of every analytics query (D152, docs/analytics.md): what a paid order is, what revenue is without VAT,
 * a period's bounds in the store's time zone, the customer key, and summing amounts held in several currencies. Every
 * analytics module builds on these, so the definitions live in one place and the figures agree from page to page.
 *
 * Queries alias `commerce.orders` as `o`, `commerce.order_lines` as `ol` and `commerce.customers` as `c` (see `CUSTOMER_JOIN`).
 */

export type Row = Record<string, unknown>;

/** A number out of a row, 0 when it is null or missing (sums of nothing). */
export const num = (row: Row | undefined, key: string): number => Number(row?.[key] ?? 0);

/**
 * A paid order: not copied from another store, not a host's (the store earns a commission there, not the sale), with a
 * captured payment. Cancelled orders that were paid still count; their refund is subtracted as a refund.
 */
export const PAID = sql`(o.copied_from is null and o.host_id is null and exists (select 1 from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id and p.status = 'captured'))`;

/**
 * Backordered units a paid order still waits for (D172): the line of `ol` on an order `o` that is paid and not yet sent (status `paid`), not copied from
 * another store, with units on backorder. The one definition of "owed" (docs/analytics.md): the Inventory page of the admin, this page's analysis and the
 * control center all sum `ol.backorder_quantity` where this holds, and a test holds them equal.
 */
export const OWED_LINE = sql`(o.status = 'paid' and o.copied_from is null and ol.backorder_quantity > 0)`;

/** Revenue of an order without VAT: goods after discounts plus shipping income. */
export const REVENUE_EX_VAT = sql`(o.total_minor - o.tax_minor)`;

/** An amount that includes VAT at `rate` (a fraction such as 0.25) without it, rounded the way line sums are. */
export const exVat = (amount: SQL, rate: SQL): SQL => sql`round((${amount})::numeric / (1 + ${rate}))`;

/**
 * An order whose person was erased (restricted for the bookkeeping duty, or anonymised, D162) belongs to nobody: it still counts in revenue, VAT and
 * refunds, but as its own anonymous customer, never joined to the person's other orders (an anonymised order's email is a marker, not an address).
 */
export const GONE = sql`(o.restricted_at is not null or o.anonymised_at is not null)`;
/** Joins the account behind an order, if any; `lower(coalesce(c.email, o.email))` is the customer key (an erased person's order is `order:{id}`). */
export const CUSTOMER_JOIN = sql`left join commerce.customers c on c.store_id = o.store_id and c.id = o.customer_id`;
export const CUSTOMER_KEY = sql`(case when ${GONE} then 'order:' || o.id::text else lower(coalesce(c.email, o.email)) end)`;
/** Orders with no key (unpaid ones whose email was never filled in) are not customers. */
export const HAS_CUSTOMER = sql`(${GONE} or coalesce(c.email, o.email) <> '')`;

/** Midnight at the start of `day` ('YYYY-MM-DD') in the store's time zone, as a timestamptz. */
export const dayStart = (store: Store, day: string): SQL => sql`((${day}::date)::timestamp at time zone ${store.timeZone})`;

/** `col` (a timestamptz) falls in the period, days being the store's. */
export const inPeriod = (store: Store, col: SQL, period: Pick<AnalyticsPeriod, "from" | "to">): SQL =>
  sql`(${col} >= ${dayStart(store, period.from)} and ${col} < ${dayStart(store, period.to)})`;

/** The store's calendar day of a timestamptz. */
export const dayOf = (store: Store, col: SQL): SQL => sql`((${col} at time zone ${store.timeZone})::date)`;

/** A day's key as 'YYYY-MM-DD' out of a row value (the driver may give a Date or a string). */
export function dayKey(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

export type ByCurrency = { currency: string; [field: string]: unknown };

/**
 * Rows grouped by currency, summed in the main currency at today's rates (`toMain()`): each named field is converted
 * and added. A currency with no rate is left out of the sums and counted, so the page can say so rather than
 * understate a total silently.
 */
export function inMain(store: Store, rows: readonly ByCurrency[], fields: readonly string[]): { values: Record<string, number>; unconverted: number; missing: string[] } {
  const main = mainCurrency(store);
  const rates = store.localization.rates;
  const values: Record<string, number> = {};
  const missing = new Set<string>();
  let unconverted = 0;
  for (const field of fields) {
    const sum = toMain(
      rows.map((r) => ({ currency: String(r.currency).trim(), minor: Number(r[field] ?? 0) })),
      main,
      rates,
    );
    values[field] = sum.minor;
    for (const m of sum.missing) missing.add(m);
    unconverted = Math.max(unconverted, sum.unconverted);
  }
  return { values, unconverted, missing: [...missing] };
}

/** One currency's amount in the main currency, or null when it has no rate (for one value at a time, such as a bucket's). */
export function toMainOne(store: Store, currency: string, minor: number): number | null {
  const sum = toMain([{ currency: currency.trim(), minor }], mainCurrency(store), store.localization.rates);
  return sum.unconverted > 0 ? null : sum.minor;
}
