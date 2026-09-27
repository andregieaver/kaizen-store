import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { toMarket } from "@/lib/markets";

import type { Membership } from "./auth";
import type { Store } from "./stores";

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

const sync = await import("./calendar-sync");
const { rangeDates } = await import("./ranges");
const { changeLine } = await import("./cart");

const run = Date.now().toString(36);
const slug = `sync-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let member: Membership;
let productId: string;
let variantId: string;
let cabin: string;
let tz: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-${slug}@example.com`}, 'Owner') returning id
  `);
  member = {
    account: { id: String(account.id), email: `owner-${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug } as Store,
  };
  // The demo cabin every new store is copied with (D67).
  const [row] = await db().execute<Row>(sql`
    select p.id as product_id, v.id as variant_id, pr.resource_id, s.time_zone
    from commerce.products p
    join commerce.product_variants v on v.product_id = p.id
    join commerce.product_resources pr on pr.product_id = p.id
    join commerce.stores s on s.id = p.store_id
    where p.store_id = ${storeId}::uuid and p.handle = 'demo-hytte'
  `);
  productId = String(row.product_id);
  variantId = String(row.variant_id);
  cabin = String(row.resource_id);
  tz = String(row.time_zone);
});

afterAll(async () => {
  await closeDb();
});

const today = () => zonedDate(Date.now(), tz);
const day = (n: number) => addDays(today(), n);
const ics = (date: string) => date.replace(/-/g, "");
const event = (uid: string, from: string, to: string) =>
  ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART;VALUE=DATE:${ics(from)}`, `DTEND;VALUE=DATE:${ics(to)}`, "SUMMARY:Reserved", "END:VEVENT"].join("\r\n");
const calendar = (...events: string[]) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...events, "END:VCALENDAR"].join("\r\n");

/** A calendar site that answers with whatever `served` holds, and records what was asked. */
let served: Response | (() => Response) = new Response("");
const asked: string[] = [];
const fakeFetch = (async (input: RequestInfo | URL) => {
  asked.push(String(input));
  return typeof served === "function" ? served() : served.clone();
}) as typeof fetch;
const serve = (text: string) => {
  served = () => new Response(text, { headers: { "Content-Type": "text/calendar" } });
};

let feedId: string;

describe("calendar sync (D67, B3b)", () => {
  it("reads another site's calendar into blocks that close the room's nights", async () => {
    serve(calendar(event("a@airbnb.com", day(10), day(13)), event("b@airbnb.com", day(20), day(22))));
    const added = await sync.addFeed(member, cabin, { name: "Airbnb", url: "https://www.airbnb.com/calendar/ical/1.ics?s=x" }, fakeFetch);
    if (!added.ok) throw new Error(added.problems.join(" "));
    feedId = added.id;
    expect(added.sync).toEqual({ ok: true, events: 2 });
    expect((await sync.listFeeds(storeId, cabin))[0]).toMatchObject({ name: "Airbnb", error: "", events: 2 });

    const month = await rangeDates(storeId, productId, day(10));
    const open = (d: string) => month?.dates.find((x) => x.date === d)?.open;
    expect([open(day(10)), open(day(12)), open(day(13))]).toEqual([false, false, true]);

    // A stay over the blocked nights is refused; one starting the day Airbnb's guest leaves is not.
    jar.clear();
    const shop = { storeId, market: no };
    const checkIn = (d: string) => new Date(zonedTime(d, "15:00", tz)).toISOString();
    expect((await changeLine(shop, variantId, 2, "add", null, undefined, { startsAt: checkIn(day(11)), resourceId: null })).outcome).toBe(
      "slot_taken",
    );
    expect((await changeLine(shop, variantId, 2, "add", null, undefined, { startsAt: checkIn(day(13)), resourceId: null })).outcome).toBe(
      "added",
    );
  });

  it("follows the calendar: events it drops open again, moved ones move", async () => {
    serve(calendar(event("b@airbnb.com", day(21), day(24))));
    expect(await sync.syncFeed(storeId, feedId, fakeFetch)).toEqual({ ok: true, events: 1 });
    const blocks = await sync.listBlocks(storeId, cabin);
    expect(blocks).toEqual([
      expect.objectContaining({
        feed: "Airbnb",
        note: "Reserved",
        startsAt: new Date(zonedTime(day(21), "12:00", tz)).toISOString(),
        endsAt: new Date(zonedTime(day(24), "12:00", tz)).toISOString(),
      }),
    ]);
  });

  it("keeps the blocks it has when a calendar cannot be read, and says why", async () => {
    served = () => new Response("Gone", { status: 410 });
    expect(await sync.syncFeed(storeId, feedId, fakeFetch)).toEqual({ ok: false, error: "The calendar answered 410." });
    serve("<html>Log in</html>");
    expect(await sync.syncFeed(storeId, feedId, fakeFetch)).toEqual({ ok: false, error: "That address does not give a calendar file." });
    // Sent on to a local address: not followed.
    asked.length = 0;
    served = () => new Response(null, { status: 302, headers: { Location: "https://localhost/secret.ics" } });
    expect((await sync.syncFeed(storeId, feedId, fakeFetch)).ok).toBe(false);
    expect(asked).toHaveLength(1);
    expect(await sync.listBlocks(storeId, cabin)).toHaveLength(1);
    expect((await sync.listFeeds(storeId, cabin))[0].error).toBe("Use the calendar's web address, not a local one.");
  });

  it("refuses addresses that are not a site's calendar", async () => {
    expect(await sync.addFeed(member, cabin, { name: "", url: "http://127.0.0.1/x.ics" }, fakeFetch)).toEqual({
      ok: false,
      problems: ["Name the calendar, such as Airbnb.", "The address must start with https://."],
    });
  });

  it("publishes the room's taken days, with its own blocks, at a secret address", async () => {
    const blocked = await sync.addBlock(member, cabin, { from: day(30), to: day(31), note: "Maling" });
    expect(blocked).toEqual({ ok: true, clashes: 0 });
    expect(await sync.addBlock(member, cabin, { from: day(31), to: day(30), note: "" })).toEqual({
      ok: false,
      problems: ["The last date cannot be before the first."],
    });
    const token = await sync.resetCalendarToken(member, cabin);
    if (!token) throw new Error("no token");
    expect(await sync.calendarForToken("wrong-token-that-is-long-enough")).toBeNull();
    const exported = await sync.calendarForToken(token);
    expect(exported?.name).toBe("Demo: Hytta");
    const file = exported!.file;
    // The block set here, to the morning after its last night; Airbnb's own event too; no note.
    expect(file).toContain(`DTSTART;VALUE=DATE:${ics(day(30))}\r\nDTEND;VALUE=DATE:${ics(day(32))}`);
    expect(file).toContain(`DTSTART;VALUE=DATE:${ics(day(21))}\r\nDTEND;VALUE=DATE:${ics(day(24))}`);
    expect(file).not.toContain("Maling");

    const own = (await sync.listBlocks(storeId, cabin)).find((b) => b.note === "Maling")!;
    expect(await sync.removeBlock(member, own.id)).toBe(true);
    // Imported ones stay until their calendar drops them.
    const imported = (await sync.listBlocks(storeId, cabin)).find((b) => b.feed)!;
    expect(await sync.removeBlock(member, imported.id)).toBe(false);
  });

  it("publishes a bike rented by the hour for those hours only, and one rented by the day for whole days (D69)", async () => {
    const [bikes] = await db().execute<Row>(sql`
      select p.id as product_id, pr.resource_id,
        (select id from commerce.product_variants where product_id = p.id and rental_period = 'hour') as hourly,
        (select id from commerce.product_variants where product_id = p.id and rental_period = 'day') as daily
      from commerce.products p join commerce.product_resources pr on pr.product_id = p.id
      where p.store_id = ${storeId}::uuid and p.handle = 'demo-sykkelutleie'
    `);
    const book = async (variant: unknown, from: string, to: string) => {
      const [held] = await db().execute<Row>(sql`
        select commerce.hold_booking(${storeId}::uuid, ${String(bikes.product_id)}::uuid, ${String(variant)}::uuid,
          ${String(bikes.resource_id)}::uuid, ${from}::timestamptz, ${to}::timestamptz, ${from}::timestamptz, ${to}::timestamptz,
          now() + interval '15 minutes', null) as id
      `);
      await db().execute(sql`update commerce.bookings set status = 'confirmed' where id = ${String(held.id)}::uuid`);
    };
    const at = (date: string, time: string) => new Date(zonedTime(date, time, tz)).toISOString();
    await book(bikes.hourly, at(day(40), "10:00"), at(day(40), "13:00"));
    await book(bikes.daily, at(day(42), "09:00"), at(day(43), "17:00"));
    const token = await sync.resetCalendarToken(member, String(bikes.resource_id));
    const file = (await sync.calendarForToken(token!))!.file;
    const utc = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
    expect(file).toContain(`DTSTART:${utc(at(day(40), "10:00"))}\r\nDTEND:${utc(at(day(40), "13:00"))}`);
    expect(file).toContain(`DTSTART;VALUE=DATE:${ics(day(42))}\r\nDTEND;VALUE=DATE:${ics(day(44))}`);
    expect(file).not.toContain(`VALUE=DATE:${ics(day(40))}`);
  });

  it("reads feeds due from the cron, each at most every quarter of an hour", async () => {
    serve(calendar());
    const first = await sync.syncDueFeeds(fakeFetch);
    await db().execute(sql`update commerce.calendar_feeds set synced_at = now() - interval '1 hour' where id = ${feedId}::uuid`);
    asked.length = 0;
    const second = await sync.syncDueFeeds(fakeFetch);
    expect(second.synced).toBeGreaterThanOrEqual(1);
    expect(asked.filter((url) => url.includes("airbnb.com/calendar/ical/1.ics"))).toHaveLength(1);
    void first;
    // Just read: not again.
    asked.length = 0;
    await sync.syncDueFeeds(fakeFetch);
    expect(asked.filter((url) => url.includes("airbnb.com/calendar/ical/1.ics"))).toHaveLength(0);
    // Removing the feed opens its dates.
    expect(await sync.removeFeed(member, feedId)).toBe(true);
    expect((await sync.listBlocks(storeId, cabin)).filter((b) => b.feed)).toEqual([]);
  });
});
