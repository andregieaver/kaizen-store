import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

/** A stand-in for Kaizen's platform Stripe client that records what it is asked. */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const charges: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const expired: string[] = [];
  const domains: { domain: string; account?: string }[] = [];
  const domainFailures = { create: false, list: false };
  let next = 0;
  const client = {
    paymentIntents: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        charges.push({ params, options });
        return { id: `pi_charge_${charges.length}`, status: "succeeded" };
      },
    },
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
            ? { id, url: null, client_secret: `${id}_secret_test`, payment_method_types: ["card", "mobilepay"] }
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
  return { client, created, expired, sessions, domains, domainFailures, charges };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client }));

const { getOpenCheckout, startCheckout } = await import("./checkout");
const { appointmentSlots } = await import("./appointments");
const { markBalancePaid } = await import("./order-admin");
const { markNoShow } = await import("./no-show");
const { getShopperOrder } = await import("./orders");
const { saleFee } = await import("@/lib/stripe-account");

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
        { quantity: 2, price_data: { currency: "nok", unit_amount: 24900, product_data: { name: "Demo: Keramikkopp (Hvit)" } } },
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

  it("starts a subscription on the store's account, with shipping that renews and Kaizen's fee as a share", async () => {
    await db().execute(sql`update commerce.platform_settings set sale_fee_bps = 150`);
    await db().execute(sql`update commerce.payment_providers set order_invoices = true where store_id = ${storeId}::uuid`);
    try {
      const [plan] = await db().execute<Row>(sql`
        insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
        select store_id, id, 'week', 2, 10 from commerce.products
        where store_id = ${storeId}::uuid and handle = 'demo-notatbok'
        returning id
      `);
      const cartId = await cartWith("DEMO-MUG-WHITE", 1);
      await db().execute(sql`
        insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, selling_plan_id)
        select ${storeId}::uuid, ${cartId}::uuid, id, 1, ${String(plan.id)}::uuid
        from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-NOTEBOOK-LINED'
      `);
      const result = await startCheckout(shop(), cartId, "https://shop.test", "Frakt", { subscription: true });
      expect(result.ok).toBe(true);
      const { params } = fake.created[fake.created.length - 1];
      const [sub] = await db().execute<Row>(sql`
        select s.id from commerce.subscriptions s join commerce.orders o on o.id = s.first_order_id
        where o.cart_id = ${cartId}::uuid
      `);
      // Stripe takes no shipping options or order invoice in this mode:
      // shipping is a line that renews, and subscriptions get invoices anyway.
      expect(params).not.toHaveProperty("shipping_options");
      expect(params).not.toHaveProperty("invoice_creation");
      expect(params).not.toHaveProperty("payment_intent_data");
      expect(params).toMatchObject({
        mode: "subscription",
        shipping_address_collection: { allowed_countries: ["NO"] },
        subscription_data: {
          application_fee_percent: 1.5,
          metadata: { subscription_id: String(sub.id) },
        },
        line_items: [
          { quantity: 1, price_data: { unit_amount: 24900, product_data: { name: "Demo: Keramikkopp (Hvit)" } } },
          {
            quantity: 1,
            price_data: {
              unit_amount: 11610,
              product_data: { name: "Demo: Notatbok A5 (Linjert)" },
              recurring: { interval: "week", interval_count: 2 },
            },
          },
          {
            quantity: 1,
            price_data: { unit_amount: 9900, product_data: { name: "Frakt" }, recurring: { interval: "week", interval_count: 2 } },
          },
        ],
      });
      expect((params.line_items as { price_data: object }[])[0].price_data).not.toHaveProperty("recurring");
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

    // What Stripe offered is kept with the order, for support questions.
    const [event] = await db().execute<Row>(sql`
      select data from commerce.order_events where order_id = ${String(order.id)}::uuid and type = 'payment.started'
    `);
    expect(event.data).toEqual({ ui: "custom", methods: ["card", "mobilepay"] });

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

describe("appointments paid later (D66)", () => {
  let taken = 0;

  /** A cart with the demo appointment at a free time, paid as said. */
  async function bookingCart(payment: "deposit" | "venue", depositPercent = 30): Promise<string> {
    const [product] = await db().execute<Row>(sql`
      update commerce.appointment_settings a set payment = ${payment}, deposit_percent = ${depositPercent}
      from commerce.products p
      where p.store_id = ${storeId}::uuid and p.handle = 'demo-massasje' and a.product_id = p.id
      returning p.id
    `);
    const week = await appointmentSlots(storeId, String(product.id));
    const slot = week?.days.flatMap((d) => d.slots)[taken++];
    if (!slot) throw new Error("no free time");
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
      values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
    `);
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, starts_at)
      select ${storeId}::uuid, ${String(cart.id)}::uuid, id, 1, ${slot.startsAt}::timestamptz
      from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MASSAGE-60'
    `);
    return String(cart.id);
  }

  it("takes a deposit through Stripe, keeping the card, and leaves the rest for the venue", async () => {
    await db().execute(sql`update commerce.platform_settings set sale_fee_bps = 150`);
    await db().execute(sql`update commerce.payment_providers set order_invoices = true where store_id = ${storeId}::uuid`);
    try {
      const cartId = await bookingCart("deposit", 30);
      const result = await startCheckout(shop(), cartId, "https://shop.test", "Frakt");
      expect(result.ok).toBe(true);
      const { params } = fake.created[fake.created.length - 1];
      expect(params).not.toHaveProperty("invoice_creation");
      expect(params).not.toHaveProperty("shipping_options");
      expect(params).toMatchObject({
        mode: "payment",
        customer_creation: "always",
        line_items: [
          {
            quantity: 1,
            price_data: { unit_amount: 26700, product_data: { name: expect.stringMatching(/^Demo: Massasje, 60 minutter, .+ \(depositum\)$/) } },
          },
        ],
        payment_intent_data: { setup_future_usage: "off_session", application_fee_amount: saleFee(26700, 150) },
      });
      const [order] = await db().execute<Row>(sql`
        select o.id, o.total_minor::int as total, o.balance_minor::int as balance, p.amount_minor::int as paying,
          (select venue_minor::int from commerce.order_lines where order_id = o.id) as venue
        from commerce.orders o join commerce.payments p on p.order_id = o.id where o.cart_id = ${cartId}::uuid
      `);
      expect(order).toMatchObject({ total: 89000, balance: 62300, paying: 26700, venue: 62300 });
    } finally {
      await db().execute(sql`update commerce.platform_settings set sale_fee_bps = 0`);
      await db().execute(sql`update commerce.payment_providers set order_invoices = false where store_id = ${storeId}::uuid`);
    }
  });

  it("confirms a booking paid at the venue without Stripe, and staff mark it paid there", async () => {
    const sessions = fake.created.length;
    // Nothing is paid online, so the shopper says who books.
    const withoutContact = await bookingCart("venue");
    expect(await startCheckout(shop(), withoutContact, "https://shop.test", "Frakt")).toEqual({ ok: false, problem: "contact" });
    const [given] = await db().execute<Row>(sql`select status from commerce.orders where cart_id = ${withoutContact}::uuid`);
    expect(given.status).toBe("cancelled");

    const cartId = await bookingCart("venue");
    const contact = { name: "Kari Nordmann", email: "kari@example.com", phone: "+47 900 00 000" };
    const result = await startCheckout(shop(), cartId, "https://shop.test", "Frakt", {}, { contact });
    const [order] = await db().execute<Row>(sql`
      select id, status, email, billing_address, balance_minor::int as balance from commerce.orders where cart_id = ${cartId}::uuid
    `);
    expect(result).toEqual({
      ok: true,
      url: expect.stringMatching(new RegExp(`^https://shop.test/s/${slug}/no/order/${order.id}\\?session_id=venue_`)),
    });
    expect(fake.created.length).toBe(sessions);
    expect(order).toMatchObject({
      status: "paid",
      email: "kari@example.com",
      billing_address: { name: "Kari Nordmann", phone: "+47 900 00 000" },
      balance: 89000,
    });
    const [booking] = await db().execute<Row>(sql`select status from commerce.bookings where order_id = ${String(order.id)}::uuid`);
    expect(booking.status).toBe("confirmed");
    // The order page opens with the key it was sent to.
    const token = new URL((result as { url: string }).url).searchParams.get("session_id")!;
    expect((await getShopperOrder(storeId, String(order.id), token))?.balanceMinor).toBe(89000);

    expect(await markBalancePaid(storeId, String(order.id), "card", null)).toBe(true);
    expect(await markBalancePaid(storeId, String(order.id), "card", null)).toBe(false);
    const [after] = await db().execute<Row>(sql`
      select o.balance_minor::int as balance, p.status, p.amount_minor::int as amount
      from commerce.orders o join commerce.payments p on p.order_id = o.id where o.id = ${String(order.id)}::uuid
    `);
    expect(after).toEqual({ balance: 0, status: "captured", amount: 89000 });
  });

  it("charges a no-show fee to the card saved with the deposit, less the deposit, only when staff ask", async () => {
    const cartId = await bookingCart("deposit", 30);
    expect((await startCheckout(shop(), cartId, "https://shop.test", "Frakt")).ok).toBe(true);
    const [order] = await db().execute<Row>(sql`
      select o.id, p.provider_reference as session, b.id as booking
      from commerce.orders o join commerce.payments p on p.order_id = o.id join commerce.bookings b on b.order_id = o.id
      where o.cart_id = ${cartId}::uuid
    `);
    const orderId = String(order.id);
    const bookingId = String(order.booking);
    // Paid: Stripe keeps the card on a customer of the store's account.
    fake.sessions.set(String(order.session), {
      status: "complete",
      payment_status: "paid",
      customer: "cus_kari",
      payment_intent: { id: "pi_deposit", payment_method: "pm_card" },
    });
    await db().execute(sql`select commerce.complete_order_payment(${orderId}::uuid, ${String(order.session)})`);
    await db().execute(sql`update commerce.payments set status = 'captured' where order_id = ${orderId}::uuid`);
    await db().execute(sql`
      update commerce.appointment_settings a set no_show_percent = 100
      from commerce.products p where p.store_id = ${storeId}::uuid and p.handle = 'demo-massasje' and a.product_id = p.id
    `);
    const [account] = await db().execute<Row>(sql`
      insert into commerce.accounts (email, name) values (${`staff-${run}@example.com`}, 'Staff') returning id
    `);
    const member = {
      account: { id: String(account.id), email: "staff@example.com", name: "Staff", platformAdmin: false },
      role: "owner" as const,
      store: { id: storeId, slug } as import("./stores").Store,
    };

    expect(await markNoShow(member, bookingId, true)).toEqual({ ok: false, problem: "The appointment has not started yet." });
    await db().execute(sql`
      update commerce.bookings set starts_at = now() - interval '2 hours', ends_at = now() - interval '1 hour',
        blocked_from = now() - interval '2 hours', blocked_to = now() - interval '1 hour'
      where id = ${bookingId}::uuid
    `);
    expect(await markNoShow(member, bookingId, true)).toEqual({ ok: true, chargedMinor: 62300 });
    expect(fake.charges[fake.charges.length - 1]).toMatchObject({
      params: {
        amount: 62300,
        currency: "nok",
        customer: "cus_kari",
        payment_method: "pm_card",
        off_session: true,
        confirm: true,
      },
      options: { stripeAccount: accountId, idempotencyKey: `no-show-${bookingId}` },
    });
    const [after] = await db().execute<Row>(sql`
      select o.balance_minor::int as balance, b.no_show_at is not null as marked,
        (select sum(amount_minor)::int from commerce.payments where order_id = o.id and status = 'captured') as taken
      from commerce.orders o join commerce.bookings b on b.order_id = o.id where o.id = ${orderId}::uuid
    `);
    // The deposit and the fee: the whole price, and nothing left for the venue.
    expect(after).toEqual({ balance: 0, marked: true, taken: 89000 });
    expect(await markNoShow(member, bookingId, true)).toEqual({ ok: false, problem: "This booking is already marked as a no-show." });
  });
});
