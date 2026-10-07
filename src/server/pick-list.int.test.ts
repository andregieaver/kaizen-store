import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { PICK_LIST_MAX } from "@/lib/fulfilment-limits";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { pickListData, ordersToSend } = await import("./pick-list");
const { runBulk } = await import("./order-bulk");
const { staffActor } = await import("./order-actor");
const { markSent } = await import("./order-admin");
const { fxStore, paidOrder, lineOf } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * The pick list against a real database (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.3, P2, P4): the selected orders' units still to send, summed by
 * variant or listed by order; digital lines, units already in parcels and units withdrawn left out; unfinished checkouts and copied history skipped with the
 * reason; another store's orders not found and nothing of them read; no amounts, names or addresses.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;
beforeAll(async () => {
  store = await fxStore("pick");
  other = await fxStore("pick-other");
});
afterAll(async () => {
  await closeDb();
});

describe("the pick list (P2)", () => {
  it("sums the units still to send by variant over the selected orders, and lists them by order", async () => {
    const a = await paidOrder(store, [["DEMO-TOTE", 2], ["DEMO-MUG-WHITE", 1]]);
    const b = await paidOrder(store, [["DEMO-TOTE", 3]]);
    await markSent(store.storeId, b.orderId, { carrier: "posten", trackingNumber: "", trackingUrl: null }, null, null, { lines: [{ lineId: lineOf(b, "DEMO-TOTE").id, quantity: 1 }] });
    const sent = await paidOrder(store, [["DEMO-LAMP", 1]]);
    await markSent(store.storeId, sent.orderId, { carrier: "posten", trackingNumber: "", trackingUrl: null }, null);
    const foreign = await paidOrder(other, [["DEMO-TOTE", 5]]);
    const data = await pickListData(store.storeId, [a.orderId, b.orderId, sent.orderId, foreign.orderId]);
    if (!data.ok) throw new Error(data.problem);
    expect(data.list.products.map((p) => [p.sku, p.units, p.orders])).toEqual([
      ["DEMO-MUG-WHITE", 1, 1],
      ["DEMO-TOTE", 4, 2],
    ]);
    expect(data.list.totalUnits).toBe(5);
    expect(data.list.skipped).toEqual([
      { orderId: sent.orderId, number: sent.number, reason: "nothing_to_send" },
      { orderId: foreign.orderId, number: null, reason: "not_found" },
    ]);
    expect(data.list.orders.some((o) => o.orderId === foreign.orderId)).toBe(false);
    expect(JSON.stringify(data)).not.toContain(a.email);
    const byOrder = await pickListData(store.storeId, [a.orderId, b.orderId], { by: "order" });
    expect(byOrder.ok && byOrder.list.orders.map((o) => [o.number, o.units])).toEqual([
      [a.number, 3],
      [b.number, 2],
    ].sort((x, y) => String(x[0]).localeCompare(String(y[0]), "en", { numeric: true })));
  });

  it("finds the orders with something to send for the AI manager's 'everything to send', never another store's", async () => {
    const order = await paidOrder(store, [["DEMO-NOTEBOOK-LINED", 1]]);
    const ids = await ordersToSend(store.storeId);
    expect(ids).toContain(order.orderId);
    expect(await ordersToSend(other.storeId)).not.toContain(order.orderId);
  });

  it("skips copied history and unfinished checkouts with the reason, and refuses more than 100", async () => {
    const [unpaid] = await db().execute<Row>(sql`select id, number from commerce.orders where store_id = ${store.storeId}::uuid and status = 'pending_payment' limit 1`);
    if (unpaid) {
      const data = await pickListData(store.storeId, [String(unpaid.id)]);
      expect(data.ok && data.list.skipped).toEqual([{ orderId: String(unpaid.id), number: String(unpaid.number), reason: "unpaid" }]);
    }
    const ids = Array.from({ length: PICK_LIST_MAX + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await pickListData(store.storeId, ids)).toEqual({ ok: false, problem: "too_many" });
  });

  it("is a bulk action that counts the orders on it and the ones it leaves out", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const foreign = await paidOrder(other, [["DEMO-TOTE", 1]]);
    const outcome = await runBulk(store.storeId, staffActor(store.accountId), { action: "print_pick_list", selection: { kind: "ids", ids: [order.orderId, foreign.orderId] } });
    expect(outcome).toMatchObject({ ok: true, result: { applied: 1, refused: [{ id: foreign.orderId, number: null, reason: "not_found" }] } });
  });
});
