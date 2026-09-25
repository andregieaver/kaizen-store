import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { defaultHours, defaultWeek } from "@/lib/opening-hours";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const { deleteLocation, getCompany, getLocation, saveLocation } = await import("./company");

const run = Date.now().toString(36);
let storeId: string;
let other: string;
const member = (id: string) => ({ account: { id: null }, store: { id } }) as unknown as Membership;

async function newStore(tag: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${tag}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`${tag}-${run}`}, 'Test', null) as id
  `);
  return String(store.id);
}

beforeAll(async () => {
  storeId = await newStore("company");
  other = await newStore("company-other");
});

afterAll(async () => {
  await closeDb();
});

const address = { street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" };

describe("the store's places (D40)", () => {
  it("keeps one office, with its hours, saved again in place", async () => {
    const summer = { kind: "season", label: "Summer", from: "2026-07-01", to: "2026-08-15", week: defaultWeek() };
    const hours = { ...defaultHours(), exceptions: [summer, { kind: "date", label: "Christmas Eve", date: "2026-12-24", hours: null }] };
    expect(await saveLocation(member(storeId), null, { kind: "office", ...address, hours: JSON.stringify(hours) })).toEqual({ ok: true });
    expect(await saveLocation(member(storeId), null, { kind: "office", ...address, street: "Kirkegata 2", hours: "" })).toEqual({ ok: true });
    const { office, places } = await getCompany(storeId);
    expect(office).toMatchObject({ kind: "office", street: "Kirkegata 2", hours: null });
    expect(places).toEqual([]);
  });

  it("adds shops and pickup points, each named, and refuses bad hours or a missing address", async () => {
    const shop = await saveLocation(member(storeId), null, {
      kind: "shop",
      name: "Butikken på Grünerløkka",
      ...address,
      phone: "+47 22 00 00 00",
      notes: "Inngang fra bakgården.",
      hours: JSON.stringify(defaultHours()),
    });
    expect(shop).toMatchObject({ ok: true, id: expect.any(String) });
    const pickup = await saveLocation(member(storeId), null, { kind: "pickup", name: "Post i Butikk, Rema 1000", ...address });
    expect(pickup.ok).toBe(true);

    expect(await saveLocation(member(storeId), null, { kind: "pickup", name: " ", ...address })).toEqual({
      ok: false,
      problems: ["Give the pickup point a name."],
    });
    expect(await saveLocation(member(storeId), null, { kind: "shop", name: "X", ...address, street: "" })).toEqual({
      ok: false,
      problems: ["Enter the street address."],
    });
    const backwards = { week: { ...defaultWeek(), mon: { open: "17:00", close: "09:00" } }, exceptions: [] };
    expect(await saveLocation(member(storeId), null, { kind: "shop", name: "X", ...address, hours: JSON.stringify(backwards) })).toEqual({
      ok: false,
      problems: ["A day must close after it opens."],
    });

    const { places } = await getCompany(storeId);
    expect(places.map((p) => [p.kind, p.name])).toEqual([
      ["shop", "Butikken på Grünerløkka"],
      ["pickup", "Post i Butikk, Rema 1000"],
    ]);
    expect(places[0].hours?.week.mon).toEqual({ open: "09:00", close: "17:00" });
  });

  it("changes and deletes a place, only the store's own", async () => {
    const { places } = await getCompany(storeId);
    const shop = places.find((p) => p.kind === "shop")!;
    expect(await saveLocation(member(storeId), shop.id, { kind: "shop", name: "Butikken", ...address })).toMatchObject({ ok: true });
    expect((await getLocation(storeId, shop.id))?.name).toBe("Butikken");

    // Another store can neither see, change nor delete it.
    expect(await getLocation(other, shop.id)).toBeNull();
    expect(await saveLocation(member(other), shop.id, { kind: "shop", name: "Mine", ...address })).toEqual({
      ok: false,
      problems: ["That place no longer exists."],
    });
    expect(await deleteLocation(member(other), shop.id)).toBe(false);

    expect(await deleteLocation(member(storeId), shop.id)).toBe(true);
    expect((await getCompany(storeId)).places.map((p) => p.kind)).toEqual(["pickup"]);
  });
});
