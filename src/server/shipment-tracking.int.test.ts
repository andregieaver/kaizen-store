import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { withdrawalWindow } from "@/lib/withdrawal";
import { dayIn } from "@/lib/work-dates";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const tracking = await import("./shipment-tracking");
const { setNotification } = await import("./notifications");
const { markSent, undoShipment } = await import("./order-admin");
const { markDelivered } = await import("./order-delivery");
const { fxStore, paidOrder, mailsOf, eventsOf } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;
type Answer = Awaited<ReturnType<NonNullable<Parameters<typeof tracking.pollTracking>[0]>["fetchEvents"] & {}>>;

/**
 * Following parcels (wave 3, D238, `docs/wave-3-notifications.md` 4.5, 4.6, 2.7 and 6.2), against a real database with the carrier faked (`fetchEvents`):
 * events stored and merged, the shopper's read of them and its "no news" state, a verified delivered event recording the receipt once (never before the
 * order, never over a staff date, never while partly sent, never from an unverified code), D153's 14 days counted from it, the carrier-event emails once per
 * parcel only when switched on and in the order's language, and a carrier that fails leaving what was stored and backing off.
 */

let store: Fx;
let other: Fx;
/** The fake carrier: answers by tracking number. */
const answers = new Map<string, Answer | (() => Promise<Answer>)>();
const fetchEvents = async (p: { trackingNumber: string }): Promise<Answer> => {
  const a = answers.get(p.trackingNumber);
  if (!a) return { ok: true, events: [] };
  return typeof a === "function" ? a() : a;
};

const at = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const HOUR = 3_600_000;

const connect = async (fx: Fx, carrier = "bring") =>
  db().execute(sql`
    insert into commerce.shipping_carriers (store_id, carrier, complete) values (${fx.storeId}::uuid, ${carrier}, true)
    on conflict do nothing
  `);

let n = 0;
async function shipped(fx: Fx, items: [string, number][] = [["DEMO-TOTE", 1]], carrier = "bring", lines?: { lineId: string; quantity: number }[]) {
  const order = await paidOrder(fx, items);
  // Placed two days ago, so the carrier's events of the last hours come after it (a delivery is never recorded before the order).
  await placeBack(order.orderId);
  const number = `370${Date.now()}${++n}`;
  const sent = await markSent(fx.storeId, order.orderId, { carrier, trackingNumber: number, trackingUrl: null }, fx.accountId, null, lines ? { lines } : {});
  if (!sent.ok) throw new Error(sent.reason);
  return { order, shipment: sent.shipment, number };
}

const placeBack = async (orderId: string) => db().execute(sql`update commerce.orders set placed_at = now() - interval '2 days' where id = ${orderId}::uuid`);

const row = async (fx: Fx, shipmentId: string) =>
  (await db().execute<Row>(sql`select * from commerce.shipment_tracking where store_id = ${fx.storeId}::uuid and shipment_id = ${shipmentId}::uuid`))[0];
const orderRow = async (orderId: string) =>
  (await db().execute<Row>(sql`select delivered_at, delivered_source, placed_at from commerce.orders where id = ${orderId}::uuid`))[0];
/** Makes a parcel due now (the poll's own next check is in the future). */
const due = async (fx: Fx, shipmentId: string) =>
  db().execute(sql`update commerce.shipment_tracking set next_check_at = now() - interval '1 minute' where store_id = ${fx.storeId}::uuid and shipment_id = ${shipmentId}::uuid`);
const poll = () => tracking.pollTracking({ fetchEvents, limits: { perRun: 500, perCarrier: 500 } });

beforeAll(async () => {
  store = await fxStore("track");
  other = await fxStore("track-other");
  await connect(store);
  await connect(store, "postnord");
});
afterAll(async () => {
  await closeDb();
});

describe("polling and the stored read (4.5, 2.7)", () => {
  it("stores and merges the carrier's events, newest first, and the shopper's read gives them", async () => {
    const p = await shipped(store);
    const handedIn = at(5 * HOUR);
    const moving = at(HOUR);
    answers.set(p.number, { ok: true, events: [{ at: handedIn, status: "HANDED_IN", description: "Sendingen er levert inn", location: "Oslo" }] });
    await poll();
    let t = await row(store, p.shipment.id);
    expect(t.phase).toBe("in_transit");
    expect(t.phase_verified).toBe(true);
    expect((t.events as unknown[]).length).toBe(1);
    answers.set(p.number, {
      ok: true,
      events: [
        { at: handedIn, status: "HANDED_IN", description: "Sendingen er levert inn", location: "Oslo" },
        { at: moving, status: "IN_TRANSIT", description: "Sendingen er under transport", location: "Lillestrøm" },
      ],
    });
    await due(store, p.shipment.id);
    await poll();
    t = await row(store, p.shipment.id);
    expect((t.events as { code: string }[]).map((e) => e.code)).toEqual(["IN_TRANSIT", "HANDED_IN"]);
    const read = await tracking.parcelTrackingFor(store.storeId, p.order.orderId);
    expect(read).toHaveLength(1);
    expect(read[0]).toMatchObject({ shipmentId: p.shipment.id, followed: "bring", phase: "in_transit", lastCheckFailed: false });
    expect(read[0].events[0]).toMatchObject({ code: "IN_TRANSIT", description: "Sendingen er under transport", location: "Lillestrøm" });
    // Another store reads nothing of it.
    expect(await tracking.parcelTrackingFor(other.storeId, p.order.orderId)).toEqual([]);
  });

  it("says plainly when the carrier has nothing: a checked parcel with no events", async () => {
    const p = await shipped(store);
    await poll();
    const [read] = await tracking.parcelTrackingFor(store.storeId, p.order.orderId);
    expect(read.followed).toBe("bring");
    expect(read.events).toEqual([]);
    expect(read.checkedAt).not.toBeNull();
  });

  it("does not follow a parcel whose carrier is not connected; the read says so (only the link is shown)", async () => {
    const p = await shipped(store, [["DEMO-TOTE", 1]], "helthjem");
    await poll();
    expect(await row(store, p.shipment.id)).toBeUndefined();
    const [read] = await tracking.parcelTrackingFor(store.storeId, p.order.orderId);
    expect(read.followed).toBeNull();
  });

  it("keeps the stored events when the carrier fails or times out, counts the failures and backs off, and never throws", async () => {
    const p = await shipped(store);
    answers.set(p.number, { ok: true, events: [{ at: at(2 * HOUR), status: "IN_TRANSIT", description: "Under transport" }] });
    await poll();
    answers.set(p.number, async () => {
      throw new Error("boom");
    });
    await due(store, p.shipment.id);
    const summary = await poll();
    expect(summary.failed).toBeGreaterThanOrEqual(1);
    let t = await row(store, p.shipment.id);
    expect(Number(t.failures)).toBe(1);
    expect((t.events as unknown[]).length).toBe(1);
    const first = new Date(String(t.next_check_at)).getTime() - new Date(String(t.checked_at)).getTime();
    answers.set(p.number, { ok: false, reason: "failed" });
    await due(store, p.shipment.id);
    await poll();
    t = await row(store, p.shipment.id);
    expect(Number(t.failures)).toBe(2);
    const second = new Date(String(t.next_check_at)).getTime() - new Date(String(t.checked_at)).getTime();
    expect(second).toBeGreaterThan(first);
    const [read] = await tracking.parcelTrackingFor(store.storeId, p.order.orderId);
    expect(read.lastCheckFailed).toBe(true);
    expect(read.events).toHaveLength(1);
  });

  it("*Check now* is refused within a minute of the last check, and checks at once otherwise", async () => {
    const p = await shipped(store);
    answers.set(p.number, { ok: true, events: [{ at: at(HOUR), status: "IN_TRANSIT", description: "Under transport" }] });
    const first = await tracking.checkParcelNow(store.storeId, p.order.orderId, p.shipment.id, { fetchEvents });
    expect(first.ok).toBe(true);
    const again = await tracking.checkParcelNow(store.storeId, p.order.orderId, p.shipment.id, { fetchEvents });
    expect(again).toMatchObject({ ok: false, problem: "too_soon" });
    expect(await tracking.checkParcelNow(other.storeId, p.order.orderId, p.shipment.id, { fetchEvents })).toMatchObject({ ok: false, problem: "not_found" });
  });
});

describe("the receipt from the carrier (4.6)", () => {
  it("records a verified delivery once, starts the 14 days from it, and a second poll writes nothing", async () => {
    const p = await shipped(store);
    const deliveredAt = at(2 * HOUR);
    answers.set(p.number, {
      ok: true,
      events: [
        { at: at(6 * HOUR), status: "HANDED_IN", description: "Levert inn" },
        { at: deliveredAt, status: "DELIVERED", description: "Sendingen er utlevert" },
      ],
    });
    await poll();
    const o = await orderRow(p.order.orderId);
    expect(o.delivered_source).toBe("carrier");
    expect(new Date(String(o.delivered_at)).toISOString()).toBe(new Date(deliveredAt).toISOString());
    const events = await eventsOf(p.order.orderId, "order.delivered");
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ by: "carrier", carrier: "bring" });
    const t = await row(store, p.shipment.id);
    expect(t.stopped).toBe("delivered");
    // A stopped parcel is not polled again; and recording again writes nothing.
    await poll();
    expect(await eventsOf(p.order.orderId, "order.delivered")).toHaveLength(1);
    expect(await tracking.recordCarrierDelivery(store.storeId, p.order.orderId, deliveredAt)).toBe(false);
    // D153: the right of withdrawal counts 14 days from the recorded day.
    const window = withdrawalWindow({ deliveredAt: new Date(String(o.delivered_at)), lastShippedAt: null }, { windowDays: 14, transitDays: 0 }, "Europe/Oslo", new Date());
    expect(window.startDay).toBe(dayIn(new Date(String(o.delivered_at)), "Europe/Oslo"));
    expect(window.statutoryEndDay).not.toBeNull();
    // Staff may correct the carrier's date: the source becomes theirs.
    const corrected = await markDelivered(store.storeId, { orderId: p.order.orderId, on: "" }, store.accountId);
    expect(corrected.ok).toBe(true);
    expect((await orderRow(p.order.orderId)).delivered_source).toBe("staff");
  });

  it("never writes a day before the order was placed", async () => {
    const p = await shipped(store);
    const placed = new Date(String((await orderRow(p.order.orderId)).placed_at));
    answers.set(p.number, { ok: true, events: [{ at: new Date(placed.getTime() - 3 * HOUR).toISOString(), status: "DELIVERED", description: "Utlevert" }] });
    await poll();
    const o = await orderRow(p.order.orderId);
    expect(o.delivered_source).toBe("carrier");
    expect(new Date(String(o.delivered_at)).getTime()).toBe(placed.getTime());
  });

  it("keeps a date staff gave, and staff may correct a carrier's date", async () => {
    const p = await shipped(store);
    const staff = await markDelivered(store.storeId, { orderId: p.order.orderId, on: "" }, store.accountId);
    expect(staff.ok).toBe(true);
    const before = await orderRow(p.order.orderId);
    expect(before.delivered_source).toBe("staff");
    answers.set(p.number, { ok: true, events: [{ at: at(HOUR), status: "DELIVERED", description: "Utlevert" }] });
    await poll();
    const after = await orderRow(p.order.orderId);
    expect(after.delivered_source).toBe("staff");
    expect(String(after.delivered_at)).toBe(String(before.delivered_at));
  });

  it("writes nothing while the order is partly sent, nor while a second parcel is on its way", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await placeBack(order.orderId);
    const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${order.orderId}::uuid`);
    const first = await markSent(store.storeId, order.orderId, { carrier: "bring", trackingNumber: `370P${Date.now()}a`, trackingUrl: null }, store.accountId, null, { lines: [{ lineId: String(line.id), quantity: 1 }] });
    if (!first.ok) throw new Error(first.reason);
    answers.set(first.shipment.trackingNumber, { ok: true, events: [{ at: at(HOUR), status: "DELIVERED", description: "Utlevert" }] });
    await poll();
    expect((await orderRow(order.orderId)).delivered_at).toBeNull();
    const second = await markSent(store.storeId, order.orderId, { carrier: "bring", trackingNumber: `370P${Date.now()}b`, trackingUrl: null }, store.accountId);
    if (!second.ok) throw new Error(second.reason);
    answers.set(second.shipment.trackingNumber, { ok: true, events: [{ at: at(HOUR), status: "IN_TRANSIT", description: "Under transport" }] });
    await poll();
    expect((await orderRow(order.orderId)).delivered_at).toBeNull();
    // The second arrives: every standing parcel is delivered now, so the receipt is the later one's.
    const later = at(10 * 60_000);
    answers.set(second.shipment.trackingNumber, { ok: true, events: [{ at: later, status: "DELIVERED", description: "Utlevert" }] });
    await due(store, second.shipment.id);
    await poll();
    const o = await orderRow(order.orderId);
    expect(o.delivered_source).toBe("carrier");
    expect(new Date(String(o.delivered_at)).toISOString()).toBe(new Date(later).toISOString());
  });

  it("an unverified code (PostNord's) shows the event but records nothing and sends nothing", async () => {
    await setNotification(store.storeId, "order.parcel_delivered", true, store.accountId);
    const p = await shipped(store, [["DEMO-TOTE", 1]], "postnord");
    answers.set(p.number, { ok: true, events: [{ at: at(HOUR), status: "DELIVERED", description: "Delivered" }] });
    await poll();
    const t = await row(store, p.shipment.id);
    expect(t.phase).toBe("delivered");
    expect(t.phase_verified).toBe(false);
    expect(t.delivered_at).toBeNull();
    expect(t.stopped).toBeNull();
    expect((await orderRow(p.order.orderId)).delivered_at).toBeNull();
    expect(await mailsOf(p.order.orderId, "order.parcel_delivered")).toHaveLength(0);
    await setNotification(store.storeId, "order.parcel_delivered", false, store.accountId);
  });

  it("an undone parcel stops being followed and its carrier delivery is taken back", async () => {
    const p = await shipped(store);
    answers.set(p.number, { ok: true, events: [{ at: at(HOUR), status: "DELIVERED", description: "Utlevert" }] });
    await poll();
    expect((await orderRow(p.order.orderId)).delivered_source).toBe("carrier");
    const undone = await undoShipment(store.storeId, p.order.orderId, p.shipment.id, store.accountId, "wrong parcel");
    expect(undone.ok).toBe(true);
    const o = await orderRow(p.order.orderId);
    expect(o.delivered_at).toBeNull();
    expect(o.delivered_source).toBeNull();
    expect((await row(store, p.shipment.id)).stopped).toBe("undone");
    expect(await tracking.parcelTrackingFor(store.storeId, p.order.orderId)).toEqual([]);
  });
});

describe("the carrier-event emails (2.7)", () => {
  it("sends none while they are switched off (the default)", async () => {
    const p = await shipped(store);
    answers.set(p.number, {
      ok: true,
      events: [
        { at: at(2 * HOUR), status: "TRANSPORT_TO_RECIPIENT", description: "Ute for levering" },
        { at: at(HOUR), status: "DELIVERED", description: "Utlevert" },
      ],
    });
    await poll();
    expect(await mailsOf(p.order.orderId, "order.parcel_out_for_delivery")).toHaveLength(0);
    expect(await mailsOf(p.order.orderId, "order.parcel_delivered")).toHaveLength(0);
  });

  it("switched on: out for delivery then delivered, once each per parcel, in the order's language; a third poll sends none", async () => {
    await setNotification(store.storeId, "order.parcel_out_for_delivery", true, store.accountId);
    await setNotification(store.storeId, "order.parcel_delivered", true, store.accountId);
    const p = await shipped(store);
    await db().execute(sql`update commerce.orders set locale = 'sv-SE' where id = ${p.order.orderId}::uuid`);
    answers.set(p.number, { ok: true, events: [{ at: at(HOUR), status: "TRANSPORT_TO_RECIPIENT", description: "Ute for levering" }] });
    await poll();
    let out = await mailsOf(p.order.orderId, "order.parcel_out_for_delivery");
    expect(out).toHaveLength(1);
    expect(String(out[0].subject)).toContain("är ute för leverans");
    expect(out[0].idempotency_key).toBe(`parcel-out:${p.shipment.id}`);
    expect(String(out[0].text)).not.toMatch(/ångra/i);
    answers.set(p.number, {
      ok: true,
      events: [
        { at: at(HOUR), status: "TRANSPORT_TO_RECIPIENT", description: "Ute for levering" },
        { at: at(10 * 60_000), status: "DELIVERED", description: "Utlevert" },
      ],
    });
    await due(store, p.shipment.id);
    await poll();
    out = await mailsOf(p.order.orderId, "order.parcel_out_for_delivery");
    const delivered = await mailsOf(p.order.orderId, "order.parcel_delivered");
    expect(out).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(String(delivered[0].subject)).toContain("har levererats");
    expect(String(delivered[0].text)).not.toMatch(/ångra/i);
    const t = await row(store, p.shipment.id);
    expect([t.emailed_out, t.emailed_delivered]).toEqual([true, true]);
    await due(store, p.shipment.id);
    await db().execute(sql`update commerce.shipment_tracking set stopped = null, stopped_at = null where shipment_id = ${p.shipment.id}::uuid`);
    await poll();
    expect(await mailsOf(p.order.orderId, "order.parcel_delivered")).toHaveLength(1);
  });

  it("a parcel first seen delivered gets only the delivered email; news older than a day gets none", async () => {
    const fresh = await shipped(store);
    answers.set(fresh.number, {
      ok: true,
      events: [
        { at: at(3 * HOUR), status: "TRANSPORT_TO_RECIPIENT", description: "Ute for levering" },
        { at: at(HOUR), status: "DELIVERED", description: "Utlevert" },
      ],
    });
    const stale = await shipped(store);
    answers.set(stale.number, { ok: true, events: [{ at: at(30 * HOUR), status: "DELIVERED", description: "Utlevert" }] });
    await poll();
    expect(await mailsOf(fresh.order.orderId, "order.parcel_out_for_delivery")).toHaveLength(0);
    expect(await mailsOf(fresh.order.orderId, "order.parcel_delivered")).toHaveLength(1);
    expect(await mailsOf(stale.order.orderId, "order.parcel_delivered")).toHaveLength(0);
    // The receipt is still recorded: the email is news, the receipt is a fact.
    expect((await orderRow(stale.order.orderId)).delivered_source).toBe("carrier");
  });

  it("two parcels of one order: one of each email per parcel", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 2]]);
    await placeBack(order.orderId);
    const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${order.orderId}::uuid`);
    const a = await markSent(store.storeId, order.orderId, { carrier: "bring", trackingNumber: `370Q${Date.now()}a`, trackingUrl: null }, store.accountId, null, { lines: [{ lineId: String(line.id), quantity: 1 }] });
    const b = await markSent(store.storeId, order.orderId, { carrier: "bring", trackingNumber: `370Q${Date.now()}b`, trackingUrl: null }, store.accountId);
    if (!a.ok || !b.ok) throw new Error("not sent");
    for (const s of [a.shipment, b.shipment]) answers.set(s.trackingNumber, { ok: true, events: [{ at: at(HOUR), status: "DELIVERED", description: "Utlevert" }] });
    await poll();
    const mails = await mailsOf(order.orderId, "order.parcel_delivered");
    expect(mails.map((m) => m.idempotency_key).sort()).toEqual([`parcel-delivered:${a.shipment.id}`, `parcel-delivered:${b.shipment.id}`].sort());
  });
});

describe("copied orders and closed stores", () => {
  it("never follows a parcel of a store that is not open", async () => {
    const closed = await fxStore("track-closed");
    await connect(closed);
    const p = await shipped(closed);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${closed.storeId}::uuid`);
    answers.set(p.number, { ok: true, events: [{ at: at(HOUR), status: "DELIVERED", description: "Utlevert" }] });
    await poll();
    expect(await row(closed, p.shipment.id)).toBeUndefined();
    await db().execute(sql`update commerce.stores set status = 'active' where id = ${closed.storeId}::uuid`);
  });
});
