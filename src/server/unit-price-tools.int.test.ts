import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { formatMoney } from "@/lib/money";
import { allowSmallBase } from "@/lib/unit-price-test-support";
import { normalisePermissions, ROLE_TEMPLATES, type PermissionHolder } from "@/lib/permissions";

import { makeStore } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const ownerTools = await import("./owner-tools");
const stores = await import("./stores");
const mcp = await import("./store-mcp");

type Row = Record<string, unknown>;

/**
 * The AI manager's unit price reads (D160, `docs/wave-1d-unit-price.md` 2.2): `unit_price_gaps` lists what still needs its
 * content and one product's unit price per country, and `get_product` carries the same figures. The figures are the
 * shop's own (`unitPriceShown()`); this checks them against an independent integer oracle and the store's isolation.
 */

let ctx: Parameters<typeof ownerTools.runOwnerTool>[0];
let ctxFor: (holder: PermissionHolder) => typeof ctx;
let storeId: string;
let emptyCtx: typeof ctx;
let emptyId: string;

type Product = { id: string; handle: string; skus: string[] };
let mug: Product;
let flagged: Product;

async function productOf(handle: string, id = storeId): Promise<Product> {
  const [p] = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${id}::uuid and handle = ${handle}`);
  const skus = await db().execute<Row>(sql`select sku from commerce.product_variants where product_id = ${String(p.id)}::uuid and active order by sku`);
  return { id: String(p.id), handle: String(p.handle), skus: skus.map((r) => String(r.sku)) };
}

beforeAll(async () => {
  const made = await makeStore("uptool");
  storeId = made.id;
  const store = (await stores.getStore(made.slug))!;
  ctx = { account: made.account, store, invalidate: () => {} };
  ctxFor = (holder) => ({ ...ctx, holder });

  const other = await makeStore("uptool-other");
  emptyId = other.id;
  emptyCtx = { account: other.account, store: (await stores.getStore(other.slug))!, invalidate: () => {} };

  mug = await productOf("demo-keramikkopp");
  flagged = await productOf("demo-notatbok");
});

afterAll(async () => {
  await closeDb();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (name: string, input: Record<string, unknown> = {}, c = ctx) => ownerTools.runOwnerTool(c, name, input) as Promise<Record<string, any>>;

describe("unit_price_gaps with nothing marked", () => {
  it("is an honest zero in a store with no data of the kind, and says how it is fixed", async () => {
    const answer = await run("unit_price_gaps");
    expect(answer.count).toBe(0);
    expect(answer.products).toEqual([]);
    expect(answer.variants_with_content).toBe(0);
    expect(answer.variants_in_all).toBeGreaterThan(0);
    expect(answer.how).toMatch(/by a person/);
  });
});

describe("unit_price_gaps lists the products that need content", () => {
  beforeAll(async () => {
    // A product marked as sold by measure and put on sale before its content was set: what a store copy or a category
    // marked later leaves behind (the copy setting switches the check off, as in unit-price.int.test.ts).
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.unit_price_copying', 'on', true)`);
      await tx.execute(sql`update commerce.products set sold_by_measure = true where id = ${flagged.id}::uuid`);
    });
    // The mug has content on one of its two variants and is not marked: it is not a gap.
    await db().execute(sql`
      update commerce.product_variants set measure_amount = 300, measure_unit = 'g'
      where store_id = ${storeId}::uuid and sku = ${mug.skus[0]}
    `);
  });

  it("names the flagged product with its reason, SKUs and editor, and counts the variants that have content", async () => {
    const answer = await run("unit_price_gaps");
    expect(answer.count).toBe(1);
    expect(answer.products).toHaveLength(1);
    const item = answer.products[0];
    expect(item.id).toBe(flagged.id);
    expect(item.handle).toBe("demo-notatbok");
    expect(item.why).toBe("the product is marked as sold by measure");
    expect(item.skus_without_content).toEqual(flagged.skus);
    expect(item.admin).toBe(`/admin/${ctx.store.slug}/products/${flagged.id}`);
    expect(answer.variants_with_content).toBe(1);
    expect(answer.note).toMatch(/nothing is hidden/);
  });

  it("follows a category mark and its ancestors, and respects the limit", async () => {
    const [parent] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, kind, content_type, name, slug, requires_unit_price)
      values (${storeId}::uuid, 'category', 'product', 'Dry goods', 'dry-goods', true) returning id
    `);
    const [child] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, kind, content_type, name, slug, parent_id)
      values (${storeId}::uuid, 'category', 'product', 'Pasta', 'pasta', ${String(parent.id)}::uuid) returning id
    `);
    const lamp = await productOf("demo-bordlampe");
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.unit_price_copying', 'on', true)`);
      await tx.execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${storeId}::uuid, ${lamp.id}::uuid, ${String(child.id)}::uuid)`);
    });
    const answer = await run("unit_price_gaps");
    expect(answer.count).toBe(2);
    const byHandle = Object.fromEntries(answer.products.map((p: Row) => [p.handle, p.why]));
    expect(byHandle["demo-bordlampe"]).toBe("its category Dry goods needs a unit price");
    expect(byHandle["demo-notatbok"]).toBe("the product is marked as sold by measure");
    const limited = await run("unit_price_gaps", { limit: 1 });
    expect(limited.count).toBe(2);
    expect(limited.products).toHaveLength(1);
  });

  it("never shows another store's products", async () => {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.unit_price_copying', 'on', true)`);
      await tx.execute(sql`update commerce.products set sold_by_measure = true where store_id = ${emptyId}::uuid and kind = 'goods'`);
    });
    const mine = await run("unit_price_gaps");
    const theirs = await run("unit_price_gaps", {}, emptyCtx);
    expect(theirs.count).toBeGreaterThan(0);
    const ids = new Set(theirs.products.map((p: Row) => p.id));
    expect(mine.products.some((p: Row) => ids.has(p.id))).toBe(false);
    // And a product of the other store cannot be looked up by this one.
    const foreign = await productOf("demo-keramikkopp", emptyId);
    await expect(run("unit_price_gaps", { product: foreign.id })).rejects.toBeInstanceOf(ownerTools.OwnerToolError);
  });
});

describe("one product's unit prices", () => {
  type Price = { amount: number; currency: string; market: string };
  const prices = async (sku: string): Promise<Price[]> => {
    const rows = await db().execute<Row>(sql`
      select cp.market_code as market, cp.currency, cp.amount_minor as amount
      from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
      where v.store_id = ${storeId}::uuid and v.sku = ${sku} order by cp.market_code
    `);
    return rows.map((r) => ({ market: String(r.market), currency: String(r.currency).trim(), amount: Number(r.amount) }));
  };
  /** The independent oracle: price per kg of a 300 g pack, half up, in integers. */
  const perKg = (minor: number) => Math.floor((minor * 1000 * 2 + 300) / (300 * 2));

  it("gives the content and the figure of each country, equal to the oracle and to the price as shown", async () => {
    const answer = await run("unit_price_gaps", { product: mug.handle });
    const measured = answer.variants.find((v: Row) => v.sku === mug.skus[0]);
    expect(measured.content).toBe("300 g");
    const own = await prices(mug.skus[0]);
    expect(own.length).toBeGreaterThan(0);
    expect(measured.countries).toHaveLength(own.length);
    for (const p of own) {
      const row = measured.countries.find((c: Row) => c.country === p.market);
      // The seeded store sells with VAT shown, so the figure is on the price as charged.
      expect(row.with_vat).toBe(`${formatMoney(perKg(p.amount), p.currency, ctx.store.markets[0]?.locale ?? "en")}/kg`);
      expect(row.without_vat).toBeUndefined();
      expect(row.price).toBe(formatMoney(p.amount, p.currency, ctx.store.markets[0]?.locale ?? "en"));
    }
    const bare = answer.variants.find((v: Row) => v.sku === mug.skus[1]);
    expect(bare.content).toBeNull();
    expect(bare.note).toMatch(/No content set/);
    expect(answer.admin).toBe(`/admin/${ctx.store.slug}/products/${mug.id}`);
  });

  it("is the same figure get_product gives, and leaves a variant with no content without the keys", async () => {
    const product = await run("get_product", { product: mug.handle });
    const withContent = product.variants.find((v: Row) => v.sku === mug.skus[0]);
    const gaps = await run("unit_price_gaps", { product: mug.handle });
    const measured = gaps.variants.find((v: Row) => v.sku === mug.skus[0]);
    expect(withContent.content).toBe("300 g");
    expect(withContent.unit_prices.map((u: Row) => [u.country, u.with_vat])).toEqual(measured.countries.map((c: Row) => [c.country, c.with_vat]));
    const bare = product.variants.find((v: Row) => v.sku === mug.skus[1]);
    expect("content" in bare).toBe(false);
    expect("unit_prices" in bare).toBe(false);
  });

  it("uses the base the owner chose only where the country allows it: kg in Norway as the rules read, 100 g when it is opened", async () => {
    // A 100 g base chosen by the owner is not used in Norway, Sweden or Germany (held by unit-price-rules.test.ts and unit-price.int.test.ts).
    await db().execute(sql`update commerce.product_variants set measure_base = '100g' where store_id = ${storeId}::uuid and sku = ${mug.skus[0]}`);
    const noOf = async () => {
      const answer = await run("unit_price_gaps", { product: mug.handle });
      return answer.variants.find((v: Row) => v.sku === mug.skus[0]).countries.find((c: Row) => c.country === "NO");
    };
    expect((await noOf()).with_vat).toMatch(/\/kg$/);
    const restoreSmallBase = allowSmallBase("NO");
    try {
      expect((await noOf()).with_vat).toMatch(/\/100 g$/);
    } finally {
      restoreSmallBase();
      await db().execute(sql`update commerce.product_variants set measure_base = null where store_id = ${storeId}::uuid and sku = ${mug.skus[0]}`);
    }
  });
});

describe("who may use it", () => {
  it("is for readers of products, refused to a role without them, and served by the store's MCP server", async () => {
    const bookings: PermissionHolder = { role: "admin", permissions: normalisePermissions(["bookings:read"]) };
    await expect(ownerTools.runOwnerTool(ctxFor(bookings), "unit_price_gaps", {})).rejects.toBeInstanceOf(ownerTools.OwnerToolError);
    const products: PermissionHolder = { role: "admin", permissions: ROLE_TEMPLATES.products.permissions };
    await expect(ownerTools.runOwnerTool(ctxFor(products), "unit_price_gaps", {})).resolves.toBeTruthy();
    const served = mcp.MCP_TOOLS.find((tool) => tool.name === "unit_price_gaps")!;
    expect(served).toBeTruthy();
    expect((served.inputSchema.required as string[]).includes("store")).toBe(true);
  });
});
