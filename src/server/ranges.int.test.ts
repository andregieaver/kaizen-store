import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

const { getRangeOffer, rangeDates } = await import("./ranges");
const { changeLine, getCart } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { getOrder } = await import("./orders");
const { listBookings } = await import("./bookings");
const { cancelOwnBooking, moveOwnBooking } = await import("./booking-changes");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const TZ = "Europe/Oslo";
let storeId: string;
let productId: string;
let variantId: string;
let cabin: string;
let shop: { storeId: string; market: typeof no };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`stay-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`stay-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  shop = { storeId, market: no };
  await db().execute(sql`update commerce.stores set modules = '{bookings}', time_zone = ${TZ} where id = ${storeId}::uuid`);
  const [unit] = await db().execute<Row>(sql`
    insert into commerce.booking_resources (store_id, kind, name, hours) values (${storeId}::uuid, 'unit', 'Hytta', '{}') returning id
  `);
  cabin = String(unit.id);
  const [product] = await db().execute<Row>(sql`
    insert into commerce.products (store_id, handle, tax_code, kind, status, vat_category)
    values (${storeId}::uuid, 'hytte', 'txcd_20030000', 'stay', 'draft', 'accommodation') returning id
  `);
  productId = String(product.id);
  await db().execute(sql`
    insert into commerce.product_translations (store_id, product_id, locale, title)
    values (${storeId}::uuid, ${productId}::uuid, 'nb-NO', 'Hytte')
  `);
  await db().execute(sql`
    insert into commerce.product_media (store_id, product_id, url) values (${storeId}::uuid, ${productId}::uuid, 'https://example.com/h.webp')
  `);
  const [variant] = await db().execute<Row>(sql`
    insert into commerce.product_variants (store_id, product_id, sku, options, delivery)
    values (${storeId}::uuid, ${productId}::uuid, ${`HYTTE-${run}`}, '{}'::jsonb, 'service') returning id
  `);
  variantId = String(variant.id);
  await db().execute(sql`select commerce.set_price(${variantId}::uuid, 'NO', 120000)`);
  await db().execute(sql`
    insert into commerce.appointment_settings (product_id, store_id, min_notice_minutes, max_days_ahead,
      check_in_time, check_out_time, min_nights, max_nights, cancel_hours)
    values (${productId}::uuid, ${storeId}::uuid, 0, 120, '15:00', '11:00', 2, 21, 48)
  `);
  await db().execute(sql`
    insert into commerce.product_resources (store_id, product_id, resource_id) values (${storeId}::uuid, ${productId}::uuid, ${cabin}::uuid)
  `);
  await db().execute(sql`update commerce.products set status = 'active' where id = ${productId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

const newShopper = () => jar.clear();
const cartId = () => jar.get(`cart_${storeId}_${no.slug}`)!;
/** Check-in on a date some weeks ahead, so notice and cancelling are no concern. */
const arrival = addDays(zonedDate(Date.now(), TZ), 20);
const checkIn = (date: string) => new Date(zonedTime(date, "15:00", TZ)).toISOString();

describe("booking a stay (D67)", () => {
  it("offers the stay with its rules, and its dates as free", async () => {
    const offer = await getRangeOffer(storeId, productId);
    expect(offer).toMatchObject({ kind: "stay", units: [{ id: cabin, name: "Hytta" }], cancelHours: 48 });
    expect(offer?.rules).toMatchObject({ checkInTime: "15:00", checkOutTime: "11:00", minNights: 2, maxNights: 21 });
    const month = await rangeDates(storeId, productId, arrival);
    expect(month?.dates).toHaveLength(28);
    expect(month?.dates.find((d) => d.date === arrival)?.open).toBe(true);
  });

  it("puts nights in the cart as the quantity, keeping to the shortest and longest", async () => {
    newShopper();
    const booking = { startsAt: checkIn(arrival), resourceId: null };
    expect((await changeLine(shop, variantId, 1, "add", null, undefined, booking)).outcome).toBe("slot_taken");
    expect((await changeLine(shop, variantId, 22, "add", null, undefined, booking)).outcome).toBe("slot_taken");
    // More than the 20 a line of goods may hold is fine for nights.
    expect(await changeLine(shop, variantId, 21, "add", null, undefined, booking)).toEqual({ outcome: "added", quantity: 21 });
    // Choosing again replaces the length.
    expect(await changeLine(shop, variantId, 3, "add", null, undefined, booking)).toEqual({ outcome: "added", quantity: 3 });
    // A stay needs dates.
    expect((await changeLine(shop, variantId, 3, "add")).outcome).toBe("unavailable");

    const cart = await getCart(shop);
    expect(cart.lines).toEqual([
      // One booking of three nights, at their whole price.
      expect.objectContaining({
        quantity: 1,
        status: "ok",
        vatRate: 0.12,
        unitPriceMinor: 360000,
        booking: expect.objectContaining({
          kind: "stay",
          count: 3,
          price: { itemsMinor: 360000, feeMinor: 0, seasonal: false, baseMinor: 120000 },
          startsAt: checkIn(arrival),
          endsAt: new Date(zonedTime(addDays(arrival, 3), "11:00", TZ)).toISOString(),
        }),
      }),
    ]);
  });

  let orderId: string;

  it("holds every night at checkout, and the next guest can arrive the day this one leaves", async () => {
    const placed = await placeOrder(shop, cartId());
    if (!placed.ok) throw new Error(placed.problem);
    orderId = placed.order.orderId;
    await db().execute(sql`update commerce.orders set status = 'paid' where id = ${orderId}::uuid`);
    const [booking] = await db().execute<Row>(sql`
      select status, starts_at, ends_at from commerce.bookings where order_id = ${orderId}::uuid
    `);
    expect(booking.status).toBe("confirmed");
    expect(new Date(String(booking.ends_at)).toISOString()).toBe(new Date(zonedTime(addDays(arrival, 3), "11:00", TZ)).toISOString());

    // Nights in the middle are taken; arriving the day it ends is not.
    newShopper();
    const inside = { startsAt: checkIn(addDays(arrival, 1)), resourceId: null };
    expect((await changeLine(shop, variantId, 2, "add", null, undefined, inside)).outcome).toBe("slot_taken");
    const after = { startsAt: checkIn(addDays(arrival, 3)), resourceId: null };
    expect((await changeLine(shop, variantId, 2, "add", null, undefined, after)).outcome).toBe("added");
    const month = await rangeDates(storeId, productId, arrival);
    const open = (date: string) => month?.dates.find((d) => d.date === date)?.open;
    expect([open(arrival), open(addDays(arrival, 2)), open(addDays(arrival, 3))]).toEqual([false, false, true]);

    const order = await getOrder(storeId, orderId);
    expect(order?.lines[0]).toMatchObject({ quantity: 1, totalMinor: 360000, booking: { kind: "stay", staff: "Hytta" } });
    const listed = await listBookings(storeId, new Date(zonedTime(addDays(arrival, 1), "00:00", TZ)), new Date(zonedTime(addDays(arrival, 2), "00:00", TZ)), [
      "unit",
    ]);
    expect(listed.map((b) => b.kind)).toEqual(["unit"]);
  });

  it("lets the guest cancel, not move, their stay", async () => {
    const [payment] = await db().execute<Row>(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${orderId}::uuid, 'venue', ${`venue_${run}`}, 360000, 'NOK', 'pending') returning provider_reference
    `);
    const key = { sessionId: String(payment.provider_reference) };
    const [booking] = await db().execute<Row>(sql`select id from commerce.bookings where order_id = ${orderId}::uuid`);
    expect(await moveOwnBooking(storeId, orderId, key, String(booking.id), checkIn(addDays(arrival, 7)))).toBe("not_found");
    expect((await cancelOwnBooking(storeId, orderId, key, String(booking.id))).outcome).toBe("done");
    const month = await rangeDates(storeId, productId, arrival);
    expect(month?.dates.find((d) => d.date === arrival)?.open).toBe(true);
  });
});
