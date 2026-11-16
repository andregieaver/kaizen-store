import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { closeDb, db } = await import("@/db/client");
const { newStore } = await import("./inventory-test-support");
const { profitOverviewTool } = await import("./profit-tools");
const { goalFigures } = await import("./autopilot-goals");
const { targetProgress } = await import("@/lib/autopilot-goals");

type Row = Record<string, unknown>;

/**
 * Profit for the autopilot (`docs/100-day-challenge.md` E2, E3) on a real store: one paid order with a known cost, read by `profit_overview`
 * and by the goals' figures with the analytics' own definition, so a goal of contribution profit or margin is measured, and one with no cost
 * known says why instead of 0.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let costless: Awaited<ReturnType<typeof newStore>>;
const today = new Date().toISOString().slice(0, 10);

/** A paid order today: one line of 125 NOK with 25 % VAT (100 NOK net), its unit cost given or unknown. */
async function paidOrder(s: typeof store, cost: number | null) {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // A line of one of the store's own goods: the analytics cost only lines of goods.
  const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${s.storeId}::uuid order by created_at limit 1`);
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at)
    values (${s.storeId}::uuid, ${`P-${run}`}, 'NO', 'NOK', 'nb-NO', 'buyer@example.com', 'paid', 12500, 0, 0, 2500, 12500, '{}'::jsonb, '{}'::jsonb, now())
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor, total_minor, tax_minor,
      tax_rate, tax_code, delivery)
    values (${s.storeId}::uuid, ${String(order.id)}::uuid, ${variant ? String(variant.id) : null}::uuid, 'LINE', 'Line', 1, 12500, ${cost}, 0, 12500, 2500, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status)
    values (${s.storeId}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_${run}`}, 'acct_profit', 12500, 0, 'NOK', 'captured'::commerce.payment_status)
  `);
}

beforeAll(async () => {
  store = await newStore("profit-goals");
  costless = await newStore("profit-costless");
  await paidOrder(store, 4000);
  await paidOrder(costless, null);
});

afterAll(closeDb);

describe("profit for the autopilot", () => {
  it("is read by profit_overview as the analytics count it", async () => {
    const answer = await profitOverviewTool({ store: store.member.store }, { period: "30d" });
    expect(answer.period).toMatchObject({ to: expect.any(String) });
    expect(answer.net_sales).toMatch(/100/);
    expect(answer.contribution_profit).not.toBeNull();
    expect(answer.contribution_margin).not.toBeNull();
    // No marketing recorded: the challenge's ratio says why instead of a figure.
    expect(answer.profit_per_krone_of_marketing).toBeNull();
    expect(answer.not_known).toEqual(expect.arrayContaining([expect.stringContaining("No marketing spend")]));
    const since = await profitOverviewTool({ store: store.member.store }, { period: "since", since: today });
    expect(since.period).toMatchObject({ from: today });
    await expect(profitOverviewTool({ store: store.member.store }, { period: "since" })).rejects.toThrow("first day");
  });

  it("measures goals of contribution and margin, and since a first day", async () => {
    const f = await goalFigures(store.member.store, new Date(), [today]);
    expect(f.contribution30d).not.toBeNull();
    expect(f.margin30d).toBeGreaterThan(0);
    expect(f.since[today]).toMatchObject({ revenue: 10_000 });
    expect(targetProgress({ kind: "margin_30d", percent: 1 }, f)).toMatchObject({ met: true });
    expect(targetProgress({ kind: "revenue_since", amount_minor: 20_000, currency: "NOK", since: today }, f)).toMatchObject({ met: false });
  });

  it("says why when no cost is known, never 0", async () => {
    const f = await goalFigures(costless.member.store, new Date(), [today]);
    expect(f.contribution30d).toBeNull();
    expect(f.missing.contribution_30d).toContain("cost");
    expect(targetProgress({ kind: "contribution_30d", amount_minor: 1, currency: "NOK" }, f)).toMatchObject({ met: null, now: "not measured" });
    const answer = await profitOverviewTool({ store: costless.member.store }, { period: "30d" });
    expect(answer.contribution_profit).toBeNull();
    expect(answer.not_known).toEqual(expect.arrayContaining([expect.stringContaining("cost")]));
  });
});
