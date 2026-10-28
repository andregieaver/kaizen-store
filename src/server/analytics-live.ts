import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { addDays, presetPeriod, todayIn } from "@/lib/analytics-period";
import { CHECKOUT_MINUTES } from "@/lib/checkout";
import { mainCurrency } from "@/lib/markets";

import { periodTotals } from "./analytics-totals";
import { num, type Row } from "./analytics-sql";
import type { Store } from "./stores";

/**
 * What is happening in the store now (wave 8 unit C, D347, docs/analytics.md *Live*), read again by the Live page every 10 seconds while
 * it is open. Nothing is kept: every figure is counted from the rows as they are.
 *
 * - **Visitors now**: visitor-days (`commerce.visits`) with a page view in the last `ACTIVE_MINUTES`, so only while the store counts
 *   visits (null otherwise: not zero), and by country (`visits.market_code`; a visit keeps no place finer than that).
 * - **Today so far**: the store's day, from its midnight: the visits counted and, from the orders, D152's paid orders and revenue
 *   (`periodTotals()` for `today`: without VAT, in the main currency, a currency with no rate left out and counted).
 * - **Carts in use**: open carts with something in them that changed in the last `CART_MINUTES` (`carts.updated_at` moves with every change).
 * - **Checkouts in progress**: orders from a shopper's checkout waiting for payment, placed in the last `CHECKOUT_MINUTES` (the time a
 *   checkout stays open, as `getOpenCheckout()` reads it).
 */

export const ACTIVE_MINUTES = 5;
export const CART_MINUTES = 30;
/** How often the page reads again, in milliseconds (decision 2 of wave 8: polling, not a socket). */
export const LIVE_REFRESH_MS = 10_000;

export type LiveFigures = {
  /** When the figures were read (ISO 8601). */
  at: string;
  /** The store's day the "today" figures are for (`YYYY-MM-DD`). */
  today: string;
  currency: string;
  /** Whether the store counts visits; without it the visitor figures are null. */
  counting: boolean;
  visitorsNow: number | null;
  /** Visitors now by country, most first; empty without counting. */
  byCountry: { code: string; visitors: number }[];
  visitsToday: number | null;
  ordersToday: number;
  revenueTodayMinor: number;
  /** Paid orders today left out of the revenue for want of a rate, and their currencies. */
  unconverted: number;
  missingCurrencies: string[];
  cartsInUse: number;
  checkoutsInProgress: number;
};

export async function liveFigures(store: Store, now: Date = new Date()): Promise<LiveFigures> {
  const today = todayIn(now, store.timeZone);
  const at = now.toISOString();
  const counting = store.visitCounting;
  // A visitor's row is for the store's day; one seen in the last minutes is today's or, just after midnight, yesterday's.
  const days = sql`v.day between ${addDays(today, -1)}::date and ${today}::date`;
  const [visits, byCountry, activity, totals] = await Promise.all([
    counting
      ? db().execute<Row>(sql`
          select count(*) filter (where v.last_seen > ${at}::timestamptz - make_interval(mins => ${ACTIVE_MINUTES})) as now,
            count(*) filter (where v.day = ${today}::date) as today
          from commerce.visits v
          where v.store_id = ${store.id}::uuid and ${days}
        `)
      : Promise.resolve([] as Row[]),
    counting
      ? db().execute<Row>(sql`
          select coalesce(v.market_code::text, '') as code, count(*) as visitors
          from commerce.visits v
          where v.store_id = ${store.id}::uuid and ${days} and v.last_seen > ${at}::timestamptz - make_interval(mins => ${ACTIVE_MINUTES})
          group by 1
          order by count(*) desc, 1
        `)
      : Promise.resolve([] as Row[]),
    db().execute<Row>(sql`
      select
        (select count(*) from commerce.carts c
          where c.store_id = ${store.id}::uuid and c.status = 'open' and c.expires_at > ${at}::timestamptz
            and c.updated_at > ${at}::timestamptz - make_interval(mins => ${CART_MINUTES})
            and exists (select 1 from commerce.cart_lines cl where cl.store_id = c.store_id and cl.cart_id = c.id)) as carts,
        (select count(*) from commerce.orders o
          where o.store_id = ${store.id}::uuid and o.status = 'pending_payment' and o.source = 'checkout' and o.copied_from is null
            and o.placed_at > ${at}::timestamptz - make_interval(mins => ${CHECKOUT_MINUTES})) as checkouts
    `),
    periodTotals(store, presetPeriod("today", today)),
  ]);
  return {
    at,
    today,
    currency: mainCurrency(store),
    counting,
    visitorsNow: counting ? num(visits[0], "now") : null,
    byCountry: byCountry.map((r) => ({ code: String(r.code), visitors: num(r, "visitors") })),
    visitsToday: counting ? num(visits[0], "today") : null,
    ordersToday: totals.totals.orders,
    revenueTodayMinor: totals.totals.revenueMinor,
    unconverted: totals.unconverted,
    missingCurrencies: totals.missingCurrencies,
    cartsInUse: num(activity[0], "carts"),
    checkoutsInProgress: num(activity[0], "checkouts"),
  };
}
