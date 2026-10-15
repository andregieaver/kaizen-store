import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { completeOrderPayment, cancelUnpaidOrder, placeOrder } = await import("./checkout");
const { fxStore, NO } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

afterAll(async () => {
  await closeDb();
});

/**
 * Review (money lens): commerce.complete_order_payment() accepts an order that was cancelled for want of payment (the checkout's hold ran out, then
 * Stripe's session completed). The order is paid and the money is taken, so it is a paid order like any other: staff must be told and the rules must run.
 */
describe("an order paid after it was cancelled", () => {
  it("queues its order.paid store event", async () => {
    const fx = await fxStore("paid-after-cancel");
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
      values (${fx.storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
    `);
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${fx.storeId}::uuid, ${String(cart.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${fx.storeId}::uuid and sku = 'DEMO-TOTE'
    `);
    const placed = await placeOrder({ storeId: fx.storeId, market: NO }, String(cart.id), {}, { customerId: null });
    if (!placed.ok) throw new Error(placed.problem);
    const orderId = placed.order.orderId;
    expect(await cancelUnpaidOrder(orderId, "expired")).toBe(true);
    expect(await completeOrderPayment(orderId, `cs_${orderId}`)).toBe(true);
    const [order] = await db().execute<Row>(sql`select status::text as status from commerce.orders where id = ${orderId}::uuid`);
    expect(order.status).toBe("paid");
    const events = await db().execute<Row>(sql`select event from commerce.store_events where store_id = ${fx.storeId}::uuid and subject_id = ${orderId}::uuid`);
    expect(events.map((e) => e.event)).toEqual(["order.paid"]);
  });
});
