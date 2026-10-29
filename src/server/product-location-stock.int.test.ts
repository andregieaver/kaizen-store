import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

/**
 * Stock per location in the product editor (wave 12 unit C, D397): with several active locations the editor reads each variant's level at
 * each and the save writes only the figures the person changed, as typed, so a sale paid since the editor opened stays paid; a new variant
 * opens at the locations it was given; another store's location is never written.
 */
const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { addLocation, clearLevels, levelsOf, mainLocation, movementsOf, newStore, setLevel } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
const SKU = "DEMO-TOTE";
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let oslo: string;
let bergen: string;

beforeAll(async () => {
  store = await newStore("location-stock");
  other = await newStore("location-stock-other");
  oslo = await mainLocation(store.storeId);
  bergen = await addLocation(store.storeId, "Bergen", 1);
});

afterAll(async () => {
  await closeDb();
});

async function open() {
  const live = (await getStore(store.slug))!;
  const editor = await getEditorContext(live);
  const [row] = await db().execute<Row>(sql`
    select p.id from commerce.products p join commerce.product_variants v on v.product_id = p.id where p.store_id = ${store.storeId}::uuid and v.sku = ${SKU}
  `);
  const id = String(row.id);
  const { archived, ...input } = (await getProductForEdit(live, editor, id))!;
  void archived;
  return { live, editor, id, input };
}

describe("stock at each location in the product editor", () => {
  it("lists the active locations and reads each variant's level at each", async () => {
    await clearLevels(store.storeId, SKU);
    await setLevel(store.storeId, SKU, oslo, 6);
    await setLevel(store.storeId, SKU, bergen, 2);
    const { editor, input } = await open();
    expect(editor.locations.map((l) => l.name)).toEqual(["Lager Oslo", "Bergen"]);
    const variant = input.variants.find((v) => v.sku === SKU)!;
    expect(variant.stock).toBe(8);
    expect(variant.locationStock).toEqual([
      { locationId: oslo, onHand: 6, loaded: 6 },
      { locationId: bergen, onHand: 2, loaded: 2 },
    ]);
  });

  it("writes only the location the person changed, as typed, and leaves a sale since the editor opened paid", async () => {
    const { live, editor, id, input } = await open();
    const variant = input.variants.find((v) => v.sku === SKU)!;
    // A sale at Oslo completes after the editor read the levels.
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand - 1 where store_id = ${store.storeId}::uuid and location_id = ${oslo}::uuid and variant_id = ${variant.id}::uuid`);
    variant.locationStock = variant.locationStock!.map((a) => (a.locationId === bergen ? { ...a, onHand: 9 } : a));
    expect(await saveProduct(live, editor, id, input)).toMatchObject({ ok: true });
    expect(await levelsOf(store.storeId, SKU)).toEqual({ "Lager Oslo": 5, Bergen: 9 });
    const [last] = (await movementsOf(store.storeId, SKU)).slice(-1);
    expect(last).toMatchObject({ location: "Bergen", delta: 7, after: 9, reason: "correction", source: "editor" });
  });

  it("saves nothing to the levels when no figure changed", async () => {
    const before = (await movementsOf(store.storeId, SKU)).length;
    const { live, editor, id, input } = await open();
    expect(await saveProduct(live, editor, id, input)).toMatchObject({ ok: true });
    expect((await movementsOf(store.storeId, SKU)).length).toBe(before);
  });

  it("opens a new variant at the locations it was given", async () => {
    const { live, editor, id, input } = await open();
    const base = input.variants.find((v) => v.sku === SKU)!;
    input.variants.push({
      ...base,
      id: null,
      sku: "DEMO-TOTE-XL",
      options: Object.fromEntries(Object.entries(base.options).map(([k]) => [k, "XL"])),
      stock: 4,
      locationStock: [
        { locationId: oslo, onHand: 0, loaded: 0 },
        { locationId: bergen, onHand: 4, loaded: 0 },
      ],
    });
    if (input.options.length > 0) input.options = input.options.map((o) => ({ ...o, values: [...o.values, "XL"] }));
    const saved = await saveProduct(live, editor, id, input);
    expect(saved).toMatchObject({ ok: true });
    expect(await levelsOf(store.storeId, "DEMO-TOTE-XL")).toEqual({ Bergen: 4 });
  });

  it("never writes a location of another store", async () => {
    const { live, editor, id, input } = await open();
    const theirs = await mainLocation(other.storeId);
    const variant = input.variants.find((v) => v.sku === SKU)!;
    variant.locationStock = [...variant.locationStock!, { locationId: theirs, onHand: 50, loaded: 0 }];
    expect(await saveProduct(live, editor, id, input)).toMatchObject({ ok: true });
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_levels where location_id = ${theirs}::uuid and variant_id = ${variant.id}::uuid`);
    expect(Number(row.n)).toBe(0);
  });
});
