import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

/**
 * Express checkout (wave 10 unit J, D373), against a stand-in for Stripe: the express area's press places the cart's order and opens its
 * Checkout Session through the checkout's own path, the wallet's sheet completes it, and the order is paid with the wallet's address and the
 * delivery the cart chose; where it is not offered it says so; the wallets card reads each address's state from Stripe.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./refresh", () => ({ refreshTag: () => {}, refreshTagNow: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const registered: { domain: string; account?: string }[] = [];
  let next = 0;
  const client = {
    paymentMethodDomains: {
      create: async (params: { domain_name: string }, options: { stripeAccount?: string }) => {
        registered.push({ domain: params.domain_name, account: options?.stripeAccount });
        return { id: `pmd_${registered.length}`, domain_name: params.domain_name, enabled: true };
      },
      list: async (params: { domain_name: string }) => ({
        data: [
          {
            id: "pmd_listed",
            domain_name: params.domain_name,
            enabled: true,
            apple_pay: { status: "inactive", status_details: { error_message: "The domain association file could not be read." } },
            google_pay: { status: "active" },
            link: { status: "active" },
            klarna: { status: "active" },
            paypal: { status: "active" },
          },
        ],
      }),
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_express_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", mode: params.mode });
          created.push({ params, options });
          return { id, url: null, client_secret: `${id}_secret_test`, payment_method_types: ["card", "link"] };
        },
        retrieve: async (id: string) => ({ id, ...sessions.get(id) }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client, created, sessions, registered };
});

vi.mock("./connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connect")>()),
  getCheckoutUi: async () => "custom",
}));
vi.mock("./stripe", () => ({
  platformStripe: () => fake.client,
  platformPublishableKey: () => "pk_test_express",
  platformModes: () => ["test"],
}));

const { changeLine, readCartId } = await import("./cart");
const { chooseDelivery } = await import("./delivery-options");
const { getShopperOrder } = await import("./orders");
const { getStore } = await import("./stores");
const { checkWalletDomains, expressOn, klarnaMessaging, startExpress, walletDomains } = await import("./express-checkout");
const { saveMethodChoices } = await import("./payment-methods");

const run = Date.now().toString(36);
const slug = `express-${run}`;
const accountId = `acct_express${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let methodId: string;

const store = async () => (await getStore(slug))!;
const shop = () => ({ storeId, market: no });

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [made] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  storeId = String(made.id);
  await db().execute(sql`update commerce.stores set legal_name = 'Test AS', organisation_number = '999999999' where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${accountId}, 'active', false)
  `);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${storeId}::uuid`);
  // The store's own shipping method beside the flat rate (D237): the wallet's sheet carries the one the cart chose.
  const [method] = await db().execute<Row>(sql`
    insert into commerce.shipping_methods (store_id, market_code, currency, name) values (${storeId}::uuid, 'NO', 'NOK', 'Express') returning id
  `);
  methodId = String(method.id);
  await db().execute(sql`
    insert into commerce.shipping_method_rates (store_id, method_id, basis, amount_minor) values (${storeId}::uuid, ${methodId}::uuid, 'flat', 14900)
  `);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

async function variant(sku: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}`);
  return String(row.id);
}

describe("an express payment", () => {
  it("is offered on the store's own checkout to a private buyer", async () => {
    const s = await store();
    expect(await expressOn(s, s.markets.find((m) => m.code === "NO") ?? s.markets[0])).toBe(true);
  });

  it("places the cart's order through checkout and ends paid with the wallet's address and the cart's delivery", async () => {
    jar.clear();
    const s = await store();
    const market = s.markets.find((m) => m.code === "NO") ?? s.markets[0];
    await changeLine(shop(), await variant("DEMO-MUG-WHITE"), 2, "add");
    const cartId = (await readCartId(shop()))!;
    expect(await chooseDelivery(shop(), cartId, `method:${methodId}`)).toEqual({ ok: true });

    const started = await startExpress({ store: s, market }, cartId, "https://shop.example", "Frakt");
    expect(started).toMatchObject({ ok: true, publishableKey: "pk_test_express", stripeAccount: accountId, lines: 1 });
    if (!started.ok) return;
    expect(started.clientSecret).toMatch(/^cs_express_\d+_secret_test$/);
    // The same session the checkout page opens: Stripe's form on Kaizena Flow's page, the address asked, the cart's delivery as its one option.
    const { params, options } = fake.created.at(-1)!;
    expect(options).toMatchObject({ stripeAccount: accountId });
    expect(params).toMatchObject({ ui_mode: "elements", shipping_address_collection: { allowed_countries: ["NO"] } });
    // Nothing is left out of Stripe's choice for Norway, Klarna included (D291): Stripe offers it where it suits the shopper.
    expect(params.excluded_payment_method_types).toBeUndefined();
    expect(params).not.toHaveProperty("payment_method_types");
    expect(params.shipping_options).toEqual([
      expect.objectContaining({ shipping_rate_data: expect.objectContaining({ display_name: "Express", fixed_amount: { amount: 14900, currency: "nok" } }) }),
    ]);

    // The wallet's sheet is done: Stripe holds who paid and the address the wallet gave.
    fake.sessions.set(started.sessionId, {
      status: "complete",
      payment_status: "paid",
      mode: "payment",
      payment_intent: `pi_${started.sessionId}`,
      customer_details: { email: `wallet-${run}@example.com`, name: "Wallet Person", phone: null, address: { line1: "Billing 1", line2: null, postal_code: "0150", city: "Oslo", country: "NO" } },
      collected_information: { shipping_details: { name: "Wallet Person", address: { line1: "Walletveien 7", line2: null, postal_code: "0155", city: "Oslo", country: "NO" } } },
    });
    const paid = await getShopperOrder(storeId, started.orderId, started.sessionId);
    expect(paid?.status).toBe("paid");
    const [order] = await db().execute<Row>(sql`
      select status, email, shipping_address, delivery_method, delivery ->> 'kind' as kind, delivery ->> 'methodId' as method_id, shipping_minor::int as shipping_minor
      from commerce.orders where id = ${started.orderId}::uuid
    `);
    expect(order).toMatchObject({
      status: "paid",
      email: `wallet-${run}@example.com`,
      kind: "method",
      method_id: methodId,
      shipping_minor: 14900,
      shipping_address: expect.objectContaining({ line1: "Walletveien 7", postalCode: "0155", city: "Oslo", country: "NO" }),
    });
  });

  it("is not offered where the store requires an account and nobody is signed in", async () => {
    jar.clear();
    await db().execute(sql`update commerce.stores set customer_accounts = 'required' where id = ${storeId}::uuid`);
    try {
      const s = await store();
      expect(await expressOn(s, s.markets[0])).toBe(false);
    } finally {
      await db().execute(sql`update commerce.stores set customer_accounts = 'optional' where id = ${storeId}::uuid`);
    }
  });

  it("refuses an empty cart before anything is placed", async () => {
    jar.clear();
    const s = await store();
    const before = fake.created.length;
    await changeLine(shop(), await variant("DEMO-MUG-WHITE"), 1, "add");
    const cartId = (await readCartId(shop()))!;
    await db().execute(sql`delete from commerce.cart_lines where cart_id = ${cartId}::uuid`);
    expect(await startExpress({ store: s, market: s.markets[0] }, cartId, "https://shop.example", "Frakt")).toEqual({ ok: false, problem: "empty" });
    expect(fake.created.length).toBe(before);
  });
});

describe("Klarna's line under a price", () => {
  it("is drawn only while Klarna is active on the store's account and on for the country", async () => {
    const s = await store();
    const market = s.markets.find((m) => m.code === "NO") ?? s.markets[0];
    // Stripe has not said Klarna is active yet.
    expect(await klarnaMessaging(s, market)).toBeNull();
    await db().execute(sql`
      update commerce.stripe_accounts set method_states = '{"card_payments":{"status":"active"},"klarna_payments":{"status":"active"}}'::jsonb
      where store_id = ${storeId}::uuid and mode = 'test'
    `);
    expect(await klarnaMessaging(s, market)).toEqual({ publishableKey: "pk_test_express", stripeAccount: accountId });
    // Switched off for Norway by the owner (D291): no line there.
    const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid and role = 'owner' limit 1`);
    await saveMethodChoices(storeId, String(owner.account_id), { markets: ["NO"], on: new Set() });
    expect(await klarnaMessaging(s, market)).toBeNull();
    // A currency Stripe's element does not draw.
    expect(await klarnaMessaging(s, { ...market, currency: "ISK" })).toBeNull();
  });
});

describe("the wallets card", () => {
  it("registers the store's addresses on its account and keeps each wallet's state with Stripe's reason", async () => {
    // The store is under Kaizena Flow's own address while stores have no hosts of their own.
    vi.stubEnv("SITE_URL", "https://kaizenaflow.test");
    expect(await walletDomains(storeId, "test")).toBeNull();
    const checked = await checkWalletDomains(storeId, slug, "test", null);
    expect(checked).toMatchObject({ ok: true });
    expect(fake.registered.every((r) => r.account === accountId)).toBe(true);
    const read = await walletDomains(storeId, "test");
    expect(read).not.toBeNull();
    expect(Object.keys(read!.domains)).toEqual(["kaizenaflow.test"]);
    expect(fake.registered).toContainEqual({ domain: "kaizenaflow.test", account: accountId });
    const [domain] = Object.values(read!.domains);
    expect(domain.wallets).toEqual({
      apple_pay: { status: "inactive", reason: "The domain association file could not be read." },
      google_pay: { status: "active", reason: null },
      link: { status: "active", reason: null },
      klarna: { status: "active", reason: null },
    });
  });

  it("says there is no account for a mode the store has none in", async () => {
    expect(await checkWalletDomains(storeId, slug, "live", null)).toEqual({ ok: false, problem: "no_account" });
  });
});
