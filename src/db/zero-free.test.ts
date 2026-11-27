import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Whether a price of nothing says Free (D913), against every migration applied to a real Postgres (PGlite): `commerce.zero_shows_free()` asks the
 * product, then its tags, then its categories (each its own or its nearest parent's), then the store's Settings > Products, and says Free when none
 * says anything. Where tags, or categories, disagree, the amount wins.
 */

let db: PGlite;
let store: string;
let counter = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const free = async (product: string) => (await one<{ free: boolean }>("select commerce.zero_shows_free($1, $2) as free", [store, product])).free;

async function product(zeroFree: boolean | null = null): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      "insert into commerce.products (store_id, handle, tax_code, zero_free) values ($1, $2, 'txcd_99999999', $3) returning id",
      [store, `zero-${counter}`, zeroFree],
    )
  ).id;
}
async function term(kind: "category" | "tag", zeroFree: boolean | null, parentId: string | null = null): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      "insert into commerce.terms (store_id, content_type, kind, name, slug, parent_id, zero_free) values ($1, 'product', $2, $3, $3, $4, $5) returning id",
      [store, kind, `zero-term-${counter}`, parentId, zeroFree],
    )
  ).id;
}
const place = (productId: string, termId: string) =>
  db.query("insert into commerce.product_terms (store_id, product_id, term_id) values ($1, $2, $3)", [store, productId, termId]);
const storeSays = (zeroFree: boolean) =>
  db.query(
    "insert into commerce.product_settings (store_id, zero_free) values ($1, $2) on conflict (store_id) do update set zero_free = excluded.zero_free",
    [store, zeroFree],
  );

beforeAll(async () => {
  db = await createTestDatabase();
  store = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('zero-free', 'Zero', 'NO') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

describe("a price of nothing says Free (D913)", () => {
  it("by default, and as the store chooses on Settings > Products", async () => {
    const p = await product();
    expect(await free(p)).toBe(true);
    await storeSays(false);
    expect(await free(p)).toBe(false);
    await storeSays(true);
  });

  it("as a category chooses over the store, and a parent category for its subcategories' products", async () => {
    await storeSays(false);
    const parent = await term("category", true);
    const child = await term("category", null, parent);
    const p = await product();
    await place(p, child);
    expect(await free(p)).toBe(true);
    // The nearest category that says something decides.
    await db.query("update commerce.terms set zero_free = false where id = $1", [child]);
    expect(await free(p)).toBe(false);
    await storeSays(true);
  });

  it("as a tag chooses over its categories, the amount winning where tags disagree", async () => {
    const category = await term("category", false);
    const yes = await term("tag", true);
    const p = await product();
    await place(p, category);
    await place(p, yes);
    expect(await free(p)).toBe(true);
    await place(p, await term("tag", false));
    expect(await free(p)).toBe(false);
  });

  it("as the product itself chooses over everything", async () => {
    const tag = await term("tag", false);
    const p = await product(true);
    await place(p, tag);
    expect(await free(p)).toBe(true);
    await db.query("update commerce.products set zero_free = false where id = $1", [p]);
    await db.query("update commerce.terms set zero_free = true where id = $1", [tag]);
    expect(await free(p)).toBe(false);
  });

  it("is a choice for products' categories and tags only", async () => {
    await expect(
      db.query("insert into commerce.terms (store_id, content_type, kind, name, slug, zero_free) values ($1, 'page', 'category', 'p', 'p', true)", [store]),
    ).rejects.toThrow(/terms_zero_free/);
  });
});
