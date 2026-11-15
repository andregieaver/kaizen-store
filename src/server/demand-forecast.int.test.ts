import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { demandForecasts } = await import("./demand-forecast");
const { newStore, mainLocation } = await import("./inventory-test-support");

type Row = Record<string, unknown>;

/**
 * The demand forecast's reads (`docs/100-day-challenge.md` C4, D636) on a real store: a year of a mug's paid sales (the days ahead sold twice
 * as many last year as the weeks before them), a past campaign it sold three times as many in, a campaign planned in the days ahead, and two
 * purchase orders that took 14 days from ordered to received.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let variant: { id: string; productId: string };
const SKU = "DEMO-MUG-WHITE";

/** `units` mugs sold, paid, in one order at noon `daysAgo` days ago (negative: never). */
async function sale(daysAgo: number, units: number) {
  const number = `F-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at)
    values (${store.storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', 'fulfilled', ${19900 * units}, 0, 0, ${3980 * units}, ${19900 * units}, '{}'::jsonb, '{}'::jsonb,
      date_trunc('day', now() at time zone 'Europe/Oslo') at time zone 'Europe/Oslo' - make_interval(days => ${daysAgo}) + interval '12 hours')
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor,
      tax_rate, tax_code, delivery)
    values (${store.storeId}::uuid, ${String(o.id)}::uuid, ${variant.id}::uuid, ${SKU}, 'Mug', ${units}, 19900, 6000, 0, ${19900 * units}, ${3980 * units}, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${store.storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`pi_${number}`}, ${store.account}, ${19900 * units}, 'NOK', 'captured')
  `);
}

beforeAll(async () => {
  store = await newStore("forecast");
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo' where id = ${store.storeId}::uuid`);
  const [v] = await db().execute<Row>(sql`select id, product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${SKU}`);
  variant = { id: String(v.id), productId: String(v.product_id) };
  // Last year: one a day in the 28 days a year before today, two a day in the 37 days after.
  for (let d = 365 + 27; d >= 365; d--) await sale(d, 1);
  for (let d = 364; d >= 365 - 37; d--) await sale(d, 2);
  // This year: one a day for the last 28 days; three a day in the ten days of a campaign 60 to 51 days ago, one a day in the 20 days before.
  for (let d = 27; d >= 0; d--) await sale(d, 1);
  for (let d = 80; d >= 61; d--) await sale(d, 1);
  for (let d = 60; d >= 51; d--) await sale(d, 3);
  await db().execute(sql`
    insert into commerce.campaigns (store_id, name, kind, percent, starts_at, ends_at, active)
    values (${store.storeId}::uuid, 'Spring', 'percent', 20, now() - interval '60 days', now() - interval '51 days', true),
           (${store.storeId}::uuid, 'Coming', 'percent', 20, now() + interval '3 days', now() + interval '12 days', true)
  `);
  const location = await mainLocation(store.storeId);
  for (const ago of [40, 20]) {
    // As the store keeps one: a draft with its line, then ordered, then received.
    const [po] = await db().execute<Row>(sql`
      insert into commerce.purchase_orders (store_id, supplier, currency, location_id) values (${store.storeId}::uuid, 'Nordic Mugs', 'NOK', ${location}::uuid)
      returning id
    `);
    await db().execute(sql`
      insert into commerce.purchase_order_lines (store_id, purchase_order_id, variant_id, quantity, unit_cost_minor)
      values (${store.storeId}::uuid, ${String(po.id)}::uuid, ${variant.id}::uuid, 50, 6000)
    `);
    await db().execute(sql`update commerce.purchase_orders set status = 'ordered', ordered_at = now() - make_interval(days => ${ago}) where id = ${String(po.id)}::uuid`);
    await db().execute(sql`update commerce.purchase_orders set status = 'received', received_at = now() - make_interval(days => ${ago - 14}) where id = ${String(po.id)}::uuid`);
  }
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.campaigns where store_id = ${store.storeId}::uuid`);
  await closeDb();
});

describe("the demand forecast's reads (C4)", () => {
  it("brings the season, the planned campaign by the product's own lift and the supplier's delivery time into the forecast", async () => {
    const forecasts = await demandForecasts({ id: store.storeId, timeZone: "Europe/Oslo" }, [{ variantId: variant.id, productId: variant.productId, onHand: 20 }], {
      paceDays: 28,
      coverDays: 30,
      leadDays: 7,
    });
    const f = forecasts.get(variant.id)!;
    expect(f.leadDays).toBe(14);
    expect(f.reasons).toEqual([
      "the season: ×2 from the same days last year",
      expect.stringMatching(/^a planned campaign: ×1\.\d \(this product sold ×3 in past campaigns\)$/),
      "delivery: 14 days, as the supplier's last received orders took",
    ]);
    // One a day, twice that for the season, and more for the ten campaign days of the 44 ahead.
    expect(f.perDay).toBeGreaterThan(2);
    expect(f.perDay).toBeLessThan(4);
    expect(f.orderNow).toBe(true);
    expect(f.suggested).toBeGreaterThan(Math.ceil(2 * 44) - 20);
  });

  it("forecasts nothing for a variant that never sold", async () => {
    const [other] = await db().execute<Row>(sql`select id, product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku <> ${SKU} limit 1`);
    const forecasts = await demandForecasts({ id: store.storeId, timeZone: "Europe/Oslo" }, [{ variantId: String(other.id), productId: String(other.product_id), onHand: 5 }], {
      paceDays: 28,
      coverDays: 30,
      leadDays: 7,
    });
    expect(forecasts.get(String(other.id))).toMatchObject({ perDay: 0, suggested: 0, orderNow: false, lastsDays: null });
  });
});
