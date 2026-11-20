import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { countStatements } from "@/db/statement-count";
import { newPageContent, type PageContent } from "@/lib/page-content";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";

import type { Account } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const pages = await import("./pages");
const layouts = await import("./product-layouts");

const run = Date.now().toString(36);
let storeId: string;
let owner: Account;

/** A layout of only a related-products component under the given heading, to tell layouts apart. */
const layoutNamed = (heading: string): PageContent => ({
  ...newPageContent(),
  title: heading,
  slug: heading.toLowerCase(),
  rows: [{ id: "r", type: "row", layout: "1", columns: [{ id: "c", blocks: [{ id: "b", type: "product", part: "related", heading }] }] }],
});

const save = async (content: PageContent, publish = true) => {
  const result = await pages.savePage(owner, storeId, null, content, { publish, type: "product_layout" });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
};

const id = async (table: "products" | "terms", slug: string) => {
  const [row] = await db().execute<Row>(
    table === "products"
      ? sql`select id from commerce.products where store_id = ${storeId}::uuid and handle = ${slug}`
      : sql`select id from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and slug = ${slug}`,
  );
  return String(row.id);
};

/** The heading of the layout a product's page uses, or null for the built-in one. */
const usedFor = async (handle: string) => {
  const layout = await layouts.productLayoutFor(storeId, await id("products", handle));
  const block = layout?.content.rows[0]?.columns[0]?.blocks[0];
  return block?.type === "product" ? (block.heading ?? null) : layout ? "?" : null;
};

beforeAll(async () => {
  // A store copied from the template: its demo products, in Hjem (the mug; the lamp through Belysning below it), with Nyhet tags.
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`layouts-${run}@example.com`}, 'Owner', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`layouts-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`layouts-${run}@example.com`}`);
  owner = { id: String(account.id), email: String(account.email), name: "Owner", platformAdmin: false };
});

afterAll(async () => {
  await closeDb();
});

describe("product layouts (D79)", () => {
  it("saves product components only in a store's product layouts, which have no categories or tags", async () => {
    const withParts = { ...DEFAULT_PRODUCT_LAYOUT, slug: `parts-${run}` };
    expect(await pages.savePage(owner, storeId, null, withParts, { publish: false, type: "page" })).toEqual({
      ok: false,
      problems: ["Product components belong in product layouts, which show a product."],
    });
    expect(await pages.savePage(owner, null, null, withParts, { publish: false, type: "product_layout" })).toEqual({
      ok: false,
      problems: ["Product layouts are a store's."],
    });
    const category = await id("terms", "hjem");
    expect(
      await pages.savePage(owner, storeId, null, { ...withParts, categories: [category] }, { publish: false, type: "product_layout" }),
    ).toEqual({ ok: false, problems: ["A product layout has no categories or tags."] });
    await expect(save({ ...withParts, slug: `standard-${run}` })).resolves.toMatch(/-/);
  });

  it("uses the product's own layout, else its nearest category's, else a tag's, else the store's, and only published ones", async () => {
    expect(await usedFor("demo-bordlampe")).toBeNull();
    const store = await save(layoutNamed("Store"));
    const home = await save(layoutNamed("Home"));
    const lighting = await save(layoutNamed("Lighting"));
    const tag = await save(layoutNamed("New"));
    const own = await save(layoutNamed("Own"));
    const unpublished = await save(layoutNamed("Draft"), false);

    await layouts.assignLayout(owner, storeId, store, { standard: true, termIds: [] });
    expect(await usedFor("demo-bordlampe")).toBe("Store");
    // The lamp is in Belysning, below Hjem: Hjem's layout counts for it, then Belysning's own goes first.
    await layouts.assignLayout(owner, storeId, home, { standard: false, termIds: [await id("terms", "hjem")] });
    expect(await usedFor("demo-bordlampe")).toBe("Home");
    expect(await usedFor("demo-keramikkopp")).toBe("Home");
    await layouts.assignLayout(owner, storeId, lighting, { standard: false, termIds: [await id("terms", "belysning")] });
    expect(await usedFor("demo-bordlampe")).toBe("Lighting");
    expect(await usedFor("demo-keramikkopp")).toBe("Home");
    // A tag's layout, for products with no category layout (the notebook is Nyhet, in Papir).
    await layouts.assignLayout(owner, storeId, tag, { standard: false, termIds: [await id("terms", "nyhet")] });
    expect(await usedFor("demo-notatbok")).toBe("New");
    // The product's own goes before all; an unpublished one is passed over.
    const lamp = await id("products", "demo-bordlampe");
    await db().execute(sql`update commerce.products set product_layout_id = ${unpublished}::uuid where id = ${lamp}::uuid`);
    expect(await usedFor("demo-bordlampe")).toBe("Lighting");
    await db().execute(sql`update commerce.products set product_layout_id = ${own}::uuid where id = ${lamp}::uuid`);
    expect(await usedFor("demo-bordlampe")).toBe("Own");

    const uses = await layouts.layoutUses(storeId);
    expect(uses.get(store)).toEqual({ standard: true, categoryIds: [], tagIds: [], products: 0 });
    expect(uses.get(own)).toMatchObject({ products: 1 });
    expect(uses.get(tag)?.tagIds).toEqual([await id("terms", "nyhet")]);

    // Choosing again replaces the categories and tags it had; no longer standard, the built-in layout is next.
    await layouts.assignLayout(owner, storeId, home, { standard: false, termIds: [] });
    expect(await usedFor("demo-keramikkopp")).toBe("Store");
    await layouts.assignLayout(owner, storeId, store, { standard: false, termIds: [] });
    expect(await usedFor("demo-keramikkopp")).toBeNull();
    // Deleting a layout lets its products fall back.
    await pages.deletePage(owner, storeId, own, "product_layout");
    expect(await usedFor("demo-bordlampe")).toBe("Lighting");
  });

  it("chooses only the store's own layouts", async () => {
    expect(await layouts.assignLayout(owner, storeId, "00000000-0000-4000-8000-000000000000", { standard: true, termIds: [] })).toEqual({
      ok: false,
      problems: ["This layout no longer exists."],
    });
    expect((await layouts.listLayoutChoices(storeId)).map((choice) => choice.title)).toContain("Draft");
  });

  it("reads a layout's document once per layout, never per product (bloat review step 2.14)", async () => {
    // Only the store's standard layout: no product, category or tag of the store has one of its own.
    await db().execute(sql`update commerce.products set product_layout_id = null where store_id = ${storeId}::uuid`);
    await db().execute(sql`update commerce.terms set product_layout_id = null where store_id = ${storeId}::uuid`);
    const standard = await save(layoutNamed("Shared"));
    await layouts.assignLayout(owner, storeId, standard, { standard: true, termIds: [] });
    const productA = await id("products", "demo-bordlampe");
    const productB = await id("products", "demo-notatbok");

    // A statement that reads a page's stored document: `published` itself, not only `published_at`.
    const selectsDocument = (text: string) => /commerce\.pages/.test(text) && /\bpublished\b/.test(text.replace(/published_at/g, ""));
    for (const product of [productA, productB]) {
      const counted = await countStatements(() => layouts.productLayoutFor(storeId, product));
      expect(counted.result?.id).toBe(standard);
      const documents = counted.statements.filter((s) => /select id, published\s+from commerce\.pages/.test(s.text));
      expect(documents).toHaveLength(1);
      const values = documents[0].values.map(String);
      expect(values).toContain(standard);
      expect(values).toContain(storeId);
      expect(values).not.toContain(productA);
      expect(values).not.toContain(productB);
      // The lookup of which layout returns only its id; the media library's alt texts may add their own statement.
      const otherDocuments = counted.statements.filter((s) => s !== documents[0] && selectsDocument(s.text));
      expect(otherDocuments).toEqual([]);
    }
  });
});
