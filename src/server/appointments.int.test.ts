import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
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

const { appointmentSlots, getAppointmentOffer } = await import("./appointments");
const { changeLine, getCart } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { getOrder } = await import("./orders");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const open = { open: "08:00", close: "20:00" };
const everyDay = { week: { mon: open, tue: open, wed: open, thu: open, fri: open, sat: open, sun: open }, exceptions: [] };
let storeId: string;
let productId: string;
let variantId: string;
let kari: string;
let ola: string;
let shop: { storeId: string; market: typeof no };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`appt-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`appt-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  shop = { storeId, market: no };
  await db().execute(sql`update commerce.stores set modules = '{bookings}', time_zone = 'Europe/Oslo' where id = ${storeId}::uuid`);
  const staff = await db().execute<Row>(sql`
    insert into commerce.booking_resources (store_id, name, hours, position)
    values (${storeId}::uuid, 'Kari', ${JSON.stringify(everyDay)}::jsonb, 0),
           (${storeId}::uuid, 'Ola', ${JSON.stringify(everyDay)}::jsonb, 1)
    returning id
  `);
  [kari, ola] = staff.map((row) => String(row.id));
  const [product] = await db().execute<Row>(sql`
    insert into commerce.products (store_id, handle, tax_code, kind, status, vat_category)
    values (${storeId}::uuid, 'massasje', 'txcd_20030000', 'appointment', 'draft', 'exempt') returning id
  `);
  productId = String(product.id);
  await db().execute(sql`
    insert into commerce.product_translations (store_id, product_id, locale, title)
    values (${storeId}::uuid, ${productId}::uuid, 'nb-NO', 'Massasje')
  `);
  await db().execute(sql`
    insert into commerce.product_media (store_id, product_id, url) values (${storeId}::uuid, ${productId}::uuid, 'https://example.com/m.webp')
  `);
  const [variant] = await db().execute<Row>(sql`
    insert into commerce.product_variants (store_id, product_id, sku, options, delivery)
    values (${storeId}::uuid, ${productId}::uuid, ${`MASSASJE-${run}`}, '{}'::jsonb, 'service') returning id
  `);
  variantId = String(variant.id);
  await db().execute(sql`select commerce.set_price(${variantId}::uuid, 'NO', 89000)`);
  await db().execute(sql`
    insert into commerce.appointment_settings (product_id, store_id, duration_minutes, buffer_after_minutes, step_minutes, min_notice_minutes, max_days_ahead)
    values (${productId}::uuid, ${storeId}::uuid, 60, 15, 30, 60, 30)
  `);
  await db().execute(sql`
    insert into commerce.product_resources (store_id, product_id, resource_id)
    values (${storeId}::uuid, ${productId}::uuid, ${kari}::uuid), (${storeId}::uuid, ${productId}::uuid, ${ola}::uuid)
  `);
  await db().execute(sql`update commerce.products set status = 'active' where id = ${productId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

/** A fresh browser: the next line starts a new cart. */
const newShopper = () => jar.clear();
const cartId = () => jar.get(`cart_${storeId}_${no.slug}`)!;

let first: string;

describe("booking an appointment (D65)", () => {
  it("offers the first week with free times, and who does it", async () => {
    const offer = await getAppointmentOffer(storeId, productId);
    expect(offer).toMatchObject({ timeZone: "Europe/Oslo", staff: [{ name: "Kari" }, { name: "Ola" }], place: null });
    expect(offer?.rules).toMatchObject({ durationMinutes: 60, bufferAfterMinutes: 15, stepMinutes: 30 });
    const week = await appointmentSlots(storeId, productId);
    const day = week?.days.find((d) => d.slots.length > 0);
    if (!day) throw new Error("no free times");
    first = day.slots[0].startsAt;
    expect(day.slots[0].resourceIds).toEqual([kari, ola]);
    // Only the chosen one's times, when the shopper chooses.
    const olas = await appointmentSlots(storeId, productId, { resourceId: ola });
    expect(olas?.days.flatMap((d) => d.slots).every((s) => s.resourceIds.join() === ola)).toBe(true);
  });

  it("puts a time in the cart once, and refuses times not offered", async () => {
    newShopper();
    const booking = { startsAt: first, resourceId: null };
    expect(await changeLine(shop, variantId, 1, "add", null, undefined, booking)).toEqual({ outcome: "added", quantity: 1 });
    expect(await changeLine(shop, variantId, 3, "add", null, undefined, booking)).toEqual({ outcome: "added", quantity: 1 });
    const odd = new Date(Date.parse(first) + 7 * 60_000).toISOString();
    expect((await changeLine(shop, variantId, 1, "add", null, undefined, { startsAt: odd, resourceId: null })).outcome).toBe("slot_taken");
    // An appointment needs a time.
    expect((await changeLine(shop, variantId, 1, "add")).outcome).toBe("unavailable");

    const cart = await getCart(shop);
    expect(cart.lines).toEqual([
      expect.objectContaining({
        quantity: 1,
        status: "ok",
        delivery: "service",
        vatRate: 0,
        booking: { startsAt: first, resourceId: null, staff: null, timeZone: "Europe/Oslo" },
      }),
    ]);
  });

  it("holds the time at checkout with whoever is free, and gives no one else the same place", async () => {
    const placed = await placeOrder(shop, cartId());
    if (!placed.ok) throw new Error(placed.problem);
    expect(placed.order.ships).toBe(false);
    expect(placed.order.taxMinor).toBe(0);
    expect(placed.order.lines[0].title).toMatch(/^Massasje, /);
    const order = await getOrder(storeId, placed.order.orderId);
    expect(order?.lines[0].booking).toMatchObject({ startsAt: first, staff: "Kari", status: "held" });

    // A second shopper gets Ola; a third finds the time gone, and nothing is placed.
    newShopper();
    await changeLine(shop, variantId, 1, "add", null, undefined, { startsAt: first, resourceId: null });
    const second = await placeOrder(shop, cartId());
    if (!second.ok) throw new Error(second.problem);
    expect((await getOrder(storeId, second.order.orderId))?.lines[0].booking?.staff).toBe("Ola");

    newShopper();
    const later = new Date(Date.parse(first) + 24 * 60 * 60_000).toISOString();
    await changeLine(shop, variantId, 1, "add", null, undefined, { startsAt: later, resourceId: kari });
    expect((await changeLine(shop, variantId, 1, "add", null, undefined, { startsAt: first, resourceId: null })).outcome).toBe("slot_taken");
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, starts_at)
      values (${storeId}::uuid, ${cartId()}::uuid, ${variantId}::uuid, 1, ${first}::timestamptz)
    `);
    const [before] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${storeId}::uuid`);
    expect(await placeOrder(shop, cartId())).toEqual({ ok: false, problem: "slot_taken" });
    const [after] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${storeId}::uuid`);
    expect(after.n).toBe(before.n);
    const [held] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.bookings where store_id = ${storeId}::uuid and starts_at = ${later}::timestamptz
    `);
    expect(held.n).toBe(0);

    // Paying confirms the time; giving up the order frees it.
    await db().execute(sql`update commerce.orders set status = 'paid' where id = ${placed.order.orderId}::uuid`);
    expect((await getOrder(storeId, placed.order.orderId))?.lines[0].booking?.status).toBe("confirmed");
    await db().execute(sql`select commerce.cancel_unpaid_order(${second.order.orderId}::uuid, 'test')`);
    const week = await appointmentSlots(storeId, productId, { from: first.slice(0, 10) });
    const slot = week?.days.flatMap((d) => d.slots).find((s) => s.startsAt === first);
    expect(slot?.resourceIds).toEqual([ola]);
  });
});
