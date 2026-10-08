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

const { changeLine, getCart, getCartCount } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { getRangePricing } = await import("./ranges");
const { seasonName } = await import("@/lib/booking-prices");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const dk = toMarket({ code: "DK", currency: "DKK", defaultLocale: "da-DK" });
let storeId: string;
let variantId: string;
let tz: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`seasons-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`seasons-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  // A new store starts with the shop alone (D178): these tests book its demo appointment, stay and rental.
  await db().execute(sql`update commerce.stores set features = features || array['appointments', 'bookings', 'countries', 'languages', 'currencies'] where id = ${storeId}::uuid`);
  // The demo cabin every new store is copied with: 1 450 kr a night, +30 % in high summer, +20 % on Friday and
  // Saturday nights, and 500 kr final cleaning (D70).
  const [row] = await db().execute<Row>(sql`
    select v.id as variant_id, s.time_zone from commerce.products p
    join commerce.product_variants v on v.product_id = p.id
    join commerce.stores s on s.id = p.store_id
    where p.store_id = ${storeId}::uuid and p.handle = 'demo-hytte'
  `);
  variantId = String(row.variant_id);
  tz = String(row.time_zone);
});

afterAll(async () => {
  await closeDb();
});

/** The first date on or after one that falls on a weekday (1 Monday … 7 Sunday). */
function onWeekday(from: string, weekday: number): string {
  for (let date = from; ; date = addDays(date, 1)) {
    if (((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7) + 1 === weekday) return date;
  }
}

const today = () => zonedDate(Date.now(), "Europe/Oslo");
// Next high summer, within the cabin's year of bookings.
const summerYear = () => Number(today().slice(0, 4)) + (today().slice(5) > "06-20" ? 1 : 0);
const checkIn = (date: string) => new Date(zonedTime(date, "15:00", tz)).toISOString();

describe("seasons and the cleaning fee (D70)", () => {
  it("prices a summer stay night by night, with the weekend on top, and cleaning once", async () => {
    jar.clear();
    // Thursday to Sunday in high summer: Thursday 1 885, Friday and Saturday 2 262 each (1 450 × 1.3 × 1.2).
    const thursday = onWeekday(`${summerYear()}-07-01`, 4);
    const shop = { storeId, market: no };
    expect(await changeLine(shop, variantId, 3, "add", null, undefined, { startsAt: checkIn(thursday), resourceId: null })).toEqual({
      outcome: "added",
      quantity: 3,
    });
    const [line] = (await getCart(shop)).lines;
    expect(line).toMatchObject({
      quantity: 1,
      unitPriceMinor: 188500 + 226200 + 226200 + 50000,
      booking: { count: 3, price: { itemsMinor: 640900, feeMinor: 50000, seasonal: true, baseMinor: 145000 } },
    });
    // One booking in the header's count, not three.
    expect(await getCartCount(shop)).toBe(1);

    const placed = await placeOrder(shop, jar.get(`cart_${storeId}_${no.slug}`)!);
    if (!placed.ok) throw new Error(placed.problem);
    expect(placed.order.lines[0]).toMatchObject({ quantity: 1, unitPriceMinor: 690900 });
    // A 30 % deposit now, of the whole, cleaning included.
    expect(placed.order.dueNowMinor).toBe(207270);
    const [booking] = await db().execute<Row>(sql`
      select b.starts_at, b.ends_at, ol.total_minor, ol.quantity from commerce.bookings b
      join commerce.order_lines ol on ol.id = b.order_line_id
      where b.order_id = ${placed.order.orderId}::uuid
    `);
    expect([new Date(String(booking.starts_at)).toISOString(), Number(booking.total_minor), Number(booking.quantity)]).toEqual([
      checkIn(thursday),
      690900,
      1,
    ]);
  });

  it("gives the product page each season's name in the shopper's language", async () => {
    const [cabin] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-hytte'`);
    const { seasons } = await getRangePricing(storeId, String(cabin.id), "SE");
    expect(seasons.map((s) => [seasonName(s, "sv-SE"), seasonName(s, "da-DK"), seasonName(s, "nb-NO")])).toEqual([
      ["Högsäsong", "Højsæson", "Høysesong"],
      ["Helg", "Weekend", "Helg"],
    ]);
  });

  it("charges each market its own fee, and ordinary nights their ordinary price", async () => {
    jar.clear();
    // Monday to Wednesday outside summer: two ordinary nights, and Denmark's 375 kr cleaning.
    const start = today().slice(5) >= "08-16" || today().slice(5) < "06-01" ? today() : `${Number(today().slice(0, 4))}-08-20`;
    const monday = onWeekday(addDays(start, 7), 1);
    const shop = { storeId, market: dk };
    expect((await changeLine(shop, variantId, 2, "add", null, undefined, { startsAt: checkIn(monday), resourceId: null })).outcome).toBe("added");
    const [line] = (await getCart(shop)).lines;
    expect(line.booking?.price).toEqual({ itemsMinor: 2 * 105000, feeMinor: 37500, seasonal: false, baseMinor: 105000 });
    expect(line.unitPriceMinor).toBe(2 * 105000 + 37500);
  });
});
