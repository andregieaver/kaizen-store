import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { defaultHours } from "@/lib/opening-hours";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const bookings = await import("./bookings");

const run = Date.now().toString(36);
const slug = `book-${run}`;
let storeId: string;
let member: Membership;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  // A new store starts with the shop alone (D178): the demo appointment, stay and rental are offered with their features on, as an owner switches them under Features.
  await db().execute(sql`update commerce.stores set features = features || array['appointments', 'bookings']::text[] where slug = ${slug}`);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-${slug}@example.com`}, 'Owner') returning id
  `);
  member = {
    account: { id: String(account.id), email: `owner-${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    // The bookings functions only need the store's id, and its features (D178).
    store: { id: storeId, slug, features: ["shop", "appointments", "bookings"] } as unknown as Store,
  };
});

afterAll(async () => {
  await closeDb();
});

const staffForm = (values: Partial<Record<string, unknown>> = {}) => ({
  name: "Kari",
  email: "",
  capacity: "1",
  active: true,
  hours: JSON.stringify(defaultHours()),
  ...values,
});

describe("the bookings module (D65)", () => {
  it("switches on and off, keeping the store's time zone", async () => {
    await bookings.setBookingsModule(member, { enabled: true, timeZone: "Europe/Stockholm", reminderHours: 48 });
    await bookings.setBookingsModule(member, { enabled: true, timeZone: "Europe/Stockholm", reminderHours: 48 });
    const [on] = await db().execute<Row>(sql`
      select modules, time_zone, booking_reminder_hours from commerce.stores where id = ${storeId}::uuid
    `);
    expect(on).toEqual({ modules: ["bookings"], time_zone: "Europe/Stockholm", booking_reminder_hours: 48 });
    await bookings.setBookingsModule(member, { enabled: false, timeZone: "Europe/Oslo", reminderHours: 24 });
    const [off] = await db().execute<Row>(sql`select modules from commerce.stores where id = ${storeId}::uuid`);
    expect(off.modules).toEqual([]);
    expect(bookings.bookingsModuleInput.safeParse({ enabled: true, timeZone: "Mars/Olympus", reminderHours: 24 }).success).toBe(false);
    expect(bookings.bookingsModuleInput.safeParse({ enabled: true, timeZone: "Europe/Oslo", reminderHours: 200 }).success).toBe(false);
  });
});

describe("staff (D65)", () => {
  it("adds and changes staff with their hours, and explains what is wrong", async () => {
    expect(await bookings.saveResource(member, null, staffForm({ name: "", email: "not an email", hours: "{" }))).toEqual({
      ok: false,
      problems: ["Give them a name.", "Write an email address, or leave it empty.", "The working hours could not be read. Try again."],
    });
    const added = await bookings.saveResource(member, null, staffForm({ email: "kari@example.com" }));
    if (!added.ok) throw new Error(added.problems.join(" "));
    expect(await bookings.saveResource(member, added.id, staffForm({ name: "Kari N.", capacity: "3" }))).toEqual({ ok: true, id: added.id });
    // New stores start with the template's demo staff; Kari is the one added here.
    const kari = (await bookings.listResources(storeId)).find((r) => r.id === added.id)!;
    expect(kari).toMatchObject({ name: "Kari N.", capacity: 3, active: true, services: 0, upcoming: 0 });
    expect(kari.hours.week.mon).toEqual({ open: "09:00", close: "17:00" });
  });

  it("keeps rooms and rental items apart from staff, without hours (D67)", async () => {
    const room = await bookings.saveResource(member, null, { name: "Rom 1", email: "", capacity: "1", active: true }, "unit");
    if (!room.ok) throw new Error(room.problems.join(" "));
    expect((await bookings.listResources(storeId)).some((r) => r.id === room.id)).toBe(false);
    expect((await bookings.listResources(storeId, ["unit", "item"])).find((r) => r.id === room.id)).toMatchObject({
      kind: "unit",
      name: "Rom 1",
    });
    // A room is not changed as staff, nor staff as a room.
    expect(await bookings.saveResource(member, room.id, staffForm({ name: "Kari" }))).toEqual({
      ok: false,
      problems: ["They are no longer in the store."],
    });
    expect(await bookings.saveResource(member, room.id, { name: "Rom 2", email: "", capacity: "2", active: true }, "unit")).toEqual({
      ok: true,
      id: room.id,
    });
  });

  it("deletes staff never booked, and only switches off those who were, keeping their bookings", async () => {
    const never = await bookings.saveResource(member, null, staffForm({ name: "Never" }));
    const booked = await bookings.saveResource(member, null, staffForm({ name: "Booked" }));
    if (!never.ok || !booked.ok) throw new Error("not saved");
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid limit 1`);
    const [held] = await db().execute<Row>(sql`
      select commerce.hold_booking(${storeId}::uuid, ${String(product.id)}::uuid, null, ${booked.id}::uuid,
        now() + interval '1 day', now() + interval '1 day 1 hour', now() + interval '1 day', now() + interval '1 day 1 hour',
        now() + interval '15 minutes', null) as id
    `);
    expect(held.id).not.toBeNull();
    const soon = await bookings.listBookings(storeId, new Date(), new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    expect(soon).toEqual([expect.objectContaining({ id: String(held.id), staff: "Booked", status: "held", orderId: null })]);

    expect(await bookings.removeResource(member, never.id)).toBe(true);
    expect(await bookings.removeResource(member, booked.id)).toBe(true);
    expect(await bookings.getResource(storeId, never.id)).toBeNull();
    expect(await bookings.getResource(storeId, booked.id)).toMatchObject({ active: false });
  });
});
