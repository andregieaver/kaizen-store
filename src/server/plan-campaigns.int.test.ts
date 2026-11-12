import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

/** Kaizena Flow's own Stripe account, faked: coupons and promotion codes. */
const fake = vi.hoisted(() => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const runId = Date.now().toString(36);
  let n = 0;
  const client = {
    coupons: {
      create: async (params: Record<string, unknown>) => (calls.push({ method: "coupons.create", params }), { id: `coupon_c_${runId}_${++n}` }),
      del: async (id: string) => ({ id, deleted: true }),
    },
    promotionCodes: {
      create: async (params: Record<string, unknown>) => (calls.push({ method: "promotionCodes.create", params }), { id: `promo_c_${runId}_${++n}` }),
      update: async (id: string) => ({ id }),
    },
  };
  return { client, calls };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./stripe", () => ({
  platformStripe: (mode: string) => (mode === "test" ? fake.client : null),
  platformModes: () => ["test"],
  WEBHOOK_EVENTS: [],
}));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const { campaignPromotion, createPlatformDiscount, deletePlatformDiscount, findPlatformDiscount, listPlanCampaigns, setPlatformDiscountActive, updatePlatformDiscount } =
  await import("./platform-discounts");
const { getPublicPlans } = await import("./public-plans");

/**
 * Timed plan prices (C5, D524) against a real database, Stripe faked: a campaign is a code with a name, a start and an end, for its plans;
 * one at a time; given without a code to a plan chosen while it runs, and never before; shown on the public plans without its code.
 */

const run = Date.now().toString(36).toUpperCase();
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
let admin: Account;
let planId: string;
let otherPlanId: string;
const made: string[] = [];

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`campaign-${run}@example.com`}, 'Admin', true) returning id
  `);
  admin = { id: String(account.id), email: `campaign-${run}@example.com`, name: "Admin", platformAdmin: true };
  // Plans of this test only, never shown: a campaign here touches no other test's plan.
  const [a] = await db().execute<Row>(sql`insert into commerce.plans (name, active) values (${`Campaign ${run}`}, false) returning id`);
  const [b] = await db().execute<Row>(sql`insert into commerce.plans (name, active) values (${`Campaign other ${run}`}, false) returning id`);
  planId = String(a.id);
  otherPlanId = String(b.id);
});

afterAll(async () => {
  for (const id of made) await deletePlatformDiscount(admin, id);
  await db().execute(sql`delete from commerce.plans where id in (${planId}::uuid, ${otherPlanId}::uuid)`);
  await closeDb();
});

const campaign = (input: Record<string, unknown>) =>
  createPlatformDiscount(admin, { kind: "percent", percent: "50", duration: "repeating", durationMonths: "3", planIds: [planId], ...input }, ["NOK"]);

describe("timed plan prices (D524)", () => {
  it("makes a campaign with a code nobody types, and refuses a second at the same time for the same plans", async () => {
    expect(await campaign({ campaignName: `Winter ${run}`, startsAt: null, expiresAt: day(10) })).toEqual({ ok: false, problems: ["Say when the campaign starts."] });
    expect(await campaign({ campaignName: `Winter ${run}`, startsAt: day(5), expiresAt: day(2) })).toEqual({ ok: false, problems: ["The campaign must end after it starts."] });
    expect(await campaign({ campaignName: `Winter ${run}`, startsAt: day(-1), expiresAt: day(10), planIds: ["0b7a0000-0000-4000-8000-00000000dead"] })).toEqual({
      ok: false,
      problems: ["Choose plans that exist."],
    });

    const winter = await campaign({ campaignName: `Winter ${run}`, startsAt: day(-1), expiresAt: day(10) });
    expect(winter).toMatchObject({ ok: true });
    made.push(winter.id!);
    const [row] = await db().execute<Row>(sql`select code, campaign_name, plan_ids from commerce.platform_discount_codes where id = ${winter.id!}::uuid`);
    expect(String(row.code)).toMatch(new RegExp(`^WINTER-${run}-[A-Z0-9]{1,8}$`));
    expect(row.plan_ids).toEqual([planId]);
    expect(fake.calls.find((c) => c.method === "coupons.create")?.params).toMatchObject({ percent_off: 50, duration: "repeating", duration_in_months: 3 });

    const clash = await campaign({ campaignName: `Clash ${run}`, startsAt: day(5), expiresAt: day(20) });
    expect(clash).toEqual({ ok: false, problems: [`The campaign Winter ${run} runs at the same time for the same plans: one campaign at a time.`] });
    // Another plan's campaign at the same time is fine; so is the same plan's after it.
    const other = await campaign({ campaignName: `Other ${run}`, startsAt: day(5), expiresAt: day(20), planIds: [otherPlanId] });
    expect(other).toMatchObject({ ok: true });
    made.push(other.id!);
    const spring = await campaign({ campaignName: `Spring ${run}`, startsAt: day(20), expiresAt: day(40) });
    expect(spring).toMatchObject({ ok: true });
    made.push(spring.id!);

    // Switched off, its time is free; switched back on while another took it, it is refused.
    expect(await setPlatformDiscountActive(admin, spring.id!, false)).toMatchObject({ ok: true });
    const easter = await campaign({ campaignName: `Easter ${run}`, startsAt: day(30), expiresAt: day(35) });
    expect(easter).toMatchObject({ ok: true });
    made.push(easter.id!);
    expect(await setPlatformDiscountActive(admin, spring.id!, true)).toEqual({ ok: false, problems: [`The campaign Easter ${run} runs at the same time for the same plans: one campaign at a time.`] });
    await deletePlatformDiscount(admin, easter.id!);
    expect(await setPlatformDiscountActive(admin, spring.id!, true)).toMatchObject({ ok: true });

    // Changing a campaign keeps its code and is not a clash with itself.
    expect(
      await updatePlatformDiscount(admin, winter.id!, { code: String(row.code), kind: "percent", percent: "50", duration: "repeating", durationMonths: "3", campaignName: `Winter sale ${run}`, startsAt: day(-1), expiresAt: day(12), planIds: [planId] }, ["NOK"], true),
    ).toMatchObject({ ok: true });
    const [renamed] = await db().execute<Row>(sql`select code, campaign_name from commerce.platform_discount_codes where id = ${winter.id!}::uuid`);
    expect(renamed).toEqual({ code: row.code, campaign_name: `Winter sale ${run}` });
  });

  it("gives the running campaign to a plan chosen now without a code, and nothing before a campaign starts", async () => {
    const campaigns = (await listPlanCampaigns()).filter((c) => c.name.endsWith(run));
    expect(campaigns.map((c) => c.name)).toEqual([`Winter sale ${run}`, `Other ${run}`, `Spring ${run}`]);
    const running = await campaignPromotion(planId, "NOK", "test");
    expect(running).toMatchObject({ discountId: made[0] });
    expect(running?.promotionCode).toMatch(/^promo_c_/);
    // The other plan's campaign has not started; a plan no campaign names gets nothing.
    expect(await campaignPromotion(otherPlanId, "NOK", "test")).toBeNull();
    const spring = campaigns.find((c) => c.name === `Spring ${run}`)!;
    expect(await findPlatformDiscount(spring.code, "test", "NOK")).toEqual({ ok: false, problem: "That discount code is not valid now." });
  });

  it("shows the running campaign on the public plans, never its code", async () => {
    const data = await getPublicPlans();
    expect(data.campaign).toMatchObject({ kind: "percent", percent: 50, duration: "repeating", durationMonths: 3 });
    expect(JSON.stringify(data.campaign)).not.toMatch(/code/i);
  });
});
