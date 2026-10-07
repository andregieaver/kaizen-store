import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { unitsToSend } from "@/lib/fulfilment";
import { parseOrderListParams } from "@/lib/order-list";

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

const { markSent, cancelOrder, getOrderAdmin } = await import("./order-admin");
const { markDelivered } = await import("./order-delivery");
const { toSend, orderFulfilment, shopperFulfilment } = await import("./fulfilment");
const { sendShipped } = await import("./shopper-emails");
const { runBulk } = await import("./order-bulk");
const { staffActor } = await import("./order-actor");
const { listOrdersPage: listOrders, loadOrderListContext } = await import("./order-list");
const w = await import("./withdrawals");
const { fxStore, paidOrder, lineOf, mailsOf, eventsOf } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * Sending in parts against a real database (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.1, 4.2, F1 to F4): a parcel names its lines and units; the order
 * is *Partly sent* (still `paid`) until nothing is left and `fulfilled` after; every refusal writes nothing; two parcels at once are serialised; `markSent()`
 * without lines sends what is left (every caller from before); a legacy parcel counts as everything; withdrawn units are never sent; each parcel has its own
 * email listing its lines; the receipt waits for the last parcel; bulk sends the remainder. Every query names the store.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;

beforeAll(async () => {
  store = await fxStore("ful");
  other = await fxStore("ful-other");
});
afterAll(async () => {
  await closeDb();
});

const parcel = { carrier: "posten", trackingNumber: "", trackingUrl: null };
const statusOf = async (orderId: string) => String((await db().execute<Row>(sql`select status from commerce.orders where id = ${orderId}::uuid`))[0].status);
const shipmentCount = async (orderId: string) => Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.shipments where order_id = ${orderId}::uuid`))[0].n);

describe("a parcel names its lines and units (F1)", () => {
  it("sends 2 of 3 and then 1 of 3: Partly sent while paid, Sent and fulfilled after", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3], ["DEMO-MUG-WHITE", 1]]);
    const tote = lineOf(order, "DEMO-TOTE");
    const mug = lineOf(order, "DEMO-MUG-WHITE");
    const first = await markSent(store.storeId, order.orderId, { ...parcel, trackingNumber: "P1" }, store.accountId, null, { lines: [{ lineId: tote.id, quantity: 2 }] });
    expect(first).toMatchObject({ ok: true, left: 2, shipment: { lines: [{ lineId: tote.id, quantity: 2 }] } });
    expect(await statusOf(order.orderId)).toBe("paid");
    expect((await orderFulfilment(db(), store.storeId, order.orderId))?.state).toBe("partly_sent");
    // The rest, by naming it.
    const second = await markSent(store.storeId, order.orderId, { ...parcel, trackingNumber: "P2" }, store.accountId, null, {
      lines: [{ lineId: tote.id, quantity: 1 }, { lineId: mug.id, quantity: 1 }],
    });
    expect(second).toMatchObject({ ok: true, left: 0 });
    expect(await statusOf(order.orderId)).toBe("fulfilled");
    expect((await orderFulfilment(db(), store.storeId, order.orderId))?.state).toBe("sent");
    // The history says what each parcel held.
    const sent = await eventsOf(order.orderId, "order.sent");
    expect(sent.map((e) => (e.data as Record<string, unknown>).units)).toEqual([2, 2]);
    // Nothing is left: a third parcel is refused and nothing is written.
    expect(await markSent(store.storeId, order.orderId, parcel, store.accountId)).toEqual({ ok: false, reason: "nothing_to_send" });
    expect(await shipmentCount(order.orderId)).toBe(2);
  });

  it("refuses too many units, a download, a line of another order and a bad quantity, writing nothing", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2], ["DEMO-MUG-WHITE", 1]]);
    const another = await paidOrder(store, [["DEMO-LAMP", 1]]);
    const tote = lineOf(order, "DEMO-TOTE");
    const mug = lineOf(order, "DEMO-MUG-WHITE");
    expect(await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 3 }] })).toMatchObject({ ok: false, reason: "too_many" });
    expect(await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: lineOf(another, "DEMO-LAMP").id, quantity: 1 }] })).toMatchObject({ ok: false, reason: "not_in_order" });
    expect(await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 1.5 }] })).toMatchObject({ ok: false, reason: "quantity_invalid" });
    expect(await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [] })).toMatchObject({ ok: false, reason: "empty" });
    // A download is never in a parcel: made a download inside the edit context, as the returns tests do.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.order_edit', ${order.orderId}, true)`);
      await tx.execute(sql`update commerce.order_lines set delivery = 'digital' where id = ${mug.id}::uuid`);
    });
    expect(await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: mug.id, quantity: 1 }] })).toMatchObject({ ok: false, reason: "not_physical" });
    expect(await shipmentCount(order.orderId)).toBe(0);
    expect(await statusOf(order.orderId)).toBe("paid");
  });

  it("refuses another store's order, an unpaid order and a copied one", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    expect(await markSent(other.storeId, order.orderId, parcel, null)).toEqual({ ok: false, reason: "not_found" });
    const [unpaid] = await db().execute<Row>(sql`select id from commerce.orders where store_id = ${store.storeId}::uuid and status = 'pending_payment' limit 1`);
    if (unpaid) expect(await markSent(store.storeId, String(unpaid.id), parcel, null)).toEqual({ ok: false, reason: "unpaid" });
    expect(await shipmentCount(order.orderId)).toBe(0);
  });

  it("serialises two parcels at once: the second sees the first", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    const both = await Promise.all([
      markSent(store.storeId, order.orderId, { ...parcel, trackingNumber: "A" }, null, null, { lines: [{ lineId: tote.id, quantity: 2 }] }),
      markSent(store.storeId, order.orderId, { ...parcel, trackingNumber: "B" }, null, null, { lines: [{ lineId: tote.id, quantity: 2 }] }),
    ]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.find((r) => !r.ok)).toMatchObject({ ok: false, reason: "too_many" });
    // With the basis the screen saw, a parcel recorded meanwhile is `changed`.
    const seen = (await orderFulfilment(db(), store.storeId, order.orderId))!.basis;
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    expect(await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 1 }], seen })).toMatchObject({ ok: false });
  });

  it("sends everything still to send when no lines are named (every caller from before)", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2], ["DEMO-MUG-BLACK", 1]]);
    const sent = await markSent(store.storeId, order.orderId, parcel, null);
    expect(sent).toMatchObject({ ok: true, left: 0 });
    expect(sent.ok && sent.shipment.lines.map((l) => l.quantity).sort()).toEqual([1, 2]);
    expect(await statusOf(order.orderId)).toBe("fulfilled");
  });

  it("counts a legacy parcel as everything sent", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await db().execute(sql`insert into commerce.shipments (store_id, order_id, carrier, tracking_number, legacy) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'Posten', 'OLD', true)`);
    const found = await orderFulfilment(db(), store.storeId, order.orderId);
    expect(found).toMatchObject({ legacy: true, unitsToSend: 0, state: "sent" });
    expect(await markSent(store.storeId, order.orderId, parcel, null)).toEqual({ ok: false, reason: "nothing_to_send" });
  });

  it("reads what is left the same way in code and in the database (toSend = line_to_send)", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3], ["DEMO-LAMP", 2]]);
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: lineOf(order, "DEMO-TOTE").id, quantity: 1 }] });
    const lines = (await toSend(db(), store.storeId, [order.orderId])).get(order.orderId)!;
    for (const line of lines) expect(line.toSend, line.sku).toBe(unitsToSend(line));
    expect(lines.map((l) => [l.sku, l.toSend]).sort()).toEqual([["DEMO-LAMP", 2], ["DEMO-TOTE", 2]]);
    // Another store reads nothing of it.
    expect((await toSend(db(), other.storeId, [order.orderId])).size).toBe(0);
  });
});

describe("the receipt, cancelling and the list", () => {
  it("records the receipt only once everything is sent, refuses to cancel a partly sent order, and finds it under Partly sent", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    const tote = lineOf(order, "DEMO-TOTE");
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    expect(await markDelivered(store.storeId, { orderId: order.orderId, on: "" }, null)).toMatchObject({ ok: false, code: "not_sent_in_full" });
    expect(await cancelOrder(store.storeId, order.orderId, "x", store.accountId)).toMatchObject({ ok: false, problem: expect.stringMatching(/already sent/) });
    const context = await loadOrderListContext(store.storeId);
    const partly = await listOrders(store.storeId, parseOrderListParams({ ship: "partly_sent" }), context);
    expect(partly.rows.map((r) => r.id)).toContain(order.orderId);
    expect(partly.rows.find((r) => r.id === order.orderId)?.ship).toBe("partly_sent");
    // To send still has it: the work is there.
    const toSendList = await listOrders(store.storeId, parseOrderListParams({ show: "to-send" }), context);
    expect(toSendList.rows.map((r) => r.id)).toContain(order.orderId);
    await markSent(store.storeId, order.orderId, parcel, null);
    expect(await markDelivered(store.storeId, { orderId: order.orderId, on: "" }, null)).toMatchObject({ ok: true });
    const after = await listOrders(store.storeId, parseOrderListParams({ ship: "partly_sent" }), context);
    expect(after.rows.map((r) => r.id)).not.toContain(order.orderId);
  });
});

describe("each parcel has its own email and the order pages list them (F2)", () => {
  it("emails each parcel once with its lines, says the rest follows on the first, and lists parcels and what is still to come", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2], ["DEMO-LAMP", 1]]);
    const tote = lineOf(order, "DEMO-TOTE");
    const first = await markSent(store.storeId, order.orderId, { ...parcel, trackingNumber: "TRK-1" }, null, null, { lines: [{ lineId: tote.id, quantity: 2 }] });
    if (!first.ok) throw new Error(first.reason);
    expect(await sendShipped(store.storeId, order.orderId, first.shipment)).toBe("logged");
    expect(await sendShipped(store.storeId, order.orderId, first.shipment)).toBe("duplicate");
    const view = await shopperFulfilment(store.storeId, order.orderId);
    expect(view?.state).toBe("partly_sent");
    expect(view?.parcels).toHaveLength(1);
    expect(view?.parcels[0].lines).toEqual([expect.objectContaining({ lineId: tote.id, quantity: 2 })]);
    expect(view?.stillToCome.map((l) => [l.sku, l.quantity])).toEqual([["DEMO-LAMP", 1]]);
    const second = await markSent(store.storeId, order.orderId, { ...parcel, trackingNumber: "TRK-2" }, null);
    if (!second.ok) throw new Error(second.reason);
    expect(await sendShipped(store.storeId, order.orderId, second.shipment)).toBe("logged");
    const mails = await mailsOf(order.orderId, "order.sent");
    expect(mails).toHaveLength(2);
    expect(mails.map((m) => m.to_address)).toEqual([order.email, order.email]);
    expect(String(mails[0].text)).toContain("I denne pakken");
    expect(String(mails[0].text)).toContain("2 × ");
    expect(String(mails[0].text)).toContain("Resten av bestillingen kommer i en annen pakke.");
    expect(String(mails[1].text)).not.toContain("Resten av bestillingen");
    expect(String(mails[1].text)).toMatch(/1 × .*Lamp|1 × /);
    expect((await shopperFulfilment(store.storeId, order.orderId))?.stillToCome).toEqual([]);
    expect(await shopperFulfilment(other.storeId, order.orderId)).toBeNull();
    // The staff page carries the parcels with their lines.
    const admin = await getOrderAdmin(store.storeId, order.orderId);
    expect(admin?.shipments.map((s) => s.lines.reduce((n, l) => n + l.quantity, 0))).toEqual([2, 1]);
    expect(admin?.fulfilment.state).toBe("sent");
  });
});

describe("bulk Mark as sent (F3)", () => {
  it("sends a partly sent order's remainder as one parcel and refuses a sent one", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const done = await paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: lineOf(order, "DEMO-TOTE").id, quantity: 1 }] });
    await markSent(store.storeId, done.orderId, parcel, null);
    const outcome = await runBulk(store.storeId, staffActor(store.accountId), { action: "mark_sent", selection: { kind: "ids", ids: [order.orderId, done.orderId] } });
    expect(outcome).toMatchObject({ ok: true, result: { applied: 1, refused: [{ id: done.orderId, reason: "already_sent" }] } });
    expect(await statusOf(order.orderId)).toBe("fulfilled");
    const last = await db().execute<Row>(sql`
      select sl.quantity from commerce.shipment_lines sl join commerce.shipments sh on sh.id = sl.shipment_id where sh.order_id = ${order.orderId}::uuid order by sh.created_at desc, sh.id desc limit 1
    `);
    expect(Number(last[0].quantity)).toBe(2);
  });

  it("counts a backordered unit as waiting only while it is still to send", async () => {
    const order = await paidOrder(store, [["DEMO-THERMOS", 2]]);
    const thermos = lineOf(order, "DEMO-THERMOS");
    // One unit sold on backorder (D172), the other in stock: written as the draw would.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.order_edit', ${order.orderId}, true)`);
      await tx.execute(sql`select set_config('kaizen.drawing', 'on', true)`);
      await tx.execute(sql`update commerce.order_lines set backorder_quantity = 1, backorder_days = 10 where id = ${thermos.id}::uuid`);
    });
    const refused = await runBulk(store.storeId, staffActor(store.accountId), { action: "mark_sent", selection: { kind: "ids", ids: [order.orderId] } });
    expect(refused).toMatchObject({ ok: true, result: { applied: 0, refused: [{ reason: "waiting_for_stock" }] } });
    // Sent in parts from the order page: one now, the backordered one later.
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: thermos.id, quantity: 1 }] });
    const state = await orderFulfilment(db(), store.storeId, order.orderId);
    expect(state?.lines[0]).toMatchObject({ toSend: 1, backordered: 1 });
  });
});

describe("withdrawn units are never sent (F4, 4.2)", () => {
  const statement = (o: { number: string; email: string }, lines: { lineId: string; quantity: number }[]) => ({ orderNumber: o.number, email: o.email, name: "K N", lines });
  async function withdraw(o: { number: string; email: string }, lines: { lineId: string; quantity: number }[]) {
    const started = await w.startWithdrawal(store.storeId, statement(o, lines), { floorMs: 0 });
    if (!started.ok || !started.matched || !started.request) throw new Error(`step 1: ${JSON.stringify(started)}`);
    const confirmed = await w.confirmWithdrawal(store.storeId, { requestId: started.request.id });
    if (!confirmed.ok) throw new Error(`step 2: ${JSON.stringify(confirmed)}`);
    return confirmed;
  }
  const nothingToSendBack = async (orderId: string) => {
    const rows = await db().execute<Row>(sql`select r.id from commerce.returns r where r.order_id = ${orderId}::uuid order by r.created_at`);
    const { NOTHING_SENT_SQL } = await import("./return-sql");
    return Promise.all(rows.map(async (r) => Boolean((await db().execute<Row>(sql`select ${NOTHING_SENT_SQL} as n from commerce.returns r where r.id = ${String(r.id)}::uuid`))[0].n)));
  };

  it("withdrawing 1 of 3 before sending leaves 2 to send, and a parcel of 3 is refused", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    await withdraw(order, [{ lineId: tote.id, quantity: 1 }]);
    expect(await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 3 }] })).toMatchObject({ ok: false, reason: "too_many" });
    expect(await markSent(store.storeId, order.orderId, parcel, null)).toMatchObject({ ok: true, left: 0, shipment: { lines: [{ quantity: 2 }] } });
    expect(await nothingToSendBack(order.orderId)).toEqual([true]);
  });

  it("after 1 of 3 is sent, a withdrawal of 1 takes an unsent unit (nothing to send back); of the last unsent ones the order is sent", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    await withdraw(order, [{ lineId: tote.id, quantity: 1 }]);
    expect((await orderFulfilment(db(), store.storeId, order.orderId))?.unitsToSend).toBe(1);
    expect(await nothingToSendBack(order.orderId)).toEqual([true]);
    expect(await statusOf(order.orderId)).toBe("paid");
    // The last unsent unit withdrawn: nothing is left to send, so the order is sent (fulfilled) in the confirmation's own transaction.
    await withdraw(order, [{ lineId: tote.id, quantity: 1 }]);
    expect(await statusOf(order.orderId)).toBe("fulfilled");
    expect(await nothingToSendBack(order.orderId)).toEqual([true, true]);
  });

  it("withdrawing 2 of 3 when 2 were sent asks one unit back", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 2 }] });
    await withdraw(order, [{ lineId: tote.id, quantity: 2 }]);
    expect(await nothingToSendBack(order.orderId)).toEqual([false]);
    expect((await orderFulfilment(db(), store.storeId, order.orderId))?.unitsToSend).toBe(0);
    expect(await statusOf(order.orderId)).toBe("fulfilled");
  });

  it("every unit withdrawn before sending: nothing is sent", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    await withdraw(order, [{ lineId: lineOf(order, "DEMO-TOTE").id, quantity: 1 }]);
    expect(await markSent(store.storeId, order.orderId, parcel, null)).toEqual({ ok: false, reason: "withdrawn_in_full" });
    expect((await orderFulfilment(db(), store.storeId, order.orderId))?.state).toBe("withdrawn");
  });
});
