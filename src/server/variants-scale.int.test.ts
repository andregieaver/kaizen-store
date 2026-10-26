import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseListingParams } from "@/lib/listing-filters";
import { MAX_VARIANTS, formatPriceInput, parsePrice, productInput, type ProductInput } from "@/lib/product-input";

import { addSwedish, euOperator } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { emptyProduct, getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { getProduct, getVariantStock, listGridProducts, listProducts } = await import("./catalog");
const { listingProducts } = await import("./listing");
const { searchProducts } = await import("./search");
const { changeLine, getCart } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { storeFeed } = await import("./feeds");

type Row = Record<string, unknown>;

/**
 * Variants at scale (wave 6 unit B, D320, `docs/wave-6-catalogue.md` B.2 and B.3): a product of 2,048 variants (16 colours × 16 sizes × 8 fits)
 * saves in one transaction within a time budget, first new and then with every price and stock changed, and the reads a shopper's page and the
 * store's jobs make for a product take as many statements at 2,048 variants as at 2. The budget is a few times what a save takes here, so only
 * a save that has gone back to a statement per variant breaks it.
 */
const SAVE_BUDGET_MS = 20_000;

/** Two stores copied from the same template: one holds the product of 2,048 variants, the other the same product with 2. */
let fx: Fixture;
let small: Fixture;
const operators = new Map<string, string>();
const COLOURS = Array.from({ length: 16 }, (_, i) => `Farge ${i + 1}`);
const SIZES = Array.from({ length: 16 }, (_, i) => `Str ${i + 1}`);
const FITS = Array.from({ length: 8 }, (_, i) => `Passform ${i + 1}`);

beforeAll(async () => {
  fx = await makeStore("variants-scale");
  small = await makeStore("variants-small");
  for (const f of [fx, small]) {
    await addSwedish(f);
    operators.set(f.slug, await euOperator(f));
  }
}, 180_000);

afterAll(async () => {
  await closeDb();
});

const storeOf = async (f: Fixture = fx) => (await getStore(f.slug))!;

/** A product with every combination of the options given, priced per market and in stock, as the editor sends it. */
async function product(
  handle: string,
  options: { name: string; values: string[] }[],
  price: (i: number) => number,
  stock: (i: number) => number,
  f: Fixture = fx,
) {
  const store = await storeOf(f);
  const editor = await getEditorContext(store);
  const combos = options.reduce<Record<string, string>[]>((all, o) => all.flatMap((c) => o.values.map((v) => ({ ...c, [o.name]: v }))), [{}]);
  const input = productInput.parse({
    ...emptyProduct(editor),
    handle,
    status: "active",
    translations: editor.locales.map((locale, k) => ({ locale, title: k === 0 ? `Genser ${handle}` : "", description: "", safetyInformation: "", seoTitle: "", seoDescription: "" })),
    media: [{ url: "/demo/lamp.webp", thumbnailUrl: null, alt: "" }],
    options,
    variants: combos.map((combo, i) => ({
      id: null, options: combo, sku: `${handle.toUpperCase()}-${i + 1}`, gtin: null, measure: null, cost: "", stock: stock(i), active: true,
      prices: Object.fromEntries(editor.markets.map((m) => [m.code, String(price(i))])),
      weightGrams: 300, hsCode: null, originCountry: null, delivery: "physical", rentalPeriod: "day", image: null,
    })),
    manufacturer: { id: operators.get(f.slug)! },
  });
  return { store, editor, input };
}

/** What `run` gave and how many statements the database was sent meanwhile (each goes through `pg`'s `Client.query`). */
async function counted<T>(run: () => Promise<T>): Promise<[T, number]> {
  const spy = vi.spyOn(pg.Client.prototype, "query");
  try {
    const result = await run();
    return [result, spy.mock.calls.length];
  } finally {
    spy.mockRestore();
  }
}

/** How many statements the database is sent while `run` runs. */
const statements = async (run: () => Promise<unknown>): Promise<number> => (await counted(run))[1];

/** The statements of the first save of the product of 2,048 variants, compared with the same product's of 2 below. */
let bigSave = 0;

async function timed<T>(run: () => Promise<T>): Promise<[T, number]> {
  const start = performance.now();
  const result = await run();
  return [result, performance.now() - start];
}

describe("a product of 2,048 variants", () => {
  let productId = "";

  it("is Shopify's limit, made of three options", () => {
    expect(MAX_VARIANTS).toBe(2048);
    expect(COLOURS.length * SIZES.length * FITS.length).toBe(MAX_VARIANTS);
  });

  it("saves new in one transaction within the budget, every price through set_price and every stock as an opening", async () => {
    const options = [{ name: "Farge", values: COLOURS }, { name: "Størrelse", values: SIZES }, { name: "Passform", values: FITS }];
    const { store, editor, input } = await product("stor", options, (i) => 400 + (i % 7), (i) => i % 5);
    expect(input.variants).toHaveLength(MAX_VARIANTS);
    // The editor's request is under the server actions' limit (4 MB, next.config.ts). Its JSON can pass a million characters, which React refuses
    // for a string that is itself an action's argument, so the editor sends it inside an object (`saveProductAction(…, { json })`).
    expect(new TextEncoder().encode(JSON.stringify(input)).length).toBeLessThan(4 * 1024 * 1024);
    const [[saved, count], ms] = await timed(() => counted(() => saveProduct(store, editor, null, input)));
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    productId = saved.productId;
    bigSave = count;
    expect(ms).toBeLessThan(SAVE_BUDGET_MS);
    const markets = editor.markets.length;
    const [counts] = await db().execute<Row>(sql`
      select (select count(*)::int from commerce.product_variants where product_id = ${productId}::uuid and active) as variants,
             (select count(*)::int from commerce.prices p join commerce.product_variants v on v.id = p.variant_id where v.product_id = ${productId}::uuid and p.valid_to is null) as prices,
             (select count(*)::int from commerce.inventory_movements m join commerce.product_variants v on v.id = m.variant_id where v.product_id = ${productId}::uuid and m.reason = 'opening') as openings,
             (select sum(l.on_hand)::int from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id where v.product_id = ${productId}::uuid) as on_hand
    `);
    expect(counts).toMatchObject({ variants: MAX_VARIANTS, prices: MAX_VARIANTS * markets });
    // A level of 0 is no movement (the trigger writes none for no change), so the openings are the variants with stock.
    expect(Number(counts.openings)).toBe(input.variants.filter((v) => v.stock > 0).length);
    expect(Number(counts.on_hand)).toBe(input.variants.reduce((sum, v) => sum + v.stock, 0));
  }, 120_000);

  it("saves again with every price and stock changed within the budget, keeping the price history and writing corrections", async () => {
    const store = await storeOf();
    const editor = await getEditorContext(store);
    const loaded = (await getProductForEdit(store, editor, productId))!;
    expect(loaded.variants).toHaveLength(MAX_VARIANTS);
    const changed: ProductInput = {
      ...loaded,
      variants: loaded.variants.map((v) => ({
        ...v,
        // Ten more in each market, typed as the editor shows a price ("410,00").
        prices: Object.fromEntries(Object.entries(v.prices).map(([code, value]) => [code, formatPriceInput((parsePrice(value, "NOK") ?? 0) + 1000, "NOK")])),
        stock: v.stock + 3,
      })),
    };
    const [saved, ms] = await timed(() => saveProduct(store, editor, productId, productInput.parse(changed)));
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    expect(ms).toBeLessThan(SAVE_BUDGET_MS);
    const markets = editor.markets.length;
    const [counts] = await db().execute<Row>(sql`
      select (select count(*)::int from commerce.prices p join commerce.product_variants v on v.id = p.variant_id where v.product_id = ${productId}::uuid) as prices,
             (select count(*)::int from commerce.prices p join commerce.product_variants v on v.id = p.variant_id where v.product_id = ${productId}::uuid and p.valid_to is null) as current,
             (select count(*)::int from commerce.inventory_movements m join commerce.product_variants v on v.id = m.variant_id where v.product_id = ${productId}::uuid and m.reason = 'correction') as corrections
    `);
    // The old prices are ended and kept; each variant has one current price per market, the new one.
    expect(counts).toMatchObject({ prices: 2 * MAX_VARIANTS * markets, current: MAX_VARIANTS * markets, corrections: MAX_VARIANTS });
    const again = (await getProductForEdit(store, editor, productId))!;
    expect(again.variants.map((v) => v.stock)).toEqual(changed.variants.map((v) => v.stock));
    expect(again.variants[0].prices).toEqual(changed.variants[0].prices);
  }, 120_000);

  it("switches off the variants an option value takes out, in the same save", async () => {
    const store = await storeOf();
    const editor = await getEditorContext(store);
    const loaded = (await getProductForEdit(store, editor, productId))!;
    const fits = FITS.slice(0, 4);
    const fewer: ProductInput = {
      ...loaded,
      options: loaded.options.map((o) => (o.name === "Passform" ? { ...o, values: fits } : o)),
      variants: loaded.variants.filter((v) => fits.includes(v.options.Passform)),
    };
    const saved = await saveProduct(store, editor, productId, productInput.parse(fewer));
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    const [row] = await db().execute<Row>(sql`
      select count(*) filter (where active)::int as active, count(*)::int as kept from commerce.product_variants where product_id = ${productId}::uuid
    `);
    expect(row).toMatchObject({ active: MAX_VARIANTS / 2, kept: MAX_VARIANTS });
  }, 120_000);
});

describe("the reads a shopper's page and the store's jobs make", () => {
  /** Every read of one store's product, with the statements it took. */
  async function readsOf(f: Fixture, handle: string, variantSku: string) {
    const store = await storeOf(f);
    const market = store.markets[0];
    const shop = { storeId: store.id, market };
    const viewer = { buyer: "private" as const, audienceBoth: false };
    const detail = (await getProduct(store.id, market, handle))!;
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.id}::uuid and sku = ${variantSku}`);
    const ids = detail.variants.map((v) => v.id);
    jar.clear();
    return {
      variants: detail.variants.length,
      counts: {
        product: await statements(() => getProduct(store.id, market, handle)),
        stock: await statements(() => getVariantStock(store.id, ids)),
        card: await statements(() => listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "newest", limit: 48, ids: [detail.id] })),
        listing: await statements(() => listingProducts(store.id, market, {}, parseListingParams({ q: undefined }), viewer)),
        search: await statements(() => searchProducts(shop, `Genser ${handle}`, null, null)),
        add: await statements(() => changeLine(shop, String(variant.id), 1, "add")),
        cart: await statements(async () => cartSummary(shop, await getCart(shop))),
        feed: await statements(() => storeFeed(store, market)),
        list: await statements(() => listProducts(store.id, market)),
      },
    };
  }

  it("take as many statements for a product of 2,048 variants as for one of 2", async () => {
    // The same product in the other store, with 2 variants for sale (the one above has 2,048 made, half of them for sale now).
    const { store, editor, input } = await product("stor", [{ name: "Farge", values: ["Farge 1", "Farge 2"] }], () => 300, () => 4, small);
    // The save too: as many statements for 2 variants as for 2,048 (the save that wrote one per variant broke this, not the budget alone).
    const [saved, count] = await counted(() => saveProduct(store, editor, null, input));
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    expect(count).toBe(bigSave);
    const big = await readsOf(fx, "stor", "STOR-1");
    const few = await readsOf(small, "stor", "STOR-1");
    expect(big.variants).toBe(MAX_VARIANTS / 2);
    expect(few.variants).toBe(2);
    expect(big.counts).toEqual(few.counts);
  }, 120_000);
});
