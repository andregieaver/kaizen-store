import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { BULK_PRINT_MAX } from "@/lib/order-limits";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { packingSlipData, parcelSlipData } = await import("./packing-slips");
const { markSent } = await import("./order-admin");
const { fxStore, paidOrder, lineOf } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * Packing slips against a real database (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.3, P1, P3, P4): one slip per order, in its own language, of the units
 * still to send (a partly sent order's remainder, withdrawn units never); sent and withdrawn orders skipped in a set, reprinted on their own; a parcel's slip of
 * that parcel's lines with "more follows"; another store's orders and parcels never printed; no amount anywhere in the data.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;
beforeAll(async () => {
  store = await fxStore("slips");
  other = await fxStore("slips-other");
});
afterAll(async () => {
  await closeDb();
});

const parcel = { carrier: "posten", trackingNumber: "", trackingUrl: null };
const noMoney = (value: unknown) => {
  const text = JSON.stringify(value);
  for (const key of ["Minor", "price", "total", "amount", "tax"]) expect(text).not.toContain(key);
};

describe("a set of slips (P1)", () => {
  it("prints each order's units still to send in its own language, and skips what has nothing left", async () => {
    const swedish = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await db().execute(sql`update commerce.orders set locale = 'sv-SE' where id = ${swedish.orderId}::uuid`);
    const partly = await paidOrder(store, [["DEMO-TOTE", 3], ["DEMO-MUG-WHITE", 1]]);
    await markSent(store.storeId, partly.orderId, parcel, null, null, { lines: [{ lineId: lineOf(partly, "DEMO-TOTE").id, quantity: 2 }] });
    const sent = await paidOrder(store, [["DEMO-LAMP", 1]]);
    await markSent(store.storeId, sent.orderId, parcel, null);
    const foreign = await paidOrder(other, [["DEMO-TOTE", 1]]);
    const set = await packingSlipData(store.storeId, [swedish.orderId, partly.orderId, sent.orderId, foreign.orderId, swedish.orderId]);
    if (!set.ok) throw new Error(set.problem);
    expect(set.slips.map((s) => [s.number, s.lang])).toEqual([
      [swedish.number, "sv"],
      [partly.number, "nb"],
    ]);
    expect(set.slips[1].lines.map((l) => [l.sku, l.quantity]).sort()).toEqual([["DEMO-MUG-WHITE", 1], ["DEMO-TOTE", 1]]);
    expect(set.skipped).toEqual([
      { id: sent.orderId, number: sent.number, reason: "already_sent" },
      { id: foreign.orderId, number: null, reason: "not_found" },
    ]);
    // Nothing of the other store's order is in the data: no slip, and its refusal carries no number.
    expect(set.slips.some((s) => s.orderId === foreign.orderId)).toBe(false);
    noMoney(set);
  });

  it("reprints a sent order on its own slip, every unit as sold", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await markSent(store.storeId, order.orderId, parcel, null);
    const set = await packingSlipData(store.storeId, [order.orderId], { reprint: true });
    expect(set.ok && set.slips[0]).toMatchObject({ scope: "reprint", lines: [{ sku: "DEMO-TOTE", quantity: 2 }] });
  });

  it("refuses more than 100 orders and none", async () => {
    const ids = Array.from({ length: BULK_PRINT_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await packingSlipData(store.storeId, ids)).toEqual({ ok: false, problem: "too_many" });
    expect(await packingSlipData(store.storeId, [])).toEqual({ ok: false, problem: "empty" });
  });
});

describe("a parcel's slip (P3, P4)", () => {
  it("prints the parcel's lines, says more follows while units are left, keeps the gift, and is never another order's or store's", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    // The buyer's gift (D173) is frozen once written: set here with the triggers off, as the checkout would have written it from the cart.
    await db().transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update commerce.orders set is_gift = true, gift_to = 'Kari', gift_message = 'Gratulerer' where id = ${order.orderId}::uuid`);
    });
    const first = await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: lineOf(order, "DEMO-TOTE").id, quantity: 1 }] });
    if (!first.ok) throw new Error(first.reason);
    const slip = await parcelSlipData(store.storeId, order.orderId, first.shipment.id);
    expect(slip).toMatchObject({ scope: "parcel", shipmentId: first.shipment.id, moreFollows: true, lines: [{ sku: "DEMO-TOTE", quantity: 1 }], gift: { to: "Kari", message: "Gratulerer" } });
    noMoney(slip);
    const last = await markSent(store.storeId, order.orderId, parcel, null);
    if (!last.ok) throw new Error(last.reason);
    expect(await parcelSlipData(store.storeId, order.orderId, last.shipment.id)).toMatchObject({ moreFollows: false, lines: [{ quantity: 2 }] });
    // Another order's parcel, another store, a made-up id: nothing.
    const another = await paidOrder(store, [["DEMO-LAMP", 1]]);
    expect(await parcelSlipData(store.storeId, another.orderId, first.shipment.id)).toBeNull();
    expect(await parcelSlipData(other.storeId, order.orderId, first.shipment.id)).toBeNull();
    expect(await parcelSlipData(store.storeId, order.orderId, "not-an-id")).toBeNull();
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.shipments where order_id = ${order.orderId}::uuid`);
    expect(Number(count.n)).toBe(2);
  });
});
