import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { seedProducts } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { sellableQuantity } = await import("./cart");
const { listingProducts } = await import("./listing");
const { NO_FILTERS } = await import("@/lib/listing-filters");

type Row = Record<string, unknown>;

/**
 * What a store does not sell in one of its countries (wave 7 unit A1, D335, `docs/wave-7-storefront.md` A.1): a product or a variant switched off in a
 * market keeps its price, is left out of `commerce.current_prices` there (so the listing does not show it and the cart refuses it), is kept in
 * `commerce.kept_prices` for the editor, is kept by a save that leaves it out, and is carried by a store made from this one.
 */

let fx: Fixture;
let products: { id: string; handle: string; skus: string[] }[];

beforeAll(async () => {
  fx = await makeStore("availability");
  products = await seedProducts(fx, 2, { prefix: "AVAIL", variants: 2 });
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const editorOf = async () => {
  const store = (await getStore(fx.slug))!;
  return { store, editor: await getEditorContext(store) };
};
const pricedIn = async (view: "current_prices" | "kept_prices", market: string, productId: string) =>
  (
    await db().execute<Row>(sql`
      select v.sku from commerce.${sql.raw(view)} c join commerce.product_variants v on v.id = c.variant_id
      where v.product_id = ${productId}::uuid and c.market_code = ${market} order by v.sku
    `)
  ).map((r) => String(r.sku));

/** Gives the product a Swedish price on every variant and the availability asked for, through the editor's own save. */
async function save(productId: string, availability: { off: string[]; variants: Record<string, string[]> } | undefined) {
  const { store, editor } = await editorOf();
  const input = (await getProductForEdit(store, editor, productId))!;
  input.variants = input.variants.map((v) => ({ ...v, prices: { ...v.prices, SE: "149,00" } }));
  if (availability === undefined) delete (input as { availability?: unknown }).availability;
  else input.availability = availability;
  return saveProduct(store, editor, productId, input);
}

describe("a product switched off in a country", () => {
  it("keeps its price there, is left out of the shopper's prices and kept in the editor's", async () => {
    expect(await save(products[0].id, { off: ["SE"], variants: {} })).toMatchObject({ ok: true });
    expect(await pricedIn("current_prices", "SE", products[0].id)).toEqual([]);
    expect(await pricedIn("kept_prices", "SE", products[0].id)).toEqual(products[0].skus);
    expect(await pricedIn("current_prices", "NO", products[0].id)).toEqual(products[0].skus);
    const { store, editor } = await editorOf();
    const read = (await getProductForEdit(store, editor, products[0].id))!;
    expect(read.availability).toEqual({ off: ["SE"], variants: {} });
    expect(read.variants.every((v) => v.prices.SE === "149,00")).toBe(true);
  });

  it("is not listed and cannot be put in a cart in that country, and is in its others", async () => {
    const store = (await getStore(fx.slug))!;
    const se = store.markets.find((m) => m.code === "SE")!;
    const no = store.markets.find((m) => m.code === "NO")!;
    const viewer = { buyer: "private" as const, audienceBoth: false };
    const listed = async (market: typeof se) => (await listingProducts(fx.storeId, market, {}, NO_FILTERS, viewer)).map((p) => p.id);
    expect(await listed(se)).not.toContain(products[0].id);
    expect(await listed(no)).toContain(products[0].id);
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where product_id = ${products[0].id}::uuid order by sku limit 1`);
    const sellable = (market: typeof se) => db().transaction((tx) => sellableQuantity(tx, { storeId: fx.storeId, market } as never, String(variant.id), null, null, 1));
    expect(await sellable(se)).toBeNull();
    expect(await sellable(no)).not.toBeNull();
  });

  it("switches one variant off on its own, and is kept by a save that leaves it out", async () => {
    const [first, second] = products[1].skus;
    expect(await save(products[1].id, { off: [], variants: { [second]: ["NO"] } })).toMatchObject({ ok: true });
    expect(await pricedIn("current_prices", "NO", products[1].id)).toEqual([first]);
    expect(await pricedIn("current_prices", "SE", products[1].id)).toEqual([first, second]);
    expect(await save(products[1].id, undefined)).toMatchObject({ ok: true });
    const { store, editor } = await editorOf();
    expect((await getProductForEdit(store, editor, products[1].id))!.availability).toEqual({ off: [], variants: { [second]: ["NO"] } });
    // Back on: the price was never gone.
    expect(await save(products[1].id, { off: [], variants: {} })).toMatchObject({ ok: true });
    expect(await pricedIn("current_prices", "NO", products[1].id)).toEqual([first, second]);
  });

  it("refuses a country the store does not sell to, a SKU the product does not have, and another product's variant", async () => {
    expect(await save(products[1].id, { off: ["US"], variants: {} })).toMatchObject({ ok: false, problems: [expect.stringMatching(/not one the store sells to/)] });
    expect(await save(products[1].id, { off: [], variants: { "NO-SUCH": ["SE"] } })).toMatchObject({ ok: false, problems: [expect.stringMatching(/NO-SUCH/)] });
    const [other] = await db().execute<Row>(sql`select id from commerce.product_variants where product_id = ${products[0].id}::uuid limit 1`);
    await expect(
      db().execute(sql`
        insert into commerce.market_availability (store_id, product_id, variant_id, market_code)
        values (${fx.storeId}::uuid, ${products[1].id}::uuid, ${String(other.id)}::uuid, 'NO')
      `),
    ).rejects.toThrow();
  });

  it("is carried by a store made from this one", async () => {
    const [cloned] = await db().execute<Row>(sql`select commerce.clone_store(${fx.storeId}::uuid, ${`${fx.slug}-clone`}, 'Clone', ${fx.ownerId}::uuid) as id`);
    const copied = await db().execute<Row>(sql`
      select p.handle, a.market_code, a.variant_id is null as whole
      from commerce.market_availability a join commerce.products p on p.id = a.product_id
      where a.store_id = ${String(cloned.id)}::uuid
    `);
    expect(copied).toEqual([{ handle: products[0].handle, market_code: "SE", whole: true }]);
  });
});
