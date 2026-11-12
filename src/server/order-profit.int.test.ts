import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const { orderProfitFor, periodOrderProfits, profitSummary } = await import("./order-profit");
const { recordLabelCost } = await import("./carrier-booking");
const { markSent } = await import("./order-admin");
const { reorderDraft } = await import("./purchase-orders");
const { getStore } = await import("./stores");
const { fxStore, paidOrder, variantOf } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;
type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;

/**
 * Profit per order (D415) and the prepared reorder (D416) against a real database: an order's profit from its frozen cost of goods, the store's fee
 * and sending estimates, then Stripe's own fee and a booked label's own price once they are known; an order with an item without a cost price has no
 * figure; a period's orders and their summary; and the purchase order prepared from what is running out.
 */

let fx: Fx;
let store: Store;

beforeAll(async () => {
  fx = await fxStore("profit");
  store = (await getStore(fx.slug))!;
  // Cost prices are frozen on a line when it is sold: the mug has one, the tote has none.
  await db().execute(sql`update commerce.product_variants set cost_minor = case sku when 'DEMO-MUG-WHITE' then 5000 else null end where store_id = ${fx.storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.analytics_settings (store_id, payment_fee_bps, payment_fee_fixed_minor, shipping_cost_minor)
    values (${fx.storeId}::uuid, 150, 200, 6900)
    on conflict (store_id) do update set payment_fee_bps = 150, payment_fee_fixed_minor = 200, shipping_cost_minor = 6900
  `);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const orderRow = async (orderId: string) =>
  (await db().execute<Row>(sql`select total_minor, tax_minor from commerce.orders where id = ${orderId}::uuid`))[0];
const lineOf = (p: NonNullable<Awaited<ReturnType<typeof orderProfitFor>>>, key: string) => p.lines.find((l) => l.key === key);

describe("profit per order (D415)", () => {
  it("takes the frozen cost of goods and the store's estimates off revenue without VAT, then Stripe's fee and the label's own price once known", async () => {
    const order = await paidOrder(fx, [["DEMO-MUG-WHITE", 2]]);
    const o = await orderRow(order.orderId);
    const total = Number(o.total_minor);
    const revenue = total - Number(o.tax_minor);

    const estimated = (await orderProfitFor(store, order.orderId))!;
    expect(estimated.currency).toBe("NOK");
    expect(lineOf(estimated, "revenue")?.amountMinor).toBe(revenue);
    expect(lineOf(estimated, "cogs")?.amountMinor).toBe(-10_000);
    expect(lineOf(estimated, "paymentFee")).toEqual({ key: "paymentFee", amountMinor: -(Math.round((total * 150) / 10_000) + 200), estimated: true });
    expect(lineOf(estimated, "shipping")).toEqual({ key: "shipping", amountMinor: -6_900, estimated: true });
    expect(estimated.estimated).toBe(true);
    expect(estimated.profitMinor).toBe(estimated.lines.reduce((s, l) => s + (l.amountMinor ?? 0), 0));

    // Stripe's own fee read (D290), and the parcel booked at a price with VAT that is kept without it (25 % in Norway).
    await db().execute(sql`update commerce.payments set provider_fee_minor = 1234, fee_currency = 'NOK' where order_id = ${order.orderId}::uuid and provider = 'stripe'`);
    const sent = await markSent(fx.storeId, order.orderId, { carrier: "Posten", trackingNumber: "PROFIT1", trackingUrl: null }, fx.accountId);
    if (!sent.ok) throw new Error(sent.reason);
    await recordLabelCost(fx.storeId, sent.shipment.id, "NO", { amountMinor: 9_250, currency: "NOK", vatIncluded: true });
    const [kept] = await db().execute<Row>(sql`select label_cost_minor, label_cost_carrier from commerce.shipments where id = ${sent.shipment.id}::uuid`);
    expect(Number(kept.label_cost_minor)).toBe(7_400);
    expect(kept.label_cost_carrier).toEqual({ amountMinor: 9_250, currency: "NOK", vatIncluded: true });

    const known = (await orderProfitFor(store, order.orderId))!;
    expect(lineOf(known, "paymentFee")).toEqual({ key: "paymentFee", amountMinor: -1_234, estimated: false });
    expect(lineOf(known, "shipping")).toEqual({ key: "shipping", amountMinor: -7_400, estimated: false });
    expect(known.estimated).toBe(false);
  }, 60_000);

  it("has no figure while an item has no cost price, and none for another store's order or an unknown one", async () => {
    const order = await paidOrder(fx, [["DEMO-TOTE", 1]]);
    const p = (await orderProfitFor(store, order.orderId))!;
    expect(p.profitMinor).toBeNull();
    expect(p.linesWithoutCost).toBe(1);
    const other = await fxStore("profit-other");
    expect(await orderProfitFor((await getStore(other.slug))!, order.orderId)).toBeNull();
    expect(await orderProfitFor(store, "not-an-id")).toBeNull();
  }, 60_000);

  it("lists the period's paid orders with their profit and sums what is known in the main currency", async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: store.timeZone });
    const { rows, capped } = await periodOrderProfits(store, customPeriod(today, today));
    expect(capped).toBe(false);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const summary = profitSummary(store, rows);
    expect(summary.orders).toBe(rows.length);
    expect(summary.unknown).toBeGreaterThanOrEqual(1);
    expect(summary.known + summary.unknown).toBe(rows.length);
    expect(summary.currency).toBe("NOK");
  }, 60_000);
});

describe("the prepared reorder (D416)", () => {
  it("fills a purchase order from what is running out, with the cost price and the supplier last used", async () => {
    const mug = await variantOf(fx, "DEMO-MUG-WHITE");
    // Two sold above and nothing left: 30 days to cover and 7 for delivery at that pace is three to order.
    await db().execute(sql`update commerce.inventory_levels set on_hand = 0 where store_id = ${fx.storeId}::uuid and variant_id = ${mug}::uuid`);
    await db().execute(sql`
      insert into commerce.purchase_orders (store_id, supplier, currency, location_id, created_by)
      select ${fx.storeId}::uuid, 'Keramikk AS', 'NOK', id, ${fx.accountId}::uuid from commerce.inventory_locations where store_id = ${fx.storeId}::uuid and active limit 1
    `);
    const draft = await reorderDraft(store);
    expect(draft.currency).toBe("NOK");
    expect(draft.supplier).toBe("Keramikk AS");
    expect(draft.lines).toContainEqual(expect.objectContaining({ sku: "DEMO-MUG-WHITE", quantity: "3", unitCost: "50,00" }));
    // Nothing was saved: the person presses Create.
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.purchase_orders where store_id = ${fx.storeId}::uuid`);
    expect(Number(count.n)).toBe(1);
  }, 60_000);
});
