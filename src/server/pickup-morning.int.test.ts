import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { dayIn, noonOf } from "@/lib/work-dates";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { savePickupOption, markCollected } = await import("./pickup");
const { saveLocalArea } = await import("./local-delivery");
const { markDelivered } = await import("./order-delivery");
const { fxStore } = await import("./fulfilment-test-fixture");
const { placeOf, deliveryOrder } = await import("./shipping-test-fixture");

afterAll(async () => {
  await closeDb();
});

/** Review (law lens): the order page's *Collected* form sends `on` = the store's today (its default), so a morning pickup is refused as "future". */
describe("Collected in the morning, as the order page sends it", () => {
  it("accepts today's date before noon", async () => {
    const store = await fxStore("pick-morning");
    const place = await placeOf(store, { name: "Morgenbutikken" });
    const saved = await savePickupOption(store.accountId, store.storeId, { locationId: place, active: true, amountMinor: 0, readyInHours: 0, instructions: "", instructionsT: {} });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const order = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${saved.id}` });
    const [s] = await db().execute<Record<string, unknown>>(sql`select time_zone from commerce.stores where id = ${store.storeId}::uuid`);
    const zone = String(s.time_zone ?? "Europe/Oslo");
    const today = dayIn(new Date(), zone);
    const morning = new Date(noonOf(today, zone).getTime() - 3 * 3_600_000);
    const done = await markCollected(store.storeId, { orderId: order.orderId, on: today }, null, morning);
    expect(done).toMatchObject({ ok: true });
  });

  it("refuses tomorrow's date", async () => {
    const store = await fxStore("pick-tomorrow");
    const place = await placeOf(store, { name: "Morgenbutikken" });
    const saved = await savePickupOption(store.accountId, store.storeId, { locationId: place, active: true, amountMinor: 0, readyInHours: 0, instructions: "", instructionsT: {} });
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const order = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${saved.id}` });
    const [s] = await db().execute<Record<string, unknown>>(sql`select time_zone from commerce.stores where id = ${store.storeId}::uuid`);
    const zone = String(s.time_zone ?? "Europe/Oslo");
    const now = new Date();
    const tomorrow = dayIn(new Date(noonOf(dayIn(now, zone), zone).getTime() + 24 * 3_600_000), zone);
    expect(await markCollected(store.storeId, { orderId: order.orderId, on: tomorrow }, null, now)).toMatchObject({ ok: false, reason: "future" });
  });

  it("marks a local order Delivered on today's date before noon (the local card's default)", async () => {
    const store = await fxStore("local-morning");
    const area = await saveLocalArea(store.accountId, store.storeId, {
      id: null, marketCode: "NO", locationId: null, name: "Oslo", names: {}, kind: "postal", patterns: ["01*"], radiusKm: null,
      amountMinor: 7900, minBasketMinor: null, freeOverMinor: null, info: "", infoT: {}, active: true,
    });
    if (!area.ok) throw new Error(JSON.stringify(area));
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150", choose: `local:${area.id}` });
    const [s] = await db().execute<Record<string, unknown>>(sql`select time_zone from commerce.stores where id = ${store.storeId}::uuid`);
    const zone = String(s.time_zone ?? "Europe/Oslo");
    const today = dayIn(new Date(), zone);
    const morning = new Date(noonOf(today, zone).getTime() - 3 * 3_600_000);
    expect(await markDelivered(store.storeId, { orderId: order.orderId, on: today }, null, morning)).toMatchObject({ ok: true, deliveredAt: morning.toISOString() });
  });
});
