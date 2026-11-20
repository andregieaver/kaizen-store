import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/**
 * What owners pay Kaizena Flow, as the AI manager tells and changes it (`src/server/billing-tools.ts`, PSI AGT-01, D18; code review 1.9's next,
 * FH9, D811): the plan, its price and the plans offered are read from Kaizena Flow's own rows and put in words by code (the model is given
 * every price it says), a change of plan or its end goes through the Billing page's own functions on Kaizena Flow's Stripe account, only an
 * owner of the store may make one, and the plan never ends at once. Kaizena Flow's own store has no plan (D466): the tools say so.
 *
 * Stripe is the stand-in of `stripe-test-support.ts`, which keeps each subscription as Stripe would.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }), headers: async () => new Headers() }));
vi.mock("./stripe", async (importActual) => {
  const { stripe } = await import("./stripe-test-support");
  return { ...(await importActual<typeof import("./stripe")>()), platformStripe: stripe.platform, platformModes: () => ["test", "live"] };
});
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test", "live"], platformPublishableKey: (mode: string) => `pk_${mode}_x`, platformSecretKey: () => null }));

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { stripe } = await import("./stripe-test-support");
const fx = await import("./invoice-test-fixture");
const tools = await import("./billing-tools");
const { getStore } = await import("./stores");
const { OwnerToolError } = await import("./owner-tool-error");

type Fixture = import("./invoice-test-fixture").Fixture;
type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;

const run = fx.run;
const names = { start: `Start ${run}`, pro: `Pro ${run}`, old: `Old ${run}` };
/** Each price as Kaizena Flow keeps it (minor units, NOK unless named), and its synced Stripe price. */
const prices: Record<string, { id: string; stripe: string; amount: number; currency: string; interval: string }> = {};
let shop: Fixture;
let store: Store;
let owner: Account;
let admin: Account;
let stranger: Account;
let ended: Account;
let subscription: string;

const ctx = (account: Account, on: Store = store) => ({ account, store: on });
/** A price in the words the tools use: the store's own format, never the model's arithmetic. */
const words = (key: string) => `${formatMoney(prices[key].amount, prices[key].currency, "nb-NO")} a ${prices[key].interval} (without VAT)`;

async function billingRow(storeId = shop.storeId): Promise<Row> {
  const [row] = await db().execute<Row>(sql`
    select price_id, status, cancel_at_period_end, subscription_id, updated_by from commerce.store_billing where store_id = ${storeId}::uuid
  `);
  return row;
}

async function plan(name: string, feeBps: number, active = true): Promise<string> {
  const [row] = await db().execute<Row>(sql`insert into commerce.plans (name, sale_fee_bps, active) values (${name}, ${feeBps}, ${active}) returning id`);
  return String(row.id);
}

async function price(key: string, planId: string, currency: string, interval: string, amount: number, active = true): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.plan_prices (plan_id, currency, interval, amount_minor, active) values (${planId}::uuid, ${currency}, ${interval}, ${amount}, ${active}) returning id
  `);
  const stripeId = `price_${key}${run}`;
  await db().execute(sql`insert into commerce.stripe_sync (mode, kind, local_id, stripe_id, synced_at) values ('live', 'price', ${String(row.id)}, ${stripeId}, now())`);
  prices[key] = { id: String(row.id), stripe: stripeId, amount, currency, interval };
}

async function account(name: string, platformAdmin = false): Promise<Account> {
  const email = `billtools-${name}-${run}@example.com`;
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${email}, ${name}, ${platformAdmin}) returning id`);
  return { id: String(row.id), email, name, platformAdmin };
}

/** Rejects with the tool's refusal in words. */
const refusal = async (promise: Promise<unknown>) => {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(OwnerToolError);
  return (error as Error).message;
};

beforeAll(async () => {
  const start = await plan(names.start, 200);
  const pro = await plan(names.pro, 100);
  const old = await plan(names.old, 50, false);
  await price("startMonth", start, "NOK", "month", 29_900);
  await price("startYear", start, "NOK", "year", 299_000);
  await price("proMonth", pro, "NOK", "month", 79_900);
  await price("proEur", pro, "EUR", "month", 6_900);
  // Prices no longer offered, and a plan that is not: never shown, never chosen.
  await price("proOld", pro, "NOK", "year", 500_000, false);
  await price("oldMonth", old, "NOK", "month", 9_900);

  shop = await fx.makeStore("billtools");
  store = (await getStore(shop.slug))!;
  owner = { id: shop.ownerId, email: shop.ownerEmail, name: "Kari", platformAdmin: false };
  admin = await account("admin");
  await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${shop.storeId}::uuid, ${admin.id}::uuid, 'admin')`);
  // Another store's owner, and an owner of this one whose access was ended.
  const elsewhere = await fx.makeStore("billtools-other");
  stranger = { id: elsewhere.ownerId, email: elsewhere.ownerEmail, name: "Kari", platformAdmin: false };
  ended = await account("ended");
  // The store is on Start, monthly, on Kaizena Flow's live Stripe account.
  subscription = stripe.subscription(prices.startMonth.stripe, { kaizen_store_id: shop.storeId });
  await db().execute(sql`
    insert into commerce.store_billing (store_id, plan_id, price_id, mode, subscription_id, status, current_period_end)
    values (${shop.storeId}::uuid, ${start}::uuid, ${prices.startMonth.id}::uuid, 'live', ${subscription}, 'active', '2026-12-09T10:00:00Z')
  `);
});

afterAll(async () => {
  await db().execute(sql`update commerce.plans set active = false where name in (${names.start}, ${names.pro})`);
  await closeDb();
});

describe("billing_overview", () => {
  it("says the plan, its price, state and period, the fee on sales and the plans offered, every price from Kaizena Flow's own rows", async () => {
    const said = await tools.billingOverviewTool(ctx(owner));
    expect(said.plan).toEqual({ name: names.start, price: words("startMonth"), status: "active", period_ends: "2026-12-09", ends_at_period_end: false });
    expect(said).toMatchObject({ fee_on_sales: "2 %" });
    const mine = said.offered.filter((p) => Object.values(names).includes(p.name));
    // The page's currency is the store's own (kroner): the euro price and those no longer offered are left out, and so is the plan that is not.
    expect(mine).toEqual([
      { name: names.pro, fee_on_sales: "1 %", prices: [words("proMonth")], current: false },
      { name: names.start, fee_on_sales: "2 %", prices: [words("startMonth"), words("startYear")], current: true },
    ]);
    expect(said).toMatchObject({ note: expect.stringContaining("prorated"), link: `/admin/${shop.slug}/billing` });
    // Kroner and øre as the store writes them, from the row's minor units: never a figure of the model's.
    expect(words("startMonth")).toMatch(/^299,00\s?kr a month \(without VAT\)$/);
  });

  it("says there is no plan yet, and the platform's fee, for a store that has none", async () => {
    const other = await fx.makeStore("billtools-none");
    const said = await tools.billingOverviewTool(ctx(owner, (await getStore(other.slug))!));
    expect(said).toMatchObject({ plan: null, fee_on_sales: "0 %", note: expect.stringContaining("no plan yet"), link: `/admin/${other.slug}/billing` });
    expect(said.offered.every((p) => !p.current)).toBe(true);
  });
});

describe("who may change the plan", () => {
  it("refuses an admin, another store's owner and an owner whose access was ended, before Stripe is asked", async () => {
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role, disabled_at) values (${shop.storeId}::uuid, ${ended.id}::uuid, 'owner', now())`);
    const mark = stripe.calls.length;
    const before = await billingRow();
    for (const who of [admin, stranger, ended]) {
      expect(await refusal(tools.preflightChangePlan(ctx(who), { plan: names.pro, interval: "month" }))).toBe("Only an owner of the store changes its plan.");
      expect(await refusal(tools.changePlanTool(ctx(who), { plan: names.pro, interval: "month" }))).toBe("Only an owner of the store changes its plan.");
      expect(await refusal(tools.preflightEndPlan(ctx(who), { when: "period_end" }))).toBe("Only an owner of the store changes its plan.");
      expect(await refusal(tools.endPlanTool(ctx(who), { when: "period_end" }))).toBe("Only an owner of the store changes its plan.");
    }
    expect(stripe.calls.slice(mark)).toEqual([]);
    expect(await billingRow()).toEqual(before);
  });
});

describe("change_plan", () => {
  it("refuses a plan or interval not offered, the plan the store is on, and a store with no plan yet, naming what is offered", async () => {
    const said = await refusal(tools.preflightChangePlan(ctx(owner), { plan: "Enterprise", interval: "month" }));
    expect(said).toMatch(/^There is no plan "Enterprise"\. Offered: /);
    expect(said).toContain(names.pro);
    expect(said).not.toContain(names.old);
    expect(await refusal(tools.preflightChangePlan(ctx(owner), { plan: names.old, interval: "month" }))).toMatch(/^There is no plan/);
    expect(await refusal(tools.preflightChangePlan(ctx(owner), { plan: names.pro, interval: "year" }))).toBe(`${names.pro} has no yearly price in NOK.`);
    expect(await refusal(tools.preflightChangePlan(ctx(owner), { plan: ` ${names.start.toUpperCase()} `, interval: "month" }))).toBe(`The store is on ${names.start} (monthly) already.`);
    const none = await fx.makeStore("billtools-first");
    const first = { account: { id: none.ownerId, email: none.ownerEmail, name: "Kari", platformAdmin: false }, store: (await getStore(none.slug))! };
    expect(await refusal(tools.preflightChangePlan(first, { plan: names.pro, interval: "month" }))).toMatch(/^The store has no plan yet: the first one is chosen and paid by card on the Billing page/);
    expect(await tools.changePlanSummary(first, { plan: names.pro, interval: "month" })).toBeNull();
  });

  it("asks the owner's yes for the plan, the price in words and what it replaces", async () => {
    expect(await tools.changePlanSummary(ctx(owner), { plan: names.pro, interval: "month" })).toBe(
      `Move the store from ${names.start} to ${names.pro} at ${words("proMonth")}, at once, with a prorated charge or credit.`,
    );
    expect(await tools.changePlanSummary(ctx(owner), { plan: "Enterprise", interval: "month" })).toBeNull();
  });

  it("moves the running subscription to the synced price at once, with prorations, and records it as the owner's change", async () => {
    const mark = stripe.calls.length;
    const done = await tools.changePlanTool(ctx(owner), { plan: names.pro, interval: "month" });
    expect(done).toEqual({
      done: `The store is on ${names.pro} now, at ${words("proMonth")}. Stripe charges or credits the difference on the next invoice.`,
      link: `/admin/${shop.slug}/billing`,
    });
    const asked = stripe.calls.slice(mark).filter((call) => call.method.startsWith("subscriptions."));
    expect(asked.map((call) => ({ method: call.method, mode: call.mode }))).toEqual([
      { method: "subscriptions.retrieve", mode: "live" },
      { method: "subscriptions.update", mode: "live" },
    ]);
    const itemId = stripe.subscriptions.get(subscription)!.items.data[0].id;
    expect(asked[1].args).toEqual([
      subscription,
      {
        items: [{ id: itemId, price: prices.proMonth.stripe }],
        proration_behavior: "create_prorations",
        cancel_at_period_end: false,
        metadata: expect.objectContaining({ kaizen_store_id: shop.storeId, kaizen_price_id: prices.proMonth.id }),
      },
    ]);
    // No second subscription and no payment page: the running one changed.
    expect(stripe.calls.slice(mark).map((call) => call.method)).not.toContain("checkout.sessions.create");
    expect(await billingRow()).toMatchObject({ price_id: prices.proMonth.id, status: "active", subscription_id: subscription, updated_by: owner.id });
    const [audit] = await db().execute<Row>(sql`
      select account_id, details from commerce.audit_log where store_id = ${shop.storeId}::uuid and action = 'billing.plan_changed' order by id desc limit 1
    `);
    expect(audit).toEqual({ account_id: owner.id, details: { priceId: prices.proMonth.id, planId: expect.any(String), subscriptionId: subscription } });
  });

  it("says what Stripe refused, and changes nothing", async () => {
    const before = await billingRow();
    stripe.failNext.set("subscriptions.update", new Error("socket hang up"));
    expect(await refusal(tools.changePlanTool(ctx(owner), { plan: names.start, interval: "year" }))).toBe("Stripe could not be reached.");
    expect(await billingRow()).toEqual(before);
  });
});

describe("end_plan", () => {
  it("ends the plan when the period paid for runs out, never at once, and keeps it after all on undo", async () => {
    const mark = stripe.calls.length;
    await tools.preflightEndPlan(ctx(owner), { when: "period_end" });
    expect(await refusal(tools.preflightEndPlan(ctx(owner), { when: "undo" }))).toBe("The plan is not set to end.");
    // The day Stripe says the paid period ends (the stand-in counts it from today), not a fixed date: it failed at midnight UTC.
    const periodEnd = new Date(stripe.subscriptions.get(subscription)!.items.data[0].current_period_end * 1000).toISOString().slice(0, 10);
    expect(await tools.endPlanTool(ctx(owner), { when: "period_end" })).toEqual({
      done: `The plan ends on ${periodEnd}; until then everything works as now.`,
      link: `/admin/${shop.slug}/billing`,
    });
    expect(await billingRow()).toMatchObject({ cancel_at_period_end: true, status: "active" });
    expect(await refusal(tools.preflightEndPlan(ctx(owner), { when: "period_end" }))).toBe("The plan already ends at the end of its period.");
    expect(await tools.endPlanTool(ctx(owner), { when: "undo" })).toEqual({ done: "The plan goes on as before.", link: `/admin/${shop.slug}/billing` });
    expect(await billingRow()).toMatchObject({ cancel_at_period_end: false, status: "active" });
    const asked = stripe.calls.slice(mark).filter((call) => call.method.startsWith("subscriptions."));
    expect(asked.map((call) => [call.method, (call.args[1] as Row | undefined)?.cancel_at_period_end])).toEqual([
      ["subscriptions.update", true],
      ["subscriptions.update", false],
    ]);
    expect(stripe.callsOf("subscriptions.cancel")).toEqual([]);
  });

  it("refuses a store with no plan to end", async () => {
    const none = await fx.makeStore("billtools-noend");
    const first = { account: { id: none.ownerId, email: none.ownerEmail, name: "Kari", platformAdmin: false }, store: (await getStore(none.slug))! };
    expect(await refusal(tools.preflightEndPlan(first, { when: "period_end" }))).toBe("The store has no plan to end.");
  });
});

describe("Kaizena Flow's own store (D466)", () => {
  let house: Store;
  let platformAdmin: Account;

  beforeAll(async () => {
    const [row] = await db().execute<Row>(sql`select slug from commerce.stores where house`);
    house = (await getStore(String(row.slug)))!;
    // Its members are the platform admins (`house_members_sync()`).
    platformAdmin = await account("platform", true);
  });

  it("needs no plan: the overview says so and leads to the plans it sells, and no change or end is offered", async () => {
    const said = await tools.billingOverviewTool(ctx(platformAdmin, house));
    expect(said).toMatchObject({ plan: null, note: expect.stringContaining("Kaizena Flow's own store"), link: "/admin/platform/plans" });
    expect(said).not.toHaveProperty("fee_on_sales");
    expect(said.note).not.toContain("Billing page");
    // The plans Kaizena Flow sells, as offered to stores.
    expect(said.offered.map((p) => p.name)).toEqual(expect.arrayContaining([names.start, names.pro]));
    const mark = stripe.calls.length;
    expect(await refusal(tools.preflightChangePlan(ctx(platformAdmin, house), { plan: names.pro, interval: "month" }))).toContain("Kaizena Flow's own store needs no plan");
    expect(await refusal(tools.preflightEndPlan(ctx(platformAdmin, house), { when: "period_end" }))).toContain("Kaizena Flow's own store needs no plan");
    expect(await refusal(tools.endPlanTool(ctx(platformAdmin, house), { when: "period_end" }))).toContain("Kaizena Flow's own store needs no plan");
    expect(await tools.changePlanSummary(ctx(platformAdmin, house), { plan: names.pro, interval: "month" })).toBeNull();
    expect(stripe.calls.slice(mark)).toEqual([]);
  });
});
