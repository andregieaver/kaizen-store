import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { safeRatio } from "@/lib/analytics-core";
import type { AnalyticsPeriod } from "@/lib/analytics-period";
import { canConvert } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { CUSTOMER_JOIN, CUSTOMER_KEY, dayStart, HAS_CUSTOMER, inMain, inPeriod, num, PAID, type Row } from "./analytics-sql";
import { setBased } from "./analytics-totals";
import type { Store } from "./stores";

/**
 * Sales by country and city for the Traffic page's geography (D152, docs/analytics.md).
 *
 * How it is read:
 *
 * - Paid orders (`PAID`), by `placed_at` in the store's days. Revenue is `total_minor - tax_minor` (without VAT), grouped by
 *   currency in SQL and converted here at today's rates; orders in a currency with no rate are left out of every figure and
 *   counted (`unconverted`).
 * - A country is the order's `market_code`: the market the shopper bought in (what the cart was made for), named from the
 *   `countries` table. A city is read from the address the order was delivered to (`shipping_address`, copied from Stripe
 *   Checkout by `applySession()`: `city`, `postalCode`, `country`), grouped by country and the city's lower-cased, trimmed,
 *   single-spaced name, shown the way most orders spelt it. An order with no city (a digital order that took no address, or one
 *   whose address was never copied) is counted under "No address".
 * - A new customer is counted in the market of their first paid order (as `periodTotals()` counts them: first order in the
 *   period, by the customer key), so the markets' new customers add up to the Overview's figure.
 * - Conversion per country needs visits by market and is not known here: `sessions` and `conversion` are null on every row
 *   for the Traffic page to fill in.
 * - Nothing here reads more than one row per country and currency, plus the best `CITY_READ_CAP` cities per currency.
 */

/** The cities shown. */
export const CITY_LIMIT = 15;
/** Cities read per currency (by revenue); `truncated` says when a currency had more. */
export const CITY_READ_CAP = 500;
export const NO_ADDRESS_LABEL = "No address";

export type GeoCountryRow = {
  /** The market's country code, upper case: `NO`. */
  code: string;
  /** From the `countries` table; the code when it is not there. */
  name: string;
  orders: number;
  /** Without VAT, minor units of the main currency. */
  revenueMinor: number;
  /** Revenue / orders, rounded; null without orders. */
  aovMinor: number | null;
  /** Customers whose first paid order is in the period and was placed in this market. */
  newCustomers: number;
  /** Share of the period's revenue (0..1); null without revenue. */
  shareOfRevenue: number | null;
  /** Visits from this market: not known here (the traffic report adds them), always null. */
  sessions: number | null;
  /** Orders / sessions: always null here, as above. */
  conversion: number | null;
};

export type GeoCityRow = {
  /** The grouping key: `{country}|{lower-cased, trimmed, single-spaced city}`. */
  key: string;
  /** The city as most of its orders spelt it. */
  city: string;
  /** The delivery address's country code (the market's when the address had none). */
  country: string;
  countryName: string;
  orders: number;
  revenueMinor: number;
  aovMinor: number | null;
  shareOfRevenue: number | null;
};

export type GeoReport = {
  /** The main currency of every amount. */
  currency: string;
  period: { from: string; to: string; days: number };
  /** The period's own figures (the markets' sum). */
  totals: { orders: number; revenueMinor: number; aovMinor: number | null; newCustomers: number };
  /** Ranked by revenue. */
  countries: GeoCountryRow[];
  /** The best `CITY_LIMIT` cities by revenue. */
  cities: GeoCityRow[];
  /** Cities with an address that are not in `cities`: orders and revenue, and how many cities (a lower bound when `truncated`). */
  otherCities: { cities: number; orders: number; revenueMinor: number };
  /** Orders with no city in their address (digital orders and the like): "No address". */
  noAddress: { label: string; orders: number; revenueMinor: number; shareOfRevenue: number | null };
  /** Orders and currencies left out because the currency has no rate. */
  unconverted: number;
  missingCurrencies: string[];
  /** A currency had more cities than `CITY_READ_CAP`: the smallest cities were not read, so `otherCities` is a little low. */
  truncated: boolean;
};

/** The currencies the store can convert into its main currency. */
function convertibleCurrencies(store: Store): Set<string> {
  const main = mainCurrency(store).trim();
  const rates = store.localization.rates;
  const list = new Set<string>([main]);
  for (const currency of rates.keys()) if (canConvert(currency, main, rates)) list.add(currency.trim());
  return list;
}

const asCurrency = (r: Row) => ({ ...r, currency: String(r.currency).trim() });

/** What an address's city is for grouping: lower case, trimmed, runs of spaces as one. */
const CITY_KEY = sql`regexp_replace(lower(btrim(o.shipping_address ->> 'city')), '[[:space:]]+', ' ', 'g')`;
const HAS_CITY = sql`nullif(btrim(o.shipping_address ->> 'city'), '') is not null`;

export async function geoReport(store: Store, period: Pick<AnalyticsPeriod, "from" | "to" | "days">): Promise<GeoReport> {
  const id = store.id;
  const convertible = convertibleCurrencies(store);
  const known = `{${[...convertible].join(",")}}`;
  const inRange = inPeriod(store, sql`o.placed_at`, period);

  const [marketRows, freshRows, cityRows, addressRows] = await Promise.all([
    // Orders and revenue per market and currency.
    setBased<Row>(sql`
      select o.market_code::text as market, o.currency::text as currency, count(*) as orders, sum(o.total_minor - o.tax_minor) as revenue
      from commerce.orders o
      where o.store_id = ${id}::uuid and ${PAID} and ${inRange}
      group by 1, 2
    `),
    // New customers by the market of their first paid order (the same customers as the Overview counts: first paid order in the
    // period, with an order in the period in a currency that can be converted). One pass over the store's paid orders up to the
    // period's end finds the customer keys that qualify (a grouped minimum, no sorting); only their first orders are then looked at.
    setBased<Row>(sql`
      with ko as materialized (
        select ${CUSTOMER_KEY} as k, o.placed_at, o.id, o.market_code::text as market, (o.currency = any(${known}::char(3)[])) as ok
        from commerce.orders o ${CUSTOMER_JOIN}
        where o.store_id = ${id}::uuid and ${PAID} and ${HAS_CUSTOMER} and o.placed_at < ${dayStart(store, period.to)}
      ),
      q as (
        select k, min(placed_at) as first_at
        from ko
        group by k
        having min(placed_at) >= ${dayStart(store, period.from)} and bool_or(placed_at >= ${dayStart(store, period.from)} and ok)
      )
      select m.market, count(*) as fresh
      from (
        select distinct on (q.k) q.k, ko.market
        from q join ko on ko.k = q.k and ko.placed_at = q.first_at
        order by q.k, ko.placed_at, ko.id
      ) m
      group by 1
    `),
    // Cities, per currency, the best by revenue (revenue of that currency).
    setBased<Row>(sql`
      with g as (
        select o.currency::text as currency,
          coalesce(nullif(upper(btrim(o.shipping_address ->> 'country')), ''), o.market_code::text) as country,
          ${CITY_KEY} as ckey,
          mode() within group (order by btrim(o.shipping_address ->> 'city')) as city,
          count(*) as orders, sum(o.total_minor - o.tax_minor) as revenue
        from commerce.orders o
        where o.store_id = ${id}::uuid and ${PAID} and ${inRange} and ${HAS_CITY} and o.currency = any(${known}::char(3)[])
        group by 1, 2, 3
      ),
      ranked as (
        select g.*, count(*) over (partition by currency) as n, row_number() over (partition by currency order by revenue desc, country, ckey) as rn
        from g
      )
      select currency, country, ckey, city, orders, revenue, n from ranked where rn <= ${CITY_READ_CAP}
    `),
    // Orders with no city.
    setBased<Row>(sql`
      select o.currency::text as currency, count(*) as orders, sum(o.total_minor - o.tax_minor) as revenue
      from commerce.orders o
      where o.store_id = ${id}::uuid and ${PAID} and ${inRange} and not (${HAS_CITY})
      group by 1
    `),
  ]);

  const usable = marketRows.filter((r) => convertible.has(String(r.currency).trim()));
  const left = marketRows.filter((r) => !convertible.has(String(r.currency).trim()));

  // Country by country.
  const byMarket = new Map<string, Row[]>();
  for (const r of usable) byMarket.set(String(r.market), [...(byMarket.get(String(r.market)) ?? []), r]);
  const fresh = new Map(freshRows.map((r) => [String(r.market), num(r, "fresh")]));
  const marketRevenue = new Map<string, { orders: number; revenue: number }>();
  for (const [market, group] of byMarket) {
    marketRevenue.set(market, {
      orders: group.reduce((s, r) => s + num(r, "orders"), 0),
      revenue: inMain(store, group.map(asCurrency), ["revenue"]).values.revenue,
    });
  }
  const totalOrders = [...marketRevenue.values()].reduce((s, m) => s + m.orders, 0);
  const totalRevenue = [...marketRevenue.values()].reduce((s, m) => s + m.revenue, 0);

  // Cities merged across currencies.
  let truncated = false;
  const cityGroups = new Map<string, { country: string; ckey: string; rows: Row[] }>();
  for (const r of cityRows) {
    if (num(r, "n") > CITY_READ_CAP) truncated = true;
    const key = `${String(r.country)}|${String(r.ckey)}`;
    const entry = cityGroups.get(key) ?? { country: String(r.country), ckey: String(r.ckey), rows: [] };
    entry.rows.push(r);
    cityGroups.set(key, entry);
  }
  const merged = [...cityGroups.entries()].map(([key, g]) => {
    const best = g.rows.reduce((a, b) => (num(b, "orders") > num(a, "orders") ? b : a));
    return {
      key,
      city: String(best.city),
      country: g.country,
      orders: g.rows.reduce((s, r) => s + num(r, "orders"), 0),
      revenue: inMain(store, g.rows.map(asCurrency), ["revenue"]).values.revenue,
    };
  });
  merged.sort((a, b) => b.revenue - a.revenue || b.orders - a.orders || a.key.localeCompare(b.key));
  const top = merged.slice(0, CITY_LIMIT);

  const noAddressUsable = addressRows.filter((r) => convertible.has(String(r.currency).trim()));
  const noAddress = {
    orders: noAddressUsable.reduce((s, r) => s + num(r, "orders"), 0),
    revenue: inMain(store, noAddressUsable.map(asCurrency), ["revenue"]).values.revenue,
  };

  // Names of the countries seen, one read.
  const codes = [...new Set([...marketRevenue.keys(), ...top.map((c) => c.country)])];
  const names = new Map<string, string>();
  if (codes.length > 0) {
    const rows = await db().execute<Row>(sql`select code::text as code, name from commerce.countries where code::text = any(${`{${codes.join(",")}}`}::text[])`);
    for (const r of rows) names.set(String(r.code).trim(), String(r.name));
  }
  const nameOf = (code: string) => names.get(code) ?? code;

  const countries: GeoCountryRow[] = [...marketRevenue.entries()]
    .map(([code, m]) => ({
      code,
      name: nameOf(code),
      orders: m.orders,
      revenueMinor: m.revenue,
      aovMinor: aov(m.revenue, m.orders),
      newCustomers: fresh.get(code) ?? 0,
      shareOfRevenue: safeRatio(m.revenue, totalRevenue),
      sessions: null,
      conversion: null,
    }))
    .sort((a, b) => b.revenueMinor - a.revenueMinor || b.orders - a.orders || a.code.localeCompare(b.code));

  const cities: GeoCityRow[] = top.map((c) => ({
    key: c.key,
    city: c.city,
    country: c.country,
    countryName: nameOf(c.country),
    orders: c.orders,
    revenueMinor: c.revenue,
    aovMinor: aov(c.revenue, c.orders),
    shareOfRevenue: safeRatio(c.revenue, totalRevenue),
  }));

  // Whatever has an address and is not among the top cities: from the exact totals, so cut-off cities are still in it.
  const topOrders = top.reduce((s, c) => s + c.orders, 0);
  const topRevenue = top.reduce((s, c) => s + c.revenue, 0);

  return {
    currency: mainCurrency(store),
    period: { from: period.from, to: period.to, days: period.days },
    totals: {
      orders: totalOrders,
      revenueMinor: totalRevenue,
      aovMinor: aov(totalRevenue, totalOrders),
      newCustomers: countries.reduce((s, c) => s + c.newCustomers, 0),
    },
    countries,
    cities,
    otherCities: {
      cities: Math.max(0, merged.length - top.length),
      orders: Math.max(0, totalOrders - noAddress.orders - topOrders),
      revenueMinor: Math.max(0, totalRevenue - noAddress.revenue - topRevenue),
    },
    noAddress: { label: NO_ADDRESS_LABEL, orders: noAddress.orders, revenueMinor: noAddress.revenue, shareOfRevenue: safeRatio(noAddress.revenue, totalRevenue) },
    unconverted: left.reduce((s, r) => s + num(r, "orders"), 0),
    missingCurrencies: [...new Set(left.map((r) => String(r.currency).trim()))].sort(),
    truncated,
  };
}

function aov(revenue: number, orders: number): number | null {
  const mean = safeRatio(revenue, orders);
  return mean === null ? null : Math.round(mean);
}
