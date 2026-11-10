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
const { GRID_PRODUCTS_MAX } = await import("./catalog");
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
  // A new store starts with the shop alone (D178): the demo appointment, stay and rental are offered with their features on, as an owner switches them under Features.
  await db().execute(sql`update commerce.stores set features = features || array['appointments', 'bookings']::text[] where slug = ${`listing-${run}`}`);
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
    await db().execute(sql`update commerce.stores set audience = 'both', features = features || array['business'] where id = ${storeId}::uuid`);
    try {
      const both = { buyer: "private" as const, audienceBoth: true };
      expect(await find({}, {}, both)).not.toContain("demo-bordlampe");
      expect(await find({}, {}, { buyer: "business", audienceBoth: true })).toContain("demo-bordlampe");
    } finally {
      await db().execute(sql`update commerce.products set audience = 'all' where store_id = ${storeId}::uuid and handle = 'demo-bordlampe'`);
      await db().execute(sql`update commerce.stores set audience = 'consumers', features = array_remove(features, 'business') where id = ${storeId}::uuid`);
    }
  });

  it("never lists a business-only product where the store sells to consumers, Sell to businesses switched off included (D178)", async () => {
    await db().execute(sql`update commerce.products set audience = 'businesses' where store_id = ${storeId}::uuid and handle = 'demo-bordlampe'`);
    try {
      // The store's own choice is consumers: nobody sees it, whatever kind of buyer they say they are.
      expect(await find({}, {}, privateBuyer)).not.toContain("demo-bordlampe");
      expect(await find({}, {}, business)).not.toContain("demo-bordlampe");
      // Selling to both, but with the feature off: the store sells to consumers.
      await db().execute(sql`update commerce.stores set audience = 'both' where id = ${storeId}::uuid`);
      expect(await find({}, {}, { buyer: "business", audienceBoth: true })).not.toContain("demo-bordlampe");
      // On again: there for businesses.
      await db().execute(sql`update commerce.stores set features = features || array['business'] where id = ${storeId}::uuid`);
      expect(await find({}, {}, { buyer: "business", audienceBoth: true })).toContain("demo-bordlampe");
    } finally {
      await db().execute(sql`update commerce.products set audience = 'all' where store_id = ${storeId}::uuid and handle = 'demo-bordlampe'`);
      await db().execute(sql`update commerce.stores set audience = 'consumers', features = array_remove(features, 'business') where id = ${storeId}::uuid`);
    }
  });
});

describe("a listing longer than one page (code review FF1)", () => {
  /** 55 more products in the store, copies of the tote bag: with the demo's own, more than a page shows. */
  const manyProducts = async () => {
    const cols = async (table: string) => {
      const [row] = await db().execute<Row>(sql`
        select string_agg(quote_ident(column_name), ', ' order by ordinal_position) as cols from information_schema.columns
        where table_schema = 'commerce' and table_name = ${table} and is_generated = 'NEVER' and identity_generation is null
      `);
      return sql.raw(String(row.cols));
    };
    const [products, translations, variants, media] = await Promise.all(["products", "product_translations", "product_variants", "product_media"].map(cols));
    await db().transaction(async (tx) => {
      await tx.execute(sql`create temp table paged_src on commit drop as select id from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-handlenett'`);
      await tx.execute(sql`create temp table paged on commit drop as select gen_random_uuid() as id, n from generate_series(1, 55) n`);
      await tx.execute(sql`
        insert into commerce.products (${products}) select ${products} from (
          select (jsonb_populate_record(null::commerce.products, to_jsonb(p) || jsonb_build_object('id', c.id, 'handle', 'paged-' || c.n, 'status', 'draft'))).*
          from commerce.products p, paged_src s, paged c where p.id = s.id) x
      `);
      await tx.execute(sql`
        insert into commerce.product_translations (${translations}) select ${translations} from (
          select (jsonb_populate_record(null::commerce.product_translations, to_jsonb(t) || jsonb_build_object('product_id', c.id, 'title', 'Paged ' || lpad(c.n::text, 2, '0')))).*
          from commerce.product_translations t, paged_src s, paged c where t.product_id = s.id) x
      `);
      await tx.execute(sql`
        create temp table paged_v on commit drop as
        select gen_random_uuid() as id, c.id as product_id, c.n, pv.id as old from commerce.product_variants pv, paged_src s, paged c where pv.product_id = s.id
      `);
      await tx.execute(sql`
        insert into commerce.product_variants (${variants}) select ${variants} from (
          select (jsonb_populate_record(null::commerce.product_variants, to_jsonb(pv) || jsonb_build_object('id', v.id, 'product_id', v.product_id, 'sku', 'PAGED-' || v.n || '-' || left(v.id::text, 6)))).*
          from commerce.product_variants pv join paged_v v on v.old = pv.id) x
      `);
      await tx.execute(sql`select commerce.set_price(v.id, cp.market_code, cp.amount_minor) from paged_v v join commerce.current_prices cp on cp.variant_id = v.old`);
      await tx.execute(sql`
        insert into commerce.product_media (${media}) select ${media} from (
          select (jsonb_populate_record(null::commerce.product_media, to_jsonb(i) || jsonb_build_object('id', gen_random_uuid(), 'product_id', c.id))).*
          from commerce.product_media i, paged_src s, paged c where i.product_id = s.id) x
      `);
      await tx.execute(sql`update commerce.products set status = 'active' where store_id = ${storeId}::uuid and handle like 'paged-%'`);
    });
  };

  it("says how many there are in all, shows a page more each time, and never repeats or skips a product", async () => {
    await manyProducts();
    const page = (n: number, filters: Partial<ListingFilters> = {}) => listing.listingPage(storeId, no, {}, { ...NO_FILTERS, ...filters }, privateBuyer, n);

    const first = await page(1, { sort: "title" });
    expect(first.products).toHaveLength(listing.LISTING_LIMIT);
    expect(first.total).toBeGreaterThanOrEqual(55 + 5);

    const second = await page(2, { sort: "title" });
    expect(second.total).toBe(first.total);
    expect(second.products).toHaveLength(Math.min(first.total, 2 * listing.LISTING_LIMIT));
    // The second page starts with the first, in the same order, and repeats nothing.
    expect(second.products.slice(0, listing.LISTING_LIMIT).map((p) => p.id)).toEqual(first.products.map((p) => p.id));
    expect(new Set(second.products.map((p) => p.id)).size).toBe(second.products.length);

    // The count follows the filters, not the page.
    const narrowed = await page(1, { tags: ["nyhet"] });
    expect(narrowed.total).toBe(narrowed.products.length);
    expect(listing.LISTING_LIMIT * listing.LISTING_PAGES_MAX).toBe(GRID_PRODUCTS_MAX);
    // A page past the end shows everything, and the one function older callers use still gives the first page.
    expect((await page(9, { sort: "title" })).products).toHaveLength(first.total);
    expect(await listing.listingProducts(storeId, no, {}, { ...NO_FILTERS, sort: "title" }, privateBuyer)).toHaveLength(listing.LISTING_LIMIT);
  });

  it("reads the page from the address: 1 for none or nonsense, never past the most a listing shows", () => {
    expect([undefined, "", "0", "-2", "abc", "1.5"].map(listing.listingPageOf)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(listing.listingPageOf("3")).toBe(3);
    expect(listing.listingPageOf(["2", "9"])).toBe(2);
    expect(listing.listingPageOf("999")).toBe(listing.LISTING_PAGES_MAX);
  });
});
