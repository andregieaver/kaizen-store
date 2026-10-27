import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { seedProducts } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { csvContextFor } = await import("./product-data");
const { taxonomySearch } = await import("./product-taxonomy");
const { searchCategories } = await import("@/lib/product-taxonomy");
const { listingFacets, listingProducts } = await import("./listing");
const { getProduct } = await import("./catalog");
const { parseListingParams } = await import("@/lib/listing-filters");

type Row = Record<string, unknown>;

/**
 * A product's standard category and attributes (wave 6 unit I, D327, `docs/wave-6-catalogue.md` I.2, I.3): saved with the product, checked
 * against the release, kept by a save that leaves them out, carried by a store made from this one, read from a Shopify CSV cell, and found
 * by the editor's search in Norwegian.
 */

let fx: Fixture;
let products: { id: string; handle: string }[];

beforeAll(async () => {
  fx = await makeStore("taxonomy");
  products = await seedProducts(fx, 2, { prefix: "TAXO" });
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const editorOf = async () => {
  const store = (await getStore(fx.slug))!;
  return { store, editor: await getEditorContext(store) };
};
const stored = async (id: string) =>
  (await db().execute<Row>(sql`select standard_category, standard_attributes from commerce.products where store_id = ${fx.storeId}::uuid and id = ${id}::uuid`))[0];

describe("a product's standard category", () => {
  it("is saved with its attributes, in a stable order", async () => {
    const { store, editor } = await editorOf();
    const input = (await getProductForEdit(store, editor, products[0].id))!;
    expect(input.standardCategory).toBeNull();
    input.standardCategory = "aa-1-1";
    input.standardAttributes = { "3": [24478], "1": [2, 1] };
    expect(await saveProduct(store, editor, products[0].id, input)).toMatchObject({ ok: true });
    expect(await stored(products[0].id)).toEqual({ standard_category: "aa-1-1", standard_attributes: { "1": [1, 2], "3": [24478] } });
    const read = (await getProductForEdit(store, editor, products[0].id))!;
    expect(read.standardCategory).toBe("aa-1-1");
    expect(read.standardAttributes).toEqual({ "1": [1, 2], "3": [24478] });
  });

  it("refuses a category the release does not know, an attribute of another category and a value of another attribute", async () => {
    const { store, editor } = await editorOf();
    const input = (await getProductForEdit(store, editor, products[1].id))!;
    const tryWith = async (category: string | null, attributes: Record<string, number[]>) =>
      saveProduct(store, editor, products[1].id, { ...input, standardCategory: category, standardAttributes: attributes });
    expect(await tryWith("aa-999", {})).toMatchObject({ ok: false, problems: [expect.stringMatching(/not in the taxonomy/)] });
    expect(await tryWith("aa-1-1", { "4": [1] })).toMatchObject({ ok: false, problems: [expect.stringMatching(/not one of this category's/)] });
    expect(await tryWith("aa-1-1", { "1": [24478] })).toMatchObject({ ok: false, problems: [expect.stringMatching(/not one of attribute 1's/)] });
    expect(await tryWith(null, { "1": [1] })).toMatchObject({ ok: true });
    // Without a category it keeps no attributes.
    expect(await stored(products[1].id)).toEqual({ standard_category: null, standard_attributes: {} });
  });

  it("is kept by a save that leaves it out (an import without the column, an older editor)", async () => {
    const { store, editor } = await editorOf();
    const input = (await getProductForEdit(store, editor, products[0].id))!;
    const { standardCategory: _c, standardAttributes: _a, ...rest } = input;
    void _c;
    void _a;
    expect(await saveProduct(store, editor, products[0].id, rest)).toMatchObject({ ok: true });
    expect((await stored(products[0].id)).standard_category).toBe("aa-1-1");
  });

  it("is carried by a store made from this one", async () => {
    const [cloned] = await db().execute<Row>(sql`select commerce.clone_store(${fx.storeId}::uuid, ${`${fx.slug}-clone`}, 'Clone', ${fx.ownerId}::uuid) as id`);
    const [copy] = await db().execute<Row>(sql`
      select standard_category, standard_attributes from commerce.products where store_id = ${String(cloned.id)}::uuid and handle = ${products[0].handle}`);
    expect(copy).toEqual({ standard_category: "aa-1-1", standard_attributes: { "1": [1, 2], "3": [24478] } });
  });

  it("is read from Shopify's Product Category cell and written as its English path", async () => {
    const { store, editor } = await editorOf();
    const ctx = await csvContextFor(store, editor);
    expect(ctx.standard!.resolve("Apparel & Accessories > Clothing > Activewear")).toMatchObject({ id: "aa-1-1" });
    expect(ctx.standard!.resolve("gid://shopify/TaxonomyCategory/hg-11-6-2-6")?.id).toBe("hg-11-6-2-6");
    expect(ctx.standard!.resolve("Things > Stuff")).toBeNull();
    expect(ctx.standard!.path("aa-1-1")).toBe("Apparel & Accessories > Clothing > Activewear");
  });

  it("is found by the editor's search in Norwegian", async () => {
    const hits = searchCategories(await taxonomySearch("nb-NO"), "kaffekvern");
    expect(hits[0]).toMatchObject({ id: "hg-11-6-2-6", name: "Kaffekverner" });
  });

  it("filters a listing by an attribute's handle and offers the attributes the page's products carry, named in the shopper's language", async () => {
    const store = (await getStore(fx.slug))!;
    const market = store.markets.find((m) => m.code === "NO")!;
    const viewer = { buyer: "private" as const, audienceBoth: false };
    const ids = (filters: string) =>
      listingProducts(fx.storeId, market, {}, parseListingParams(new URLSearchParams(filters)), viewer).then((rows) => rows.map((p) => p.id));
    // Product 0 is Activewear, black and blue (values 1 and 2 of Color), Animal pattern; product 1 has none.
    expect(await ids("t.color=blue")).toEqual([products[0].id]);
    expect(await ids("t.color=blue&t.color=red")).toEqual([products[0].id]);
    expect(await ids("t.color=red")).toEqual([]);
    // An attribute or value the release does not know is dropped: the page is as without it.
    expect((await ids("t.nothing=blue")).sort()).toEqual((await ids("")).sort());
    const facets = await listingFacets(fx.storeId, market, {}, viewer);
    const color = facets.attributes.find((a) => a.name === "color")!;
    expect(color.label).toBe("Farge");
    expect(color.values.map((v) => [v.value, v.count])).toEqual(expect.arrayContaining([["black", 1], ["blue", 1]]));
    expect(facets.attributeLabels.find((a) => a.name === "pattern")?.values.animal).toBeTruthy();
  });

  it("gives the product page its path for the structured data and the feeds Google's category and colours in English", async () => {
    const store = (await getStore(fx.slug))!;
    const market = store.markets.find((m) => m.code === "NO")!;
    const product = (await getProduct(fx.storeId, market, products[0].handle))!;
    expect(product.standard).toEqual({
      id: "aa-1-1",
      path: "Klær og tilbehør > Klesplagg > Treningsklær",
      google: 5322,
      english: { color: ["Black", "Blue"], pattern: ["Animal"] },
    });
    expect((await getProduct(fx.storeId, market, products[1].handle))!.standard).toBeNull();
  });
});
