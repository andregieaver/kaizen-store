import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

/**
 * Adversarial review of D153 (security, privacy, abuse). Each test states the property the contract asks for
 * (`docs/returns.md`: "a withdrawal must never email an address that is not the order's"); a failing one is a defect.
 */

const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [] } }) },
    refunds: { create: async () => ({ id: "re_x", status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const w = await import("./withdrawals");
const r = await import("./returns");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  const id = String(store.id);
  await db().execute(sql`update commerce.stores set contact_email = ${`butikk-${slug}@example.com`} where id = ${id}::uuid`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${id}::uuid`);
  return id;
}

beforeAll(async () => {
  storeId = await makeStore(`sec-${run}`);
});
afterAll(async () => {
  await closeDb();
});

async function paidOrder(email: string) {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${storeId}::uuid, ${String(cart.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE'
  `);
  const result = await placeOrder({ storeId, market: no }, String(cart.id), {}, { customerId: null });
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  const key = `venue_${run}_${orderId}`;
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${storeId}::uuid, ${orderId}::uuid, 'venue', ${key}, ${totalMinor}, 'NOK', 'captured')
  `);
  await completeOrderPayment(orderId, key);
  await db().execute(sql`update commerce.orders set email = ${email} where id = ${orderId}::uuid`);
  const [order] = await db().execute<Row>(sql`select number from commerce.orders where id = ${orderId}::uuid`);
  const lines = await db().execute<Row>(sql`select id, quantity from commerce.order_lines where order_id = ${orderId}::uuid`);
  return { orderId, key, number: String(order.number), lines: lines.map((l) => ({ lineId: String(l.id), quantity: Number(l.quantity) })) };
}

describe("a withdrawal never emails an address that is not the order's", () => {
  it("holding the order page's key does not let the shopper choose who is emailed", async () => {
    const owner = `owner-${run}@example.com`;
    const victim = `victim-${run}@example.org`;
    const order = await paidOrder(owner);
    // The order page's key proves the order, so no email has to match: the typed address is then stored as the request's own.
    const started = await w.startWithdrawal(
      storeId,
      { orderNumber: order.number, email: victim, name: "Mallory", lines: order.lines, orderKey: order.key },
      { floorMs: 0 },
    );
    if (!started.ok || !started.matched || !started.request) throw new Error(`step 1: ${JSON.stringify(started)}`);
    const confirmed = await w.confirmWithdrawal(storeId, { requestId: started.request.id });
    if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
    // Staff then work the return: the later emails go to the request's address too.
    await r.markReceived(storeId, { returnId: confirmed.returns[0].id }, null);

    const sent = await db().execute<Row>(sql`select kind, to_address from commerce.email_messages where order_id = ${order.orderId}::uuid`);
    const outsiders = sent.filter((m) => String(m.to_address).toLowerCase() !== owner);
    expect(outsiders).toEqual([]);
  });
});
