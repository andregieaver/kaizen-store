import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseOrderListParams } from "@/lib/order-list";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    refunds: { create: async () => ({ id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { savePickupOption, listPickupPlaces, markReadyForPickup, markCollected, pickupBlockers } = await import("./pickup");
const { markSent, undoShipment } = await import("./order-admin");
const { resolveDelivery } = await import("./delivery-options");
const { cartSummary } = await import("./cart-summary");
const { getCart } = await import("./cart");
const { runBulk } = await import("./order-bulk");
const { staffActor } = await import("./order-actor");
const { listOrdersPage, loadOrderListContext } = await import("./order-list");
const { packingSlipData } = await import("./packing-slips");
const { fxStore, NO, NO_EUR, mailsOf, eventsOf } = await import("./fulfilment-test-fixture");
const { placeOf, deliveryOrder, deliveryOf, cartOf } = await import("./shipping-test-fixture");

type Row = Record<string, unknown>;

/**
 * Local pickup against a real database (D237, `docs/wave-3-shipping-methods.md` 2.2, 4.4, 6.2): the option per place (free by default, priced in the
 * market's own currency and shown converted), offered at checkout and charged the same by `cartSummary()` and `placeOrder()` in kroner and in euro; the
 * order keeps the place's snapshot; *Ready for pickup* once with one email in the order's language; *Collected* records a `pickup` handover and the receipt
 * together, sends no shipped email, and is undone by D174's undo; pickup orders are never in *To send*. Every refusal writes nothing.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;
let shopPlace: string;
let optionId: string;

beforeAll(async () => {
  store = await fxStore("pick");
  other = await fxStore("pick-other");
  shopPlace = await placeOf(store, { name: "Butikken Grünerløkka" });
  const saved = await savePickupOption(store.accountId, store.storeId, {
    locationId: shopPlace,
    active: true,
    amountMinor: 0,
    readyInHours: 4,
    instructions: "Ring på bakdøren.",
    instructionsT: { en: "Ring the back door." },
  });
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  optionId = saved.id;
});
afterAll(async () => {
  await closeDb();
});

const statusOf = async (orderId: string) => String((await db().execute<Row>(sql`select status from commerce.orders where id = ${orderId}::uuid`))[0].status);

describe("setting pickup up", () => {
  it("saves a place's option, free by default, and lists every shop and pickup place with it", async () => {
    const places = await listPickupPlaces(store.storeId);
    const mine = places.find((p) => p.locationId === shopPlace)!;
    expect(mine).toMatchObject({ sellsThere: true, currency: "NOK", option: { id: optionId, active: true, amountMinor: 0, readyInHours: 4, instructions: "Ring på bakdøren." } });
    // Saved again: the same option, updated in place.
    expect(await savePickupOption(store.accountId, store.storeId, { locationId: shopPlace, active: true, amountMinor: 0, readyInHours: 4, instructions: "Ring på bakdøren.", instructionsT: { en: "Ring the back door." } })).toEqual({
      ok: true,
      id: optionId,
    });
    const [audit] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'shipping.pickup_saved' order by created_at desc limit 1`);
    // The audit says what changed, never the instructions.
    expect(JSON.stringify(audit.details)).not.toContain("bakdøren");
  });

  it("refuses an office, a place in a country the store does not sell to, another store's place and bad input", async () => {
    const office = await placeOf(store, { kind: "office", name: "" });
    expect(await savePickupOption(store.accountId, store.storeId, { locationId: office, active: true, amountMinor: 0, readyInHours: 0, instructions: "", instructionsT: {} })).toMatchObject({
      ok: false,
      problem: "pickup_options.place_kind",
    });
    const abroad = await placeOf(store, { name: "Berlin", country: "DE", postalCode: "10115", city: "Berlin" });
    expect(await savePickupOption(store.accountId, store.storeId, { locationId: abroad, active: true, amountMinor: 0, readyInHours: 0, instructions: "", instructionsT: {} })).toMatchObject({
      ok: false,
      problem: "not_market",
    });
    expect(await savePickupOption(other.accountId, other.storeId, { locationId: shopPlace, active: true, amountMinor: 0, readyInHours: 0, instructions: "", instructionsT: {} })).toMatchObject({
      ok: false,
      problem: "not_found",
    });
    expect(await savePickupOption(store.accountId, store.storeId, { locationId: shopPlace, active: true, amountMinor: -1, readyInHours: 0, instructions: "", instructionsT: {} })).toMatchObject({
      ok: false,
      problem: "invalid",
    });
    expect(await savePickupOption(store.accountId, store.storeId, { locationId: shopPlace, active: true, amountMinor: 0, readyInHours: 721, instructions: "", instructionsT: {} })).toMatchObject({
      ok: false,
      problem: "invalid",
    });
  });
});

describe("pickup at checkout", () => {
  it("is offered for the market, never preselected, and charged the same by the cart and the order (free)", async () => {
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const resolved = await resolveDelivery(db(), store.storeId, cartId, NO);
    expect(resolved?.offer.pickups.map((p) => p.id)).toEqual([optionId]);
    // The default is the flat rate (99 kr under 999 kr), not pickup.
    expect(resolved?.delivery).toMatchObject({ kind: "flat" });
    expect(resolved?.rate).toEqual({ amountMinor: 9900, freeOverMinor: 99900 });

    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { choose: `pickup:${optionId}`, paid: false });
    const kept = await deliveryOf(order.orderId);
    expect(kept).toMatchObject({ delivery_method: "pickup", pickup_location_id: shopPlace, shipping_minor: "0" });
    expect(kept.delivery).toMatchObject({ kind: "pickup", locationId: shopPlace, name: "Butikken Grünerløkka", postalCode: "0555", city: "Oslo", country: "NO", instructions: "Ring på bakdøren.", readyInHours: 4 });
    // The cheapest standard delivery stays the flat rate: pickup is not standard delivery (4.3).
    expect(Number(kept.standard_shipping_minor)).toBe(9900);
    // The cart page showed the same: 0 shipping.
    const summary = await cartSummary({ storeId: store.storeId, market: NO }, await getCartFor(order.cartId), { cartId: order.cartId, customerId: null });
    expect(summary.shipping).toBe(0);
    expect(summary.total).toBe(order.totalMinor);
  });

  it("charges a priced pickup the same in kroner and in euro, converted on its own", async () => {
    await savePickupOption(store.accountId, store.storeId, { locationId: shopPlace, active: true, amountMinor: 4900, readyInHours: 4, instructions: "Ring på bakdøren.", instructionsT: { en: "Ring the back door." } });
    try {
      for (const market of [NO, NO_EUR]) {
        const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 2]], { choose: `pickup:${optionId}`, paid: false, market });
        const expected = market === NO ? 4900 : Math.round(4900 / 11.5);
        const summary = await cartSummary({ storeId: store.storeId, market }, await getCartFor(order.cartId, market), { cartId: order.cartId, customerId: null });
        expect(summary.shipping).toBe(expected);
        expect(Number((await deliveryOf(order.orderId)).shipping_minor)).toBe(expected);
        expect(summary.total).toBe(order.totalMinor);
        expect(order.currency).toBe(market === NO ? "NOK" : "EUR");
      }
    } finally {
      await savePickupOption(store.accountId, store.storeId, { locationId: shopPlace, active: true, amountMinor: 0, readyInHours: 4, instructions: "Ring på bakdøren.", instructionsT: { en: "Ring the back door." } });
    }
  });

  it("falls back to the default when the option is switched off, and says the choice changed", async () => {
    const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const { chooseDelivery } = await import("./delivery-options");
    expect(await chooseDelivery({ storeId: store.storeId, market: NO }, cartId, `pickup:${optionId}`)).toEqual({ ok: true });
    await db().execute(sql`update commerce.pickup_options set active = false where id = ${optionId}::uuid`);
    try {
      const resolved = await resolveDelivery(db(), store.storeId, cartId, NO);
      expect(resolved).toMatchObject({ changed: true, method: "ship", delivery: { kind: "flat" } });
      // Choosing it again is refused while it is off.
      expect(await chooseDelivery({ storeId: store.storeId, market: NO }, cartId, `pickup:${optionId}`)).toEqual({ ok: false, problem: "gone" });
    } finally {
      await db().execute(sql`update commerce.pickup_options set active = true where id = ${optionId}::uuid`);
    }
  });
});

/** The cart as the cart page reads it, for a cart made by the fixture (no cookie). */
async function getCartFor(cartId: string, market = NO) {
  const { readCartLinesForTest } = await cartReader();
  return readCartLinesForTest(cartId, market);
}

/** `getCart()` reads the cookie's cart; tests hand it the id through the mocked cookie jar instead. */
async function cartReader() {
  return {
    readCartLinesForTest: async (cartId: string, market: typeof NO) => {
      cookieCart.value = cartId;
      cookieCart.name = `cart_${store.storeId}_${NO.slug}`;
      return getCart({ storeId: store.storeId, market });
    },
  };
}
const cookieCart = vi.hoisted(() => ({ name: "", value: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === cookieCart.name ? { name, value: cookieCart.value } : undefined),
    set: () => {},
    delete: () => {},
  }),
  headers: async () => new Headers(),
}));

describe("Ready for pickup", () => {
  it("marks once, writes the event and sends one email in the order's language with the place, hours and instructions", async () => {
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 2]], { choose: `pickup:${optionId}`, locale: "en-GB" });
    const done = await markReadyForPickup(store.storeId, { orderId: order.orderId }, store.accountId);
    expect(done).toMatchObject({ ok: true, email: expect.stringMatching(/^(sent|logged)$/) });
    expect((await deliveryOf(order.orderId)).ready_for_pickup_at).not.toBeNull();
    expect(await eventsOf(order.orderId, "order.ready_for_pickup")).toHaveLength(1);
    const mails = await mailsOf(order.orderId, "order.ready_for_pickup");
    expect(mails).toHaveLength(1);
    expect(mails[0]).toMatchObject({ to_address: order.email, idempotency_key: `order-ready:${order.orderId}` });
    const text = String(mails[0].text);
    expect(text).toContain("ready to collect");
    expect(text).toContain("Butikken Grünerløkka, Thorvald Meyers gate 1, 0555 Oslo");
    expect(text).toContain("09:00–17:00");
    // The instructions as the order kept them when it was bought, in its language (the market's view was Norwegian: the snapshot is the Norwegian text).
    expect(text).toContain("Ring på bakdøren.");
    expect(text).toContain("2 × ");
    // No price: an amount in kroner, written either way (the store's random address may hold the letters "kr", as `pick-…7kr` did).
    expect(text).not.toMatch(/(?<![\w.-])\d[\d .,]*\s?kr\b|\bkr\s?\d|\bNOK\b/);
    // A second press is refused and sends nothing.
    expect(await markReadyForPickup(store.storeId, { orderId: order.orderId }, store.accountId)).toMatchObject({ ok: false, reason: "already_ready" });
    // *Send the email again* sends only when the first did not go.
    expect(await markReadyForPickup(store.storeId, { orderId: order.orderId }, store.accountId, { resend: true })).toMatchObject({ ok: true, email: "duplicate" });
    expect(await mailsOf(order.orderId, "order.ready_for_pickup")).toHaveLength(1);
    await db().execute(sql`update commerce.email_messages set status = 'failed' where idempotency_key = ${`order-ready:${order.orderId}`}`);
    expect(await markReadyForPickup(store.storeId, { orderId: order.orderId }, store.accountId, { resend: true })).toMatchObject({ ok: true, email: expect.stringMatching(/^(sent|logged)$/) });
    expect(await mailsOf(order.orderId, "order.ready_for_pickup")).toHaveLength(2);
    // Pressed again after the retry went: nothing more.
    expect(await markReadyForPickup(store.storeId, { orderId: order.orderId }, store.accountId, { resend: true })).toMatchObject({ ok: true, email: "duplicate" });
    expect(await mailsOf(order.orderId, "order.ready_for_pickup")).toHaveLength(2);
  });

  it("is written in Norwegian for a Norwegian order", async () => {
    const order = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    expect(await markReadyForPickup(store.storeId, { orderId: order.orderId }, store.accountId)).toMatchObject({ ok: true });
    const [mail] = await mailsOf(order.orderId, "order.ready_for_pickup");
    expect(String(mail.subject)).toContain("klar til henting");
    expect(String(mail.text)).toContain("Ta med bestillingsnummeret");
  });

  it("refuses an unpaid order, a parcel order, another store's, a cancelled one and units waiting for stock, writing nothing", async () => {
    const unpaid = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}`, paid: false });
    expect(await markReadyForPickup(store.storeId, { orderId: unpaid.orderId }, null)).toMatchObject({ ok: false, reason: "unpaid" });
    const parcel = await deliveryOrder(store, [["DEMO-TOTE", 1]]);
    expect(await markReadyForPickup(store.storeId, { orderId: parcel.orderId }, null)).toMatchObject({ ok: false, reason: "not_pickup" });
    const mine = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    expect(await markReadyForPickup(other.storeId, { orderId: mine.orderId }, null)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await markCollected(other.storeId, { orderId: mine.orderId }, null)).toMatchObject({ ok: false, reason: "not_found" });
    expect(await markReadyForPickup(store.storeId, { orderId: "not-an-id" }, null)).toMatchObject({ ok: false, reason: "not_found" });
    const { cancelOrder } = await import("./order-admin");
    const cancelled = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    await cancelOrder(store.storeId, cancelled.orderId, "Test", store.accountId).catch(() => null);
    if ((await statusOf(cancelled.orderId)) === "cancelled") {
      expect(await markReadyForPickup(store.storeId, { orderId: cancelled.orderId }, null)).toMatchObject({ ok: false, reason: "cancelled" });
    }
    // Sold beyond the stock (D172): waiting until staff confirm they have the units.
    await db().execute(sql`update commerce.product_variants set stock_policy = 'continue', backorder_days = 5 where store_id = ${store.storeId}::uuid and sku = 'DEMO-THERMOS'`);
    await db().execute(sql`update commerce.inventory_levels l set on_hand = 0 from commerce.product_variants v where v.id = l.variant_id and v.store_id = ${store.storeId}::uuid and v.sku = 'DEMO-THERMOS'`);
    const waiting = await deliveryOrder(store, [["DEMO-THERMOS", 2]], { choose: `pickup:${optionId}` });
    expect(await markReadyForPickup(store.storeId, { orderId: waiting.orderId }, null)).toMatchObject({ ok: false, reason: "waiting_for_stock" });
    expect(await markCollected(store.storeId, { orderId: waiting.orderId }, null)).toMatchObject({ ok: false, reason: "waiting_for_stock" });
    expect(await markReadyForPickup(store.storeId, { orderId: waiting.orderId, haveStock: true }, null)).toMatchObject({ ok: true });
    await db().execute(sql`update commerce.product_variants set stock_policy = 'deny', backorder_days = null where store_id = ${store.storeId}::uuid and sku = 'DEMO-THERMOS'`);
    await db().execute(sql`update commerce.inventory_levels l set on_hand = 500 from commerce.product_variants v where v.id = l.variant_id and v.store_id = ${store.storeId}::uuid and v.sku = 'DEMO-THERMOS'`);
    for (const id of [unpaid.orderId, parcel.orderId, mine.orderId]) expect((await deliveryOf(id)).ready_for_pickup_at).toBeNull();
    expect(await mailsOf(mine.orderId, "order.ready_for_pickup")).toHaveLength(0);
  });

  it("is two staff pressing at once: one success", async () => {
    const order = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    const both = await Promise.all([markReadyForPickup(store.storeId, { orderId: order.orderId }, null), markReadyForPickup(store.storeId, { orderId: order.orderId }, null)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(await mailsOf(order.orderId, "order.ready_for_pickup")).toHaveLength(1);
  });
});

describe("Collected", () => {
  it("records a pickup handover of every unit and the receipt together, fulfils the order and sends no shipped email; undo takes both back", async () => {
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 2], ["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    // A pickup order is never sent as a parcel.
    expect(await markSent(store.storeId, order.orderId, { carrier: "posten", trackingNumber: "X", trackingUrl: null }, null)).toEqual({ ok: false, reason: "pickup_order" });
    const done = await markCollected(store.storeId, { orderId: order.orderId }, store.accountId);
    expect(done).toMatchObject({ ok: true });
    if (!done.ok) return;
    const [shipment] = await db().execute<Row>(sql`select method, carrier, tracking_number, tracking_url, carrier_id, label_url from commerce.shipments where id = ${done.shipmentId}::uuid`);
    expect(shipment).toMatchObject({ method: "pickup", carrier: "", tracking_number: "", tracking_url: null, carrier_id: null, label_url: null });
    const [units] = await db().execute<Row>(sql`select sum(quantity)::int as n from commerce.shipment_lines where shipment_id = ${done.shipmentId}::uuid`);
    expect(Number(units.n)).toBe(3);
    const kept = await deliveryOf(order.orderId);
    expect(kept.status).toBe("fulfilled");
    expect(kept.delivered_at).not.toBeNull();
    expect(await eventsOf(order.orderId, "order.collected")).toHaveLength(1);
    expect(await mailsOf(order.orderId, "order.sent")).toHaveLength(0);
    // Not twice.
    expect(await markCollected(store.storeId, { orderId: order.orderId }, null)).toMatchObject({ ok: false, reason: "collected" });
    // A mistake: D174's undo returns it to paid and clears the receipt.
    const undone = await undoShipment(store.storeId, order.orderId, done.shipmentId, store.accountId, "Wrong order");
    expect(undone).toMatchObject({ ok: true, reopened: true });
    const after = await deliveryOf(order.orderId);
    expect(after.status).toBe("paid");
    expect(after.delivered_at).toBeNull();
    // And it can be collected again.
    expect(await markCollected(store.storeId, { orderId: order.orderId }, null)).toMatchObject({ ok: true });
  });

  it("takes a day: not in the future, not before the order", async () => {
    const order = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    expect(await markCollected(store.storeId, { orderId: order.orderId, on: "2999-01-01" }, null)).toMatchObject({ ok: false, reason: "future" });
    expect(await markCollected(store.storeId, { orderId: order.orderId, on: "2000-01-01" }, null)).toMatchObject({ ok: false, reason: "before_order" });
    expect(await markCollected(store.storeId, { orderId: order.orderId, on: "1 May" }, null)).toMatchObject({ ok: false, reason: "invalid" });
    expect(await db().execute<Row>(sql`select 1 from commerce.shipments where order_id = ${order.orderId}::uuid`)).toHaveLength(0);
  });
});

describe("the Orders list, bulk and the place", () => {
  it("never lists a pickup order in To send; To hand over lists it until it is collected", async () => {
    const order = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    const parcel = await deliveryOrder(store, [["DEMO-TOTE", 1]]);
    const context = await loadOrderListContext(store.storeId);
    const ids = async (query: string) => (await listOrdersPage(store.storeId, parseOrderListParams(new URLSearchParams(query)), context)).rows.map((r: { id: string }) => r.id);
    expect(await ids("show=to-send")).toContain(parcel.orderId);
    expect(await ids("show=to-send")).not.toContain(order.orderId);
    expect(await ids("show=to-hand-over")).toContain(order.orderId);
    expect(await ids("show=to-hand-over")).not.toContain(parcel.orderId);
    await markCollected(store.storeId, { orderId: order.orderId }, null);
    expect(await ids("show=to-hand-over")).not.toContain(order.orderId);
  });

  it("marks pickup orders ready in bulk and refuses a parcel order; bulk Mark as sent refuses a pickup order", async () => {
    const a = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    const parcel = await deliveryOrder(store, [["DEMO-TOTE", 1]]);
    const actor = staffActor(store.accountId);
    const ready = await runBulk(store.storeId, actor, { action: "ready_for_pickup", selection: { kind: "ids", ids: [a.orderId, parcel.orderId] } });
    expect(ready).toMatchObject({ ok: true, result: { applied: 1, refused: [{ id: parcel.orderId, reason: "not_pickup" }] } });
    const sent = await runBulk(store.storeId, actor, { action: "mark_sent", selection: { kind: "ids", ids: [a.orderId] } });
    expect(sent).toMatchObject({ ok: true, result: { applied: 0, refused: [{ id: a.orderId, reason: "pickup_order" }] } });
  });

  it("prints the place on the packing slip", async () => {
    const order = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${optionId}` });
    const slips = await packingSlipData(store.storeId, [order.orderId]);
    expect(slips.ok && slips.slips[0].handover).toEqual({ method: "pickup", place: "Butikken Grünerløkka, Thorvald Meyers gate 1, 0555 Oslo" });
  });

  it("counts the orders waiting at a place, which keep it from being deleted", async () => {
    const place = await placeOf(store, { kind: "pickup", name: "Hentepunkt" });
    const saved = await savePickupOption(store.accountId, store.storeId, { locationId: place, active: true, amountMinor: 0, readyInHours: 0, instructions: "", instructionsT: {} });
    if (!saved.ok) throw new Error("option");
    const order = await deliveryOrder(store, [["DEMO-TOTE", 1]], { choose: `pickup:${saved.id}` });
    expect(await pickupBlockers(db(), store.storeId, place)).toBe(1);
    const { deleteLocation } = await import("./company");
    const member = { account: { id: store.accountId }, store: { id: store.storeId } } as unknown as Parameters<typeof deleteLocation>[0];
    expect(await deleteLocation(member, place)).toBe(false);
    await markCollected(store.storeId, { orderId: order.orderId }, null);
    expect(await pickupBlockers(db(), store.storeId, place)).toBe(0);
    expect(await deleteLocation(member, place)).toBe(true);
    // Its option went with it; the order keeps its snapshot.
    expect(await db().execute<Row>(sql`select 1 from commerce.pickup_options where id = ${saved.id}::uuid`)).toHaveLength(0);
    expect((await deliveryOf(order.orderId)).delivery).toMatchObject({ kind: "pickup", name: "Hentepunkt" });
  });
});
