import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseOrderListParams } from "@/lib/order-list";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const cookieCart = vi.hoisted(() => ({ name: "", value: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === cookieCart.name ? { name, value: cookieCart.value } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    refunds: { create: async () => ({ id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { saveLocalArea, listLocalAreas, deleteLocalArea, codesInRadius, checkLocalCode, markOutForDelivery } = await import("./local-delivery");
const { markDelivered } = await import("./order-delivery");
const { chooseDelivery, deliveryReady, flagDeliveryMismatch, resolveDelivery, setDeliveryPostalCode, deliveryOptionsFor } = await import("./delivery-options");
const { cartSummary } = await import("./cart-summary");
const { getCart } = await import("./cart");
const { listOrdersPage, loadOrderListContext } = await import("./order-list");
const { packingSlipData } = await import("./packing-slips");
const { fxStore, NO, NO_EUR, mailsOf, eventsOf } = await import("./fulfilment-test-fixture");
const { placeOf, deliveryOrder, deliveryOf, cartOf } = await import("./shipping-test-fixture");

type Row = Record<string, unknown>;

/**
 * Local delivery against a real database (D237, `docs/wave-3-shipping-methods.md` 2.3, 4.5, 6.3): areas by postal codes or by a radius from a place
 * (its position filled from the GeoNames centres), with a price, a minimum basket and a free-above value, offered only inside the area, the cheapest of
 * overlapping ones; `cartSummary()` and `placeOrder()` agree in kroner and in euro; *Out for delivery* records a `local` handover and emails once;
 * *Delivered* without a handover writes it; the list shows local orders apart and never in *To send*; a postal code that differs from Stripe's address is
 * flagged, never re-charged.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;
let shop: string;
let postalArea: string;

const base = (over: Record<string, unknown> = {}) => ({
  id: null,
  marketCode: "NO",
  locationId: null,
  name: "Oslo sentrum",
  names: { "en-GB": "Central Oslo" },
  kind: "postal",
  patterns: ["01*", "05*"],
  radiusKm: null,
  amountMinor: 7900,
  minBasketMinor: 20000,
  freeOverMinor: 80000,
  info: "Vi kjører ut mellom 16 og 20.",
  infoT: {},
  active: true,
  ...over,
});

beforeAll(async () => {
  store = await fxStore("local");
  other = await fxStore("local-other");
  shop = await placeOf(store, { name: "Butikken", postalCode: "0555" });
  const saved = await saveLocalArea(store.accountId, store.storeId, base());
  if (!saved.ok) throw new Error(JSON.stringify(saved));
  postalArea = saved.id;
});
afterAll(async () => {
  await closeDb();
});

async function summaryOf(cartId: string, market = NO) {
  cookieCart.name = `cart_${store.storeId}_${NO.slug}`;
  cookieCart.value = cartId;
  return cartSummary({ storeId: store.storeId, market }, await getCart({ storeId: store.storeId, market }), { cartId, customerId: null });
}

describe("areas", () => {
  it("saves a postal-code area and lists it; refuses bad patterns, a country the store does not sell to and another store's place", async () => {
    const areas = await listLocalAreas(store.storeId);
    expect(areas.find((a) => a.id === postalArea)).toMatchObject({ kind: "postal", patterns: ["01*", "05*"], amountMinor: 7900, minBasketMinor: 20000, freeOverMinor: 80000, currency: "NOK" });
    expect(await saveLocalArea(store.accountId, store.storeId, base({ patterns: ["01**"] }))).toMatchObject({ ok: false, problem: "invalid" });
    expect(await saveLocalArea(store.accountId, store.storeId, base({ patterns: [] }))).toMatchObject({ ok: false, problem: "invalid" });
    expect(await saveLocalArea(store.accountId, store.storeId, base({ marketCode: "DE", patterns: ["10*"] }))).toMatchObject({ ok: false, problem: "not_market" });
    expect(await saveLocalArea(other.accountId, other.storeId, base({ kind: "radius", patterns: [], radiusKm: 5, locationId: shop }))).toMatchObject({ ok: false, problem: "not_found" });
    expect(await saveLocalArea(store.accountId, store.storeId, base({ minBasketMinor: 0 }))).toMatchObject({ ok: false, problem: "invalid" });
    // The audit keeps counts and amounts, never the codes.
    const [audit] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'shipping.local_area_saved' order by created_at limit 1`);
    expect(audit.details).toMatchObject({ patterns: 2, amountMinor: 7900 });
    expect(JSON.stringify(audit.details)).not.toContain("01*");
  });

  it("fills a radius area's place position from the postal-code centres, and refuses a place with none", async () => {
    const saved = await saveLocalArea(store.accountId, store.storeId, base({ name: "Rundt butikken", kind: "radius", patterns: [], radiusKm: 15, locationId: shop, active: false }));
    expect(saved).toMatchObject({ ok: true });
    const [place] = await db().execute<Row>(sql`select latitude, longitude from commerce.store_locations where id = ${shop}::uuid`);
    expect(Number(place.latitude)).toBeCloseTo(59.9127, 3);
    expect(Number(place.longitude)).toBeCloseTo(10.7461, 3);
    // 15 km from central Oslo takes in Lysaker (1337) and not Ski (1400) or Bergen.
    expect(await codesInRadius("NO", { lat: Number(place.latitude), lon: Number(place.longitude) }, 15)).toBeGreaterThan(100);
    const nowhere = await placeOf(store, { name: "Ukjent", postalCode: "9999" });
    expect(await saveLocalArea(store.accountId, store.storeId, base({ name: "Ukjent", kind: "radius", patterns: [], radiusKm: 5, locationId: nowhere }))).toMatchObject({
      ok: false,
      problem: "local_delivery_areas.no_position",
    });
    if (saved.ok) await deleteLocalArea(store.accountId, store.storeId, saved.id);
  });

  it("says which areas cover a code, and whether the code is in the reference data", async () => {
    expect(await checkLocalCode(store.storeId, "NO", "0150")).toMatchObject({ code: "0150", known: true, areas: [{ id: postalArea }] });
    expect(await checkLocalCode(store.storeId, "NO", "5003")).toMatchObject({ code: "5003", known: true, areas: [] });
    expect(await checkLocalCode(store.storeId, "NO", "x")).toMatchObject({ code: null });
  });
});

describe("local delivery at checkout", () => {
  it("is offered only inside the area and at or above the minimum, never preselected", async () => {
    const inside = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const shopOf = { storeId: store.storeId, market: NO };
    // Before a code: no local delivery, and the pay press waits for one (the price depends on it).
    expect((await resolveDelivery(db(), store.storeId, inside, NO))?.offer.local).toBeNull();
    expect(await deliveryReady(shopOf, inside)).toEqual({ ok: false, problem: "postal_code" });
    await setDeliveryPostalCode(shopOf, inside, "0150");
    const resolved = await resolveDelivery(db(), store.storeId, inside, NO);
    expect(resolved?.offer.local).toMatchObject({ kind: "local", id: postalArea, priceMinor: 7900 });
    expect(resolved?.delivery).toMatchObject({ kind: "flat" });
    expect(await deliveryReady(shopOf, inside)).toEqual({ ok: true });

    const outside = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    await setDeliveryPostalCode(shopOf, outside, "5003");
    expect((await resolveDelivery(db(), store.storeId, outside, NO))?.offer.local).toBeNull();
    expect(await chooseDelivery(shopOf, outside, `local:${postalArea}`)).toEqual({ ok: false, problem: "gone" });

    // Below the 200 kr minimum (a tote at 199 kr): shown as "from", never chosen.
    const small = await cartOf(store, [["DEMO-TOTE", 1]]);
    await setDeliveryPostalCode(shopOf, small, "0150");
    const below = await resolveDelivery(db(), store.storeId, small, NO);
    expect(below?.offer.local).toBeNull();
    expect(below?.offer.localBelowMinimum).toMatchObject({ minimumMinor: 20000 });
    const listed = await deliveryOptionsFor(shopOf, small, { label: "Frakt", rate: { amountMinor: 9900, freeOverMinor: 99900 } }, (r) => r.amountMinor);
    expect(listed.localBelowMinimum).toEqual({ label: "Oslo sentrum", minimumMinor: 20000 });
    expect(await chooseDelivery(shopOf, small, `local:${postalArea}`)).toEqual({ ok: false, problem: "gone" });
  });

  it("is charged the same by the cart and the order, in kroner and in euro, free above its limit, with the note kept", async () => {
    for (const market of [NO, NO_EUR]) {
      for (const [quantity, free] of [[1, false], [4, true]] as const) {
        const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", quantity]], { market, postalCode: "0150", choose: `local:${postalArea}`, note: "Ring på hos naboen", paid: false });
        const summary = await summaryOf(order.cartId, market);
        const expected = free ? 0 : market === NO ? 7900 : Math.round(7900 / 11.5);
        expect(summary.shipping).toBe(expected);
        expect(summary.total).toBe(order.totalMinor);
        const kept = await deliveryOf(order.orderId);
        expect(Number(kept.shipping_minor)).toBe(expected);
        expect(kept).toMatchObject({ delivery_method: "local", delivery_note: "Ring på hos naboen" });
        expect(kept.delivery).toMatchObject({ kind: "local", areaId: postalArea, postalCode: "0150", info: "Vi kjører ut mellom 16 og 20." });
      }
    }
  });

  it("offers the cheapest of overlapping areas", async () => {
    const cheap = await saveLocalArea(store.accountId, store.storeId, base({ name: "Grünerløkka", patterns: ["0555"], amountMinor: 2900, minBasketMinor: null, freeOverMinor: null }));
    if (!cheap.ok) throw new Error("cheap");
    try {
      const cart = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
      await setDeliveryPostalCode({ storeId: store.storeId, market: NO }, cart, "0555");
      expect((await resolveDelivery(db(), store.storeId, cart, NO))?.offer.local).toMatchObject({ id: cheap.id, priceMinor: 2900 });
      const elsewhere = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
      await setDeliveryPostalCode({ storeId: store.storeId, market: NO }, elsewhere, "0150");
      expect((await resolveDelivery(db(), store.storeId, elsewhere, NO))?.offer.local).toMatchObject({ id: postalArea });
    } finally {
      await deleteLocalArea(store.accountId, store.storeId, cheap.id);
    }
  });

  it("voids a local choice when the code moves out of the area: the default is charged and the pay press is refused once", async () => {
    const shopOf = { storeId: store.storeId, market: NO };
    const cart = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    await setDeliveryPostalCode(shopOf, cart, "0150");
    expect(await chooseDelivery(shopOf, cart, `local:${postalArea}`, undefined, { note: "Bakdøren" })).toEqual({ ok: true });
    await setDeliveryPostalCode(shopOf, cart, "5003");
    const resolved = await resolveDelivery(db(), store.storeId, cart, NO);
    expect(resolved).toMatchObject({ changed: true, method: "ship", delivery: { kind: "flat" } });
    expect(await deliveryReady(shopOf, cart)).toEqual({ ok: false, problem: "changed" });
    // Once: the choice is gone (and its note with it), the next press goes ahead.
    expect(await deliveryReady(shopOf, cart)).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select local_area_id, delivery_note from commerce.carts where id = ${cart}::uuid`);
    expect(row).toEqual({ local_area_id: null, delivery_note: null });
  });

  it("refuses a note that is too long", async () => {
    const cart = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    await setDeliveryPostalCode({ storeId: store.storeId, market: NO }, cart, "0150");
    expect(await chooseDelivery({ storeId: store.storeId, market: NO }, cart, `local:${postalArea}`, undefined, { note: "x".repeat(501) })).toEqual({ ok: false, problem: "note" });
  });
});

describe("handing a local order over", () => {
  it("Out for delivery records a local handover of everything, fulfils the order and emails once; the list shows it apart until delivered", async () => {
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 2]], { postalCode: "0150", choose: `local:${postalArea}`, note: "Ring på hos naboen" });
    const parcel = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const context = await loadOrderListContext(store.storeId);
    const ids = async (query: string) => (await listOrdersPage(store.storeId, parseOrderListParams(new URLSearchParams(query)), context)).rows.map((r: { id: string }) => r.id);
    expect(await ids("show=to-send")).not.toContain(order.orderId);
    expect(await ids("show=to-send")).toContain(parcel.orderId);
    expect(await ids("show=local")).toContain(order.orderId);
    expect(await ids("show=local")).not.toContain(parcel.orderId);
    const slips = await packingSlipData(store.storeId, [order.orderId]);
    expect(slips.ok && slips.slips[0].handover).toEqual({ method: "local", note: "Ring på hos naboen" });

    expect(await markOutForDelivery(store.storeId, { orderId: parcel.orderId }, null)).toMatchObject({ ok: false, reason: "not_local" });
    expect(await markOutForDelivery(other.storeId, { orderId: order.orderId }, null)).toMatchObject({ ok: false, reason: "not_found" });
    const out = await markOutForDelivery(store.storeId, { orderId: order.orderId }, store.accountId);
    expect(out).toMatchObject({ ok: true, email: expect.stringMatching(/^(sent|logged)$/) });
    if (!out.ok) return;
    const [shipment] = await db().execute<Row>(sql`select method, tracking_number, tracking_url from commerce.shipments where id = ${out.shipmentId}::uuid`);
    expect(shipment).toMatchObject({ method: "local", tracking_number: "", tracking_url: null });
    expect((await deliveryOf(order.orderId)).status).toBe("fulfilled");
    expect(await eventsOf(order.orderId, "order.out_for_delivery")).toHaveLength(1);
    const mails = await mailsOf(order.orderId, "order.out_for_delivery");
    expect(mails).toHaveLength(1);
    expect(mails[0].idempotency_key).toBe(`order-out:${out.shipmentId}`);
    expect(String(mails[0].text)).toContain("vår egen levering");
    expect(String(mails[0].text)).toContain("Vi kjører ut mellom 16 og 20.");
    expect(await mailsOf(order.orderId, "order.sent")).toHaveLength(0);
    // Taken out once: a second press finds nothing left.
    expect(await markOutForDelivery(store.storeId, { orderId: order.orderId }, null)).toMatchObject({ ok: false });
    // Still in Local deliveries until it is delivered.
    expect(await ids("show=local")).toContain(order.orderId);
    expect(await markDelivered(store.storeId, { orderId: order.orderId }, null)).toMatchObject({ ok: true });
    expect(await ids("show=local")).not.toContain(order.orderId);
  });

  it("Delivered on a local order never taken out writes the handover first, in one press", async () => {
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150", choose: `local:${postalArea}` });
    expect(await markDelivered(store.storeId, { orderId: order.orderId }, null)).toMatchObject({ ok: true });
    const kept = await deliveryOf(order.orderId);
    expect(kept.status).toBe("fulfilled");
    expect(kept.delivered_at).not.toBeNull();
    const [shipment] = await db().execute<Row>(sql`select method from commerce.shipments where order_id = ${order.orderId}::uuid`);
    expect(shipment.method).toBe("local");
    // No email but the existing ones: no shipped email, no out-for-delivery email.
    expect(await mailsOf(order.orderId, "order.sent")).toHaveLength(0);
    expect(await mailsOf(order.orderId, "order.out_for_delivery")).toHaveLength(0);
    // A parcel order not sent is still refused.
    const parcel = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]]);
    expect(await markDelivered(store.storeId, { orderId: parcel.orderId }, null)).toMatchObject({ ok: false, code: "not_sent" });
  });
});

describe("a postal code that differs from Stripe's address (2.7)", () => {
  it("flags a local order whose address is outside its area once, keeps the two codes only and changes no amount", async () => {
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150", choose: `local:${postalArea}` });
    const before = await deliveryOf(order.orderId);
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ name: "A", line1: "Gate 1", postalCode: "5003", city: "Bergen", country: "NO" })}::jsonb where id = ${order.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, order.orderId)).toEqual({ priced: "0150", address: "5003" });
    expect(await flagDeliveryMismatch(store.storeId, order.orderId)).toBeNull();
    const after = await deliveryOf(order.orderId);
    expect(after.delivery_mismatch_at).not.toBeNull();
    expect(after.shipping_minor).toBe(before.shipping_minor);
    const events = await eventsOf(order.orderId, "order.delivery_mismatch");
    expect(events.map((e) => e.data)).toEqual([{ priced: "0150", address: "5003" }]);
    const context = await loadOrderListContext(store.storeId);
    const listed = await listOrdersPage(store.storeId, parseOrderListParams(new URLSearchParams("ship=delivery_mismatch")), context);
    expect(listed.rows.map((r: { id: string }) => r.id)).toContain(order.orderId);
  });

  it("does not flag an address inside the area, nor an order on the flat rate", async () => {
    const inside = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150", choose: `local:${postalArea}` });
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ postalCode: "0555", city: "Oslo" })}::jsonb where id = ${inside.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, inside.orderId)).toBeNull();
    const flat = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150" });
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ postalCode: "5003", city: "Bergen" })}::jsonb where id = ${flat.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, flat.orderId)).toBeNull();
    expect((await deliveryOf(flat.orderId)).delivery).toMatchObject({ kind: "flat", postalCode: "0150" });
  });
});
