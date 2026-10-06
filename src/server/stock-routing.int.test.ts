import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
const fake = vi.hoisted(() => {
  const refunds: Record<string, unknown>[] = [];
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [] } }) },
    refunds: {
      create: async (params: Record<string, unknown>) => {
        refunds.push(params);
        return { id: `re_${refunds.length}`, status: "succeeded" };
      },
    },
  };
  return { client, refunds };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { placeOrder } = await import("./checkout");
const { cancelOrder, getOrderAdmin, refundOrder } = await import("./order-admin");
const { deactivateLocation } = await import("./inventory-locations");
const support = await import("./inventory-test-support");
const { addLocation, cartOf, holdsOf, ledgerIsWhole, levelsOf, movementsOf, newStore, no, pay, place, setLevel, variantId } = support;

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
const OSLO = "Lager Oslo";
const BERGEN = "Bergen";
const TRONDHEIM = "Trondheim";
let oslo: string;
let bergen: string;
let trondheim: string;

beforeAll(async () => {
  store = await newStore("routing");
  other = await newStore("routing-other");
  oslo = String(
    (await db().execute<Row>(sql`select id from commerce.inventory_locations where store_id = ${store.storeId}::uuid and name = ${OSLO}`))[0].id,
  );
  await db().execute(sql`update commerce.inventory_locations set priority = 1 where id = ${oslo}::uuid`);
  bergen = await addLocation(store.storeId, BERGEN, 2);
  trondheim = await addLocation(store.storeId, TRONDHEIM, 3);
});

afterAll(async () => {
  await closeDb();
});

const SKUS = ["DEMO-TOTE", "DEMO-MUG-WHITE", "DEMO-THERMOS"];

/** Every variant these tests use starts from nothing, at every location (a level row at each, so the backordered remainder has places to go), and no checkout holds anything. */
beforeEach(async () => {
  await db().execute(sql`update commerce.inventory_reservations set released_at = now() where store_id = ${store.storeId}::uuid and released_at is null`);
  for (const sku of SKUS) for (const location of [oslo, bergen, trondheim]) await setLevel(store.storeId, sku, location, 0);
});

const shop = () => ({ storeId: store.storeId, market: no });

describe("which location an order's units come from", () => {
  it("keeps an order together at the first location that has all of it, and pays from where it was held", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 1);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", oslo, 1);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 5);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", bergen, 5);
    await setLevel(store.storeId, "DEMO-TOTE", trondheim, 9);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", trondheim, 9);
    const order = await place(store.storeId, [["DEMO-TOTE", 2], ["DEMO-MUG-WHITE", 2]]);
    // Oslo is first but cannot supply both: Bergen is the first that can, and both lines are held there, none at Oslo or Trondheim.
    expect(await holdsOf(store.storeId, "DEMO-TOTE")).toEqual({ [BERGEN]: 2 });
    expect(await holdsOf(store.storeId, "DEMO-MUG-WHITE")).toEqual({ [BERGEN]: 2 });
    await pay(store.storeId, order, store.account);
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 1, [BERGEN]: 3, [TRONDHEIM]: 9 });
    expect((await movementsOf(store.storeId, "DEMO-MUG-WHITE")).filter((m) => m.orderId === order.orderId)).toEqual([
      expect.objectContaining({ location: BERGEN, delta: -2, reason: "sale", source: "order" }),
    ]);
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("splits what no location has in full by rank, as few places as the ranking allows", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 2);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 3);
    await setLevel(store.storeId, "DEMO-TOTE", trondheim, 4);
    const order = await place(store.storeId, [["DEMO-TOTE", 6]]);
    expect(await holdsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 2, [BERGEN]: 3, [TRONDHEIM]: 1 });
    await pay(store.storeId, order, store.account);
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 0, [BERGEN]: 0, [TRONDHEIM]: 3 });
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("puts the backordered remainder at the first location that stocks the variant, and nothing below zero elsewhere", async () => {
    await setLevel(store.storeId, "DEMO-THERMOS", bergen, 2);
    const order = await place(store.storeId, [["DEMO-THERMOS", 5]]);
    // Two are free at Bergen; the three beyond stock are at Oslo, the first in rank that has a level for it.
    expect(await holdsOf(store.storeId, "DEMO-THERMOS")).toEqual({ [OSLO]: 3, [BERGEN]: 2 });
    await pay(store.storeId, order, store.account);
    expect(await levelsOf(store.storeId, "DEMO-THERMOS")).toEqual({ [OSLO]: -3, [BERGEN]: 0, [TRONDHEIM]: 0 });
    const [line] = await db().execute<Row>(sql`select backorder_quantity from commerce.order_lines where order_id = ${order.orderId}::uuid and sku = 'DEMO-THERMOS'`);
    expect(Number(line.backorder_quantity)).toBe(3);
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("makes a level at the first location when the variant has none anywhere, so there is a row to take below zero", async () => {
    const id = await variantId(store.storeId, "DEMO-THERMOS");
    await db().execute(sql`delete from commerce.inventory_levels where store_id = ${store.storeId}::uuid and variant_id = ${id}::uuid`);
    const order = await place(store.storeId, [["DEMO-THERMOS", 2]]);
    expect(await holdsOf(store.storeId, "DEMO-THERMOS")).toEqual({ [OSLO]: 2 });
    await pay(store.storeId, order, store.account);
    expect(await levelsOf(store.storeId, "DEMO-THERMOS")).toEqual({ [OSLO]: -2 });
  });

  it("takes the last unit for one of two checkouts, with the level rows locked in one order, whichever location has it", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", trondheim, 1);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", bergen, 1);
    const carts = await Promise.all([
      cartOf(store.storeId, [["DEMO-TOTE", 1], ["DEMO-MUG-WHITE", 1]]),
      cartOf(store.storeId, [["DEMO-MUG-WHITE", 1], ["DEMO-TOTE", 1]]),
    ]);
    const results = await Promise.all(carts.map((cart) => placeOrder(shop(), cart)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, problem: "stock" }]);
    // Nothing is held by the one that lost.
    expect(await holdsOf(store.storeId, "DEMO-TOTE")).toEqual({ [TRONDHEIM]: 1 });
  });

  it("counts only the active locations: a location that was switched off supplies nothing", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", trondheim, 5);
    await db().execute(sql`update commerce.inventory_locations set active = false where id = ${trondheim}::uuid`);
    await expect(place(store.storeId, [["DEMO-TOTE", 1]])).rejects.toThrow("stock");
    await db().execute(sql`update commerce.inventory_locations set active = true where id = ${trondheim}::uuid`);
    await expect(place(store.storeId, [["DEMO-TOTE", 1]])).resolves.toBeTruthy();
  });
});

describe("putting units back after a refund, a cancellation or a return", () => {
  /** A paid order of 6 totes taken from three places: 2 at Oslo, 3 at Bergen, 1 at Trondheim. */
  async function splitOrder() {
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 2);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 3);
    await setLevel(store.storeId, "DEMO-TOTE", trondheim, 4);
    const order = await place(store.storeId, [["DEMO-TOTE", 6]]);
    await pay(store.storeId, order, store.account);
    const admin = (await getOrderAdmin(store.storeId, order.orderId))!;
    return { order, lineId: admin.lines.find((l) => l.sku === "DEMO-TOTE")!.id };
  }
  const refund = (orderId: string, restock: { lineId: string; quantity: number; locationId?: string | null }[]) => refundOrder(store.storeId, orderId, { amountMinor: 0, reason: "Back", restock }, store.accountId, { outside: true });

  it("goes back where the units were taken from, split as the order was", async () => {
    const { order, lineId } = await splitOrder();
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 0, [BERGEN]: 0, [TRONDHEIM]: 3 });
    expect(await refund(order.orderId, [{ lineId, quantity: 6 }])).toMatchObject({ ok: true });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 2, [BERGEN]: 3, [TRONDHEIM]: 4 });
    const back = (await movementsOf(store.storeId, "DEMO-TOTE")).filter((m) => m.orderId === order.orderId && m.reason === "order_restock");
    expect(back.map((m) => [m.location, m.delta]).sort()).toEqual([[BERGEN, 3], [OSLO, 2], [TRONDHEIM, 1]]);
    // The event says where, and what read the old shape still reads.
    const [event] = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'order.restocked'`);
    const restocked = (event.data as { restocked: { sku: string; quantity: number; locationId: string }[] }).restocked;
    expect(restocked.reduce((n, r) => n + r.quantity, 0)).toBe(6);
    expect(restocked.every((r) => r.sku === "DEMO-TOTE" && typeof r.locationId === "string")).toBe(true);
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("can be put back in parts, never above what the order took", async () => {
    const { order, lineId } = await splitOrder();
    expect(await refund(order.orderId, [{ lineId, quantity: 3 }])).toMatchObject({ ok: true });
    // The first three come from the highest-ranked location first: Oslo 2, then Bergen 1.
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 2, [BERGEN]: 1, [TRONDHEIM]: 3 });
    expect(await refund(order.orderId, [{ lineId, quantity: 3 }])).toMatchObject({ ok: true });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 2, [BERGEN]: 3, [TRONDHEIM]: 4 });
    expect(await refund(order.orderId, [{ lineId, quantity: 1 }])).toMatchObject({ ok: false, problem: expect.stringContaining("can go back in stock") });
  });

  it("goes to the location staff choose, when it is an active location of the store", async () => {
    const { order, lineId } = await splitOrder();
    expect(await refund(order.orderId, [{ lineId, quantity: 6, locationId: bergen }])).toMatchObject({ ok: true });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 0, [BERGEN]: 6, [TRONDHEIM]: 3 });
    expect(await ledgerIsWhole(store.storeId)).toBe(true);
  });

  it("refuses a location that is not active or not the store's, before anything moves", async () => {
    const { order, lineId } = await splitOrder();
    const foreign = await addLocation(other.storeId, "Elsewhere", 1);
    await db().execute(sql`update commerce.inventory_locations set active = false where id = ${bergen}::uuid`);
    const before = await levelsOf(store.storeId, "DEMO-TOTE");
    expect(await refund(order.orderId, [{ lineId, quantity: 1, locationId: bergen }])).toMatchObject({ ok: false, problem: expect.stringContaining("active stock location") });
    expect(await refund(order.orderId, [{ lineId, quantity: 1, locationId: foreign }])).toMatchObject({ ok: false, problem: expect.stringContaining("active stock location") });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual(before);
    await db().execute(sql`update commerce.inventory_locations set active = true where id = ${bergen}::uuid`);
  });

  it("falls back to the first active location when the one the units came from has been switched off", async () => {
    const { order, lineId } = await splitOrder();
    await db().execute(sql`update commerce.inventory_locations set active = false where id = ${trondheim}::uuid`);
    expect(await refund(order.orderId, [{ lineId, quantity: 6 }])).toMatchObject({ ok: true });
    // Oslo 2 and Bergen 3 as they were; Trondheim's one unit goes to the first active location in rank, Oslo.
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 3, [BERGEN]: 3, [TRONDHEIM]: 3 });
    await db().execute(sql`update commerce.inventory_locations set active = true where id = ${trondheim}::uuid`);
  });

  it("is done for a cancelled paid order through the same plan", async () => {
    const { order } = await splitOrder();
    const done = await cancelOrder(store.storeId, order.orderId, "Cancelled", store.accountId);
    expect(done.ok).toBe(true);
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 2, [BERGEN]: 3, [TRONDHEIM]: 4 });
  });

  it("puts an order from before the history was kept back at the first active location", async () => {
    const { order, lineId } = await splitOrder();
    // As if it had been paid before movements were recorded: its own movements are gone from the record the plan reads.
    await db().execute(sql`alter table commerce.inventory_movements disable trigger inventory_movements_guard`);
    try {
      await db().execute(sql`delete from commerce.inventory_movements where store_id = ${store.storeId}::uuid and order_id = ${order.orderId}::uuid`);
    } finally {
      await db().execute(sql`alter table commerce.inventory_movements enable trigger inventory_movements_guard`);
    }
    expect(await refund(order.orderId, [{ lineId, quantity: 2 }])).toMatchObject({ ok: true });
    expect(await levelsOf(store.storeId, "DEMO-TOTE")).toEqual({ [OSLO]: 2, [BERGEN]: 0, [TRONDHEIM]: 3 });
  });

  it("does not let an owner deactivate a location while a checkout holds stock there, and a refund never touches that rule", async () => {
    await setLevel(store.storeId, "DEMO-TOTE", trondheim, 4);
    await place(store.storeId, [["DEMO-TOTE", 2]]);
    const holder = Object.keys(await holdsOf(store.storeId, "DEMO-TOTE"))[0];
    const id = holder === TRONDHEIM ? trondheim : holder === BERGEN ? bergen : oslo;
    const refused = await deactivateLocation(store.member, id, 4);
    expect(refused.ok).toBe(false);
  });
});
