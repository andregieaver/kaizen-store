import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { encryptSecret } from "@/lib/secret-box";

type Row = Record<string, unknown>;

/** A stand-in for Stripe that records what Kaizen asks of it. */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, { status: string; payment_status: string }>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const expired: string[] = [];
  let next = 0;
  const client = {
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_fake_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid" });
          created.push({ params, options });
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        retrieve: async (id: string) => ({ id, ...sessions.get(id) }),
        expire: async (id: string) => {
          expired.push(id);
          sessions.set(id, { status: "expired", payment_status: "unpaid" });
          return { id };
        },
      },
    },
  };
  return { client, created, expired, sessions };
});

vi.mock("./stripe", () => ({ stripeFor: () => fake.client }));

const { startCheckout } = await import("./checkout");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
const slug = `stripe-${run}`;

beforeAll(async () => {
  const key = randomBytes(32);
  process.env.SETTINGS_ENCRYPTION_KEY = key.toString("base64");
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  storeId = String(store.id);
  await db().execute(sql`
    insert into commerce.payment_credentials (store_id, provider, mode, publishable_key, secret_key_ciphertext, secret_key_hint)
    values (${storeId}::uuid, 'stripe', 'test', 'pk_test_x', ${encryptSecret("sk_test_x", key)}, 'sk_test_…x')
  `);
  await db().execute(sql`
    update commerce.payment_providers set enabled = true where store_id = ${storeId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.payment_methods (store_id, market_code, method, enabled)
    values (${storeId}::uuid, 'NO', 'card', true), (${storeId}::uuid, 'NO', 'klarna', true)
  `);
});

afterAll(async () => {
  await closeDb();
});

async function cartWith(sku: string, quantity: number): Promise<string> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity}
    from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
  `);
  return String(cart.id);
}

const shop = () => ({ storeId, storeSlug: slug, market: no });

describe("starting checkout", () => {
  it("opens a Stripe session for the order, in the shopper's language and country", async () => {
    const cartId = await cartWith("DEMO-MUG-WHITE", 2);
    const result = await startCheckout(shop(), cartId, "https://shop.test", "Frakt");
    expect(result).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_fake_1" });

    const { params, options } = fake.created[0];
    const [order] = await db().execute<Row>(sql`
      select id, status from commerce.orders where cart_id = ${cartId}::uuid
    `);
    expect(options).toEqual({ idempotencyKey: `checkout-${order.id}` });
    expect(params).toMatchObject({
      mode: "payment",
      client_reference_id: order.id,
      locale: "nb",
      payment_method_types: ["card", "klarna"],
      shipping_address_collection: { allowed_countries: ["NO"] },
      line_items: [
        { quantity: 2, price_data: { currency: "nok", unit_amount: 24900, product_data: { name: "Demo: Keramikkopp (white)" } } },
      ],
      shipping_options: [
        { shipping_rate_data: { type: "fixed_amount", display_name: "Frakt", fixed_amount: { amount: 9900, currency: "nok" } } },
      ],
      success_url: `https://shop.test/s/${slug}/no/order/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `https://shop.test/s/${slug}/no/cart`,
    });

    const [payment] = await db().execute<Row>(sql`
      select provider_reference, amount_minor::int as amount from commerce.payments where order_id = ${String(order.id)}::uuid
    `);
    expect(payment).toEqual({ provider_reference: "cs_fake_1", amount: 59700 });
  });

  it("closes the earlier session when the shopper checks out again", async () => {
    const cartId = await cartWith("DEMO-TOTE", 1);
    await startCheckout(shop(), cartId, "https://shop.test", "Frakt");
    const first = fake.created.length;
    await startCheckout(shop(), cartId, "https://shop.test", "Frakt");

    expect(fake.expired).toContain(`cs_fake_${first}`);
    const orders = await db().execute<Row>(sql`
      select status from commerce.orders where cart_id = ${cartId}::uuid order by placed_at, number
    `);
    expect(orders.map((o) => o.status)).toEqual(["cancelled", "pending_payment"]);
  });

  it("does not open a second payment for a basket that was already paid", async () => {
    const cartId = await cartWith("DEMO-TOTE", 1);
    await startCheckout(shop(), cartId, "https://shop.test", "Frakt");
    const id = `cs_fake_${fake.created.length}`;
    fake.sessions.set(id, { status: "complete", payment_status: "paid" });

    const result = await startCheckout(shop(), cartId, "https://shop.test", "Frakt");
    expect(result).toMatchObject({ ok: false, problem: "already_paid" });
    const [order] = await db().execute<Row>(sql`
      select status from commerce.orders where cart_id = ${cartId}::uuid
    `);
    expect(order.status).toBe("paid");
  });

  it("will not take payment when Stripe is switched off", async () => {
    await db().execute(sql`update commerce.payment_providers set enabled = false where store_id = ${storeId}::uuid`);
    const result = await startCheckout(shop(), await cartWith("DEMO-TOTE", 1), "https://shop.test", "Frakt");
    expect(result).toEqual({ ok: false, problem: "payments_off" });
    await db().execute(sql`update commerce.payment_providers set enabled = true where store_id = ${storeId}::uuid`);
  });
});
