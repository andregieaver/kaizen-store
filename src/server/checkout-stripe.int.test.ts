import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

/** A stand-in for Kaizen's platform Stripe client that records what it is asked. */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, { status: string; payment_status: string }>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const expired: string[] = [];
  const domains: { domain: string; account?: string }[] = [];
  const domainFailures = { create: false, list: false };
  let next = 0;
  const client = {
    paymentMethodDomains: {
      create: async (params: { domain_name: string }, options: { stripeAccount?: string }) => {
        if (domainFailures.create) throw new Error("already registered");
        domains.push({ domain: params.domain_name, account: options?.stripeAccount });
        return { id: `pmd_${domains.length}`, domain_name: params.domain_name, enabled: true };
      },
      list: async () => ({ data: domainFailures.list ? [] : [{ id: "pmd_listed" }] }),
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_fake_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid" });
          created.push({ params, options });
          return params.ui_mode === "elements"
            ? { id, url: null, client_secret: `${id}_secret_test` }
            : { id, url: `https://checkout.stripe.test/${id}`, client_secret: null };
        },
        retrieve: async (id: string, _params: unknown, options: { stripeAccount?: string }) => {
          if (!options?.stripeAccount) throw new Error("no connected account");
          return { id, ...sessions.get(id) };
        },
        expire: async (id: string, _params: unknown, options: { stripeAccount?: string }) => {
          if (!options?.stripeAccount) throw new Error("no connected account");
          expired.push(id);
          sessions.set(id, { status: "expired", payment_status: "unpaid" });
          return { id };
        },
      },
    },
  };
  return { client, created, expired, sessions, domains, domainFailures };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client }));

const { getOpenCheckout, startCheckout } = await import("./checkout");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
const slug = `stripe-${run}`;

const accountId = `acct_${run}`;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  storeId = String(store.id);
  await db().execute(sql`
    update commerce.stores set legal_name = 'Test AS', organisation_number = '999999999' where id = ${storeId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${accountId}, 'active', false)
  `);
  await db().execute(sql`
    update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${storeId}::uuid
  `);
  // Stripe's own page first; Kaizen's page (the default) is tested below.
  await db().execute(sql`update commerce.platform_settings set checkout_ui = 'hosted'`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set checkout_ui = 'custom'`);
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
    // A direct charge on the store's own account, with no Kaizen fee by default.
    expect(options).toEqual({ stripeAccount: accountId, idempotencyKey: `checkout-${order.id}` });
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params).not.toHaveProperty("invoice_creation");
    expect(params.payment_intent_data).not.toHaveProperty("application_fee_amount");
    expect(params).toMatchObject({
      mode: "payment",
      client_reference_id: order.id,
      locale: "nb",
      integration_identifier: expect.stringMatching(/^kaizen-storefront-[a-z]{8}$/),
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
      select provider_reference, provider_account, amount_minor::int as amount
      from commerce.payments where order_id = ${String(order.id)}::uuid
    `);
    expect(payment).toEqual({ provider_reference: "cs_fake_1", provider_account: accountId, amount: 59700 });
  });

  it("takes Kaizen's fee and sends an invoice when the store wants one", async () => {
    await db().execute(sql`update commerce.platform_settings set sale_fee_bps = 150`);
    await db().execute(sql`update commerce.payment_providers set order_invoices = true where store_id = ${storeId}::uuid`);
    try {
      await startCheckout(shop(), await cartWith("DEMO-MUG-WHITE", 2), "https://shop.test", "Frakt");
      const { params } = fake.created[fake.created.length - 1];
      expect(params).toMatchObject({
        payment_intent_data: { application_fee_amount: 896 },
        invoice_creation: {
          enabled: true,
          invoice_data: {
            footer: "Test AS · Org.nr. 999999999",
            custom_fields: [{ name: "Herav mva", value: expect.stringMatching(/119,40/) }],
          },
        },
      });
    } finally {
      await db().execute(sql`update commerce.platform_settings set sale_fee_bps = 0`);
      await db().execute(sql`update commerce.payment_providers set order_invoices = false where store_id = ${storeId}::uuid`);
    }
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

  it("will not take payment before Stripe has approved the store's account", async () => {
    await db().execute(sql`update commerce.stripe_accounts set card_payments = 'pending' where store_id = ${storeId}::uuid`);
    const result = await startCheckout(shop(), await cartWith("DEMO-TOTE", 1), "https://shop.test", "Frakt");
    expect(result).toEqual({ ok: false, problem: "payments_off" });
    await db().execute(sql`update commerce.stripe_accounts set card_payments = 'active' where store_id = ${storeId}::uuid`);
  });
});

describe("Kaizen's checkout page", () => {
  beforeAll(async () => {
    await db().execute(sql`update commerce.platform_settings set checkout_ui = 'custom'`);
  });

  it("opens a session for Stripe's form on Kaizen's page and sends the shopper there", async () => {
    const cartId = await cartWith("DEMO-MUG-WHITE", 1);
    const result = await startCheckout(shop(), cartId, "https://shop.test", "Frakt");
    expect(result).toEqual({ ok: true, url: `https://shop.test/s/${slug}/no/checkout` });

    const { params, options } = fake.created[fake.created.length - 1];
    const [order] = await db().execute<Row>(sql`select id from commerce.orders where cart_id = ${cartId}::uuid`);
    expect(options).toMatchObject({ stripeAccount: accountId });
    expect(params).toMatchObject({
      ui_mode: "elements",
      return_url: `https://shop.test/s/${slug}/no/order/${order.id}?session_id={CHECKOUT_SESSION_ID}`,
      shipping_address_collection: { allowed_countries: ["NO"] },
    });
    for (const key of ["success_url", "cancel_url", "locale", "payment_method_types"]) {
      expect(params).not.toHaveProperty(key);
    }

    // Wallets, Link and Klarna need the domain registered on the store's own account.
    expect(fake.domains).toEqual([{ domain: "shop.test", account: accountId }]);

    const open = await getOpenCheckout(storeId, cartId);
    expect(open).toMatchObject({
      orderId: order.id,
      accountId,
      mode: "test",
      clientSecret: expect.stringMatching(/_secret_test$/),
      expired: false,
      changed: false,
    });
  });

  it("registers the domain once per account, and not for local addresses", async () => {
    await startCheckout(shop(), await cartWith("DEMO-TOTE", 1), "https://shop.test", "Frakt");
    await startCheckout(shop(), await cartWith("DEMO-TOTE", 1), "http://localhost:3000", "Frakt");
    expect(fake.domains).toHaveLength(1);
  });

  it("still takes payment when Stripe will not register the domain", async () => {
    fake.domainFailures.create = true;
    fake.domainFailures.list = true;
    try {
      const result = await startCheckout(shop(), await cartWith("DEMO-TOTE", 1), "https://other.test", "Frakt");
      expect(result).toMatchObject({ ok: true });
      const [row] = await db().execute<Row>(sql`
        select payment_domains from commerce.stripe_accounts where store_id = ${storeId}::uuid and mode = 'test'
      `);
      expect(row.payment_domains).toEqual(["shop.test"]);
    } finally {
      fake.domainFailures.create = false;
      fake.domainFailures.list = false;
    }
  });

  it("notices when the cart changes after the order was placed", async () => {
    const cartId = await cartWith("DEMO-TOTE", 1);
    await startCheckout(shop(), cartId, "https://shop.test", "Frakt");
    await db().execute(sql`update commerce.cart_lines set quantity = 2 where cart_id = ${cartId}::uuid`);
    expect(await getOpenCheckout(storeId, cartId)).toMatchObject({ changed: true });

    // Checking out again replaces the order; the new one matches the cart.
    await startCheckout(shop(), cartId, "https://shop.test", "Frakt");
    expect(await getOpenCheckout(storeId, cartId)).toMatchObject({ changed: false });
  });

  it("has nothing to show for a cart without an order waiting for payment", async () => {
    expect(await getOpenCheckout(storeId, await cartWith("DEMO-TOTE", 1))).toBeNull();
  });
});
