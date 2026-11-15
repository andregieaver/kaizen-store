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
const { removeOriginalPeriod, saveOriginalPeriod, scoreboardOf } = await import("./challenge-scoreboard");
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
