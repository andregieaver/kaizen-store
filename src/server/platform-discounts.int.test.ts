import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/** Kaizen's own Stripe account, faked: coupons, promotion codes and a store's plan subscription. */
const fake = vi.hoisted(() => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let n = 0;
  const subscription = {
    id: "sub_plan",
    status: "active",
    metadata: {} as Record<string, string>,
    cancel_at_period_end: false,
    discounts: [] as string[],
    items: { data: [{ id: "si_1", current_period_end: 1_900_000_000, price: { id: "price_x" } }] },
  };
  const client = {
    coupons: {
      create: async (params: Record<string, unknown>) => {
        calls.push({ method: "coupons.create", params });
        return { id: `coupon_${++n}` };
      },
    },
    promotionCodes: {
      create: async (params: Record<string, unknown>) => {
        calls.push({ method: "promotionCodes.create", params });
        return { id: `promo_${++n}` };
      },
      update: async (id: string, params: Record<string, unknown>) => {
        calls.push({ method: "promotionCodes.update", params: { id, ...params } });
        return { id };
      },
    },
    subscriptions: {
      retrieve: async () => structuredClone(subscription),
      update: async (_id: string, params: { discounts?: unknown[]; metadata?: Record<string, string> }) => {
        calls.push({ method: "subscriptions.update", params });
        if (params.discounts) subscription.discounts = ["di_1"];
        if (params.metadata) subscription.metadata = params.metadata;
        return structuredClone(subscription);
      },
    },
  };
  return { client, calls, subscription };
});

vi.mock("server-only", () => ({}));
vi.mock("./stripe", () => ({
  platformStripe: (mode: string) => (mode === "test" ? fake.client : null),
  platformModes: () => ["test"],
  WEBHOOK_EVENTS: [],
}));

const { applySubscription, applyPlanDiscount, getStoreBilling, removeWaitingDiscount } = await import("./billing");
const { createPlatformDiscount, findPlatformDiscount, setPlatformDiscountActive } = await import("./platform-discounts");

const run = Date.now().toString(36).toUpperCase();
let admin: Account;
let storeId: string;

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`admin-${run}@example.com`}, 'Admin', true)
    returning id
  `);
  admin = { id: String(account.id), email: `admin-${run}@example.com`, name: "Admin", platformAdmin: true };
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`pd-${run.toLowerCase()}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`pd-${run.toLowerCase()}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
});

afterAll(async () => {
  await closeDb();
});

describe("Kaizen's codes for plans (D31)", () => {
  it("are made in Kaizen and put in Stripe as a coupon and a promotion code", async () => {
    const result = await createPlatformDiscount(
      admin,
      { code: `start${run}`, kind: "percent", percent: "20", duration: "repeating", durationMonths: "3", maxRedemptions: "50" },
      ["NOK", "SEK"],
    );
    expect(result).toMatchObject({ ok: true });
    const coupon = fake.calls.find((c) => c.method === "coupons.create")!;
    expect(coupon.params).toMatchObject({ percent_off: 20, duration: "repeating", duration_in_months: 3, name: `START${run}` });
    const promotion = fake.calls.find((c) => c.method === "promotionCodes.create")!;
    expect(promotion.params).toMatchObject({
      promotion: { type: "coupon", coupon: "coupon_1" },
      code: `START${run}`,
      active: true,
      max_redemptions: 50,
    });
  });

  it("give an amount per currency, and are only found for those currencies", async () => {
    const result = await createPlatformDiscount(
      admin,
      { code: `KRONER${run}`, kind: "fixed", amounts: { NOK: "100", SEK: "" }, duration: "once" },
      ["NOK", "SEK"],
    );
    expect(result).toMatchObject({ ok: true });
    expect(fake.calls.filter((c) => c.method === "coupons.create").at(-1)!.params).toMatchObject({
      amount_off: 10000,
      currency: "nok",
      duration: "once",
    });
    expect(await findPlatformDiscount(`kroner${run}`, "test", "NOK")).toMatchObject({ ok: true });
    expect(await findPlatformDiscount(`kroner${run}`, "test", "SEK")).toEqual({
      ok: false,
      problem: "That discount code is not for plans paid in SEK.",
    });
    expect(await findPlatformDiscount("NO-SUCH-CODE", "test", "NOK")).toEqual({ ok: false, problem: "There is no such discount code." });
  });

  it("wait for the plan to be chosen when a store has none, and can be taken off", async () => {
    expect(await applyPlanDiscount(admin, storeId, `start${run}`)).toMatchObject({ ok: true });
    const billing = await getStoreBilling(storeId);
    expect(billing?.discount).toMatchObject({ code: `START${run}`, percent: 20, appliedAt: null });
    await removeWaitingDiscount(admin, storeId);
    expect((await getStoreBilling(storeId))?.discount).toBeNull();
  });

  it("apply at once to a running plan, and go when Stripe no longer gives the discount", async () => {
    await applySubscription(
      { ...structuredClone(fake.subscription), metadata: { kaizen_store_id: storeId } } as unknown as Stripe.Subscription,
      "test",
    );
    const result = await applyPlanDiscount(admin, storeId, `start${run}`);
    expect(result).toMatchObject({ ok: true, note: "Applied. It shows on your next invoice." });
    const update = fake.calls.filter((c) => c.method === "subscriptions.update").at(-1)!;
    expect(update.params.discounts).toEqual([{ promotion_code: "promo_2" }]);
    const applied = await getStoreBilling(storeId);
    expect(applied?.discount?.code).toBe(`START${run}`);
    expect(applied?.discount?.appliedAt).not.toBeNull();

    // Three months later Stripe reports the subscription without it.
    await applySubscription({ ...structuredClone(fake.subscription), discounts: [] } as unknown as Stripe.Subscription, "test");
    expect((await getStoreBilling(storeId))?.discount).toBeNull();
  });

  it("stop working when switched off, in Kaizen and in Stripe", async () => {
    const [row] = await db().execute<Row>(sql`select id from commerce.platform_discount_codes where code = ${`START${run}`}`);
    expect(await setPlatformDiscountActive(admin, String(row.id), false)).toMatchObject({ ok: true });
    expect(fake.calls.at(-1)).toMatchObject({ method: "promotionCodes.update", params: { active: false } });
    expect(await findPlatformDiscount(`start${run}`, "test", "NOK")).toEqual({
      ok: false,
      problem: "That discount code is no longer valid.",
    });
  });
});
