import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
const fake = vi.hoisted(() => {
  const refunds: Record<string, unknown>[] = [];
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [] } }) },
    refunds: { create: async (params: Record<string, unknown>) => { refunds.push(params); return { id: `re_${refunds.length}`, status: "succeeded" }; } },
  };
  return { client, refunds };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { cancelOrder } = await import("./order-admin");
const support = await import("./inventory-test-support");
const { newStore, place, pay, setLevel, mainLocation, addLocation, clearLevels, variantId } = support;
const { variantStockOf } = await import("./catalog");
const { getOrder } = await import("./orders");

let storeId: string;
let account: string;
let accountId: string;

beforeAll(async () => {
  const made = await newStore("revmoney");
  storeId = made.storeId;
  account = made.account;
  accountId = made.accountId;
});
afterAll(async () => { await closeDb(); });

describe("review (money): a paid order that was short at the draw can still be cancelled and refunded", () => {
  it("cancelOrder refunds in full even though the stock draw was short (hold expired, stock sold meanwhile)", async () => {
    const main = await mainLocation(storeId);
    await setLevel(storeId, "DEMO-MUG-WHITE", main, 3);
    const order = await place(storeId, [["DEMO-MUG-WHITE", 2]]);
    // The checkout's hold expires and the stock goes elsewhere before the customer pays: the old draw recorded `stock.short` and took what was left.
    await db().execute(sql`update commerce.inventory_reservations set expires_at = now() - interval '1 minute' where order_id = ${order.orderId}::uuid`);
    await setLevel(storeId, "DEMO-MUG-WHITE", main, 1);
    await pay(storeId, order, account);
    const short = await db().execute(sql`select 1 from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'stock.short'`);
    expect(short.length).toBe(1);
    const done = await cancelOrder(storeId, order.orderId, "Out of stock", accountId);
    expect(done).toMatchObject({ ok: true });
    expect(fake.refunds.length).toBe(1);
  });
});

describe("review (money): the shopper's stock figure agrees with what placeOrder will allocate", () => {
  it("one location owing units and another holding stock: the page's in-stock count is the physical stock the order is filled from", async () => {
    const main = await mainLocation(storeId);
    const second = await addLocation(storeId, "Bergen", 5);
    await clearLevels(storeId, "DEMO-THERMOS");
    await setLevel(storeId, "DEMO-THERMOS", main, -3); // 3 units owed on backorder at the home location
    await setLevel(storeId, "DEMO-THERMOS", second, 5); // 5 units received at the second location
    const id = await variantId(storeId, "DEMO-THERMOS");
    const stock = (await variantStockOf(db(), storeId, [id])).get(id)!;
    const order = await place(storeId, [["DEMO-THERMOS", 5]]);
    const [line] = await db().execute(sql`select backorder_quantity from commerce.order_lines where order_id = ${order.orderId}::uuid`);
    // 5 units are physically there and the order is filled from them without a backorder ...
    expect(Number(line.backorder_quantity)).toBe(0);
    // ... so the product page / cart must not say only 2 are in stock and that 3 of 5 are on backorder.
    expect(stock.inStock).toBe(5);
    void getOrder;
  });
});
