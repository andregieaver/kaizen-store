import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { CHECKOUT_MINUTES } from "@/lib/checkout";
import { toMarket, type Market } from "@/lib/markets";
import { saleFee } from "@/lib/stripe-account";

type Row = Record<string, unknown>;

/**
 * The shopper's payment session (`src/server/payment-session.ts`, code review 1.9's next, FH9, D811): the one place a Stripe Checkout session is
 * made, for a cart's order, a draft's pay link, an order change, an exchange, a company's approved order and a balance on payment terms. What
 * Stripe charges is what the order says is due, in the order's currency, as whole minor units, on the store's own connected account (a host's
 * for a host's listings) with Kaizena Flow's fee on what is sold; the payment waiting for it is one row; a test store's session is a test one.
 *
 * Stripe is the stand-in of `stripe-test-support.ts`: it works out what a session charges from what it was sent (the lines, the coupon, the
 * shipping), refuses what Stripe refuses (a fraction of a minor unit, two currencies, a fee above the amount, a coupon of another account,
 * an expiry outside 30 minutes to 24 hours) and answers an idempotency key as Stripe does. No platform key is set.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("./stripe", async (importActual) => {
  const { stripe } = await import("./stripe-test-support");
  return { ...(await importActual<typeof import("./stripe")>()), platformStripe: stripe.platform };
});
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test", "live"], platformPublishableKey: (mode: string) => `pk_${mode}_x`, platformSecretKey: () => null }));
/** Every line written through `log()`, as it would be written. */
const logs = vi.hoisted(() => [] as string[]);
vi.mock("./log", async (importOriginal) => {
  const real = await importOriginal<typeof import("./log")>();
  return { ...real, log: (...args: Parameters<typeof real.log>) => void logs.push(real.logLine(...args)) };
});

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { stripe } = await import("./stripe-test-support");
const fx = await import("./invoice-test-fixture");
const { placeOrder } = await import("./checkout");
const { openPaymentSession, paymentConnection } = await import("./payment-session");
const { excludedPaymentMethods } = await import("./payment-methods");

type PlacedOrder = import("./checkout").PlacedOrder;
type Fixture = import("./invoice-test-fixture").Fixture;

const no = fx.no;
const fi: Market = toMarket({ code: "FI", currency: "EUR", defaultLocale: "fi-FI" });
const before = { saleFeeBps: 0 };
let live: Fixture;
let test: Fixture;

/** An order placed from a cart of these SKUs, as a shopper's checkout places it. */
async function placed(store: Fixture, items: [sku: string, quantity: number][], o: { market?: Market; code?: string } = {}): Promise<PlacedOrder> {
  const market = o.market ?? no;
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, discount_code)
    values (${store.storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day', ${o.code ?? null}) returning id
  `);
  for (const [sku, quantity] of items) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${store.storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${sku}
    `);
  }
  const result = await placeOrder({ storeId: store.storeId, market }, String(cart.id));
  if (!result.ok) throw new Error(`placeOrder: ${result.problem}`);
  return result.order;
}

const shopOf = (store: Fixture, market: Market = no) => ({ storeId: store.storeId, storeSlug: store.slug, market });

async function connected(store: Fixture) {
  const found = await paymentConnection(store.storeId);
  if (!found) throw new Error("payments are off");
  return found;
}

async function paymentsOf(orderId: string): Promise<Row[]> {
  return db().execute<Row>(sql`
    select provider, provider_reference, provider_account, client_secret, amount_minor::int as amount, currency, status::text, kaizen_fee_minor::int as fee,
           order_edit_id, exchange_id
    from commerce.payments where order_id = ${orderId}::uuid order by created_at
  `);
}

const lastCall = (method: string) => stripe.callsOf(method).at(-1)!;
/** The parameters and options of the last session Stripe was asked for. */
const lastSession = () => {
  const call = lastCall("checkout.sessions.create");
  return { params: call.args[0] as Record<string, any>, options: call.args[1] as Record<string, unknown>, mode: call.mode }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

beforeAll(async () => {
  const [settings] = await db().execute<Row>(sql`select sale_fee_bps from commerce.platform_settings`);
  before.saleFeeBps = Number(settings.sale_fee_bps);
  await db().execute(sql`update commerce.platform_settings set sale_fee_bps = 150`);
  [live, test] = await Promise.all([fx.makeStore("paysession-live"), fx.makeStore("paysession-test", { mode: "test" })]);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set sale_fee_bps = ${before.saleFeeBps}`);
  await closeDb();
});

describe("the store's Stripe connection (paymentConnection)", () => {
  it("is the live account and the live client for a store taking real payments", async () => {
    expect(await paymentConnection(live.storeId)).toEqual({
      connection: { mode: "live", accountId: live.account, orderInvoices: false },
      stripe: stripe.platform("live"),
    });
  });

  it("is the test account and the test client for a store in test mode, never the live ones", async () => {
    // The test store has a live account too: it is never what a test checkout pays to.
    await db().execute(sql`
      insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
      values (${test.storeId}::uuid, 'live', ${`acct_livealso${fx.run}`}, 'active', false)
    `);
    expect(await paymentConnection(test.storeId)).toEqual({
      connection: { mode: "test", accountId: test.account, orderInvoices: false },
      stripe: stripe.platform("test"),
    });
  });

  it("is off while the live account cannot take card payments, the platform has no live keys, or Stripe is switched off for the store", async () => {
    const mark = stripe.calls.length;
    await db().execute(sql`update commerce.stripe_accounts set card_payments = 'pending' where store_id = ${live.storeId}::uuid and mode = 'live'`);
    try {
      expect(await paymentConnection(live.storeId)).toBeNull();
    } finally {
      await db().execute(sql`update commerce.stripe_accounts set card_payments = 'active' where store_id = ${live.storeId}::uuid and mode = 'live'`);
    }
    stripe.modes.delete("live");
    try {
      // Without live keys a live store is off: it never falls back to the test client.
      expect(await paymentConnection(live.storeId)).toBeNull();
    } finally {
      stripe.modes.add("live");
    }
    await db().execute(sql`update commerce.payment_providers set enabled = false where store_id = ${live.storeId}::uuid`);
    try {
      expect(await paymentConnection(live.storeId)).toBeNull();
    } finally {
      await db().execute(sql`update commerce.payment_providers set enabled = true where store_id = ${live.storeId}::uuid`);
    }
    expect(stripe.calls.slice(mark)).toEqual([]);
  });

  it("makes no test account at checkout (no owner at hand) and pays a test order to no live account", async () => {
    const store = await fx.makeStore("paysession-notest", { mode: "test" });
    await db().execute(sql`update commerce.stripe_accounts set mode = 'live' where store_id = ${store.storeId}::uuid`);
    const mark = stripe.calls.length;
    expect(await paymentConnection(store.storeId)).toBeNull();
    expect(stripe.calls.slice(mark).map((call) => call.method)).not.toContain("accounts.create");
  });
});

describe("a session for a placed order (openPaymentSession)", () => {
  it("charges exactly what the order is due, in its currency, on the store's own account, with Kaizena Flow's fee, and records one payment waiting", async () => {
    const order = await placed(live, [["DEMO-MUG-WHITE", 2]]);
    const result = await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" });
    const { params, options, mode } = lastSession();
    const session = stripe.sessions.get(result.ok ? result.sessionId : "")!;
    expect(result).toEqual({ ok: true, url: session.url, sessionId: session.id });

    // A direct charge on the store's account, made with the live client, keyed by the order.
    expect(mode).toBe("live");
    expect(options).toEqual({ stripeAccount: live.account, idempotencyKey: `checkout-${order.orderId}` });
    expect(session.account).toBe(live.account);
    // What Stripe charges is the order's total: the lines at their VAT-inclusive prices and the shipping, in kroner.
    const [row] = await db().execute<Row>(sql`select total_minor::int as total, currency from commerce.orders where id = ${order.orderId}::uuid`);
    expect(session.amount_total).toBe(order.dueNowMinor);
    expect(session.amount_total).toBe(row.total);
    expect(session.currency).toBe("nok");
    expect(row.currency).toBe("NOK");
    // Kaizena Flow's fee (1.5 %) on what is paid, as whole øre.
    const fee = saleFee(order.dueNowMinor, 150)!;
    expect(fee).toBe(Math.round((order.dueNowMinor * 150) / 10_000));
    expect(params.payment_intent_data).toMatchObject({ application_fee_amount: fee, metadata: { order_id: order.orderId, store_id: live.storeId } });
    expect(params.metadata).toEqual({ order_id: order.orderId, order_number: order.number, store_id: live.storeId });
    expect(params.client_reference_id).toBe(order.orderId);
    // Never a list of methods of our own: the store's Stripe Dashboard decides.
    expect(params).not.toHaveProperty("payment_method_types");

    expect(await paymentsOf(order.orderId)).toEqual([
      {
        provider: "stripe",
        provider_reference: session.id,
        provider_account: live.account,
        client_secret: null,
        amount: order.dueNowMinor,
        currency: "NOK",
        status: "pending",
        fee,
        order_edit_id: null,
        exchange_id: null,
      },
    ]);
    const events = await db().execute<Row>(sql`select type, data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'payment.started'`);
    expect(events).toEqual([{ type: "payment.started", data: { ui: "hosted", methods: ["card", "klarna", "mobilepay"] } }]);
  });

  it("charges a market shown in euro in euro, at the order's own amounts", async () => {
    const order = await placed(live, [["DEMO-MUG-WHITE", 1]], { market: fx.noInEuro });
    expect(order.currency).toBe("EUR");
    const result = await openPaymentSession(shopOf(live, fx.noInEuro), order, "https://shop.test", "Shipping", { ...(await connected(live)), ui: "hosted" });
    expect(result.ok).toBe(true);
    const session = stripe.sessions.get(result.ok ? result.sessionId : "")!;
    expect(session).toMatchObject({ currency: "eur", amount_total: order.dueNowMinor });
    expect(lastSession().params.payment_intent_data.application_fee_amount).toBe(saleFee(order.dueNowMinor, 150));
    expect(await paymentsOf(order.orderId)).toMatchObject([{ amount: order.dueNowMinor, currency: "EUR" }]);
  });

  it("sends a discount code as one coupon on the same account, used once, and Stripe still charges the order's total", async () => {
    const code = `TIEN${fx.run}`.toUpperCase();
    await db().execute(sql`insert into commerce.discount_codes (store_id, code, kind, percent) values (${live.storeId}::uuid, ${code}, 'percent', 10)`);
    const order = await placed(live, [["DEMO-MUG-WHITE", 3]], { code });
    expect(order.discount?.couponMinor).toBeGreaterThan(0);
    const result = await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" });
    expect(result.ok).toBe(true);

    const coupon = lastCall("coupons.create");
    expect(coupon.args).toEqual([
      { amount_off: order.discount!.couponMinor, currency: "nok", duration: "once", max_redemptions: 1, name: code, metadata: lastSession().params.metadata },
      { stripeAccount: live.account, idempotencyKey: `coupon-${order.orderId}` },
    ]);
    const session = stripe.sessions.get(result.ok ? result.sessionId : "")!;
    expect(session.amount_total).toBe(order.dueNowMinor);
    // The fee is on what the shopper pays, after the discount.
    expect(lastSession().params.payment_intent_data.application_fee_amount).toBe(saleFee(order.dueNowMinor, 150));
  });

  it("sends a draft's exact amounts as one line each at what is due, and they add up to the total", async () => {
    const order = await placed(live, [["DEMO-MUG-WHITE", 2], ["DEMO-MUG-BLACK", 1]]);
    const result = await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", {
      ...(await connected(live)),
      ui: "hosted",
      exactAmounts: true,
      idempotencyKey: `draft-pay-${order.orderId}-0`,
      allowedCountry: "NO",
      expiresInSeconds: 24 * 60 * 60 - 60,
      cancelUrl: "https://shop.test/back",
      customerEmail: "kari@example.no",
    });
    expect(result.ok).toBe(true);
    const { params, options } = lastSession();
    expect(options).toEqual({ stripeAccount: live.account, idempotencyKey: `draft-pay-${order.orderId}-0` });
    expect(params.line_items).toEqual(
      order.lines.map((line) => ({
        quantity: 1,
        price_data: { currency: "nok", unit_amount: line.dueNowMinor, product_data: { name: `${line.quantity > 1 ? `${line.quantity} × ` : ""}${line.title}` } },
      })),
    );
    expect(params).toMatchObject({ customer_email: "kari@example.no", cancel_url: "https://shop.test/back" });
    expect(params).not.toHaveProperty("discounts");
    expect(stripe.sessions.get(result.ok ? result.sessionId : "")!.amount_total).toBe(order.dueNowMinor);
    // Stripe's limit is 24 hours: the caller's day less a minute is what Stripe is sent.
    expect(params.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(24 * 60 * 60 - 120);
  });

  it("charges only the rest when gift cards paid part of it, and takes no fee on duties passed on to customs", async () => {
    const base = await placed(live, [["DEMO-MUG-WHITE", 2]]);
    // Gift cards paid 100 kroner of it (D300 F3): Stripe is sent one line of the rest.
    const cards = { ...base, giftCardsMinor: 10_000, dueNowMinor: base.totalMinor - 10_000 };
    const carded = await openPaymentSession(shopOf(live), cards, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" });
    expect(carded.ok).toBe(true);
    expect(lastSession().params.line_items).toEqual([{ quantity: 1, price_data: { currency: "nok", unit_amount: cards.dueNowMinor, product_data: { name: expect.stringContaining(base.number) } } }]);
    expect(lastSession().params).not.toHaveProperty("shipping_options");
    expect(stripe.sessions.get(carded.ok ? carded.sessionId : "")!.amount_total).toBe(cards.dueNowMinor);

    // Duties and import VAT collected at checkout (DDP, D343): a line of their own, paid now, and no fee on them.
    const ddp = await placed(live, [["DEMO-MUG-WHITE", 1]]);
    const duties = { ...ddp, dutiesMinor: 4_321, dueNowMinor: ddp.totalMinor + 4_321 };
    const opened = await openPaymentSession(shopOf(live), duties, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" });
    expect(opened.ok).toBe(true);
    const { params } = lastSession();
    expect(params.line_items.at(-1)).toEqual({ quantity: 1, price_data: { currency: "nok", unit_amount: 4_321, product_data: { name: expect.any(String) } } });
    expect(stripe.sessions.get(opened.ok ? opened.sessionId : "")!.amount_total).toBe(duties.dueNowMinor);
    expect(params.payment_intent_data.application_fee_amount).toBe(saleFee(ddp.totalMinor, 150));
    expect(await paymentsOf(ddp.orderId)).toMatchObject([{ amount: duties.dueNowMinor, fee: saleFee(ddp.totalMinor, 150) }]);
  });

  it("gives the first session back for the same key and order, and Stripe refuses the key for an order that changed since", async () => {
    const order = await placed(live, [["DEMO-MUG-WHITE", 1]]);
    const connection = await connected(live);
    const options = { ...connection, ui: "hosted" as const, idempotencyKey: `draft-pay-${order.orderId}-0` };
    const now = vi.spyOn(Date, "now").mockReturnValue(Date.now());
    let first, again, changed;
    try {
      first = await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", options);
      again = await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", options);
      // The same key for an order whose lines changed: Stripe refuses it, so a session made for the old amounts is never handed out for the new.
      const more = { ...order, lines: order.lines.map((line) => ({ ...line, quantity: line.quantity + 1, dueNowMinor: line.dueNowMinor * 2 })), dueNowMinor: order.dueNowMinor + order.lines[0].dueNowMinor, totalMinor: order.totalMinor + order.lines[0].dueNowMinor };
      changed = await openPaymentSession(shopOf(live), more, "https://shop.test", "Frakt", options);
    } finally {
      now.mockRestore();
    }
    expect(first.ok && again.ok && again.sessionId).toBe(first.ok && first.sessionId);
    expect(changed).toEqual({ ok: false, problem: "payment_error" });
    // One session at Stripe, one payment waiting, at the first amounts.
    expect([...stripe.sessions.values()].filter((s) => s.client_reference_id === order.orderId)).toHaveLength(1);
    expect(await paymentsOf(order.orderId)).toMatchObject([{ amount: order.dueNowMinor, status: "pending" }]);
  });

  it("answers a Stripe failure with payment_error and records nothing, leaving the order to its caller", async () => {
    const order = await placed(live, [["DEMO-MUG-WHITE", 1]]);
    stripe.failNext.set("checkout.sessions.create", new Error("socket hang up"));
    expect(await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" })).toEqual({ ok: false, problem: "payment_error" });
    // A coupon Stripe will not make stops the session before it is asked for.
    const code = `FEM${fx.run}`.toUpperCase();
    await db().execute(sql`insert into commerce.discount_codes (store_id, code, kind, percent) values (${live.storeId}::uuid, ${code}, 'percent', 5)`);
    const discounted = await placed(live, [["DEMO-MUG-WHITE", 2]], { code });
    const sessionsBefore = stripe.callsOf("checkout.sessions.create").length;
    stripe.failNext.set("coupons.create", new Error("rate limited"));
    expect(await openPaymentSession(shopOf(live), discounted, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" })).toEqual({ ok: false, problem: "payment_error" });
    expect(stripe.callsOf("checkout.sessions.create")).toHaveLength(sessionsBefore);

    for (const id of [order.orderId, discounted.orderId]) {
      expect(await paymentsOf(id)).toEqual([]);
      const [row] = await db().execute<Row>(sql`
        select o.status::text, (select count(*)::int from commerce.order_events e where e.order_id = o.id and e.type = 'payment.started') as started
        from commerce.orders o where o.id = ${id}::uuid
      `);
      expect(row).toEqual({ status: "pending_payment", started: 0 });
    }
  });

  it("puts Stripe's form on Kaizena Flow's page: the secret kept on the payment for that page alone, the paying account's domain registered", async () => {
    const order = await placed(live, [["DEMO-MUG-WHITE", 1]]);
    const result = await openPaymentSession(shopOf(live), order, "https://shop.example", "Frakt", { ...(await connected(live)), ui: "custom", captureLater: true });
    const session = stripe.sessions.get(result.ok ? result.sessionId : "")!;
    expect(result).toEqual({ ok: true, url: `https://shop.example/s/${live.slug}/no/checkout`, sessionId: session.id });
    const { params } = lastSession();
    expect(params).toMatchObject({
      ui_mode: "elements",
      return_url: `https://shop.example/s/${live.slug}/no/order/${order.orderId}?session_id={CHECKOUT_SESSION_ID}`,
      // Held now and taken when sent (D289).
      payment_intent_data: { capture_method: "manual" },
    });
    expect(params).not.toHaveProperty("success_url");
    expect(await paymentsOf(order.orderId)).toMatchObject([{ client_secret: session.client_secret, provider_account: live.account }]);
    expect(lastCall("paymentMethodDomains.create").args).toEqual([{ domain_name: "shop.example" }, { stripeAccount: live.account }]);
    // The order's history says which methods were offered, never the secret.
    const [event] = await db().execute<Row>(sql`select data::text as data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'payment.started'`);
    expect(event.data).not.toContain(String(session.client_secret));
  });

  it("asks an address only in the order's own market, and leaves out the methods switched off there", async () => {
    const order = await placed(live, [["DEMO-MUG-WHITE", 1]]);
    // Shown under Finland's address, the order is still Norway's: its VAT was decided for Norway.
    const result = await openPaymentSession(shopOf(live, fi), order, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted", allowedCountry: "NO" });
    expect(result.ok).toBe(true);
    const { params } = lastSession();
    expect(params.shipping_address_collection).toEqual({ allowed_countries: ["NO"] });
    const excluded = await excludedPaymentMethods(live.storeId, "NO", order.orderId);
    if (excluded.length > 0) expect(params.excluded_payment_method_types).toEqual(excluded);
    else expect(params).not.toHaveProperty("excluded_payment_method_types");
    // A checkout's session lives as long as the stock is held, and a minute.
    expect(params.expires_at - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(CHECKOUT_MINUTES * 60 + 60);
    expect(params.expires_at - Math.floor(Date.now() / 1000)).toBeGreaterThan(CHECKOUT_MINUTES * 60);
  });

  it("asks Stripe for its invoice only for a whole order, never for a change, an exchange or a balance on terms that Kaizena Flow invoices", async () => {
    await db().execute(sql`update commerce.payment_providers set order_invoices = true where store_id = ${live.storeId}::uuid`);
    await db().execute(sql`insert into commerce.invoice_settings (store_id, enabled) values (${live.storeId}::uuid, false) on conflict (store_id) do update set enabled = false`);
    try {
      const order = await placed(live, [["DEMO-MUG-WHITE", 1]]);
      await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" });
      expect(lastSession().params.invoice_creation).toMatchObject({
        enabled: true,
        invoice_data: { metadata: { order_id: order.orderId }, custom_fields: [{ name: "Herav mva", value: expect.any(String) }] },
      });
      const balance = await placed(live, [["DEMO-MUG-WHITE", 1]]);
      await openPaymentSession(shopOf(live), balance, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted", exactAmounts: true, termsBalance: true, idempotencyKey: `terms-pay-${balance.orderId}-0` });
      const { params } = lastSession();
      expect(params).not.toHaveProperty("invoice_creation");
      // The webhook tells a balance on terms from the order's first payment by its metadata.
      expect(params.metadata).toEqual({ order_id: balance.orderId, order_number: balance.number, store_id: live.storeId, terms_balance: "1" });
    } finally {
      await db().execute(sql`update commerce.payment_providers set order_invoices = false where store_id = ${live.storeId}::uuid`);
      await db().execute(sql`delete from commerce.invoice_settings where store_id = ${live.storeId}::uuid`);
    }
  });

  it("makes a test store's session with the test client on its test account", async () => {
    const order = await placed(test, [["DEMO-MUG-WHITE", 1]]);
    const result = await openPaymentSession(shopOf(test), order, "https://shop.test", "Frakt", { ...(await connected(test)), ui: "hosted" });
    expect(result.ok).toBe(true);
    const { options, mode } = lastSession();
    expect(mode).toBe("test");
    expect(options.stripeAccount).toBe(test.account);
    const session = stripe.sessions.get(result.ok ? result.sessionId : "")!;
    expect(session.livemode).toBe(false);
    expect(await paymentsOf(order.orderId)).toMatchObject([{ provider_account: test.account }]);
  });
});

describe("a host's listings (D71)", () => {
  let hostId: string;
  const hostAccount = `acct_payhost${fx.run}`;

  beforeAll(async () => {
    const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`payhost-${fx.run}@example.com`}, 'Host') returning id`);
    const [host] = await db().execute<Row>(sql`
      insert into commerce.hosts (store_id, account_id, name, commission_bps) values (${live.storeId}::uuid, ${String(account.id)}::uuid, 'Hytta', 1000) returning id
    `);
    hostId = String(host.id);
  });

  it("refuses before asking Stripe while the host cannot take payments", async () => {
    const order = { ...(await placed(live, [["DEMO-MUG-WHITE", 1]])), hostId };
    const mark = stripe.calls.length;
    expect(await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" })).toEqual({ ok: false, problem: "host_payments_off" });
    expect(stripe.calls.slice(mark).map((call) => call.method)).not.toContain("checkout.sessions.create");
    expect(await paymentsOf(order.orderId)).toEqual([]);
  });

  it("pays on the host's own account, with the store's commission in the fee, and keeps Kaizena Flow's part apart", async () => {
    await db().execute(sql`
      insert into commerce.host_stripe_accounts (host_id, store_id, mode, account_id, card_payments, requirements_due)
      values (${hostId}::uuid, ${live.storeId}::uuid, 'live', ${hostAccount}, 'active', false)
    `);
    const order = { ...(await placed(live, [["DEMO-MUG-WHITE", 2]])), hostId };
    const result = await openPaymentSession(shopOf(live), order, "https://shop.test", "Frakt", { ...(await connected(live)), ui: "hosted" });
    expect(result.ok).toBe(true);
    const kaizena = saleFee(order.dueNowMinor, 150)!;
    const commission = Math.round(order.dueNowMinor * 0.1);
    const { params, options } = lastSession();
    expect(options.stripeAccount).toBe(hostAccount);
    expect(params.payment_intent_data.application_fee_amount).toBe(kaizena + commission);
    // A host is the seller of their own bookings: the store's invoice is not theirs.
    expect(params).not.toHaveProperty("invoice_creation");
    const [row] = await db().execute<Row>(sql`select commission_minor::int as commission from commerce.orders where id = ${order.orderId}::uuid`);
    expect(row.commission).toBe(commission);
    expect(await paymentsOf(order.orderId)).toMatchObject([{ provider_account: hostAccount, fee: kaizena, amount: order.dueNowMinor }]);
  });
});

describe("what a payment session writes down", () => {
  it("never puts a client secret or a shopper's address in a log line", () => {
    const said = logs.join("\n");
    expect(stripe.secrets.length).toBeGreaterThan(0);
    for (const secret of [...stripe.secrets, "kari@example.no", "_secret_"]) expect(said).not.toContain(secret);
  });
});
