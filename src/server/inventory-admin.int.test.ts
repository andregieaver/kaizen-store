import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { putBackWords, takenFromWords } from "@/lib/inventory-admin";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { listOrders } = await import("./orders");
const { getOrderAdmin, refundOrder } = await import("./order-admin");
const { listLocations } = await import("./inventory-locations");
const { orderStockHistory } = await import("./stock-restock");
const support = await import("./inventory-test-support");
const { addLocation, clearLevels, mainLocation, newStore, pay, place, setLevel, variantId } = support;

/**
 * What the admin's order pages read together (wave 3, D172): the order list's *Waiting for stock* filter and the owed units on a row, and the words
 * that say where an order's units were taken from and where a restock goes. The words are pure (`inventory-admin.ts`); this holds them to what the
 * database really recorded for a split order and a backordered one.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let main: string;
let bergen: string;
let MAIN_NAME = "";
const BERGEN = "Bergen lager";
const MUG = "DEMO-MUG-WHITE";
const THERMOS = "DEMO-THERMOS";

beforeAll(async () => {
  store = await newStore("inv-admin");
  main = await mainLocation(store.storeId);
  bergen = await addLocation(store.storeId, BERGEN, 5);
  MAIN_NAME = (await listLocations(store.storeId)).find((l) => l.id === main)!.name;
});

afterAll(async () => {
  await closeDb();
});

describe("the order list's Waiting for stock", () => {
  it("lists a paid order with units sold on backorder, with how many are owed, and not one without", async () => {
    await clearLevels(store.storeId, THERMOS);
    await setLevel(store.storeId, THERMOS, main, 2);
    await setLevel(store.storeId, MUG, main, 20);
    const backordered = await place(store.storeId, [[THERMOS, 5]]);
    await pay(store.storeId, backordered, store.account);
    const plain = await place(store.storeId, [[MUG, 1]]);
    await pay(store.storeId, plain, store.account);

    const waiting = await listOrders(store.storeId, { waiting: true });
    expect(waiting.map((o) => o.id)).toEqual([backordered.orderId]);
    expect(waiting[0].owed).toBe(3);
    // Both are orders to send; only the backordered one carries owed units.
    const toSend = await listOrders(store.storeId, { toSend: true });
    expect(toSend.map((o) => o.id).sort()).toEqual([backordered.orderId, plain.orderId].sort());
    const all = await listOrders(store.storeId);
    expect(all.find((o) => o.id === backordered.orderId)?.owed).toBe(3);
    expect(all.find((o) => o.id === plain.orderId)?.owed).toBe(0);
  });

  it("stops listing an order once it is sent: it no longer owes anything", async () => {
    const [row] = await listOrders(store.storeId, { waiting: true });
    await db().execute(sql`update commerce.orders set status = 'fulfilled' where id = ${row.id}::uuid`);
    expect(await listOrders(store.storeId, { waiting: true })).toEqual([]);
    expect((await listOrders(store.storeId)).find((o) => o.id === row.id)?.owed).toBe(0);
  });

  it("never lists another store's orders", async () => {
    const other = await newStore("inv-admin-other");
    expect(await listOrders(other.storeId, { waiting: true })).toEqual([]);
  });
});

describe("where an order's units came from, and where a restock goes", () => {
  it("says an order was split across the locations it was taken from, in rank order", async () => {
    await clearLevels(store.storeId, MUG);
    await setLevel(store.storeId, MUG, main, 2);
    await setLevel(store.storeId, MUG, bergen, 3);
    const order = await place(store.storeId, [[MUG, 4]]);
    await pay(store.storeId, order, store.account);
    const variant = await variantId(store.storeId, MUG);
    const locations = await listLocations(store.storeId);
    const history = (await orderStockHistory(db(), store.storeId, order.orderId, [variant])).get(variant)!;
    expect(takenFromWords(history.taken, locations)).toBe(`${MAIN_NAME} 2, ${BERGEN} 2`);
    expect(putBackWords(history.taken, history.returned, locations)).toBe(`They go back where they were taken from: ${MAIN_NAME} 2, ${BERGEN} 2.`);
  });

  it("follows a restock to a chosen location, and says what is left to go back", async () => {
    await clearLevels(store.storeId, MUG);
    await setLevel(store.storeId, MUG, main, 2);
    await setLevel(store.storeId, MUG, bergen, 3);
    const order = await place(store.storeId, [[MUG, 4]]);
    await pay(store.storeId, order, store.account);
    const lineId = (await getOrderAdmin(store.storeId, order.orderId))!.lines.find((l) => l.sku === MUG)!.id;
    const done = await refundOrder(store.storeId, order.orderId, { amountMinor: 0, reason: "Back", restock: [{ lineId, quantity: 2, locationId: bergen }] }, store.accountId, { outside: true });
    expect(done).toMatchObject({ ok: true });
    const variant = await variantId(store.storeId, MUG);
    const locations = await listLocations(store.storeId);
    const history = (await orderStockHistory(db(), store.storeId, order.orderId, [variant])).get(variant)!;
    // Two went back (to Bergen, by choice); the rest still goes where each unit came from, less what is already back there.
    expect(history.returned).toEqual([{ locationId: bergen, quantity: 2 }]);
    expect(putBackWords(history.taken, history.returned, locations)).toBe(`They go back where they were taken from: ${MAIN_NAME} 2.`);
  });

  it("says a deactivated location's units go to the first active one", async () => {
    await clearLevels(store.storeId, MUG);
    await setLevel(store.storeId, MUG, main, 3);
    const order = await place(store.storeId, [[MUG, 2]]);
    await pay(store.storeId, order, store.account);
    await db().execute(sql`update commerce.inventory_locations set active = false where id = ${main}::uuid`);
    try {
      const variant = await variantId(store.storeId, MUG);
      const locations = await listLocations(store.storeId);
      const history = (await orderStockHistory(db(), store.storeId, order.orderId, [variant])).get(variant)!;
      const named = locations.map((l) => ({ id: l.id, name: l.name, active: l.active }));
      expect(putBackWords(history.taken, history.returned, named)).toBe(`Taken from ${MAIN_NAME} 2. ${MAIN_NAME} is not active, so those units go back to ${BERGEN}.`);
    } finally {
      await db().execute(sql`update commerce.inventory_locations set active = true where id = ${main}::uuid`);
    }
  });

  it("has nothing to say of an order that took no stock", async () => {
    const variant = await variantId(store.storeId, MUG);
    const locations = await listLocations(store.storeId);
    const history = (await orderStockHistory(db(), store.storeId, "00000000-0000-4000-8000-000000000000", [variant])).get(variant);
    expect(history).toBeUndefined();
    expect(takenFromWords([], locations)).toBe("");
  });
});
