import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { getEditorContext, getProductForEdit, saveProduct } = await import("./products");
const { getStore } = await import("./stores");
const { quoteCart } = await import("./wordpress-shop");
const { mainLocation, newStore, setLevel, variantId } = await import("./inventory-test-support");

/**
 * Price breaks (wave 6 unit E2, D323): the editor's save writes them as typed and reads them back, refuses what the database would, and the
 * WordPress quote prices a line at the break its quantity reaches, as the store's cart does.
 */
let storeId: string;
let slug: string;
let productId: string;
const MUG = "DEMO-MUG-WHITE";

beforeAll(async () => {
  const made = await newStore("price-breaks");
  storeId = made.storeId;
  slug = made.slug;
  await setLevel(storeId, MUG, await mainLocation(storeId), 100);
  const [row] = await db().execute<Record<string, unknown>>(sql`select product_id from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${MUG}`);
  productId = String(row.product_id);
});

afterAll(async () => {
  await closeDb();
});

describe("a product's price breaks (D323)", () => {
  it("are saved from the editor as typed and read back the same", async () => {
    const store = (await getStore(slug))!;
    const editor = await getEditorContext(store);
    const input = (await getProductForEdit(store, editor, productId))!;
    input.priceBreaks = [
      { variantSku: null, from: 5, percent: 10, prices: {} },
      { variantSku: MUG, from: 10, percent: null, prices: { NO: "90,00" } },
    ];
    expect(await saveProduct(store, editor, productId, input)).toMatchObject({ ok: true });
    const again = (await getProductForEdit(store, editor, productId))!;
    expect(again.priceBreaks).toEqual([
      { variantSku: null, from: 5, percent: 10, prices: {} },
      { variantSku: MUG, from: 10, percent: null, prices: { NO: "90,00" } },
    ]);
    const kept = await db().execute<Record<string, unknown>>(sql`
      select from_quantity, percent, amounts from commerce.price_breaks where store_id = ${storeId}::uuid and product_id = ${productId}::uuid order by from_quantity
    `);
    expect(kept.map((r) => ({ from: Number(r.from_quantity), percent: r.percent === null ? null : Number(r.percent), amounts: r.amounts }))).toEqual([
      { from: 5, percent: 10, amounts: null },
      { from: 10, percent: null, amounts: { NO: 9000 } },
    ]);
  });

  it("refuses a break without a price or with two at one quantity", async () => {
    const store = (await getStore(slug))!;
    const editor = await getEditorContext(store);
    const input = (await getProductForEdit(store, editor, productId))!;
    const saved = await saveProduct(store, editor, productId, { ...input, priceBreaks: [...input.priceBreaks, { variantSku: null, from: 5, percent: null, prices: {} }] });
    expect(saved.ok).toBe(false);
  });

  it("prices the WordPress quote at the break the fitted quantity reaches", async () => {
    const store = (await getStore(slug))!;
    const id = await variantId(storeId, MUG);
    const [{ amount_minor: market }] = await db().execute<Record<string, unknown>>(sql`select amount_minor from commerce.current_prices where variant_id = ${id}::uuid and market_code = 'NO'`);
    const at = async (quantity: number) => (await quoteCart(store, "no", [{ variantId: id, quantity }]))!.lines[0].unit!.amount_minor;
    expect(await at(2)).toBe(Number(market));
    expect(await at(5)).toBe(Math.floor((Number(market) * 90 + 50) / 100));
    expect(await at(10)).toBe(9000);
    const quote = (await quoteCart(store, "no", [{ variantId: id, quantity: 10 }]))!;
    expect(quote.subtotal_minor).toBe(90000);
  });
});
