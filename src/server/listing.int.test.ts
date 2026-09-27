import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { NO_FILTERS, type ListingFilters } from "@/lib/listing-filters";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
// 'use cache' needs Next's cache outside a request: run the functions as they are.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {} }));

const listing = await import("./listing");
type Viewer = import("./listing").Viewer;

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const privateBuyer = { buyer: "private" as const, audienceBoth: false };
const business = { buyer: "business" as const, audienceBoth: false };
let storeId: string;

beforeAll(async () => {
  // A store copied from the template, with its demo product of every kind.
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`listing-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`listing-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
});

afterAll(async () => {
  await closeDb();
});

const demo = (handles: (string | undefined)[]) => handles.filter((h) => h?.startsWith("demo-"));
const find = async (filters: Partial<ListingFilters>, scope: { ids?: string[] } = {}, viewer: Viewer = privateBuyer) =>
  demo((await listing.listingProducts(storeId, no, scope, { ...NO_FILTERS, ...filters }, viewer)).map((p) => p.handle));

describe("product listings' sort and filters (D78)", () => {
  it("filters by kinds, variant options on one variant, price, stock and the store's terms", async () => {
    expect((await find({ kinds: ["stay", "rental"] })).sort()).toEqual(["demo-hytte", "demo-sykkelutleie"]);
    expect(await find({ options: [{ name: "colour", values: ["white"] }] })).toEqual(["demo-keramikkopp"]);
    // Options on different products, or a value no variant has, find nothing together.
    expect(await find({ options: [{ name: "colour", values: ["white"] }, { name: "ruling", values: ["lined"] }] })).toEqual([]);
    // A rental's period is one of its options.
    expect(await find({ options: [{ name: "rental", values: ["halfDay"] }] })).toEqual(["demo-sykkelutleie"]);
    // Any variant in the range: the bike by the hour is 120 kr.
    expect((await find({ maxPrice: 200 })).sort()).toEqual(["demo-handlenett", "demo-notatbok", "demo-sykkelutleie"]);
    expect(await find({ minPrice: 1000 })).toEqual(["demo-hytte"]);
    // The lamp has none in stock; bookings count as available.
    const inStock = await find({ inStock: true });
    expect(inStock).not.toContain("demo-bordlampe");
    expect(inStock).toContain("demo-hytte");
    expect((await find({ categories: ["hjem"] })).sort()).toEqual(["demo-bordlampe", "demo-keramikkopp"]);
    expect((await find({ tags: ["nyhet"] })).sort()).toEqual(["demo-handlenett", "demo-notatbok"]);
  });

  it("compares prices as the shopper sees them: without VAT for a business", async () => {
    // The cabin is 1 450 kr with VAT, under 1 300 kr without it.
    expect(await find({ minPrice: 1300 }, {}, privateBuyer)).toEqual(["demo-hytte"]);
    expect(await find({ minPrice: 1300 }, {}, business)).toEqual([]);
    const facets = await listing.listingFacets(storeId, no, {}, business);
    expect(facets.price!.max).toBeLessThan(1450);
  });

  it("sorts by price, name and newest, and keeps search results' own order", async () => {
    const byPrice = await find({ sort: "priceHigh" });
    expect(byPrice[0]).toBe("demo-hytte");
    expect((await find({ sort: "priceLow" }))[0]).toBe("demo-sykkelutleie");
    const [cup, lamp] = await Promise.all(
      ["demo-keramikkopp", "demo-bordlampe"].map(async (handle) => {
        const [row] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = ${handle}`);
        return String(row.id);
      }),
    );
    expect(await find({}, { ids: [cup, lamp] })).toEqual(["demo-keramikkopp", "demo-bordlampe"]);
    expect(await find({}, { ids: [lamp, cup] })).toEqual(["demo-bordlampe", "demo-keramikkopp"]);
    expect(await find({ sort: "priceLow" }, { ids: [lamp, cup] })).toEqual(["demo-keramikkopp", "demo-bordlampe"]);
  });

  it("offers only choices that narrow the page, with counts and the price range", async () => {
    const facets = await listing.listingFacets(storeId, no, {}, privateBuyer, { colour: "Farge", white: "Hvit" });
    expect(facets.kinds.map((kind) => kind.kind).sort()).toEqual(["appointment", "goods", "rental", "stay"]);
    expect(facets.kinds.find((kind) => kind.kind === "stay")?.count).toBe(1);
    const colour = facets.options.find((option) => option.name === "colour")!;
    expect(colour.label).toBe("Farge");
    expect(colour.values).toEqual([
      { value: "black", label: "black", count: 1 },
      { value: "white", label: "Hvit", count: 1 },
    ]);
    // Hjem holds the mug, and the lamp through Belysning below it.
    expect(facets.categories.find((category) => category.value === "hjem")).toMatchObject({ count: 2, depth: 0 });
    expect(facets.categories.find((category) => category.value === "belysning")).toMatchObject({ count: 1, depth: 1 });
    expect(facets.tags.find((tag) => tag.value === "nyhet")?.count).toBe(2);
    expect(facets.price).toEqual({ min: 120, max: 1450 });

    // Within one category, the category itself narrows nothing and is not offered.
    const [hjem] = await db().execute<Row>(sql`
      select id from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and slug = 'hjem'
    `);
    const [belysning] = await db().execute<Row>(sql`
      select id from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and slug = 'belysning'
    `);
    const inHome = await listing.listingFacets(storeId, no, { categoryIds: [String(hjem.id), String(belysning.id)] }, privateBuyer);
    expect(inHome.total).toBe(2);
    expect(inHome.categories.map((category) => category.value)).toEqual(["belysning"]);
    expect(inHome.kinds).toEqual([]);
  });

  it("in a store selling to both, shows each kind of buyer only their products", async () => {
    await db().execute(sql`update commerce.products set audience = 'businesses' where store_id = ${storeId}::uuid and handle = 'demo-bordlampe'`);
    try {
      const both = { buyer: "private" as const, audienceBoth: true };
      expect(await find({}, {}, both)).not.toContain("demo-bordlampe");
      expect(await find({}, {}, { buyer: "business", audienceBoth: true })).toContain("demo-bordlampe");
    } finally {
      await db().execute(sql`update commerce.products set audience = 'all' where store_id = ${storeId}::uuid and handle = 'demo-bordlampe'`);
    }
  });
});
