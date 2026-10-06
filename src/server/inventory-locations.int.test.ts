import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { LOCATIONS_MAX } from "@/lib/inventory";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { deactivateLocation, listLocations, moveLocation, reactivateLocation, saveLocation } = await import("./inventory-locations");
const { locationImpact } = await import("./inventory");
const { variantStockOf } = await import("./catalog");
const support = await import("./inventory-test-support");
const { clearLevels, mainLocation, newStore, place, setLevel, variantId } = support;

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let oslo: string;

beforeAll(async () => {
  store = await newStore("locations");
  other = await newStore("locations-other");
  oslo = await mainLocation(store.storeId);
});

afterAll(async () => {
  await closeDb();
});

const names = async () => (await listLocations(store.storeId)).map((l) => `${l.name}${l.active ? "" : " (off)"}`);
const staff = () => ({ ...store.member, role: "admin" as const, permissions: null });
const stockOf = async (sku: string) => (await variantStockOf(db(), store.storeId, [await variantId(store.storeId, sku)])).get(await variantId(store.storeId, sku))!;

describe("adding, renaming and ranking locations", () => {
  it("adds a location last in the rank and renames or moves it", async () => {
    const bergen = await saveLocation(store.member, { name: "Bergen", country: "no" });
    const trondheim = await saveLocation(store.member, { name: "Trondheim", country: "NO" });
    if (!bergen.ok || !trondheim.ok) throw new Error("not added");
    expect(await names()).toEqual(["Lager Oslo", "Bergen", "Trondheim"]);
    expect((await listLocations(store.storeId)).map((l) => l.priority)).toEqual([0, 1, 2]);
    expect(await moveLocation(store.member, trondheim.id, "up")).toEqual({ ok: true });
    expect(await names()).toEqual(["Lager Oslo", "Trondheim", "Bergen"]);
    // The priorities are 1..n, the active locations first.
    expect((await listLocations(store.storeId)).map((l) => l.priority)).toEqual([1, 2, 3]);
    // Past an end: nothing changes.
    expect(await moveLocation(store.member, oslo, "up")).toEqual({ ok: true });
    expect(await names()).toEqual(["Lager Oslo", "Trondheim", "Bergen"]);
    expect(await saveLocation(store.member, { name: "Bergen lager", country: "NO" }, bergen.id)).toEqual({ ok: true, id: bergen.id });
    expect((await names()).at(-1)).toBe("Bergen lager");
  });

  it("refuses two active locations with one name, a bad name or country, and more than the most", async () => {
    expect(await saveLocation(store.member, { name: "  lager OSLO ", country: "NO" })).toEqual({ ok: false, problem: "Another active location already has this name." });
    expect(await saveLocation(store.member, { name: "", country: "NO" })).toMatchObject({ ok: false });
    expect(await saveLocation(store.member, { name: "x".repeat(61), country: "NO" })).toMatchObject({ ok: false });
    expect(await saveLocation(store.member, { name: "Nowhere", country: "ZZ" })).toEqual({ ok: false, problem: "Choose a country." });
    const have = (await listLocations(store.storeId)).length;
    for (let i = have; i < LOCATIONS_MAX; i++) expect(await saveLocation(store.member, { name: `Extra ${i}`, country: "NO" })).toMatchObject({ ok: true });
    expect(await saveLocation(store.member, { name: "One too many", country: "NO" })).toEqual({ ok: false, problem: `A store has at most ${LOCATIONS_MAX} stock locations.` });
    expect((await listLocations(store.storeId)).length).toBe(LOCATIONS_MAX);
  });

  it("is for members who write products, and never touches another store's location", async () => {
    const reader = { ...store.member, role: "admin" as const, permissions: ["products:read"] };
    expect(await saveLocation(reader, { name: "Nope", country: "NO" })).toEqual({ ok: false, problem: "You do not have access to this." });
    const theirs = await mainLocation(other.storeId);
    expect(await saveLocation(store.member, { name: "Mine now", country: "NO" }, theirs)).toEqual({ ok: false, problem: "This location is not in this store." });
    expect(await moveLocation(store.member, theirs, "down")).toEqual({ ok: false, problem: "This location is not in this store." });
    expect((await listLocations(other.storeId))[0].name).toBe("Lager Oslo");
  });
});

describe("switching a location off and on", () => {
  it("is the owner's alone", async () => {
    expect(await deactivateLocation(staff(), oslo, 0)).toEqual({ ok: false, problem: "You do not have access to this." });
    expect(await reactivateLocation(staff(), oslo)).toEqual({ ok: false, problem: "You do not have access to this." });
  });

  it("reports what stops being for sale, asks for the figure it showed, and takes the stock off sale", async () => {
    const bergen = (await listLocations(store.storeId)).find((l) => l.name === "Bergen lager")!.id;
    await clearLevels(store.storeId, "DEMO-TOTE");
    await db().execute(sql`update commerce.inventory_reservations set released_at = now() where store_id = ${store.storeId}::uuid and released_at is null`);
    await setLevel(store.storeId, "DEMO-TOTE", oslo, 5);
    await setLevel(store.storeId, "DEMO-TOTE", bergen, 4);
    await setLevel(store.storeId, "DEMO-MUG-WHITE", bergen, 3);
    expect((await stockOf("DEMO-TOTE")).inStock).toBe(9);
    const impact = (await locationImpact(db(), store.storeId, bergen))!;
    expect(impact).toMatchObject({ units: 7, variants: 2, committedUnits: 0 });
    // A figure that is not the one the dialog showed is refused, with the new one.
    const stale = await deactivateLocation(store.member, bergen, 6);
    expect(stale).toMatchObject({ ok: false, impact: { units: 7 } });
    expect((await listLocations(store.storeId)).find((l) => l.id === bergen)!.active).toBe(true);

    const done = await deactivateLocation(store.member, bergen, 7);
    if (!done.ok) throw new Error(done.problem);
    expect(done.notice).toBe("7 units across 2 variants are no longer for sale; reactivate the location to sell them again.");
    // The shop sells the sum of the active locations only.
    expect((await stockOf("DEMO-TOTE")).inStock).toBe(5);
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'products.location_deactivated'`);
    expect(entry.details).toMatchObject({ units: 7, variants: 2 });
    const listed = (await listLocations(store.storeId)).find((l) => l.id === bergen)!;
    expect(listed.active).toBe(false);
    expect(listed.deactivatedAt).not.toBeNull();
    // Stock is still counted and can be changed there; reactivating restores sale at once.
    const back = await reactivateLocation(store.member, bergen);
    expect(back).toMatchObject({ ok: true, impact: { units: 7 } });
    expect((await stockOf("DEMO-TOTE")).inStock).toBe(9);
    expect((await listLocations(store.storeId)).find((l) => l.id === bergen)!.deactivatedAt).toBeNull();
  });

  it("is refused while checkouts in progress hold stock there", async () => {
    const trondheim = (await listLocations(store.storeId)).find((l) => l.name === "Trondheim")!.id;
    await db().execute(sql`update commerce.inventory_reservations set released_at = now() where store_id = ${store.storeId}::uuid and released_at is null`);
    await clearLevels(store.storeId, "DEMO-MUG-BLACK");
    await setLevel(store.storeId, "DEMO-MUG-BLACK", trondheim, 2);
    // Oslo and Bergen have none of it: the order is held at Trondheim.
    await place(store.storeId, [["DEMO-MUG-BLACK", 2]]);
    const refused = await deactivateLocation(store.member, trondheim, 2);
    expect(refused).toMatchObject({ ok: false, problem: "2 units are held by checkouts in progress; try again in a few minutes." });
    expect((await listLocations(store.storeId)).find((l) => l.id === trondheim)!.active).toBe(true);
  });

  it("is refused for the last active location, and a name an active location has stops a reactivation", async () => {
    // Everything but Oslo off.
    await db().execute(sql`update commerce.inventory_reservations set released_at = now() where store_id = ${store.storeId}::uuid and released_at is null`);
    const others = (await listLocations(store.storeId)).filter((l) => l.id !== oslo && l.active);
    for (const location of others) expect((await deactivateLocation(store.member, location.id, (await locationImpact(db(), store.storeId, location.id))!.units)).ok).toBe(true);
    const last = await deactivateLocation(store.member, oslo, (await locationImpact(db(), store.storeId, oslo))!.units);
    expect(last).toMatchObject({ ok: false, problem: expect.stringContaining("at least one active stock location") });
    expect((await listLocations(store.storeId)).find((l) => l.id === oslo)!.active).toBe(true);
    // An active location now called "Bergen lager" (the only one is renamed) blocks the old one from coming back under that name.
    const old = others.find((l) => l.name === "Bergen lager")!;
    expect(await saveLocation(store.member, { name: "Bergen lager", country: "NO" }, oslo)).toMatchObject({ ok: true });
    expect(await reactivateLocation(store.member, old.id)).toEqual({ ok: false, problem: "Another active location already has this name. Rename one of them first." });
  });

  it("never lets one store's owner switch another store's location", async () => {
    const theirs = await mainLocation(other.storeId);
    expect(await deactivateLocation(store.member, theirs, 0)).toEqual({ ok: false, problem: "This location is not in this store." });
    expect(await reactivateLocation(store.member, theirs)).toMatchObject({ ok: false });
    expect((await listLocations(other.storeId))[0].active).toBe(true);
  });
});
