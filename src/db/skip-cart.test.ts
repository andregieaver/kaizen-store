import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Whether buying a product skips the cart page (D915), against every migration applied to a real Postgres (PGlite): `commerce.skips_cart()` asks
 * the product, then its tags, then its categories (each its own or its nearest parent's), then the store's Settings > Checkout, and shows the cart
 * when none says anything. Where tags, or categories, disagree, the cart wins.
 */

let db: PGlite;
let store: string;
let counter = 0;

async function one<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}
const skips = async (product: string) => (await one<{ skips: boolean }>("select commerce.skips_cart($1, $2) as skips", [store, product])).skips;

async function product(skipCart: boolean | null = null): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      "insert into commerce.products (store_id, handle, tax_code, skip_cart) values ($1, $2, 'txcd_99999999', $3) returning id",
      [store, `skip-${counter}`, skipCart],
    )
  ).id;
}
async function term(kind: "category" | "tag", skipCart: boolean | null, parentId: string | null = null): Promise<string> {
  counter += 1;
  return (
    await one<{ id: string }>(
      "insert into commerce.terms (store_id, content_type, kind, name, slug, parent_id, skip_cart) values ($1, 'product', $2, $3, $3, $4, $5) returning id",
      [store, kind, `skip-term-${counter}`, parentId, skipCart],
    )
  ).id;
}
const place = (productId: string, termId: string) =>
  db.query("insert into commerce.product_terms (store_id, product_id, term_id) values ($1, $2, $3)", [store, productId, termId]);
const storeSays = (skipCart: boolean) => db.query("update commerce.stores set skip_cart = $2 where id = $1", [store, skipCart]);

beforeAll(async () => {
  db = await createTestDatabase();
  store = (await one<{ id: string }>("insert into commerce.stores (slug, name, country) values ('skip-cart', 'Skip', 'NO') returning id")).id;
});

afterAll(async () => {
  await db.close();
});

describe("buying skips the cart page (D915)", () => {
  it("never by default, and as the store chooses on Settings > Checkout", async () => {
    const p = await product();
    expect(await skips(p)).toBe(false);
    await storeSays(true);
    expect(await skips(p)).toBe(true);
    await storeSays(false);
  });

  it("as a category chooses over the store, and a parent category for its subcategories' products", async () => {
    const parent = await term("category", true);
    const child = await term("category", null, parent);
    const p = await product();
    await place(p, child);
    expect(await skips(p)).toBe(true);
    // The nearest category that says something decides.
    await db.query("update commerce.terms set skip_cart = false where id = $1", [child]);
    expect(await skips(p)).toBe(false);
  });

  it("as a tag chooses over its categories, the cart winning where tags disagree", async () => {
    const category = await term("category", false);
    const yes = await term("tag", true);
    const p = await product();
    await place(p, category);
    await place(p, yes);
    expect(await skips(p)).toBe(true);
    await place(p, await term("tag", false));
    expect(await skips(p)).toBe(false);
  });

  it("as the product itself chooses over everything", async () => {
    await storeSays(true);
    const tag = await term("tag", true);
    const p = await product(false);
    await place(p, tag);
    expect(await skips(p)).toBe(false);
    await db.query("update commerce.products set skip_cart = true where id = $1", [p]);
    await db.query("update commerce.terms set skip_cart = false where id = $1", [tag]);
    expect(await skips(p)).toBe(true);
    await storeSays(false);
  });

  it("is a choice for products' categories and tags only", async () => {
    await expect(
      db.query("insert into commerce.terms (store_id, content_type, kind, name, slug, skip_cart) values ($1, 'page', 'category', 'p', 'p', true)", [store]),
    ).rejects.toThrow(/terms_skip_cart/);
  });
});
