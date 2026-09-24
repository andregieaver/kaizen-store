import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret } from "@/lib/secret-box";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/** A stand-in for Kaizen's own Stripe account that records what it is asked. */
const fake = vi.hoisted(() => {
  let next = 0;
  // Unique per run, so the tests can run again on the same database.
  const tag = Date.now().toString(36);
  const id = (prefix: string) => `${prefix}_fake${tag}n${++next}`;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const record =
    (method: string, make: (params: Record<string, unknown>) => Record<string, unknown>) =>
    async (...args: unknown[]) => {
      const params = (typeof args[0] === "string" ? { id: args[0], ...(args[1] as object) } : args[0]) as Record<
        string,
        unknown
      >;
      calls.push({ method, params });
      return make(params);
    };
  const subscription = (params: Record<string, unknown>, status = "active") => ({
    id: (params.id as string) ?? id("sub"),
    object: "subscription",
    status: params.trial_period_days ? "trialing" : status,
    cancel_at_period_end: Boolean(params.cancel_at_period_end),
    metadata: params.metadata ?? {},
    items: {
      data: [
        {
          id: "si_fake",
          price: { id: ((params.items as { price: string }[] | undefined)?.[0]?.price as string) ?? "price_unknown" },
          current_period_end: 1_800_000_000,
        },
      ],
    },
  });
  /** What the fake Checkout session hands back on return. */
  const sessions = { storeId: "", stripePrice: "" };
  const client = {
    products: {
      create: record("products.create", () => ({ id: id("prod") })),
      update: record("products.update", (p) => ({ id: p.id })),
    },
    prices: {
      create: record("prices.create", () => ({ id: id("price") })),
      update: record("prices.update", (p) => ({ id: p.id })),
    },
    taxRates: { create: record("taxRates.create", () => ({ id: id("txr") })) },
    billingPortal: {
      configurations: { create: record("portal.configurations.create", () => ({ id: id("bpc") })) },
      sessions: { create: record("portal.sessions.create", () => ({ url: "https://billing.stripe.test/session" })) },
    },
    checkout: {
      sessions: {
        create: record("checkout.sessions.create", () => ({ id: "cs_plan_1", url: "https://checkout.stripe.test/plan" })),
        retrieve: record("checkout.sessions.retrieve", (p) => ({
          id: p.id,
          metadata: { kaizen_store_id: sessions.storeId },
          subscription: subscription({
            id: `sub_checkout${tag}`,
            items: [{ price: sessions.stripePrice }],
            metadata: { kaizen_store_id: sessions.storeId },
          }),
        })),
      },
    },
    subscriptions: {
      create: record("subscriptions.create", (p) => subscription(p)),
      retrieve: record("subscriptions.retrieve", (p) => subscription(p)),
      update: record("subscriptions.update", (p) => subscription(p)),
      cancel: record("subscriptions.cancel", (p) => subscription(p, "canceled")),
    },
    v2: {
      core: {
        accounts: {
          create: record("accounts.create", () => ({
            id: id("acct"),
            configuration: { merchant: { capabilities: { card_payments: { status: "pending" } } } },
            requirements: { entries: [] },
          })),
        },
      },
    },
  };
  return { client, calls, sessions, tag };
});

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
vi.mock("./stripe", async (importActual) => ({
  ...(await importActual<typeof import("./stripe")>()),
  platformStripe: (mode: string) => (mode === "test" ? fake.client : null),
  platformModes: () => ["test"],
}));

const billing = await import("./billing");
const { POST: billingWebhook } = await import("@/app/api/stripe/billing/[mode]/route");

const run = Date.now().toString(36);
const slug = `billing-${run}`;
let storeId: string;
let admin: Account;

beforeAll(async () => {
  process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`admin-${run}@example.com`}, 'Admin', true)
    returning id, email
  `);
  admin = { id: String(account.id), email: String(account.email), name: "Admin", platformAdmin: true };
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Billing test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Billing test', null) as id
  `);
  storeId = String(store.id);
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${storeId}::uuid`);
});

afterAll(async () => {
  await db().execute(sql`update commerce.platform_settings set sale_fee_bps = 0`);
  await closeDb();
});

const calls = (method: string) => fake.calls.filter((call) => call.method === method);

describe("plans", () => {
  let planId: string;

  it("creates a plan with its prices, and copies it to Stripe", async () => {
    const result = await billing.savePlan(admin, null, {
      name: `Basic ${run}`,
      description: "For new stores",
      saleFeeBps: 200,
      position: 1,
      active: true,
      prices: [
        { currency: "NOK", interval: "month", amountMinor: 29_900 },
        { currency: "NOK", interval: "year", amountMinor: 299_000 },
      ],
    });
    expect(result).toMatchObject({ ok: true, note: undefined });
    planId = result.planId as string;

    const plan = (await billing.listPlans()).find((p) => p.id === planId);
    expect(plan?.prices.filter((p) => p.active)).toHaveLength(2);
    expect(plan?.sync.test).toEqual({ synced: true, error: null });
    expect(calls("prices.create").map((c) => c.params)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          nickname: `Basic ${run} · NOK · monthly`,
          currency: "nok",
          unit_amount: 29_900,
          recurring: { interval: "month" },
          tax_behavior: "exclusive",
        }),
      ]),
    );
    const [vat] = await db().execute<Row>(sql`
      select stripe_id from commerce.stripe_sync where mode = 'test' and kind = 'tax_rate'
    `);
    expect(String(vat.stripe_id)).toMatch(/^txr_/);
  });

  it("turns a changed amount into a new price and switches the old one off", async () => {
    const before = calls("prices.create").length;
    await billing.savePlan(admin, planId, {
      name: `Basic ${run}`,
      description: "For new stores",
      saleFeeBps: 150,
      position: 1,
      active: true,
      prices: [{ currency: "NOK", interval: "month", amountMinor: 34_900 }],
    });
    const plan = (await billing.listPlans()).find((p) => p.id === planId);
    expect(plan?.saleFeeBps).toBe(150);
    expect(plan?.prices.filter((p) => p.active).map((p) => p.amountMinor)).toEqual([34_900]);
    expect(plan?.prices.filter((p) => !p.active)).toHaveLength(2);
    expect(calls("prices.create")).toHaveLength(before + 1);

    // Both old prices are switched off in Stripe, once: a later sync leaves them alone.
    const old = await db().execute<Row>(sql`
      select s.stripe_id from commerce.stripe_sync s
      join commerce.plan_prices pp on pp.id::text = s.local_id
      where s.mode = 'test' and s.kind = 'price' and pp.plan_id = ${planId}::uuid and not pp.active and s.archived
    `);
    const switchedOff = (id: unknown) =>
      calls("prices.update").filter((c) => c.params.id === id && c.params.active === false).length;
    expect(old.map((row) => switchedOff(row.stripe_id))).toEqual([1, 1]);
    await billing.syncPlans("test");
    expect(old.map((row) => switchedOff(row.stripe_id))).toEqual([1, 1]);
  });

  it("puts a store on a plan: its Stripe account is created, and it pays the plan's fee", async () => {
    await db().execute(sql`update commerce.platform_settings set sale_fee_bps = 300`);
    expect(await billing.storeFeeBps(storeId)).toBe(300);

    const plan = (await billing.listPlans()).find((p) => p.id === planId);
    const price = plan?.prices.find((p) => p.active);
    const result = await billing.assignPlan(admin, slug, price?.id as string, 14, "https://kaizen.test");
    expect(result).toEqual({ ok: true });

    expect(calls("accounts.create")).toHaveLength(1);
    const created = calls("subscriptions.create")[0].params;
    expect(created).toMatchObject({
      customer_account: expect.stringMatching(/^acct_/),
      collection_method: "send_invoice",
      days_until_due: 14,
      trial_period_days: 14,
      default_tax_rates: [expect.stringMatching(/^txr_/)],
      metadata: { kaizen_store_id: storeId, kaizen_plan_id: planId, kaizen_price_id: price?.id },
    });

    const state = await billing.getStoreBilling(storeId);
    expect(state).toMatchObject({ planId, priceId: price?.id, status: "trialing", mode: "test", feeBps: 150 });
    expect(await billing.storeFeeBps(storeId)).toBe(150);
  });

  it("lets a store's own fee win, and falls back to the default after cancelling", async () => {
    await billing.setStoreFee(admin, storeId, 50);
    expect(await billing.storeFeeBps(storeId)).toBe(50);
    await billing.setStoreFee(admin, storeId, null);

    expect(await billing.cancelPlan(admin, storeId, "now")).toEqual({ ok: true });
    expect(await billing.getStoreBilling(storeId)).toMatchObject({ status: "canceled", feeBps: 300 });
  });

  it("opens Stripe's billing page for the store's own account", async () => {
    const result = await billing.portalUrl(storeId, "https://kaizen.test/admin/x/billing");
    expect(result).toEqual({ ok: true, url: "https://billing.stripe.test/session" });
    expect(calls("portal.sessions.create")[0].params).toMatchObject({
      customer_account: expect.stringMatching(/^acct_/),
      configuration: expect.stringMatching(/^bpc_/),
    });
  });
});

describe("the billing webhook", () => {
  const secret = `whsec_billing_${run}`;
  const signer = new Stripe("sk_test_signing_only");

  beforeAll(async () => {
    const key = Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY as string, "base64");
    await db().execute(sql`
      insert into commerce.platform_webhooks (provider, mode, kind, endpoint_id, url, secret_ciphertext)
      values ('stripe', 'test', 'billing', 'we_billing', 'https://kaizen.test/billing', ${encryptSecret(secret, key)})
      on conflict (provider, mode, kind) do update set secret_ciphertext = excluded.secret_ciphertext
    `);
  });

  const post = (body: string, signature: string) =>
    billingWebhook(
      new Request("http://localhost/api/stripe/billing/test", {
        method: "POST",
        headers: { "stripe-signature": signature },
        body,
      }),
      { params: Promise.resolve({ mode: "test" }) },
    );

  it("records a store's subscription as Stripe reports it, and refuses bad signatures", async () => {
    const body = JSON.stringify({
      id: `evt_sub_${run}`,
      object: "event",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: `sub_hook_${run}`,
          object: "subscription",
          status: "past_due",
          cancel_at_period_end: false,
          metadata: { kaizen_store_id: storeId },
          items: { data: [{ id: "si_1", price: { id: "price_not_kaizen" }, current_period_end: 1_900_000_000 }] },
        },
      },
    });
    const response = await post(body, signer.webhooks.generateTestHeaderString({ payload: body, secret }));
    expect(response.status).toBe(200);
    expect(await billing.getStoreBilling(storeId)).toMatchObject({
      subscriptionId: `sub_hook_${run}`,
      status: "past_due",
      currentPeriodEnd: new Date(1_900_000_000 * 1000).toISOString(),
    });

    const forged = signer.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_other" });
    expect((await post(body, forged)).status).toBe(400);
  });

  it("does not let a late event about an old, cancelled subscription replace the current one", async () => {
    const body = JSON.stringify({
      id: `evt_old_${run}`,
      object: "event",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: `sub_old_${run}`,
          object: "subscription",
          status: "canceled",
          cancel_at_period_end: false,
          metadata: { kaizen_store_id: storeId },
          items: { data: [] },
        },
      },
    });
    await post(body, signer.webhooks.generateTestHeaderString({ payload: body, secret }));
    expect(await billing.getStoreBilling(storeId)).toMatchObject({
      subscriptionId: `sub_hook_${run}`,
      status: "past_due",
    });
  });
});

describe("owners choosing their own plan", () => {
  let ownerStore: string;
  const ownerSlug = `owner-${run}`;
  let owner: Account;

  beforeAll(async () => {
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${ownerSlug}@example.com`}, 'Owner', 'Owner test') returning id
    `);
    const [store] = await db().execute<Row>(sql`
      select commerce.approve_access_request(${String(request.id)}::uuid, ${ownerSlug}, 'Owner test', null) as id
    `);
    ownerStore = String(store.id);
    const [account] = await db().execute<Row>(sql`
      select a.id, a.email from commerce.accounts a where lower(a.email) = ${`${ownerSlug}@example.com`}
    `);
    owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
  });

  const activePrice = async (interval: "month" | "year") => {
    const plan = (await billing.listPlans()).find((p) => p.active && p.prices.some((x) => x.active && x.interval === interval));
    return plan?.prices.find((x) => x.active && x.interval === interval && x.currency === "NOK");
  };

  it("sends a store without a plan to Stripe Checkout, paid by card, with VAT for Norway", async () => {
    const price = await activePrice("month");
    const result = await billing.choosePlan(owner, ownerSlug, price?.id as string, "https://kaizen.test");
    expect(result).toEqual({ ok: true, checkoutUrl: "https://checkout.stripe.test/plan" });
    const params = calls("checkout.sessions.create").at(-1)?.params;
    expect(params).toMatchObject({
      mode: "subscription",
      customer_account: expect.stringMatching(/^acct_/),
      line_items: [{ quantity: 1, tax_rates: [expect.stringMatching(/^txr_/)] }],
      subscription_data: { metadata: { kaizen_store_id: ownerStore, kaizen_price_id: price?.id } },
      success_url: `https://kaizen.test/admin/${ownerSlug}/billing?checkout={CHECKOUT_SESSION_ID}`,
    });
    // Nothing is recorded until the owner has paid.
    expect((await billing.getStoreBilling(ownerStore))?.status).toBeNull();
  });

  it("records the plan when the owner returns from Checkout, and only for their own store", async () => {
    const price = await activePrice("month");
    const [synced] = await db().execute<Row>(sql`
      select stripe_id from commerce.stripe_sync where mode = 'test' and kind = 'price' and local_id = ${price?.id as string}
    `);
    fake.sessions.stripePrice = String(synced.stripe_id);

    fake.sessions.storeId = storeId; // A session for another store: ignored.
    expect(await billing.completePlanCheckout(ownerStore, "cs_plan_1")).toBe(false);

    fake.sessions.storeId = ownerStore;
    expect(await billing.completePlanCheckout(ownerStore, "cs_plan_1")).toBe(true);
    expect(await billing.getStoreBilling(ownerStore)).toMatchObject({
      subscriptionId: `sub_checkout${fake.tag}`,
      status: "active",
      priceId: price?.id,
    });
  });

  it("changes a running plan at once instead of opening Checkout again", async () => {
    // Offer the store's plan yearly too, then switch to that.
    const planId = (await billing.getStoreBilling(ownerStore))?.planId;
    const plan = (await billing.listPlans()).find((p) => p.id === planId);
    const monthly = plan?.prices.find((p) => p.active && p.interval === "month");
    await billing.savePlan(admin, planId as string, {
      name: plan?.name as string,
      description: plan?.description ?? "",
      saleFeeBps: plan?.saleFeeBps ?? 0,
      position: plan?.position ?? 0,
      active: true,
      prices: [
        { currency: "NOK", interval: "month", amountMinor: monthly?.amountMinor as number },
        { currency: "NOK", interval: "year", amountMinor: 349_000 },
      ],
    });
    const yearly = (await billing.listPlans())
      .find((p) => p.id === planId)
      ?.prices.find((p) => p.active && p.interval === "year");
    const checkouts = calls("checkout.sessions.create").length;
    const result = await billing.choosePlan(owner, ownerSlug, yearly?.id as string, "https://kaizen.test");
    expect(result).toEqual({ ok: true });
    expect(calls("checkout.sessions.create")).toHaveLength(checkouts);
    expect(calls("subscriptions.update").at(-1)?.params).toMatchObject({
      id: `sub_checkout${fake.tag}`,
      proration_behavior: "create_prorations",
    });
  });
});
