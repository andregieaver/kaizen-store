import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { BONUS_DEFAULTS } from "@/lib/bonus";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { saveBonusSettings, shopperBonus } = await import("./bonus");
const { refundOrder } = await import("./order-admin");
const { fxStore, paidOrder, NO } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * Loyalty levels and the credit for opening an account (wave 11 unit M, D392) on a real database: an order earns at the rate of the level the
 * customer's spending reaches when it is paid (what they paid for goods in the last 365 days, less refunds, the order itself left out), the
 * account credit is given once when an email is proven, only while the program works, and the shopper's page says the level and the next.
 */
let store: Awaited<ReturnType<typeof fxStore>>;
let owner: Account;

beforeAll(async () => {
  store = await fxStore("bonus-levels");
  await db().execute(sql`update commerce.stores set country = 'NO', features = features || array['bonus'] where id = ${store.storeId}::uuid`);
  const [a] = await db().execute<Row>(sql`select id, email from commerce.accounts where id = ${store.accountId}::uuid`);
  owner = { id: String(a.id), email: String(a.email), name: "Owner", platformAdmin: false };
}, 60_000);

afterAll(async () => {
  await closeDb();
});

const entries = async (customerId: string, kind: string) =>
  (await db().execute<Row>(sql`select amount_minor, available_at <= now() as usable from commerce.bonus_entries where customer_id = ${customerId}::uuid and kind = ${kind}`)).map((r) => ({
    amount: Number(r.amount_minor),
    usable: Boolean(r.usable),
  }));

const newCustomer = async (label: string, verified: boolean) => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, email_verified_at) values (${store.storeId}::uuid, ${`${label}-${Date.now().toString(36)}@example.com`}, ${verified ? sql`now()` : sql`null`})
    returning id`);
  return String(row.id);
};

const earnedOn = async (orderId: string) => Number((await db().execute<Row>(sql`select bonus_earned_minor from commerce.orders where id = ${orderId}::uuid`))[0].bonus_earned_minor ?? 0);
const goodsOf = async (orderId: string) =>
  Number((await db().execute<Row>(sql`select coalesce(sum(total_minor - venue_minor), 0) as n from commerce.order_lines where order_id = ${orderId}::uuid`))[0].n);

describe("the credit for opening an account (D392)", () => {
  it("is given once, usable at once, when an email is first proven, and only while the program works", async () => {
    // Off: nothing given.
    expect(await saveBonusSettings(owner, store.storeId, { ...BONUS_DEFAULTS, enabled: false, signupMinor: 5_000 })).toEqual({ ok: true });
    expect(await entries(await newCustomer("off", true), "signup")).toEqual([]);

    expect(await saveBonusSettings(owner, store.storeId, { ...BONUS_DEFAULTS, enabled: true, signupMinor: 5_000 })).toEqual({ ok: true });
    const opened = await newCustomer("opened", true);
    expect(await entries(opened, "signup")).toEqual([{ amount: 5_000, usable: true }]);

    // Proven later (a guest who signs in): given then, and never again however often the email is proven.
    const later = await newCustomer("later", false);
    expect(await entries(later, "signup")).toEqual([]);
    await db().execute(sql`update commerce.customers set email_verified_at = now() where id = ${later}::uuid`);
    await db().execute(sql`update commerce.customers set email_verified_at = null where id = ${later}::uuid`);
    await db().execute(sql`update commerce.customers set email_verified_at = now() where id = ${later}::uuid`);
    expect(await entries(later, "signup")).toEqual([{ amount: 5_000, usable: true }]);
  });
});

describe("levels (D392)", () => {
  it("earn at the level the customer's spending reaches, the order itself and refunds left out", async () => {
    const buyer = await newCustomer("buyer", true);
    const asBuyer = { beforePaid: (orderId: string) => db().execute(sql`update commerce.orders set customer_id = ${buyer}::uuid where id = ${orderId}::uuid`).then(() => undefined) };
    const levels = [{ name: "Gull", fromMinor: 1, earnBps: 1_000 }];
    expect(await saveBonusSettings(owner, store.storeId, { ...BONUS_DEFAULTS, enabled: true, earnBps: 500, levels })).toEqual({ ok: true });

    // The first order: nothing spent before it, so the program's own 5%.
    const first = await paidOrder(store, [["DEMO-TOTE", 1]], { manual: true, ...asBuyer });
    expect(await earnedOn(first.orderId)).toBe(Math.floor((await goodsOf(first.orderId)) * 500 / 10_000));

    // The second: the first counts, so the level's 10%.
    const second = await paidOrder(store, [["DEMO-TOTE", 1]], { manual: true, ...asBuyer });
    expect(await earnedOn(second.orderId)).toBe(Math.floor((await goodsOf(second.orderId)) * 1_000 / 10_000));

    // A level above both orders: back to 5% until the spending reaches it.
    const both = (await goodsOf(first.orderId)) + (await goodsOf(second.orderId));
    expect(await saveBonusSettings(owner, store.storeId, { ...BONUS_DEFAULTS, enabled: true, earnBps: 500, levels: [{ name: "Gull", fromMinor: both, earnBps: 1_000 }] })).toEqual({ ok: true });
    const spent = Number((await db().execute<Row>(sql`select commerce.bonus_level_spend(${store.storeId}::uuid, ${buyer}::uuid, null) as n`))[0].n);
    expect(spent).toBe(both);
    expect(Number((await db().execute<Row>(sql`select commerce.bonus_earn_bps(${store.storeId}::uuid, ${buyer}::uuid, null) as n`))[0].n)).toBe(1_000);

    // A refund takes what was given back off the spending: below the level again.
    expect(await refundOrder(store.storeId, second.orderId, { amountMinor: 100, reason: "Goodwill", restock: [] }, store.accountId)).toMatchObject({ ok: true });
    expect(Number((await db().execute<Row>(sql`select commerce.bonus_level_spend(${store.storeId}::uuid, ${buyer}::uuid, null) as n`))[0].n)).toBe(both - 100);
    expect(Number((await db().execute<Row>(sql`select commerce.bonus_earn_bps(${store.storeId}::uuid, ${buyer}::uuid, null) as n`))[0].n)).toBe(500);

    // The shopper's page: no level yet, and what more the next needs.
    const page = await shopperBonus({ storeId: store.storeId, market: NO }, buyer);
    expect(page.level).toEqual({ current: null, next: { name: "Gull", earnPercent: 10, remainingMinor: 100 } });
    expect(page.earnPercent).toBe(5);
  });

  it("are refused when they are not steps up", async () => {
    const out = await saveBonusSettings(owner, store.storeId, {
      ...BONUS_DEFAULTS,
      enabled: true,
      earnBps: 500,
      levels: [
        { name: "Gull", fromMinor: 500_000, earnBps: 1_000 },
        { name: "Sølv", fromMinor: 200_000, earnBps: 700 },
      ],
    });
    expect(out).toMatchObject({ ok: false });
  });
});
