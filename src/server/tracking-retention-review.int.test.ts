import { sql } from "drizzle-orm";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const tracking = await import("./shipment-tracking");
const { markSent } = await import("./order-admin");
const { fxStore, paidOrder } = await import("./fulfilment-test-fixture");

/**
 * Security review (wave 3, D238): a parcel that is never delivered by a verified code (every PostNord, Helthjem or Porterbuddy parcel, whose codes are
 * unverified; or a Bring parcel lost in transit) must stop being followed after FOLLOW_DAYS (`stopped = 'old'`), so that its carrier events, which can
 * name who signed, are cleared 90 days later by `pruneTrackingEvents()` (spec 3.5, PERSONAL_DATA's promise).
 */
let fx: Awaited<ReturnType<typeof fxStore>>;
beforeAll(async () => {
  fx = await fxStore("track-retention");
  await db().execute(sql`insert into commerce.shipping_carriers (store_id, carrier, complete) values (${fx.storeId}::uuid, 'postnord', true) on conflict do nothing`);
});
afterAll(async () => closeDb());

it("stops following an old undelivered parcel, so its carrier events are pruned", async () => {
  const order = await paidOrder(fx, [["DEMO-TOTE", 1]]);
  await db().execute(sql`update commerce.orders set placed_at = now() - interval '2 days' where id = ${order.orderId}::uuid`);
  const number = `PN${Date.now()}`;
  const sent = await markSent(fx.storeId, order.orderId, { carrier: "postnord", trackingNumber: number, trackingUrl: null }, fx.accountId, null, {});
  if (!sent.ok) throw new Error(sent.reason);
  const fetchEvents = async () => ({ ok: true as const, events: [{ at: new Date(Date.now() - 3_600_000).toISOString(), status: "DELIVERED", description: "Delivered, signed by Kari Nordmann", location: "Oslo" }] });
  await tracking.pollTracking({ fetchEvents, limits: { perRun: 500, perCarrier: 500 } });
  const shipment = sent.shipment.id;
  const [first] = await db().execute<Record<string, unknown>>(sql`select events, stopped from commerce.shipment_tracking where shipment_id = ${shipment}::uuid`);
  expect((first.events as unknown[]).length).toBe(1);
  // Thirty-one days on: the parcel was sent long ago and its next check is due.
  // (Shipments are frozen, so the clock moves instead.)
  const later31 = new Date(Date.now() + 31 * 86_400_000);
  await tracking.pollTracking({ now: later31, fetchEvents, limits: { perRun: 500, perCarrier: 500 } });
  const [later] = await db().execute<Record<string, unknown>>(sql`select stopped from commerce.shipment_tracking where shipment_id = ${shipment}::uuid`);
  expect(later.stopped).toBe("old");
  // And 91 days after that, the events (a name) are gone.
  await tracking.pruneTrackingEvents(new Date(Date.now() + 122 * 86_400_000));
  const [pruned] = await db().execute<Record<string, unknown>>(sql`select events from commerce.shipment_tracking where shipment_id = ${shipment}::uuid`);
  expect(pruned.events).toEqual([]);
});

it("clears the events of a parcel whose following ended with no stop written (its carrier disconnected), 90 days after it could last be followed", async () => {
  const own = await fxStore("track-retention-gone");
  await db().execute(sql`insert into commerce.shipping_carriers (store_id, carrier, complete) values (${own.storeId}::uuid, 'postnord', true) on conflict do nothing`);
  const order = await paidOrder(own, [["DEMO-TOTE", 1]]);
  const sent = await markSent(own.storeId, order.orderId, { carrier: "postnord", trackingNumber: `PNG${Date.now()}`, trackingUrl: null }, own.accountId, null, {});
  if (!sent.ok) throw new Error(sent.reason);
  const fetchEvents = async () => ({ ok: true as const, events: [{ at: new Date(Date.now() - 3_600_000).toISOString(), status: "DELIVERED", description: "Delivered, signed by Ola Nordmann", location: "Bergen" }] });
  await tracking.pollTracking({ fetchEvents, limits: { perRun: 500, perCarrier: 500 } });
  // The agreement goes: the poll no longer picks the parcel, and no check writes a stop.
  await db().execute(sql`update commerce.shipping_carriers set complete = false where store_id = ${own.storeId}::uuid and carrier = 'postnord'`);
  const read = async () => (await db().execute<Record<string, unknown>>(sql`select events, stopped from commerce.shipment_tracking where shipment_id = ${sent.shipment.id}::uuid`))[0];
  expect((await read()).stopped).toBeNull();
  await tracking.pruneTrackingEvents(new Date(Date.now() + 60 * 86_400_000));
  expect(((await read()).events as unknown[]).length).toBe(1);
  await tracking.pruneTrackingEvents(new Date(Date.now() + 121 * 86_400_000));
  expect((await read()).events).toEqual([]);
});
