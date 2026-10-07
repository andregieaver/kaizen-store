import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { unitsToSend } from "@/lib/fulfilment";
import { parseOrderListParams } from "@/lib/order-list";
import { undoneMessage } from "@/lib/shipment-undo";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    refunds: { create: async () => ({ id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { markSent, getOrderAdmin, undoShipment, undoRefusalText, UNDO_REFUSALS, cancelOrder } = await import("./order-admin");
const { markDelivered } = await import("./order-delivery");
const { toSend, orderFulfilment, shopperFulfilment } = await import("./fulfilment");
const { packingSlipData, parcelSlipData } = await import("./packing-slips");
const { pickListData } = await import("./pick-list");
const { runBulk } = await import("./order-bulk");
const { staffActor } = await import("./order-actor");
const { sendShipped } = await import("./shopper-emails");
const { carrierLabel } = await import("./carrier-label");
const { listOrdersPage, loadOrderListContext } = await import("./order-list");
const { fxStore, paidOrder, lineOf, eventsOf } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * Undoing a parcel (wave 3, run 3, D174 follow-up, `docs/wave-3-fulfilment.md` "Undoing a parcel"), against a real database: `undoShipment()` marks a parcel undone (never
 * deleted), its units are to send again, a sent order is partly sent again, a recorded receipt is cleared, the slips, the pick list, the bulk send, the list's filters
 * and the shopper's page all read it as not sent, and a carrier booking is not cancelled (the answer says so). Refusals come back as codes with a sentence each.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;

beforeAll(async () => {
  store = await fxStore("undo");
  other = await fxStore("undo-b");
});
afterAll(async () => {
  await closeDb();
});

const statusOf = async (orderId: string) => String((await db().execute<Row>(sql`select status from commerce.orders where id = ${orderId}::uuid`))[0].status);
const shipmentCount = async (orderId: string) => Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.shipments where order_id = ${orderId}::uuid`))[0].n);
const auditOf = (orderId: string) =>
  db().execute<Row>(sql`select action, area, details, account_id from commerce.audit_log where store_id = ${store.storeId}::uuid and target_id = ${orderId} and action = 'order.shipment_undone'`);

/** 3 totes sent in two parcels (2, then 1): the order is Sent. */
async function sentInTwo(trackings = ["FIRST", "SECOND"]) {
  const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
  const tote = lineOf(order, "DEMO-TOTE");
  const first = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: trackings[0], trackingUrl: null }, store.accountId, null, { lines: [{ lineId: tote.id, quantity: 2 }] });
  const second = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: trackings[1], trackingUrl: null }, store.accountId, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
  if (!first.ok || !second.ok) throw new Error("not sent");
  expect(await statusOf(order.orderId)).toBe("fulfilled");
  return { order, tote, first: first.shipment.id, second: second.shipment.id };
}

describe("undoing the second of two parcels", () => {
  it("makes the order Partly sent with its unit to send again, everywhere", async () => {
    const { order, tote, first, second } = await sentInTwo();
    const undone = await undoShipment(store.storeId, order.orderId, second, store.accountId, "Packed the wrong colour");
    expect(undone).toEqual({ ok: true, units: 1, left: 1, reopened: true, deliveredWas: null, bookedWith: null });

    // The order and the database's own reading.
    expect(await statusOf(order.orderId)).toBe("paid");
    const found = await orderFulfilment(db(), store.storeId, order.orderId);
    expect(found).toMatchObject({ state: "partly_sent", unitsToSend: 1, hasShipment: true });
    expect(found?.lines[0]).toMatchObject({ quantity: 3, shipped: 2, toSend: 1 });
    for (const line of (await toSend(db(), store.storeId, [order.orderId])).get(order.orderId)!) expect(line.toSend).toBe(unitsToSend(line));

    // The record stays, marked, with who and why.
    expect(await shipmentCount(order.orderId)).toBe(2);
    const admin = await getOrderAdmin(store.storeId, order.orderId);
    expect(admin?.shipments.map((s) => [s.id, s.undone?.reason ?? null])).toEqual([
      [first, null],
      [second, "Packed the wrong colour"],
    ]);
    expect(admin?.shipments[1].undone?.by).toMatch(/@example\.com$/);
    expect(admin?.fulfilment).toMatchObject({ state: "partly_sent", unitsToSend: 1 });

    // The history and the activity log: counts and ids, the reason only in the event's note.
    const [event] = await eventsOf(order.orderId, "order.shipment_undone");
    expect(event.data).toMatchObject({ shipment: second, units: 1, left: 1, reopened: true, tracking: "SECOND", note: "Packed the wrong colour" });
    const audits = await auditOf(order.orderId);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ area: "orders", account_id: store.accountId, details: { shipment: second, units: 1, left: 1, reopened: true, booked: null, receiptCleared: false } });
    expect(JSON.stringify(audits[0].details)).not.toContain("colour");

    // The shopper sees one parcel and one unit still to come; the undone parcel is never emailed.
    const shopper = await shopperFulfilment(store.storeId, order.orderId);
    expect(shopper?.parcels.map((p) => p.id)).toEqual([first]);
    expect(shopper?.stillToCome).toEqual([expect.objectContaining({ lineId: tote.id, quantity: 1 })]);
    expect(await sendShipped(store.storeId, order.orderId, { id: second, carrier: "Posten", trackingNumber: "SECOND", trackingUrl: null }, { resend: true })).toBeNull();

    // The slips: the order's prints the unit to send, the undone parcel's is gone; the pick list counts it.
    const slips = await packingSlipData(store.storeId, [order.orderId]);
    expect(slips.ok && slips.slips[0].lines).toEqual([expect.objectContaining({ quantity: 1, sku: "DEMO-TOTE" })]);
    expect(await parcelSlipData(store.storeId, order.orderId, second)).toBeNull();
    expect((await parcelSlipData(store.storeId, order.orderId, first))?.lines).toEqual([expect.objectContaining({ quantity: 2 })]);
    const picks = await pickListData(store.storeId, [order.orderId]);
    expect(picks.ok && picks.list.totalUnits).toBe(1);

    // The list: partly sent, and the undone parcel's tracking number finds nothing.
    const context = await loadOrderListContext(store.storeId);
    expect((await listOrdersPage(store.storeId, parseOrderListParams({ ship: "partly_sent" }), context)).rows.map((r) => r.id)).toContain(order.orderId);
    expect((await listOrdersPage(store.storeId, parseOrderListParams({ q: "SECOND" }), context)).rows.map((r) => r.id)).not.toContain(order.orderId);
    expect((await listOrdersPage(store.storeId, parseOrderListParams({ q: "FIRST" }), context)).rows.map((r) => r.id)).toContain(order.orderId);

    // Bulk Mark as sent sends the unit again, and the order is Sent.
    const bulk = await runBulk(store.storeId, staffActor(store.accountId), { action: "mark_sent", selection: { kind: "ids", ids: [order.orderId] } });
    expect(bulk).toMatchObject({ ok: true, result: { applied: 1 } });
    expect(await statusOf(order.orderId)).toBe("fulfilled");
    expect(await shipmentCount(order.orderId)).toBe(3);
    expect((await orderFulfilment(db(), store.storeId, order.orderId))?.lines[0]).toMatchObject({ shipped: 3, toSend: 0 });
  });

  it("clears a recorded receipt, which can be recorded again only once everything is sent", async () => {
    const { order, tote, second } = await sentInTwo(["R1", "R2"]);
    expect(await markDelivered(store.storeId, { orderId: order.orderId, on: "" }, store.accountId)).toMatchObject({ ok: true });
    const undone = await undoShipment(store.storeId, order.orderId, second, store.accountId, null);
    expect(undone).toMatchObject({ ok: true, reopened: true });
    expect(undone.ok && undone.deliveredWas).toEqual(expect.any(String));
    expect((await db().execute<Row>(sql`select delivered_at from commerce.orders where id = ${order.orderId}::uuid`))[0].delivered_at).toBeNull();
    expect(await markDelivered(store.storeId, { orderId: order.orderId, on: "" }, store.accountId)).toMatchObject({ ok: false, code: "not_sent_in_full" });
    await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "R3", trackingUrl: null }, store.accountId, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    expect(await markDelivered(store.storeId, { orderId: order.orderId, on: "" }, store.accountId)).toMatchObject({ ok: true });
    const audits = await auditOf(order.orderId);
    expect(audits[0].details).toMatchObject({ receiptCleared: true });
  });

  it("lets an order whose only parcel was undone be cancelled (nothing was sent)", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const sent = await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "", trackingUrl: null }, store.accountId);
    if (!sent.ok) throw new Error("not sent");
    expect(await undoShipment(store.storeId, order.orderId, sent.shipment.id, store.accountId, null)).toMatchObject({ ok: true, units: 1, reopened: true });
    expect((await orderFulfilment(db(), store.storeId, order.orderId))?.state).toBe("unsent");
    expect(await cancelOrder(store.storeId, order.orderId, "customer asked", store.accountId)).toMatchObject({ ok: true });
    expect(await statusOf(order.orderId)).toBe("cancelled");
  });
});

describe("a parcel booked with a carrier", () => {
  it("is undone, but the booking is not cancelled at the carrier: the answer says so, and its label is no longer served", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    const sent = await markSent(
      store.storeId,
      order.orderId,
      { carrier: "bring", trackingNumber: "70701234567", trackingUrl: null },
      store.accountId,
      { carrierId: "bring", consignmentNumber: "70701234567", labelUrl: "https://api.bring.com/labels/x.pdf" },
    );
    if (!sent.ok) throw new Error("not sent");
    const undone = await undoShipment(store.storeId, order.orderId, sent.shipment.id, store.accountId, "Booked twice");
    expect(undone).toMatchObject({ ok: true, units: 2, left: 2, bookedWith: "Posten / Bring" });
    if (!undone.ok) throw new Error("not undone");
    const message = undoneMessage(undone);
    expect(message).toContain("The booking with Posten / Bring was not cancelled: cancel it with Posten / Bring yourself.");
    expect(message).toContain("The customer was not emailed");
    expect(await carrierLabel(store.storeId, order.orderId, sent.shipment.id)).toBeNull();
    expect((await auditOf(order.orderId))[0].details).toMatchObject({ booked: "bring" });
    // Booking again right away is not taken for a double click: the undone booking does not count.
    const [recent] = await db().execute<Row>(sql`
      select 1 from commerce.shipments where store_id = ${store.storeId}::uuid and order_id = ${order.orderId}::uuid and carrier_id = 'bring'
        and created_at > now() - interval '2 minutes' and undone_at is null
    `);
    expect(recent).toBeUndefined();
  });
});

describe("refusals, each with a sentence", () => {
  it("refuses a parcel undone already", async () => {
    const { order, second } = await sentInTwo(["A1", "A2"]);
    await undoShipment(store.storeId, order.orderId, second, store.accountId, null);
    expect(await undoShipment(store.storeId, order.orderId, second, store.accountId, null)).toEqual({ ok: false, reason: "already_undone" });
    expect(undoRefusalText("already_undone")).toBe("This parcel was undone already.");
  });

  it("refuses another store's parcel and order, a parcel of another order, and ids that are not ids", async () => {
    const { order, first } = await sentInTwo(["B1", "B2"]);
    expect(await undoShipment(other.storeId, order.orderId, first, other.accountId, null)).toEqual({ ok: false, reason: "not_found" });
    const elsewhere = await paidOrder(store, [["DEMO-TOTE", 1]]);
    expect(await undoShipment(store.storeId, elsewhere.orderId, first, store.accountId, null)).toEqual({ ok: false, reason: "not_found" });
    expect(await undoShipment(store.storeId, order.orderId, "not-a-uuid", store.accountId, null)).toEqual({ ok: false, reason: "invalid" });
    expect(undoRefusalText("not_found")).toBe("This parcel was not found.");
    expect(await statusOf(order.orderId)).toBe("fulfilled");
  });

  it("refuses when a return or withdrawal was made after the parcel, pointing at settling it first", async () => {
    const { order, second } = await sentInTwo(["C1", "C2"]);
    await db().execute(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'return', 'requested')`);
    expect(await undoShipment(store.storeId, order.orderId, second, store.accountId, null)).toEqual({ ok: false, reason: "return" });
    expect(undoRefusalText("return")).toMatch(/Settle the return first/);
  });

  it("refuses a cancelled order's parcel and a reason over 200 characters", async () => {
    const { order, second } = await sentInTwo(["D1", "D2"]);
    expect(await undoShipment(store.storeId, order.orderId, second, store.accountId, "x".repeat(201))).toEqual({ ok: false, reason: "reason_too_long" });
    await db().execute(sql`update commerce.orders set status = 'cancelled' where id = ${order.orderId}::uuid`);
    expect(await undoShipment(store.storeId, order.orderId, second, store.accountId, null)).toEqual({ ok: false, reason: "status" });
    expect(undoRefusalText("status")).toMatch(/paid or sent order/);
    // Every refusal has its sentence.
    for (const text of Object.values(UNDO_REFUSALS)) expect(text.length).toBeGreaterThan(10);
  });
});
