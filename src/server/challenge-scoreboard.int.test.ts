import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const ownerTools = await import("./owner-tools");
const { periodTotals } = await import("./analytics-totals");
const { getAnalyticsSettings } = await import("./analytics-settings");
const { customPeriod } = await import("@/lib/analytics-period");
const { challengeFor, saveChallenge } = await import("./autopilot-settings");
const { freezeBaseline, removeOriginalPeriod, saveOriginalPeriod, scoreboardOf } = await import("./challenge-scoreboard");
const { makeAccount } = await import("./trust-fixtures");
const { newStore } = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * One contribution profit and the scoreboard (`docs/100-day-challenge.md` E1, E7) on a real store: Finance counts a parcel at its booked label's
 * price and estimates only the rest; the scoreboard counts the clone over the days of the original's signed period, and keeps the periods when
 * the challenge's dates change.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let admin: Awaited<ReturnType<typeof makeAccount>>;
const ctx = () => ({ account: store.member.account, store: store.member.store, holder: { role: "owner" as const }, invalidate: () => {} });
const SKU = "DEMO-MUG-WHITE";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** A paid order placed some days ago with one shipped line of 250 NOK (200 without VAT) and a cost of 80. */
async function paidOrder(daysAgo: number): Promise<{ id: string; number: string }> {
  const number = `B-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${SKU}`);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at)
    values (${store.storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', 'paid', 25000, 0, 0, 5000, 25000, '{}'::jsonb, '{}'::jsonb,
      now() - make_interval(days => ${daysAgo}))
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor,
      tax_rate, tax_code, delivery)
    values (${store.storeId}::uuid, ${String(row.id)}::uuid, ${String(variant.id)}::uuid, ${SKU}, 'Mug', 1, 25000, 8000, 0, 25000, 5000, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
    values (${store.storeId}::uuid, ${String(row.id)}::uuid, 'stripe', ${`pi_${number}`}, ${store.account}, 25000, 0, 'NOK', 'captured')
  `);
  return { id: String(row.id), number };
}

beforeAll(async () => {
  store = await newStore("scoreboard");
  admin = await makeAccount("scoreboard-admin", { platformAdmin: true });
  const sent = await paidOrder(3);
  await paidOrder(2);
  await ownerTools.runOwnerTool(ctx(), "mark_order_sent", { order: sent.number, carrier: "bring", tracking_number: "70711112222", notify: false });
  await db().execute(sql`update commerce.shipments set label_cost_minor = 7400 where store_id = ${store.storeId}::uuid and order_id = ${sent.id}::uuid`);
  await saveChallenge({ account: admin }, store.storeId, { startsOn: day(-10), dayOne: day(-10), endsOn: day(89), adMoney: 1000 });
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.autopilot_settings where store_id = ${store.storeId}::uuid`);
  await closeDb();
});

describe("one contribution profit (E1)", () => {
  it("counts a parcel at its booked label's price, and estimates only an order with none", async () => {
    const settings = await getAnalyticsSettings(store.storeId);
    const totals = (await periodTotals(store.member.store, customPeriod(day(-10), day(0)), settings)).totals;
    expect(totals.shippingCostsMinor).toBe(7400 + settings.shippingCostMinor);
  });

  it("counts handling and packaging per order with something to ship, and a booked return label without VAT, in contribution (D646)", async () => {
    const [order] = await db().execute<Row>(sql`select id, number from commerce.orders where store_id = ${store.storeId}::uuid order by placed_at limit 1`);
    // A return label of 125 kr with VAT (Norway's 25 %): 100 kr without; a test label never counts.
    await db().execute(sql`
      insert into commerce.returns (store_id, order_id, kind, number, status, label_source, label_carrier_id, label_cost_minor, label_booked_at, label_test)
      values (${store.storeId}::uuid, ${String(order.id)}::uuid, 'return', ${`${String(order.number)}-R1`}, 'requested', 'carrier', 'bring', 12500, now() - interval '1 day', false),
             (${store.storeId}::uuid, ${String(order.id)}::uuid, 'return', ${`${String(order.number)}-R2`}, 'requested', 'carrier', 'bring', 9900, now() - interval '1 day', true)
    `);
    await db().execute(sql`
      insert into commerce.analytics_settings (store_id, handling_cost_minor) values (${store.storeId}::uuid, 2500)
      on conflict (store_id) do update set handling_cost_minor = excluded.handling_cost_minor
    `);
    const settings = await getAnalyticsSettings(store.storeId);
    expect(settings.handlingCostMinor).toBe(2500);
    const before = (await periodTotals(store.member.store, customPeriod(day(-10), day(0)), { ...settings, handlingCostMinor: 0 })).totals;
    const totals = (await periodTotals(store.member.store, customPeriod(day(-10), day(0)), settings)).totals;
    // Two paid orders with a mug to send: 2 × 25 kr.
    expect(totals.handlingCostsMinor).toBe(5000);
    expect(totals.returnLabelsMinor).toBe(10_000);
    expect(before.handlingCostsMinor).toBeUndefined();
    const { financeStatement } = await import("@/lib/analytics-finance");
    const statement = financeStatement(totals, settings, 10);
    expect(statement.lines.map((l) => l.key)).toEqual(expect.arrayContaining(["handlingCosts", "returnLabels"]));
    expect(statement.reconciles).toBe(true);
  });
});

describe("the scoreboard (E7)", () => {
  const signed = (over: Record<string, unknown> = {}) => ({
    from: day(-10),
    to: day(0),
    currency: "NOK",
    netSalesMinor: 100_000,
    cogsMinor: 40_000,
    marketingMinor: 90_000,
    sessions: 800,
    signedBy: "Revisor AS",
    signedOn: day(0),
    ...over,
  });

  it("is a platform admin's to fill, and refuses periods that overlap", async () => {
    await expect(saveOriginalPeriod({ account: store.member.account }, store.storeId, signed())).rejects.toThrow("platform admin");
    await saveOriginalPeriod({ account: admin }, store.storeId, signed());
    await expect(saveOriginalPeriod({ account: admin }, store.storeId, signed({ from: day(-5), to: day(1) }))).rejects.toThrow("overlap");
  });

  it("counts the clone over the signed period's days, with its AI and plan as costs, beside the original as signed", async () => {
    const s = await scoreboardOf(store.storeId);
    expect(s?.spans).toEqual([{ from: day(-10), to: day(0) }]);
    expect(s?.clone).toMatchObject({ netSalesMinor: 40_000, aiMinor: 0, planMinor: 0 });
    expect(s?.original).toMatchObject({ netSalesMinor: 100_000, contributionMinor: -30_000, marketingMinor: 90_000, sessions: 800 });
    // 1 000 kr agreed: the original spent 900 (90 %), the clone nothing yet.
    expect(s?.agreedAdMinor).toBe(100_000);
    expect(s?.board?.ad).toEqual({ clone: 0, original: 0.9 });
    expect(s?.board?.underSpent).toEqual(["clone"]);
    expect(s?.board?.ratios.margin.original).toBeCloseTo(-0.3, 5);
  });

  it("keeps the signed periods when the challenge's dates change, and takes one off", async () => {
    await saveChallenge({ account: admin }, store.storeId, { startsOn: day(-10), dayOne: day(-10), endsOn: day(95) });
    expect((await challengeFor(store.storeId))?.original).toHaveLength(1);
    await removeOriginalPeriod({ account: admin }, store.storeId, day(-10));
    expect((await challengeFor(store.storeId))?.original).toEqual([]);
    expect((await scoreboardOf(store.storeId))?.notes).toEqual(expect.arrayContaining([expect.stringContaining("No period of the original's signed P&L")]));
  });

  it("says when the original is in another currency than the clone", async () => {
    await saveOriginalPeriod({ account: admin }, store.storeId, signed({ currency: "EUR" }));
    const s = await scoreboardOf(store.storeId);
    expect(s?.original).toBeNull();
    expect(s?.notes).toEqual(expect.arrayContaining([expect.stringContaining("is in EUR and the clone counts in NOK")]));
  });
});

describe("the baseline (E7, D650)", () => {
  it("is frozen by a platform admin before Day 1, kept when the dates change, and counted with in place of later changes", async () => {
    await db().execute(sql`
      insert into commerce.analytics_settings (store_id, shipping_cost_minor, handling_cost_minor) values (${store.storeId}::uuid, 6900, 2500)
      on conflict (store_id) do update set shipping_cost_minor = 6900, handling_cost_minor = 2500
    `);
    await saveChallenge({ account: admin }, store.storeId, { startsOn: day(1), dayOne: day(3), endsOn: day(90), adMoney: 1000 });
    await expect(freezeBaseline({ account: store.member.account }, store.storeId)).rejects.toThrow("platform admin");
    const frozen = await freezeBaseline({ account: admin }, store.storeId);
    expect(frozen).toMatchObject({ currency: "NOK", adMoney: 1000, costs: { shippingCostMinor: 6900, handlingCostMinor: 2500 } });
    expect(frozen.variantsWithCost + frozen.variantsWithoutCost).toBeGreaterThan(0);

    // Day 1 moves into the past (the dates change, the baseline is kept); the store then changes its estimates, a cost price and the ad money.
    await saveChallenge({ account: admin }, store.storeId, { startsOn: day(-10), dayOne: day(-10), endsOn: day(89), adMoney: 5000 });
    expect((await challengeFor(store.storeId))?.baseline?.costFingerprint).toBe(frozen.costFingerprint);
    await db().execute(sql`update commerce.analytics_settings set shipping_cost_minor = 100 where store_id = ${store.storeId}::uuid`);
    await db().execute(sql`update commerce.product_variants set cost_minor = coalesce(cost_minor, 0) + 1 where store_id = ${store.storeId}::uuid and sku = ${SKU}`);
    const s = await scoreboardOf(store.storeId);
    expect(s?.agreedAdMinor).toBe(100_000);
    expect(s?.notes).toEqual(
      expect.arrayContaining([
        expect.stringContaining("changed the shipping cost per order"),
        expect.stringContaining("agreed ad money was changed"),
        expect.stringContaining("Cost prices of the clone's goods were changed"),
      ]),
    );
    await expect(freezeBaseline({ account: admin }, store.storeId)).rejects.toThrow("before Day 1");
  });
});
