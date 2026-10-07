import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { unitsToSend } from "@/lib/fulfilment";

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

const { markSent, refundOrder, cancelOrder, getOrderAdmin, PARTLY_SENT_CANCEL } = await import("./order-admin");
const { markDelivered } = await import("./order-delivery");
const { toSend, orderFulfilment } = await import("./fulfilment");
const { packingSlipData } = await import("./packing-slips");
const { pickListData } = await import("./pick-list");
const { runBulk } = await import("./order-bulk");
const { staffActor } = await import("./order-actor");
const { fxStore, paidOrder, lineOf, onHand, eventsOf, NO, NO_EUR } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * Units that will not be sent (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` "Closing units that will not be sent"), against a real database: a partly sent
 * order cannot be cancelled or changed, so staff refund the units never sent and put them back in stock with *These units were not sent* ticked
 * (`refundOrder(..., { notSent: true })`). Those units come off what is still to send (`commerce.unsent_closures`), so the order becomes Sent, its packing slip,
 * the pick list and bulk Mark as sent leave them out, and the receipt can be recorded. Without the tick a restock is stock going back and nothing more (a sent
 * unit that came back), as before. In a krone order and a euro one (D109: a new money read).
 */

let store: Awaited<ReturnType<typeof fxStore>>;

beforeAll(async () => {
  store = await fxStore("unsent");
});
afterAll(async () => {
  await closeDb();
});

const parcel = { carrier: "posten", trackingNumber: "", trackingUrl: null };
const statusOf = async (orderId: string) => String((await db().execute<Row>(sql`select status from commerce.orders where id = ${orderId}::uuid`))[0].status);
const shipmentCount = async (orderId: string) => Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.shipments where order_id = ${orderId}::uuid`))[0].n);
const closures = (orderId: string) =>
  db().execute<Row>(sql`select order_line_id, quantity, refund_id, created_by from commerce.unsent_closures where store_id = ${store.storeId}::uuid and order_id = ${orderId}::uuid`);

describe.each([
  ["kroner", NO, "NOK"],
  ["euros", NO_EUR, "EUR"],
] as const)("a partly sent order in %s", (_name, market, currency) => {
  /** 3 totes, 1 sent: 2 still to send. */
  async function partlySent() {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]], { market });
    expect(order.currency).toBe(currency);
    const tote = lineOf(order, "DEMO-TOTE");
    const sent = await markSent(store.storeId, order.orderId, { ...parcel, trackingNumber: "FIRST" }, store.accountId, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    expect(sent).toMatchObject({ ok: true, left: 2 });
    return { order, tote, unitRefund: Math.floor((tote.totalMinor * 2) / 3) };
  }

  it("cannot be cancelled, and the refusal points at refunding the units not sent with the tick", async () => {
    const { order } = await partlySent();
    expect(await cancelOrder(store.storeId, order.orderId, "customer asked", store.accountId)).toEqual({ ok: false, problem: PARTLY_SENT_CANCEL });
    expect(PARTLY_SENT_CANCEL).toMatch(/These units were not sent/);
  });

  it("refunds the 2 units never sent with 'not sent': they come off what is to send, the order is Sent, and slips, the pick list and bulk send leave them out", async () => {
    const { order, tote, unitRefund } = await partlySent();
    const stockBefore = await onHand(store, "DEMO-TOTE");
    const refunded = await refundOrder(
      store.storeId,
      order.orderId,
      { amountMinor: unitRefund, reason: "out of stock", restock: [{ lineId: tote.id, quantity: 2 }], notSent: true },
      store.accountId,
    );
    expect(refunded).toMatchObject({ ok: true, amountMinor: unitRefund, closedUnits: 2 });
    if (!refunded.ok) throw new Error(refunded.problem);
    // The refund is in the order's own currency, and the closure names it.
    const [refund] = await db().execute<Row>(sql`select r.amount_minor, trim(p.currency) as currency from commerce.refunds r join commerce.payments p on p.id = r.payment_id where r.id = ${refunded.refundId}::uuid`);
    expect({ amount: Number(refund.amount_minor), currency: refund.currency }).toEqual({ amount: unitRefund, currency });
    expect(await closures(order.orderId)).toEqual([{ order_line_id: tote.id, quantity: 2, refund_id: refunded.refundId, created_by: store.accountId }]);
    expect(await onHand(store, "DEMO-TOTE")).toBe(stockBefore + 2);

    // Sent, in the refund's own transaction.
    expect(await statusOf(order.orderId)).toBe("fulfilled");
    const found = await orderFulfilment(db(), store.storeId, order.orderId);
    expect(found).toMatchObject({ state: "sent", unitsToSend: 0 });
    expect(found?.lines[0]).toMatchObject({ quantity: 3, shipped: 1, withdrawn: 0, closed: 2, toSend: 0 });
    for (const line of (await toSend(db(), store.storeId, [order.orderId])).get(order.orderId)!) expect(line.toSend).toBe(unitsToSend(line));
    expect((await eventsOf(order.orderId, "order.unsent_closed")).map((e) => e.data)).toEqual([
      { units: 2, lines: [{ lineId: tote.id, sku: "DEMO-TOTE", title: expect.any(String), quantity: 2 }], refundId: refunded.refundId },
    ]);

    // The packing slip and the pick list print nothing of it.
    const slips = await packingSlipData(store.storeId, [order.orderId]);
    expect(slips).toMatchObject({ ok: true, slips: [], skipped: [{ id: order.orderId, reason: "already_sent" }] });
    const picks = await pickListData(store.storeId, [order.orderId]);
    expect(picks.ok && picks.list.totalUnits).toBe(0);
    // Bulk Mark as sent records no second parcel.
    const bulk = await runBulk(store.storeId, staffActor(store.accountId), { action: "mark_sent", selection: { kind: "ids", ids: [order.orderId] } });
    expect(bulk).toMatchObject({ ok: true, result: { applied: 0, refused: [{ id: order.orderId, reason: "already_sent" }] } });
    expect(await markSent(store.storeId, order.orderId, parcel, null)).toEqual({ ok: false, reason: "nothing_to_send" });
    expect(await shipmentCount(order.orderId)).toBe(1);
    // The receipt (D153) can be recorded now that it is Sent.
    expect(await markDelivered(store.storeId, { orderId: order.orderId, on: "" }, store.accountId)).toMatchObject({ ok: true });
    // The admin's own read says the same.
    const admin = await getOrderAdmin(store.storeId, order.orderId);
    expect(admin?.fulfilment).toMatchObject({ state: "sent", unitsToSend: 0 });
  });

  it("without 'not sent' leaves the restocked units to send, as before (a sent unit that came back is not a unit that will not be sent)", async () => {
    const { order, tote, unitRefund } = await partlySent();
    const refunded = await refundOrder(store.storeId, order.orderId, { amountMinor: unitRefund, reason: "goodwill", restock: [{ lineId: tote.id, quantity: 2 }] }, store.accountId);
    expect(refunded).toMatchObject({ ok: true });
    expect(refunded.ok && refunded.closedUnits).toBeFalsy();
    expect(await closures(order.orderId)).toEqual([]);
    expect(await statusOf(order.orderId)).toBe("paid");
    expect(await orderFulfilment(db(), store.storeId, order.orderId)).toMatchObject({ state: "partly_sent", unitsToSend: 2 });
    const slips = await packingSlipData(store.storeId, [order.orderId]);
    expect(slips.ok && slips.slips[0]?.lines).toEqual([{ quantity: 2, title: expect.any(String), sku: "DEMO-TOTE" }]);
    const picks = await pickListData(store.storeId, [order.orderId]);
    expect(picks.ok && picks.list.totalUnits).toBe(2);
  });

  it("closes no more than is still to send: 2 of 3 sent, 3 put back as not sent closes 1", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]], { market });
    const tote = lineOf(order, "DEMO-TOTE");
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 2 }] });
    const refunded = await refundOrder(store.storeId, order.orderId, { amountMinor: 0, reason: "returned and the last one not sent", restock: [{ lineId: tote.id, quantity: 3 }], notSent: true }, store.accountId);
    expect(refunded).toMatchObject({ ok: true, closedUnits: 1 });
    expect(await closures(order.orderId)).toEqual([{ order_line_id: tote.id, quantity: 1, refund_id: null, created_by: store.accountId }]);
    expect(await statusOf(order.orderId)).toBe("fulfilled");
  });
});

describe("an order with nothing sent yet", () => {
  it.each([
    ["kroner", NO],
    ["euros", NO_EUR],
  ] as const)("1 of 3 closed with nothing refunded, then the other 2 sent: Sent (%s)", async (_name, market) => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]], { market });
    const tote = lineOf(order, "DEMO-TOTE");
    const closed = await refundOrder(store.storeId, order.orderId, { amountMinor: 0, reason: "one is damaged", restock: [{ lineId: tote.id, quantity: 1 }], notSent: true }, store.accountId);
    expect(closed).toMatchObject({ ok: true, closedUnits: 1 });
    expect(await orderFulfilment(db(), store.storeId, order.orderId)).toMatchObject({ state: "unsent", unitsToSend: 2 });
    const slips = await packingSlipData(store.storeId, [order.orderId]);
    expect(slips.ok && slips.slips[0]?.lines).toEqual([{ quantity: 2, title: expect.any(String), sku: "DEMO-TOTE" }]);
    // A parcel of 3 is refused; everything still to send is 2.
    expect(await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 3 }] })).toMatchObject({ ok: false, reason: "too_many" });
    const sent = await markSent(store.storeId, order.orderId, parcel, null);
    expect(sent).toMatchObject({ ok: true, left: 0, shipment: { lines: [{ lineId: tote.id, quantity: 2 }] } });
    expect(await statusOf(order.orderId)).toBe("fulfilled");
    expect((await orderFulfilment(db(), store.storeId, order.orderId))?.state).toBe("sent");
  });

  it("everything closed and nothing sent reads as closed, stays paid, and refuses a change and a parcel", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    const tote = lineOf(order, "DEMO-TOTE");
    expect(await refundOrder(store.storeId, order.orderId, { amountMinor: 0, reason: "will not send", restock: [{ lineId: tote.id, quantity: 2 }], notSent: true }, store.accountId)).toMatchObject({
      ok: true,
      closedUnits: 2,
    });
    expect(await orderFulfilment(db(), store.storeId, order.orderId)).toMatchObject({ state: "closed", unitsToSend: 0 });
    expect(await statusOf(order.orderId)).toBe("paid");
    expect(await markSent(store.storeId, order.orderId, parcel, null)).toEqual({ ok: false, reason: "nothing_to_send" });
    const bulk = await runBulk(store.storeId, staffActor(store.accountId), { action: "mark_sent", selection: { kind: "ids", ids: [order.orderId] } });
    expect(bulk).toMatchObject({ ok: true, result: { applied: 0, refused: [{ reason: "nothing_to_send" }] } });
    const slips = await packingSlipData(store.storeId, [order.orderId]);
    expect(slips).toMatchObject({ ok: true, slips: [], skipped: [{ reason: "nothing_to_send" }] });
    const { orderEditability } = await import("./order-edits");
    expect(await orderEditability(store.storeId, order.orderId)).toMatchObject({ block: "unsent_closed" });
  });
});

describe("another store's ids", () => {
  /** The database's words for a refused statement (drizzle wraps the driver's error in its own). */
  const refusal = (query: Promise<unknown>) =>
    query.then(
      () => "accepted",
      (error: unknown) => {
        const e = error as { message?: string; cause?: { message?: string } };
        return `${e.message ?? ""} ${e.cause?.message ?? ""}`;
      },
    );

  it("are refused: no closure through another store's order or line, by the refund or by the table's own rules", async () => {
    const other = await fxStore("unsent-other");
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    const theirs = await paidOrder(other, [["DEMO-TOTE", 2]]);
    const theirTote = lineOf(theirs, "DEMO-TOTE");

    // The other store refunding this store's order: not found.
    expect(
      await refundOrder(other.storeId, order.orderId, { amountMinor: 0, reason: "x", restock: [{ lineId: tote.id, quantity: 2 }], notSent: true }, other.accountId),
    ).toEqual({ ok: false, problem: "This order no longer exists." });
    // This store's order with the other store's line: the line is not on the order, so nothing is put back or closed.
    expect(
      await refundOrder(store.storeId, order.orderId, { amountMinor: 0, reason: "x", restock: [{ lineId: theirTote.id, quantity: 1 }], notSent: true }, store.accountId),
    ).toEqual({ ok: false, problem: "Enter an amount to refund." });

    // Written directly, the table's rules refuse a row naming another store's order or line.
    expect(
      await refusal(
        db().execute(sql`
          insert into commerce.unsent_closures (store_id, order_id, order_line_id, quantity)
          values (${other.storeId}::uuid, ${order.orderId}::uuid, ${tote.id}::uuid, 1)
        `),
      ),
    ).toMatch(/unsent_closure\.order|foreign key/);
    expect(
      await refusal(
        db().execute(sql`
          insert into commerce.unsent_closures (store_id, order_id, order_line_id, quantity)
          values (${store.storeId}::uuid, ${order.orderId}::uuid, ${theirTote.id}::uuid, 1)
        `),
      ),
    ).toMatch(/unsent_closure\.order|foreign key/);

    expect(await closures(order.orderId)).toEqual([]);
    expect(await orderFulfilment(db(), store.storeId, order.orderId)).toMatchObject({ state: "partly_sent", unitsToSend: 2 });
    expect(await orderFulfilment(db(), other.storeId, theirs.orderId)).toMatchObject({ state: "unsent", unitsToSend: 2 });
    // The slips and the pick list of one store never read the other's order.
    expect(await packingSlipData(other.storeId, [order.orderId])).toMatchObject({ ok: true, slips: [], skipped: [{ id: order.orderId, reason: "not_found" }] });
    const picks = await pickListData(other.storeId, [order.orderId]);
    expect(picks.ok ? picks.list.totalUnits : 0).toBe(0);
  });
});

describe("a withdrawal after units were closed (D153, 4.2)", () => {
  it("never offers a closed unit for withdrawal: it was refunded, so 1 of 3 sent and 2 closed leaves 1 to withdraw", async () => {
    const { loadFacts, judge } = await import("./return-facts");
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    const before = await loadFacts(store.storeId, order.orderId);
    expect(judge(before!, new Date()).lines.find((l) => l.lineId === tote.id)?.remaining).toBe(3);
    expect(
      await refundOrder(store.storeId, order.orderId, { amountMinor: 0, reason: "will not send", restock: [{ lineId: tote.id, quantity: 2 }], notSent: true }, store.accountId),
    ).toMatchObject({ ok: true, closedUnits: 2 });
    const after = await loadFacts(store.storeId, order.orderId);
    const line = judge(after!, new Date()).lines.find((l) => l.lineId === tote.id);
    expect(line?.remaining).toBe(1);
    expect(line?.maxQuantity).toBeLessThanOrEqual(1);
  });

  it("never takes a closed unit as one not sent: 1 of 3 sent, 2 closed, withdrew 1 asks the sent unit back", async () => {
    const w = await import("./withdrawals");
    const { NOTHING_SENT_SQL } = await import("./return-sql");
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    await markSent(store.storeId, order.orderId, parcel, null, null, { lines: [{ lineId: tote.id, quantity: 1 }] });
    expect(
      await refundOrder(store.storeId, order.orderId, { amountMinor: 0, reason: "will not send", restock: [{ lineId: tote.id, quantity: 2 }], notSent: true }, store.accountId),
    ).toMatchObject({ ok: true, closedUnits: 2 });
    const started = await w.startWithdrawal(store.storeId, { orderNumber: order.number, email: order.email, name: "K N", lines: [{ lineId: tote.id, quantity: 1 }] }, { floorMs: 0 });
    if (!started.ok || !started.matched || !started.request) throw new Error(`step 1: ${JSON.stringify(started)}`);
    expect(await w.confirmWithdrawal(store.storeId, { requestId: started.request.id })).toMatchObject({ ok: true });
    const [ret] = await db().execute<Row>(sql`select r.id, ${NOTHING_SENT_SQL} as nothing_sent from commerce.returns r where r.order_id = ${order.orderId}::uuid`);
    expect(ret.nothing_sent).toBe(false);
    // What is to send is untouched: the withdrawn unit is the sent one.
    expect(await orderFulfilment(db(), store.storeId, order.orderId)).toMatchObject({ state: "sent", unitsToSend: 0 });
  });
});
