import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

/**
 * An account billed through its account (D748 E4 part two): one subscription on Kaizena Flow's Stripe account (a stand-in that keeps each
 * subscription's items) with the plan and the extensions bought on their own as items; Stripe's word recorded on the account's row and its
 * extension rows; an extension taken off ends with its grace period.
 */

type Row = Record<string, unknown>;

const fake = vi.hoisted(() => {
  let next = 0;
  const tag = Date.now().toString(36);
  const id = (prefix: string) => `${prefix}_acct${tag}n${++next}`;
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const subscriptions = new Map<string, { id: string; items: { id: string; price: string }[]; status: string; cancel: boolean; metadata: Record<string, string> }>();
  const shape = (s: { id: string; items: { id: string; price: string }[]; status: string; cancel: boolean; metadata: Record<string, string> }) => ({
    id: s.id,
    object: "subscription",
    status: s.status,
    cancel_at_period_end: s.cancel,
    metadata: s.metadata,
    items: { data: s.items.map((item) => ({ id: item.id, price: { id: item.price }, current_period_end: 1_800_000_000 })) },
  });
  const record =
    (method: string, make: (params: Record<string, unknown>) => unknown) =>
    async (...args: unknown[]) => {
      const params = (typeof args[0] === "string" ? { id: args[0], ...(args[1] as object) } : args[0]) as Record<string, unknown>;
      calls.push({ method, params });
      return make(params);
    };
  const client = {
    products: { create: record("products.create", () => ({ id: id("prod") })), update: record("products.update", (p) => ({ id: p.id })) },
    prices: { create: record("prices.create", () => ({ id: id("price") })), update: record("prices.update", (p) => ({ id: p.id })) },
    taxRates: { create: record("taxRates.create", () => ({ id: id("txr") })) },
    billingPortal: {
      configurations: { create: record("portal.configurations.create", () => ({ id: id("bpc") })) },
      sessions: { create: record("portal.sessions.create", () => ({ url: "https://billing.stripe.test/account" })) },
    },
    checkout: { sessions: { create: record("checkout.sessions.create", () => ({ id: "cs_account_1", url: "https://checkout.stripe.test/account" })) } },
    subscriptions: {
      create: record("subscriptions.create", (p) => {
        const made = {
          id: id("sub"),
          items: (p.items as { price: string }[]).map((item) => ({ id: id("si"), price: item.price })),
          status: p.trial_period_days ? "trialing" : "active",
          cancel: false,
          metadata: (p.metadata as Record<string, string>) ?? {},
        };
        subscriptions.set(made.id, made);
        return shape(made);
      }),
      retrieve: record("subscriptions.retrieve", (p) => shape(subscriptions.get(String(p.id))!)),
      update: record("subscriptions.update", (p) => {
        const s = subscriptions.get(String(p.id))!;
        for (const change of (p.items as ({ id: string; deleted: true } | { price: string })[] | undefined) ?? []) {
          if ("deleted" in change) s.items = s.items.filter((item) => item.id !== change.id);
          else s.items.push({ id: id("si"), price: change.price });
        }
        if (typeof p.cancel_at_period_end === "boolean") s.cancel = p.cancel_at_period_end;
        if (p.metadata) s.metadata = p.metadata as Record<string, string>;
        return shape(s);
      }),
      cancel: record("subscriptions.cancel", (p) => {
        const s = subscriptions.get(String(p.id))!;
        s.status = "canceled";
        return shape(s);
      }),
    },
    v2: {
      core: {
        accounts: {
          create: record("accounts.create", (p) => ({
            id: id("acct"),
            dashboard: p.dashboard,
            configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
            requirements: { entries: [] },
          })),
          update: record("accounts.update", (p) => ({ id: p.id })),
          retrieve: record("accounts.retrieve", (p) => ({
            id: p.id,
            dashboard: "none",
            configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } },
            requirements: { entries: [] },
          })),
        },
      },
    },
    paymentMethodConfigurations: {
      list: record("pmc.list", () => ({ data: [{ id: "pmc_child", is_default: true }] })),
      update: record("pmc.update", (p) => ({ id: p.id })),
    },
    accounts: { createExternalAccount: record("accounts.createExternalAccount", () => ({ id: id("ba") })) },
  };
  return { client, calls, subscriptions, shape };
});

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));
vi.mock("./stripe", async (importActual) => ({
  ...(await importActual<typeof import("./stripe")>()),
  platformStripe: (mode: string) => (mode === "test" ? fake.client : null),
  platformModes: () => ["test"],
}));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const accounts = await import("./account-billing");

const run = Date.now().toString(36);
const slug = `account-billing-${run}`;
let admin: Account;
let owner: Account;
let storeId: string;
let organisation: string;
let planId: string;
let planPrice: string;
let workPrice: string;
let dealsPrice: string;
const origin = "https://kaizen.test";
const calls = (method: string) => fake.calls.filter((call) => call.method === method);

beforeAll(async () => {
  process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  const [a] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`account-admin-${run}@example.com`}, 'Admin', true) returning id, email`);
  admin = { id: String(a.id), email: String(a.email), name: "Admin", platformAdmin: true };
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Owner', 'Account billing') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Account billing', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${storeId}::uuid`);
  const [o] = await db().execute<Row>(sql`select a.id, a.email, s.organisation_id from commerce.accounts a, commerce.stores s where lower(a.email) = ${`${slug}@example.com`} and s.id = ${storeId}::uuid`);
  owner = { id: String(o.id), email: String(o.email), name: "Owner", platformAdmin: false };
  organisation = String(o.organisation_id);
  const [p] = await db().execute<Row>(sql`insert into commerce.plans (name) values (${`Account plan ${run}`}) returning id`);
  planId = String(p.id);
  const [pp] = await db().execute<Row>(sql`insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values (${planId}::uuid, 'NOK', 'month', 30000) returning id`);
  planPrice = String(pp.id);
  const price = async (extension: string) => {
    const [row] = await db().execute<Row>(sql`
      select ep.id from commerce.extension_prices ep join commerce.extension_sizes es on es.id = ep.size_id
       where es.extension_id = ${extension} and ep.active and es.active and ep.currency = 'NOK' and ep.interval = 'month'
       order by es.position limit 1`);
    return String(row.id);
  };
  workPrice = await price("work");
  dealsPrice = await price("deals");
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.organisation_extensions where organisation_id = ${organisation}::uuid`);
  await db().execute(sql`delete from commerce.organisation_billing where organisation_id = ${organisation}::uuid`);
  await closeDb();
});

describe("an account's one subscription (D748 E4 part two)", () => {
  it("copies every extension to Stripe as a product with its prices, once", async () => {
    expect(await accounts.syncExtensions("test")).toEqual({ ok: true });
    // Every extension has its product and every offered price its Stripe price (made now, or by an earlier run on this database).
    const missing = await db().execute<Row>(sql`
      select e.id from commerce.extensions e
       where not exists (select 1 from commerce.stripe_sync s where s.mode = 'test' and s.kind = 'product' and s.local_id = 'extension:' || e.id and s.stripe_id is not null)
      union all
      select ep.id::text from commerce.extension_prices ep
       where ep.active and not exists (select 1 from commerce.stripe_sync s where s.mode = 'test' and s.kind = 'price' and s.local_id = ep.id::text and s.stripe_id is not null)`);
    expect(missing).toEqual([]);
    const prices = calls("prices.create").length;
    expect(await accounts.syncExtensions("test")).toEqual({ ok: true });
    expect(calls("prices.create")).toHaveLength(prices);
  });

  it("refuses an account still billed store by store", async () => {
    expect(await accounts.chooseAccountPlan(owner, organisation, { planPriceId: planPrice, extensionPriceIds: [] }, origin)).toEqual({
      ok: false,
      problems: [accounts.NOT_BILLED_BY_ACCOUNT],
    });
    expect(await accounts.getAccountBilling(organisation)).toBeNull();
  });

  it("starts one subscription with the plan and an extension, billed to the first store's Stripe account", async () => {
    await db().execute(sql`insert into commerce.organisation_billing (organisation_id) values (${organisation}::uuid)`);
    expect(await accounts.assignAccountPlan(admin, organisation, { planPriceId: planPrice, extensionPriceIds: [workPrice] }, 0, origin)).toEqual({ ok: true });
    const created = calls("subscriptions.create").at(-1)?.params;
    const [store] = await db().execute<Row>(sql`select account_id from commerce.stripe_accounts where store_id = ${storeId}::uuid and mode = 'test'`);
    expect(created).toMatchObject({ customer_account: String(store.account_id), collection_method: "send_invoice", metadata: { kaizen_organisation_id: organisation, kaizen_plan_id: planId } });
    expect(created?.items).toHaveLength(2);
    // Norway: 25 % MVA on what Kaizena Flow bills.
    expect((created?.default_tax_rates as string[]).length).toBe(1);
    const billing = await accounts.getAccountBilling(organisation);
    expect(billing).toMatchObject({ planId, status: "active", mode: "test", customerAccount: String(store.account_id) });
    const rows = await db().execute<Row>(sql`select extension_id, source, ended_at from commerce.organisation_extensions where organisation_id = ${organisation}::uuid`);
    expect(rows).toEqual([{ extension_id: "work", source: "bought", ended_at: null }]);
    // Every store of the account now reads the account's plan.
    const [plan] = await db().execute<Row>(sql`select plan_id, by_account from commerce.store_plans where store_id = ${storeId}::uuid`);
    expect(plan).toEqual({ plan_id: planId, by_account: true });
  });

  it("changes the items at once, prorated: an extension added, one taken off ends with its grace period", async () => {
    const result = await accounts.chooseAccountPlan(owner, organisation, { planPriceId: planPrice, extensionPriceIds: [dealsPrice] }, origin);
    expect(result).toEqual({ ok: true });
    expect(calls("checkout.sessions.create")).toHaveLength(0);
    const update = calls("subscriptions.update").at(-1)?.params;
    expect(update).toMatchObject({ proration_behavior: "create_prorations" });
    // The plan's item is kept as it was: only Work's is deleted and Deals' added.
    expect((update?.items as unknown[]).length).toBe(2);
    const rows = await db().execute<Row>(sql`
      select extension_id, source, ended_at is not null as ended, grace_ends_at > now() + interval '13 days' as grace
        from commerce.organisation_extensions where organisation_id = ${organisation}::uuid order by extension_id`);
    expect(rows).toEqual([
      { extension_id: "deals", source: "bought", ended: false, grace: null },
      { extension_id: "work", source: "bought", ended: true, grace: true },
    ]);
  });

  it("never sells an extension the plan includes, nor mixes currencies", async () => {
    const [size] = await db().execute<Row>(sql`select id from commerce.extension_sizes where extension_id = 'deals' order by position limit 1`);
    await db().execute(sql`insert into commerce.plan_extension_grants (plan_id, extension_id, size_id) values (${planId}::uuid, 'deals', ${String(size.id)}::uuid)`);
    try {
      expect(await accounts.chooseAccountPlan(owner, organisation, { planPriceId: planPrice, extensionPriceIds: [dealsPrice] }, origin)).toEqual({
        ok: false,
        problems: ["Deals and contracts is in the plan already."],
      });
    } finally {
      await db().execute(sql`delete from commerce.plan_extension_grants where plan_id = ${planId}::uuid`);
    }
    const [eur] = await db().execute<Row>(sql`
      select ep.id from commerce.extension_prices ep join commerce.extension_sizes es on es.id = ep.size_id
       where es.extension_id = 'work' and ep.active and ep.currency = 'EUR' and ep.interval = 'month' limit 1`);
    expect(await accounts.chooseAccountPlan(owner, organisation, { planPriceId: planPrice, extensionPriceIds: [String(eur.id)] }, origin)).toEqual({
      ok: false,
      problems: ["Everything on the account's plan is billed in one currency."],
    });
  });

  it("ends what the subscription paid for when it is cancelled, and a late event about an old one changes nothing", async () => {
    const before = await accounts.getAccountBilling(organisation);
    expect(await accounts.cancelAccountPlan(owner, organisation, "now")).toEqual({ ok: true });
    expect(await accounts.getAccountBilling(organisation)).toMatchObject({ status: "canceled", subscriptionId: before?.subscriptionId });
    const [deals] = await db().execute<Row>(sql`
      select ended_at is not null as ended from commerce.organisation_extensions where organisation_id = ${organisation}::uuid and extension_id = 'deals'`);
    expect(deals).toEqual({ ended: true });
    // A new subscription; then a late event about another, cancelled one does not replace it.
    expect(await accounts.assignAccountPlan(admin, organisation, { planPriceId: planPrice, extensionPriceIds: [] }, 14, origin)).toEqual({ ok: true });
    const current = await accounts.getAccountBilling(organisation);
    expect(current).toMatchObject({ status: "trialing" });
    const late = fake.shape({ id: "sub_old", items: [], status: "canceled", cancel: false, metadata: { kaizen_organisation_id: organisation } });
    expect(await accounts.applyAccountSubscription(late as never, "test")).toBe(true);
    expect(await accounts.getAccountBilling(organisation)).toMatchObject({ status: "trialing", subscriptionId: current?.subscriptionId });
    // A store's own subscription is not the account's.
    expect(await accounts.applyAccountSubscription(fake.shape({ id: "sub_store", items: [], status: "active", cancel: false, metadata: {} }) as never, "test")).toBe(false);
  });

  it("opens Stripe's portal and lists invoices for the account's customer", async () => {
    expect(await accounts.accountPortalUrl(organisation, `${origin}/admin`)).toEqual({ ok: true, url: "https://billing.stripe.test/account" });
    const [store] = await db().execute<Row>(sql`select account_id from commerce.stripe_accounts where store_id = ${storeId}::uuid and mode = 'test'`);
    expect(calls("portal.sessions.create").at(-1)?.params).toMatchObject({ customer_account: String(store.account_id) });
  });
});

describe("the move to one plan (D748 E4 part four)", () => {
  it("keeps the highest plan's subscription for the account, ends the others with credit, and tells the owner", async () => {
    const moves = await import("./account-move");
    const tag = `${run}m`;
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name) values (${`move-${tag}@example.com`}, 'Mover', 'Move one') returning id`);
    const [a] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`move-a-${tag}`}, 'Move one', null) as id`);
    const storeA = String(a.id);
    const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = ${`move-${tag}@example.com`}`);
    const [b] = await db().execute<Row>(sql`insert into commerce.stores (slug, name, created_by) values (${`move-b-${tag}`}, 'Move two', ${String(owner.id)}::uuid) returning id`);
    const storeB = String(b.id);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${storeB}::uuid, ${String(owner.id)}::uuid, 'owner')`);
    await db().execute(sql`update commerce.stores set country = 'NO', status = 'active' where id in (${storeA}::uuid, ${storeB}::uuid)`);
    const [org] = await db().execute<Row>(sql`select organisation_id from commerce.stores where id = ${storeB}::uuid`);
    const moved = String(org.organisation_id);
    const plan = async (name: string, position: number, amount: number) => {
      const [p] = await db().execute<Row>(sql`insert into commerce.plans (name, position) values (${`${name} ${tag}`}, ${position}) returning id`);
      const [pp] = await db().execute<Row>(sql`insert into commerce.plan_prices (plan_id, currency, interval, amount_minor) values (${String(p.id)}::uuid, 'NOK', 'month', ${amount}) returning id`);
      return { plan: String(p.id), price: String(pp.id) };
    };
    const basic = await plan("Basic", 0, 30000);
    const grow = await plan("Grow", 1, 99000);
    for (const [store, p, sub] of [[storeA, basic, `sub_a_${tag}`], [storeB, grow, `sub_b_${tag}`]] as const) {
      fake.subscriptions.set(sub, { id: sub, items: [{ id: `si_${sub}`, price: `price_${sub}` }], status: "active", cancel: false, metadata: { kaizen_store_id: store } });
      await db().execute(sql`
        insert into commerce.store_billing (store_id, plan_id, price_id, mode, subscription_id, status)
        values (${store}::uuid, ${p.plan}::uuid, ${p.price}::uuid, 'test', ${sub}, 'active')`);
    }
    await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id) values (${storeB}::uuid, 'test', ${`acct_B${tag}`})`);

    const [preview] = await moves.movePreviews(moved);
    expect(preview).toMatchObject({
      billed: false,
      kept: { storeId: storeB, subscriptionId: `sub_b_${tag}` },
      ending: [{ storeId: storeA, subscriptionId: `sub_a_${tag}` }],
      before: [{ currency: "NOK", minor: 129000 }],
      after: [{ currency: "NOK", minor: 99000 }],
    });

    const [{ since }] = await db().execute<Row>(sql`select now() as since`);
    expect(await moves.moveAccount(admin, moved)).toEqual({ ok: true });
    expect(await accounts.getAccountBilling(moved)).toMatchObject({
      planId: grow.plan,
      subscriptionId: `sub_b_${tag}`,
      status: "active",
      customerAccount: `acct_B${tag}`,
    });
    expect(calls("subscriptions.update").at(-1)?.params).toMatchObject({ id: `sub_b_${tag}`, metadata: { kaizen_organisation_id: moved, kaizen_store_id: storeB } });
    expect(calls("subscriptions.cancel").at(-1)?.params).toMatchObject({ id: `sub_a_${tag}`, prorate: true, invoice_now: true });
    const own = await db().execute<Row>(sql`select store_id, subscription_id, status from commerce.store_billing where store_id in (${storeA}::uuid, ${storeB}::uuid) order by store_id = ${storeB}::uuid`);
    expect(own).toEqual([
      { store_id: storeA, subscription_id: `sub_a_${tag}`, status: "canceled" },
      { store_id: storeB, subscription_id: null, status: null },
    ]);
    // Both stores read the account's plan; the plan's history holds the ended plan only, not the kept one handed over.
    const plans = await db().execute<Row>(sql`select plan_id, by_account from commerce.store_plans where store_id in (${storeA}::uuid, ${storeB}::uuid)`);
    expect(plans).toEqual([
      { plan_id: grow.plan, by_account: true },
      { plan_id: grow.plan, by_account: true },
    ]);
    const after = await db().execute<Row>(sql`select kind, plan_id from commerce.plan_moves where at > ${String(since)}::timestamptz and store_id in (${storeA}::uuid, ${storeB}::uuid)`);
    expect(after).toEqual([{ kind: "cancelled", plan_id: basic.plan }]);
    const [mail] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where kind = 'billing.account_moved' and lower(to_address) = ${`move-${tag}@example.com`}`);
    expect(mail.n).toBe(1);
    expect(await moves.moveAccount(admin, moved)).toEqual({ ok: false, problems: ["That account is billed through its account already."] });
  });
});
