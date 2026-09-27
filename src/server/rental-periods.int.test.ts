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

const { rentalTimes, rangeDates } = await import("./ranges");
const { changeLine, getCart } = await import("./cart");
const { placeOrder } = await import("./checkout");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let productId: string;
let bikes: string;
let tz: string;
const variant: Record<string, string> = {};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`hours-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`hours-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  // The demo e-bike rental every new store is copied with: three bikes, by the day, half day or hour (D69).
  const rows = await db().execute<Row>(sql`
    select p.id as product_id, v.id as variant_id, v.rental_period, pr.resource_id, s.time_zone
    from commerce.products p
    join commerce.product_variants v on v.product_id = p.id
    join commerce.product_resources pr on pr.product_id = p.id
    join commerce.stores s on s.id = p.store_id
    where p.store_id = ${storeId}::uuid and p.handle = 'demo-sykkelutleie'
  `);
  for (const row of rows) variant[String(row.rental_period)] = String(row.variant_id);
  productId = String(rows[0].product_id);
  bikes = String(rows[0].resource_id);
  tz = String(rows[0].time_zone);
});

afterAll(async () => {
  await closeDb();
});

const day = addDays(zonedDate(Date.now(), "Europe/Oslo"), 5);
const at = (time: string) => new Date(zonedTime(day, time, tz)).toISOString();
const shop = () => ({ storeId, market: no });

describe("renting by the half day or hour (D69)", () => {
  it("offers the day's two halves and each hour from pick-up, with the hours free after it", async () => {
    expect(Object.keys(variant).sort()).toEqual(["day", "half_day", "hour"]);
    const halves = await rentalTimes(storeId, productId, day, "half_day");
    expect(halves?.map((h) => [h.startsAt, h.endsAt, h.free])).toEqual([
      [at("09:00"), at("13:00"), 1],
      [at("13:00"), at("17:00"), 1],
    ]);
    const hours = await rentalTimes(storeId, productId, day, "hour");
    expect(hours?.map((h) => h.free)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
  });

  it("puts hours and half days in the cart at the times offered, and nothing else", async () => {
    jar.clear();
    const hourly = { startsAt: at("10:00"), resourceId: null };
    expect(await changeLine(shop(), variant.hour, 3, "add", null, undefined, hourly)).toEqual({ outcome: "added", quantity: 3 });
    // Not on the hour, or past return time.
    expect((await changeLine(shop(), variant.hour, 1, "add", null, undefined, { startsAt: at("10:30"), resourceId: null })).outcome).toBe(
      "slot_taken",
    );
    expect((await changeLine(shop(), variant.hour, 8, "add", null, undefined, { startsAt: at("14:00"), resourceId: null })).outcome).toBe(
      "slot_taken",
    );
    // Half days: one of the two halves, one at a time.
    expect((await changeLine(shop(), variant.half_day, 1, "add", null, undefined, { startsAt: at("11:00"), resourceId: null })).outcome).toBe(
      "slot_taken",
    );
    expect(await changeLine(shop(), variant.half_day, 1, "add", null, undefined, { startsAt: at("13:00"), resourceId: null })).toEqual({
      outcome: "added",
      quantity: 1,
    });

    const cart = await getCart(shop());
    const lines = Object.fromEntries(cart.lines.map((l) => [l.booking?.period, l]));
    expect(lines.hour).toMatchObject({ quantity: 3, unitPriceMinor: 12000, status: "ok", booking: { kind: "rental", endsAt: at("13:00") } });
    expect(lines.half_day).toMatchObject({ quantity: 1, unitPriceMinor: 30000, booking: { endsAt: at("17:00") } });
  });

  it("holds each at checkout, and then counts the bikes hour by hour", async () => {
    const placed = await placeOrder(shop(), jar.get(`cart_${storeId}_${no.slug}`)!);
    if (!placed.ok) throw new Error(placed.problem);
    expect(placed.order.lines.map((l) => l.title).sort()).toEqual([
      expect.stringMatching(/^Demo: Leie av elsykkel \(Halv dag\), .+ 13[:.]00–17[:.]00$/),
      expect.stringMatching(/^Demo: Leie av elsykkel \(Per time\), .+ 10[:.]00–13[:.]00$/),
    ]);
    const held = await db().execute<Row>(sql`
      select starts_at, ends_at from commerce.bookings where order_id = ${placed.order.orderId}::uuid order by starts_at
    `);
    expect(held.map((b) => [new Date(String(b.starts_at)).toISOString(), new Date(String(b.ends_at)).toISOString()])).toEqual([
      [at("10:00"), at("13:00")],
      [at("13:00"), at("17:00")],
    ]);

    // Two more bikes out from 10:00 to 11:00: all three are taken then, but not before or after.
    for (let i = 0; i < 2; i++) {
      await db().execute(sql`
        select commerce.hold_booking(${storeId}::uuid, ${productId}::uuid, ${variant.hour}::uuid, ${bikes}::uuid,
          ${at("10:00")}::timestamptz, ${at("11:00")}::timestamptz, ${at("10:00")}::timestamptz, ${at("11:00")}::timestamptz,
          now() + interval '15 minutes', null)
      `);
    }
    const hours = await rentalTimes(storeId, productId, day, "hour");
    expect(hours?.slice(0, 3).map((h) => h.free)).toEqual([1, 0, 6]);
    // The day still opens by the hour, but not for a whole day.
    const byHour = await rangeDates(storeId, productId, day, undefined, "hour");
    const byDay = await rangeDates(storeId, productId, day, undefined, "day");
    expect(byHour?.dates.find((d) => d.date === day)?.open).toBe(true);
    expect(byDay?.dates.find((d) => d.date === day)?.open).toBe(false);
  });
});
