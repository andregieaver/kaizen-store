import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { Market } from "@/lib/markets";

import { completeOrderPayment, placeOrder } from "./checkout";
import { chooseDelivery, setDeliveryPostalCode } from "./delivery-options";
import { NO, readOrder, type FxOrder, type FxStore } from "./fulfilment-test-fixture";

type Row = Record<string, unknown>;

/**
 * What the integration tests of shipping methods, pickup and local delivery share (D237): a place of the store, a cart with a delivery postal code and a
 * choice, and an order placed from it by the checkout's own `placeOrder()` and paid through `complete_order_payment()`. A test file that uses this mocks
 * `server-only`, `next/cache`, `next/headers` and `./stripe` itself. Never imported by the app.
 */

/** A place of the store (D40) in a country, with opening hours and, when given, a position. */
export async function placeOf(
  store: FxStore,
  options: { kind?: "shop" | "pickup" | "office"; name?: string; country?: string; postalCode?: string; city?: string; position?: { lat: number; lon: number } | null } = {},
): Promise<string> {
  const hours = { week: { mon: { open: "09:00", close: "17:00" }, tue: { open: "09:00", close: "17:00" }, wed: { open: "09:00", close: "17:00" }, thu: { open: "09:00", close: "17:00" }, fri: { open: "09:00", close: "17:00" }, sat: { open: "10:00", close: "14:00" }, sun: null }, exceptions: [] };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.store_locations (store_id, kind, name, street, postal_code, city, country, hours, latitude, longitude)
    values (${store.storeId}::uuid, ${options.kind ?? "shop"}, ${options.name ?? "Butikken Grünerløkka"}, 'Thorvald Meyers gate 1', ${options.postalCode ?? "0555"},
            ${options.city ?? "Oslo"}, ${options.country ?? "NO"}, ${JSON.stringify(hours)}::jsonb,
            ${options.position?.lat ?? null}::numeric, ${options.position?.lon ?? null}::numeric)
    ${options.kind === "office" ? sql`on conflict (store_id) where kind = 'office' do update set name = excluded.name` : sql``}
    returning id
  `);
  return String(row.id);
}

/** A new open cart in the market's view holding the SKUs. */
export async function cartOf(store: FxStore, items: [string, number][], market: Market = NO): Promise<string> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${store.storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day') returning id
  `);
  for (const [sku, quantity] of items) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${store.storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${sku}
    `);
  }
  return String(cart.id);
}

/**
 * An order placed from a cart with a delivery postal code and a choice (`method:{id}`, `pickup:{id}`, `local:{id}`, or none for the default), paid through
 * Stripe (a captured payment) and completed. `paid: false` leaves it waiting for payment.
 */
export async function deliveryOrder(
  store: FxStore,
  items: [string, number][],
  options: { market?: Market; postalCode?: string; choose?: string; note?: string; email?: string; paid?: boolean; locale?: string } = {},
): Promise<FxOrder & { cartId: string }> {
  const market = options.market ?? NO;
  const cartId = await cartOf(store, items, market);
  const shop = { storeId: store.storeId, market };
  if (options.postalCode) {
    const set = await setDeliveryPostalCode(shop, cartId, options.postalCode);
    if (!set.ok) throw new Error(`postal code ${set.problem}`);
  }
  if (options.choose) {
    const chosen = await chooseDelivery(shop, cartId, options.choose, undefined, { note: options.note });
    if (!chosen.ok) throw new Error(`choose ${options.choose}: ${chosen.problem}`);
  }
  const placed = await placeOrder(shop, cartId, {}, { customerId: null });
  if (!placed.ok) throw new Error(placed.problem);
  const { orderId } = placed.order;
  if (options.locale) await db().execute(sql`update commerce.orders set locale = ${options.locale} where id = ${orderId}::uuid`);
  const email = options.email ?? `buyer-${orderId.slice(0, 8)}@example.com`;
  if (options.paid !== false) {
    const [o] = await db().execute<Row>(sql`select total_minor, currency from commerce.orders where id = ${orderId}::uuid`);
    const reference = `cs_${orderId}`;
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${store.storeId}::uuid, ${orderId}::uuid, 'stripe', ${reference}, ${store.stripeAccount}, ${Number(o.total_minor)}, ${String(o.currency).trim()}, 'captured')
    `);
    await completeOrderPayment(orderId, reference);
  }
  await db().execute(sql`update commerce.orders set email = ${email} where id = ${orderId}::uuid`);
  return { ...(await readOrder(store, orderId, email)), cartId };
}

/** The order's delivery columns. */
export async function deliveryOf(orderId: string): Promise<Row> {
  const [row] = await db().execute<Row>(sql`
    select delivery_method, pickup_location_id, delivery, delivery_note, ready_for_pickup_at, delivered_at, status, shipping_minor, standard_shipping_minor,
      delivery_mismatch_at, shipping_address
    from commerce.orders where id = ${orderId}::uuid
  `);
  return row;
}
