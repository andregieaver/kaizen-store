import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import type { Membership, Role } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * The store's analytics set-up (D152): cost assumptions, visit counting, costs back-filled onto earlier sales, targets and
 * marketing spend. Who may change what, what is refused and written to the audit log, and that one store never reaches
 * another's rows.
 */

const refreshed = vi.hoisted(() => [] as string[]);
vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: (tag: string) => void refreshed.push(tag),
  revalidateTag: () => {},
}));

const {
  addSpend,
  backfillCosts,
  deleteSpend,
  deleteTarget,
  getAnalyticsSettings,
  listSpend,
  listTargets,
  saveAnalyticsSettings,
  saveTarget,
  setVisitCounting,
} = await import("./analytics-settings");
const { getStore } = await import("./stores");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });

let storeId: string;
let otherId: string;
let owner: Membership;
let admin: Membership;
let stranger: Membership;
const variant: Record<string, string> = {};

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(store.id);
}

async function member(id: string, slug: string, role: Role, market = no): Promise<Membership> {
  const email = `${role}-${slug}@example.com`;
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${email}, ${role}) returning id`);
  return {
    account: { id: String(account.id), email, name: role, platformAdmin: false },
    role,
    store: { id, slug, markets: [market] } as unknown as Store,
  };
}

const audits = async (action: string, id = storeId) =>
  db().execute<Row>(sql`select account_id, details from commerce.audit_log where store_id = ${id}::uuid and action = ${action} order by created_at, id`);

beforeAll(async () => {
  storeId = await makeStore(`analytics-${run}`);
  otherId = await makeStore(`analytics-other-${run}`);
  owner = await member(storeId, `analytics-${run}`, "owner");
  admin = await member(storeId, `analytics-${run}`, "admin");
  stranger = await member(otherId, `analytics-other-${run}`, "owner", se);
  const rows = await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${storeId}::uuid`);
  for (const row of rows) variant[String(row.sku)] = String(row.id);
});

afterAll(async () => {
  await closeDb();
});

describe("cost assumptions", () => {
  const typed = { paymentFeePercent: "2,9", paymentFeeFixed: "1,80", shippingCost: "49", fixedCostsMonthly: "12 000", ltvLifespanYears: 4 };

  it("are the defaults until saved: nothing entered, three years", async () => {
    expect(await getAnalyticsSettings(storeId)).toEqual({
      paymentFeeBps: 0,
      paymentFeeFixedMinor: 0,
      shippingCostMinor: 0,
      fixedCostsMonthlyMinor: 0,
      ltvLifespanYears: 3,
      saved: false,
      updatedAt: null,
    });
  });

  it("are the owner's: an admin is refused and nothing is written", async () => {
    expect(await saveAnalyticsSettings(admin, typed)).toEqual({ ok: false, problems: ["Only an owner can change this."] });
    expect((await getAnalyticsSettings(storeId)).saved).toBe(false);
    expect(await audits("analytics.settings")).toHaveLength(0);
  });

  it("are saved as minor units in the main currency, audited, and refresh the store's cache", async () => {
    refreshed.length = 0;
    expect(await saveAnalyticsSettings(owner, typed)).toEqual({
      ok: true,
      settings: { paymentFeeBps: 290, paymentFeeFixedMinor: 180, shippingCostMinor: 4900, fixedCostsMonthlyMinor: 1_200_000, ltvLifespanYears: 4 },
    });
    expect(await getAnalyticsSettings(storeId)).toMatchObject({
      paymentFeeBps: 290,
      paymentFeeFixedMinor: 180,
      shippingCostMinor: 4900,
      fixedCostsMonthlyMinor: 1_200_000,
      ltvLifespanYears: 4,
      saved: true,
    });
    expect(refreshed).toContain(`store:analytics-${run}`);
    const [entry, ...rest] = await audits("analytics.settings");
    expect(rest).toHaveLength(0);
    expect(entry.account_id).toBe(owner.account.id);
    expect(entry.details).toMatchObject({ paymentFeeBps: 290, currency: "NOK" });
  });

  it("can be changed, and a wrong value changes nothing", async () => {
    expect(await saveAnalyticsSettings(owner, { ...typed, paymentFeePercent: "1,4", shippingCost: "" })).toMatchObject({ ok: true });
    expect(await getAnalyticsSettings(storeId)).toMatchObject({ paymentFeeBps: 140, shippingCostMinor: 0 });
    expect(await saveAnalyticsSettings(owner, { ...typed, paymentFeePercent: "abc" })).toEqual({
      ok: false,
      problems: ['"abc" is not a percentage between 0 and 100 with at most two decimals.'],
    });
    expect(await saveAnalyticsSettings(owner, { ...typed, ltvLifespanYears: 11 })).toEqual({ ok: false, problems: ["Use at most 10 years."] });
    expect(await getAnalyticsSettings(storeId)).toMatchObject({ paymentFeeBps: 140, ltvLifespanYears: 4 });
    expect(await audits("analytics.settings")).toHaveLength(2);
  });

  it("are the store's own: another store has its own, in its own currency", async () => {
    expect((await getAnalyticsSettings(otherId)).saved).toBe(false);
    // The other store's main currency is SEK, so "49" is 49 kronor.
    await saveAnalyticsSettings(stranger, { ...typed, shippingCost: "49" });
    expect(await getAnalyticsSettings(otherId)).toMatchObject({ shippingCostMinor: 4900 });
    expect(await getAnalyticsSettings(storeId)).toMatchObject({ paymentFeeBps: 140, shippingCostMinor: 0 });
    expect(await audits("analytics.settings", otherId)).toHaveLength(1);
  });

  it("are held to the database's limits too", async () => {
    await expect(db().execute(sql`update commerce.analytics_settings set payment_fee_bps = 10001 where store_id = ${storeId}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.analytics_settings set ltv_lifespan_years = 0 where store_id = ${storeId}::uuid`)).rejects.toThrow();
  });
});

describe("visit counting", () => {
  it("is off for a new store, and only the owner switches it", async () => {
    expect((await getStore(`analytics-${run}`))?.visitCounting).toBe(false);
    expect(await setVisitCounting(admin, true)).toEqual({ ok: false, problems: ["Only an owner can change this."] });
    refreshed.length = 0;
    expect(await setVisitCounting(owner, true)).toEqual({ ok: true, enabled: true });
    expect(refreshed).toContain(`store:analytics-${run}`);
    const [row] = await db().execute<Row>(sql`select visit_counting from commerce.stores where id = ${storeId}::uuid`);
    expect(row.visit_counting).toBe(true);
    // Another store is not affected.
    const [other] = await db().execute<Row>(sql`select visit_counting from commerce.stores where id = ${otherId}::uuid`);
    expect(other.visit_counting).toBe(false);
    expect(await setVisitCounting(owner, false)).toEqual({ ok: true, enabled: false });
    expect((await audits("analytics.visit_counting")).map((a) => a.details)).toEqual([{ enabled: true }, { enabled: false }]);
  });
});

describe("costs on earlier sales", () => {
  async function sell(sku: string, unitCost: number | null, extra = "") {
    const [order] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
        discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at ${sql.raw(extra ? ", copied_from" : "")})
      values (${storeId}::uuid, ${`BF-${run}-${Math.random().toString(36).slice(2, 8)}`}, 'NO', 'NOK', 'nb-NO', 'a@example.com', 'paid', 1000, 0, 0, 200, 1000,
        '{}'::jsonb, '{}'::jsonb, now() ${sql.raw(extra ? ", gen_random_uuid()" : "")})
      returning id
    `);
    const [line] = await db().execute<Row>(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor,
        tax_minor, tax_rate, tax_code, unit_cost_minor)
      values (${storeId}::uuid, ${String(order.id)}::uuid, ${variant[sku]}::uuid, ${sku}, 'x', 1, 1000, 0, 1000, 200, 0.25, 'txcd_99999999', ${unitCost})
      returning id
    `);
    return String(line.id);
  }
  const cost = async (id: string) => {
    const [row] = await db().execute<Row>(sql`select unit_cost_minor from commerce.order_lines where id = ${id}::uuid`);
    return row.unit_cost_minor === null ? null : Number(row.unit_cost_minor);
  };

  it("are filled in from the variants' costs now, only where unknown, and only for the owner", async () => {
    await db().execute(sql`update commerce.product_variants set cost_minor = 700 where id = ${variant["DEMO-MUG-WHITE"]}::uuid`);
    await db().execute(sql`update commerce.product_variants set cost_minor = null where id = ${variant["DEMO-TOTE"]}::uuid`);
    await db().execute(sql`update commerce.product_variants set cost_minor = 0 where id = ${variant["DEMO-NOTEBOOK-LINED"]}::uuid`);
    const unknown = await sell("DEMO-MUG-WHITE", null);
    const known = await sell("DEMO-MUG-WHITE", 500);
    const noCost = await sell("DEMO-TOTE", null);
    const zero = await sell("DEMO-NOTEBOOK-LINED", null);

    expect(await backfillCosts(admin)).toEqual({ ok: false, problems: ["Only an owner can change this."] });
    expect(await cost(unknown)).toBeNull();

    // The mug's unknown line and the notebook's (a known cost of zero) are filled in; the line with a cost keeps it; a
    // variant with no cost leaves its line unknown. Other lines the demo made (none here) would not matter.
    expect(await backfillCosts(owner)).toEqual({ ok: true, lines: 2 });
    expect([await cost(unknown), await cost(known), await cost(noCost), await cost(zero)]).toEqual([700, 500, null, 0]);
    const [entry] = await audits("analytics.costs_backfill");
    expect(entry.details).toEqual({ lines: 2 });
    // Run again: nothing left to do.
    expect(await backfillCosts(owner)).toEqual({ ok: true, lines: 0 });
  });

  it("leave a copied order alone, and another store's lines too", async () => {
    // A copied order's lines are read-only history (D129): the trigger only lets a copy in while copying, so the copied
    // order here is one the rules let in through the copy switch.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
      const [order] = await tx.execute<Row>(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
          discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, copied_from)
        values (${storeId}::uuid, ${`C-${run}`}, 'NO', 'NOK', 'nb-NO', 'a@example.com', 'paid', 1000, 0, 0, 200, 1000, '{}'::jsonb, '{}'::jsonb, now(), gen_random_uuid())
        returning id
      `);
      await tx.execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor,
          tax_minor, tax_rate, tax_code)
        values (${storeId}::uuid, ${String(order.id)}::uuid, ${variant["DEMO-MUG-WHITE"]}::uuid, 'DEMO-MUG-WHITE', 'x', 1, 1000, 0, 1000, 200, 0.25, 'txcd_99999999')
      `);
    });
    expect(await backfillCosts(owner)).toEqual({ ok: true, lines: 0 });
    const [copied] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.order_lines l join commerce.orders o on o.id = l.order_id
      where o.store_id = ${storeId}::uuid and o.copied_from is not null and l.unit_cost_minor is not null
    `);
    expect(copied.n).toBe(0);
    // The other store's owner back-fills only the other store.
    expect(await backfillCosts(stranger)).toEqual({ ok: true, lines: 0 });
  });
});

describe("monthly targets", () => {
  it("are one per month, replaced when set again, and listed newest first", async () => {
    expect(await saveTarget(admin, { month: "2026-10", revenueTarget: "500 000" })).toEqual({
      ok: true,
      target: { month: "2026-10-01", revenueTargetMinor: 50_000_000 },
    });
    await saveTarget(owner, { month: "2026-09-17", revenueTarget: "400000" });
    await saveTarget(owner, { month: "2026-10-31", revenueTarget: "600000" });
    expect(await listTargets(storeId)).toEqual([
      { month: "2026-10-01", revenueTargetMinor: 60_000_000 },
      { month: "2026-09-01", revenueTargetMinor: 40_000_000 },
    ]);
    expect(await listTargets(otherId)).toEqual([]);
    expect(await listTargets(storeId, 1)).toHaveLength(1);
    expect(await audits("analytics.target")).toHaveLength(3);
  });

  it("are refused when the month or amount is wrong", async () => {
    expect(await saveTarget(owner, { month: "next", revenueTarget: "5" })).toEqual({ ok: false, problems: ["Choose a month."] });
    expect(await saveTarget(owner, { month: "2026-11", revenueTarget: "0" })).toEqual({ ok: false, problems: ["The target must be more than 0."] });
    expect(await listTargets(storeId)).toHaveLength(2);
  });

  it("can be taken away, only from the store's own", async () => {
    expect(await deleteTarget(stranger, "2026-10")).toEqual({ ok: true, deleted: false });
    expect(await deleteTarget(admin, "2026-10-05")).toEqual({ ok: true, deleted: true });
    expect(await deleteTarget(admin, "2026-10")).toEqual({ ok: true, deleted: false });
    expect(await deleteTarget(admin, "soon")).toEqual({ ok: false, problems: ["Choose a month."] });
    expect(await listTargets(storeId)).toEqual([{ month: "2026-09-01", revenueTargetMinor: 40_000_000 }]);
    expect(await audits("analytics.target_delete")).toHaveLength(1);
  });
});

describe("marketing spend", () => {
  const entry = { day: "2026-10-01", channel: "paid_search", campaign: "brand", amount: "1 500,50", note: "october" };

  it("is entered per day, channel and campaign, in the main currency, by any member", async () => {
    const added = await addSpend(admin, entry);
    expect(added).toMatchObject({ ok: true, replaced: false });
    await addSpend(owner, { day: "2026-10-01", channel: "paid_search", amount: "200" });
    await addSpend(owner, { day: "2026-10-03", channel: "email", amount: "99" });
    await addSpend(owner, { day: "2026-09-30", channel: "paid_social", campaign: "autumn", amount: "10" });
    expect(await listSpend(storeId)).toEqual([
      { id: expect.any(String), day: "2026-10-03", channel: "email", campaign: "", amountMinor: 9900, note: null },
      { id: expect.any(String), day: "2026-10-01", channel: "paid_search", campaign: "", amountMinor: 20_000, note: null },
      { id: expect.any(String), day: "2026-10-01", channel: "paid_search", campaign: "brand", amountMinor: 150_050, note: "october" },
      { id: expect.any(String), day: "2026-09-30", channel: "paid_social", campaign: "autumn", amountMinor: 1000, note: null },
    ]);
  });

  it("replaces an amount entered again for the same day, channel and campaign", async () => {
    const again = await addSpend(owner, { ...entry, amount: "1000", note: "" });
    expect(again).toMatchObject({ ok: true, replaced: true });
    const rows = await listSpend(storeId, { from: "2026-10-01", to: "2026-10-02" });
    expect(rows.filter((r) => r.campaign === "brand")).toEqual([
      { id: (again as { id: string }).id, day: "2026-10-01", channel: "paid_search", campaign: "brand", amountMinor: 100_000, note: null },
    ]);
    expect(await listSpend(storeId)).toHaveLength(4);
    expect((await audits("analytics.spend")).at(-1)?.details).toMatchObject({ replaced: true, amountMinor: 100_000, currency: "NOK" });
  });

  it("is listed within a period (from, up to but not including to) and a limit", async () => {
    expect((await listSpend(storeId, { from: "2026-10-01" })).map((r) => r.day)).toEqual(["2026-10-03", "2026-10-01", "2026-10-01"]);
    expect((await listSpend(storeId, { to: "2026-10-01" })).map((r) => r.day)).toEqual(["2026-09-30"]);
    expect(await listSpend(storeId, { from: "2026-11-01" })).toEqual([]);
    expect(await listSpend(storeId, { limit: 2 })).toHaveLength(2);
    expect(await listSpend(storeId, { limit: 0 })).toHaveLength(1);
    // A bad day is ignored, not an error.
    expect(await listSpend(storeId, { from: "yesterday" })).toHaveLength(4);
  });

  it("is refused when wrong, naming what is", async () => {
    expect(await addSpend(owner, { ...entry, day: "2026-02-30" })).toEqual({ ok: false, problems: ["Choose a day."] });
    expect(await addSpend(owner, { ...entry, channel: "tv" })).toEqual({ ok: false, problems: ["Choose a channel."] });
    expect(await addSpend(owner, { ...entry, amount: "0" })).toEqual({ ok: false, problems: ["The amount must be more than 0."] });
    expect(await addSpend(owner, { ...entry, amount: "free" })).toEqual({ ok: false, problems: ['"free" is not an amount in NOK.'] });
    expect(await listSpend(storeId)).toHaveLength(4);
  });

  it("is the store's own: another store's list is its own, in its own currency, and it cannot delete ours", async () => {
    const [mine] = await listSpend(storeId);
    expect(await listSpend(otherId)).toEqual([]);
    await addSpend(stranger, { day: "2026-10-01", channel: "email", amount: "5" });
    expect(await deleteSpend(stranger, mine.id)).toEqual({ ok: true, deleted: false });
    expect(await listSpend(storeId)).toHaveLength(4);
    expect(await listSpend(otherId)).toHaveLength(1);
  });

  it("can be taken away by any member, once", async () => {
    const [first] = await listSpend(storeId);
    expect(await deleteSpend(admin, first.id)).toEqual({ ok: true, deleted: true });
    expect(await deleteSpend(admin, first.id)).toEqual({ ok: true, deleted: false });
    expect(await deleteSpend(admin, "not-an-id")).toEqual({ ok: true, deleted: false });
    expect(await listSpend(storeId)).toHaveLength(3);
    expect((await audits("analytics.spend_delete"))[0].details).toMatchObject({ day: "2026-10-03", channel: "email", amountMinor: 9900 });
  });
});
