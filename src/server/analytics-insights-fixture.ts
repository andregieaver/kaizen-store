import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { addDays, todayIn } from "@/lib/analytics-period";

import { getStore, type Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Stores built by hand for the insights' integration tests (D152): the alerts, the forecast and the diagnosis (`analytics-insights`) and
 * the AI manager's analytics tools (`analytics-tools`) are tried against the same busy store. Tests only: nothing in the app imports it.
 *
 * The moment is fixed, Wednesday 14 October 2026, 14:00 in Oslo (so 58 % of the day has passed), and the busy store is built around it:
 *
 *   Visits   from 60 days before today: 60 a day to 8 days before today, 110 a day in the 7 days before today, 20 today.
 *   Orders   2 a day in the 28 days up to 8 days before today (56), then 1 on each of 4 of the last 7 days: conversion 3.3 % over the
 *            four weeks, 4 of 770 visits (0.5 %) over the last week.
 *   Mugs     24 orders of one mug (before the last 14 days, none refunded) and 8 in the 14 days before today, 3 of those refunded in full:
 *            3 of 8 units against none before, and the mug is out of stock while it sells.
 *
 * A quiet store has nothing at all; a steady one has an order a day for 60 days and no visit counting.
 */

export const NOW = new Date("2026-10-14T12:00:00Z");

const run = Date.now().toString(36);
let serial = 0;

/** A store of its own, made the way an approved request makes one (so with the demo catalogue), with visit counting on or off. */
export async function makeStore(name: string, visitCounting: boolean): Promise<Store> {
  const slug = `${name}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null)`);
  if (visitCounting) await db().execute(sql`update commerce.stores set visit_counting = true where slug = ${slug}`);
  // A new store starts with the shop alone (D178): Subscriptions on, so its subscriptions page and files are there to read, and the template's
  // countries. Denmark is its own country, as the figures below were written for (a store with no country of its own took the first of the
  // template's countries by code until new stores kept the template's order).
  await db().execute(sql`update commerce.stores set features = features || array['subscriptions', 'countries'], country = 'DK' where slug = ${slug}`);
  return (await getStore(slug)) as Store;
}

/** The store's today at the fixed moment. */
export const todayOf = (store: Store): string => todayIn(NOW, store.timeZone);

/** `offset` days from the store's today at `hour` o'clock, as the database reads it (Oslo's summer time). */
export const at = (store: Store, offset: number, hour = 10): string => `${addDays(todayOf(store), offset)}T${String(hour).padStart(2, "0")}:00:00+02:00`;

/**
 * A paid order in the store's main currency: 100.00 with 25 % VAT, a line for the demo mug when asked (its cost not known), a captured
 * payment and, when asked, a refund of all of it made the day after.
 */
export async function placeTestOrder(store: Store, o: { at: string; mug?: boolean; refunded?: boolean }): Promise<void> {
  serial += 1;
  const total = 10_000;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at)
    values (${store.id}::uuid, ${`I-${run}-${serial}`}, 'NO', ${store.markets[0].currency}, 'nb-NO', ${`buyer${serial}@example.com`}, 'paid', ${total}, 0, 0, 2000, ${total},
      '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz)
    returning id
  `);
  const orderId = String(row.id);
  if (o.mug) {
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.id}::uuid and sku = 'DEMO-MUG-WHITE'`);
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${store.id}::uuid, ${orderId}::uuid, ${String(variant.id)}::uuid, 'DEMO-MUG-WHITE', 'Mug', 1, ${total}, 0, ${total}, 2000, 0.25, 'txcd_99999999', 'physical')
    `);
  }
  const [payment] = await db().execute<Row>(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
    values (${store.id}::uuid, ${orderId}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_insights', ${total}, 0, ${store.markets[0].currency}, 'captured')
    returning id
  `);
  if (o.refunded) {
    await db().execute(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, created_at)
      values (${store.id}::uuid, ${String(payment.id)}::uuid, ${total}, 'test', ${`re_${run}_${serial}`}, 'succeeded', ${addDays(o.at.slice(0, 10), 1)}::date + time '12:00')
    `);
  }
}

/** The busy store's orders, the mug's stock and its visits (see the top of this file); the store must have visit counting on. */
export async function seedBusyStore(store: Store): Promise<void> {
  const today = todayOf(store);
  // Four weeks of two orders a day, up to eight days before today, then four orders in the last seven days.
  for (let d = -35; d <= -8; d++) {
    await placeTestOrder(store, { at: at(store, d, 10) });
    await placeTestOrder(store, { at: at(store, d, 15) });
  }
  for (const d of [-6, -5, -3, -1]) await placeTestOrder(store, { at: at(store, d, 11) });
  // The mug: 24 orders before the last 14 days (none refunded), then 8 in the 14 days before today, 3 of them refunded in full.
  for (let i = 0; i < 24; i++) await placeTestOrder(store, { at: at(store, -100 + i * 3, 12), mug: true });
  for (let i = 0; i < 8; i++) await placeTestOrder(store, { at: at(store, -14 + i, 12), mug: true, refunded: i < 3 });
  // Out of stock while it sells.
  await db().execute(sql`
    update commerce.inventory_levels set on_hand = 0
    where store_id = ${store.id}::uuid and variant_id in (select id from commerce.product_variants where store_id = ${store.id}::uuid and sku = 'DEMO-MUG-WHITE')
  `);
  // Visits: 60 a day, 110 a day in the last week, 20 so far today.
  await db().execute(sql`
    insert into commerce.visits (store_id, day, visitor, device, channel, landing_path)
    select ${store.id}::uuid, d::date, substr(md5(d::text || g::text), 1, 24), 'desktop', 'direct', '/'
    from generate_series(${today}::date - 60, ${today}::date, interval '1 day') d
    cross join lateral generate_series(1, case when d::date >= ${today}::date then 20 when d::date >= ${today}::date - 7 then 110 else 60 end) g
  `);
}

/** A steady store: an order a day for the 60 days before today, nothing else. */
export async function seedSteadyStore(store: Store): Promise<void> {
  for (let d = -60; d <= -1; d++) await placeTestOrder(store, { at: at(store, d, 10) });
}
