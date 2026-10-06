import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { Market } from "@/lib/markets";
import { toMarket } from "@/lib/markets";

import type { Membership } from "./auth";
import { completeOrderPayment, placeOrder, type PlacedOrder } from "./checkout";
import { storeOf } from "./product-data";

type Row = Record<string, unknown>;

/**
 * What the stock tests share (wave 3, D172): a store copied from the seeded template, its owner, carts made straight in the database, orders placed by
 * `placeOrder()` and paid as a Checkout session leaves them, and plain reads of the levels. A test file that uses this mocks `./stripe` itself when it
 * refunds. Never imported by the app.
 */

export const no: Market = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });

export type TestStore = { storeId: string; slug: string; accountId: string; accountEmail: string; account: string; member: Membership };

/** A store copied from the template (demo catalogue, stock, shipping), with an owner and a test Stripe account for refunds. */
export async function newStore(label: string): Promise<TestStore> {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const slug = `${label}-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [made] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  const storeId = String(made.id);
  const account = `acct_${slug.replace(/[^A-Za-z0-9]/g, "")}`;
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${account}, 'active', false)
  `);
  const [owner] = await db().execute<Row>(sql`
    select a.id, a.email, a.name from commerce.store_members m join commerce.accounts a on a.id = m.account_id
    where m.store_id = ${storeId}::uuid and m.role = 'owner' limit 1
  `);
  const store = await storeOf(storeId);
  if (!store) throw new Error("the test store was not made");
  const member: Membership = {
    account: { id: String(owner.id), email: String(owner.email), name: owner.name ? String(owner.name) : null, platformAdmin: false } as Membership["account"],
    role: "owner",
    store,
  };
  return { storeId, slug, accountId: String(owner.id), accountEmail: String(owner.email), account, member };
}

export async function variantId(storeId: string, sku: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}`);
  if (!row) throw new Error(`no variant ${sku}`);
  return String(row.id);
}

export async function mainLocation(storeId: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    select id from commerce.inventory_locations where store_id = ${storeId}::uuid and active order by priority, created_at, id limit 1
  `);
  return String(row.id);
}

/** A second (third ...) location; `priority` ranks it (a lower number is taken from first). */
export async function addLocation(storeId: string, name: string, priority: number): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.inventory_locations (store_id, name, country, priority) values (${storeId}::uuid, ${name}, 'NO', ${priority}) returning id
  `);
  return String(row.id);
}

/** Sets a level as the database sees any writer (no stock context: recorded as `system`). */
export async function setLevel(storeId: string, sku: string, locationId: string, onHand: number): Promise<void> {
  await db().execute(sql`
    insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
    values (${storeId}::uuid, ${await variantId(storeId, sku)}::uuid, ${locationId}::uuid, ${onHand})
    on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()
  `);
}

/** Puts every level of a variant to zero (so a test starts from the figures it sets). */
export async function clearLevels(storeId: string, sku: string): Promise<void> {
  await db().execute(sql`
    update commerce.inventory_levels set on_hand = 0 where store_id = ${storeId}::uuid and variant_id = ${await variantId(storeId, sku)}::uuid
  `);
}

/** The level at each location by the location's name. */
export async function levelsOf(storeId: string, sku: string): Promise<Record<string, number>> {
  const rows = await db().execute<Row>(sql`
    select loc.name, l.on_hand from commerce.inventory_levels l
    join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id
    where l.store_id = ${storeId}::uuid and l.variant_id = ${await variantId(storeId, sku)}::uuid
  `);
  return Object.fromEntries(rows.map((r) => [String(r.name), Number(r.on_hand)]));
}

export async function totalOnHand(storeId: string, sku: string): Promise<number> {
  return Object.values(await levelsOf(storeId, sku)).reduce((a, b) => a + b, 0);
}

/** The live holds at each location by the location's name. */
export async function holdsOf(storeId: string, sku: string): Promise<Record<string, number>> {
  const rows = await db().execute<Row>(sql`
    select loc.name, sum(r.quantity)::int as held from commerce.inventory_reservations r
    join commerce.inventory_locations loc on loc.store_id = r.store_id and loc.id = r.location_id
    where r.store_id = ${storeId}::uuid and r.variant_id = ${await variantId(storeId, sku)}::uuid and r.released_at is null and r.expires_at > now()
    group by loc.name
  `);
  return Object.fromEntries(rows.map((r) => [String(r.name), Number(r.held)]));
}

/** A cart in the database with these lines (SKU, quantity). */
export async function cartOf(storeId: string, lines: [string, number][], market: Market = no): Promise<string> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day') returning id
  `);
  for (const [sku, quantity] of lines) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      values (${storeId}::uuid, ${String(cart.id)}::uuid, ${await variantId(storeId, sku)}::uuid, ${quantity})
    `);
  }
  return String(cart.id);
}

/** Places an order from a cart of these lines; throws the problem when it is refused. */
export async function place(storeId: string, lines: [string, number][], market: Market = no, options: { noBackorder?: boolean } = {}): Promise<PlacedOrder> {
  const result = await placeOrder({ storeId, market }, await cartOf(storeId, lines, market), {}, options);
  if (!result.ok) throw new Error(result.problem);
  return result.order;
}

/** Pays an order as a Checkout session leaves it: a captured payment on the store's account, then `complete_order_payment()`. */
export async function pay(storeId: string, order: PlacedOrder, account: string): Promise<void> {
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${storeId}::uuid, ${order.orderId}::uuid, 'stripe', ${`cs_${order.orderId}`}, ${account}, ${order.totalMinor}, ${order.currency}, 'captured')
  `);
  await completeOrderPayment(order.orderId, `cs_${order.orderId}`);
  await db().execute(sql`
    update commerce.orders set email = 'kari@example.com',
      shipping_address = '{"name": "Kari Nordmann", "line1": "Storgata 1", "postalCode": "0155", "city": "Oslo"}'
    where id = ${order.orderId}::uuid
  `);
}

/** The movements of a variant, oldest first. */
export async function movementsOf(storeId: string, sku: string): Promise<{ location: string; delta: number; after: number; reason: string; source: string; orderId: string | null; returnId: string | null; jobId: string | null; actor: string | null; note: string | null }[]> {
  const rows = await db().execute<Row>(sql`
    select loc.name as location, m.delta, m.on_hand_after, m.reason, m.source, m.order_id, m.return_id, m.job_id, m.actor_account_id, m.note
    from commerce.inventory_movements m join commerce.inventory_locations loc on loc.store_id = m.store_id and loc.id = m.location_id
    where m.store_id = ${storeId}::uuid and m.variant_id = ${await variantId(storeId, sku)}::uuid order by m.id
  `);
  return rows.map((r) => ({
    location: String(r.location),
    delta: Number(r.delta),
    after: Number(r.on_hand_after),
    reason: String(r.reason),
    source: String(r.source),
    orderId: r.order_id ? String(r.order_id) : null,
    returnId: r.return_id ? String(r.return_id) : null,
    jobId: r.job_id ? String(r.job_id) : null,
    actor: r.actor_account_id ? String(r.actor_account_id) : null,
    note: r.note ? String(r.note) : null,
  }));
}

/** The movements add up to every level of the store (`inventory_ledger_check()` is empty). */
export async function ledgerIsWhole(storeId: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`select * from commerce.inventory_ledger_check(${storeId}::uuid)`);
  return rows.length === 0;
}
