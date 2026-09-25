import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type ContentGridBlock } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { gridData, listGridStores } = await import("./content-grid");
const pages = await import("./pages");
const taxonomy = await import("./taxonomy");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let admin: Account;
const grid = (overrides: Partial<ContentGridBlock> = {}): ContentGridBlock => ({
  ...(newBlock("contentGrid", () => "g") as ContentGridBlock),
  ...overrides,
});
const created = <T extends { ok: boolean }>(result: T) => {
  if (!result.ok) throw new Error(JSON.stringify(result));
  return result as Extract<T, { ok: true; id: string }>;
};

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`grid-${run}@example.com`}, 'Admin', true)
    returning id, email
  `);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true };
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.pages where slug like ${`%-${run}`}`);
  await db().execute(sql`delete from commerce.terms where slug like ${`%${run}%`}`);
  await closeDb();
});

describe("content grids (D51)", () => {
  it("shows published pages of a category and its subcategories, newest first, never the page it is on", async () => {
    const scope = { storeId: null, contentType: "page" } as const;
    const guides = created(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Guides ${run}` }));
    const selling = created(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Selling ${run}`, parentId: guides.id }));
    const other = created(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Other ${run}` }));
    const save = async (slug: string, categories: string[], publish = true) =>
      created(
        await pages.savePage(
          admin,
          null,
          null,
          { ...newPageContent(), title: `Page ${slug}`, slug: `${slug}-${run}`, seo: { title: "", description: `About ${slug}` }, categories },
          { publish },
        ),
      ).id;
    const first = await save("first", [guides.id]);
    const second = await save("second", [selling.id]);
    await save("elsewhere", [other.id]);
    await save("draft", [guides.id], false);

    const shown = await gridData(grid({ categories: [guides.id] }), { pageId: null, owner: null });
    expect(shown.items.map((i) => i.title)).toEqual([`Page second`, `Page first`]);
    expect(shown.items[0]).toMatchObject({ href: `/second-${run}`, excerpt: "About second", price: null });

    const onPage = await gridData(grid({ categories: [guides.id], sort: "oldest" }), { pageId: first, owner: null });
    expect(onPage.items.map((i) => i.id)).toEqual([second]);
    // A category deleted since matches nothing, rather than everything.
    expect((await gridData(grid({ categories: ["00000000-0000-4000-8000-000000000000"] }), { pageId: null, owner: null })).items).toEqual([]);
  });

  it("shows a store's products of a category, priced in the market, cheapest first", async () => {
    const stores = await listGridStores();
    const demo = stores.find((s) => s.markets.length > 0);
    if (!demo) throw new Error("no open store with markets in the test database");
    const scope = { storeId: demo.id, contentType: "product" } as const;
    const mugs = created(await taxonomy.createTerm(admin, scope, { kind: "category", name: `Mugs ${run}` }));
    const products = await db().execute<Row>(sql`
      select id from commerce.products where store_id = ${demo.id}::uuid and status = 'active' order by handle limit 2
    `);
    for (const product of products) {
      await db().execute(sql`
        insert into commerce.product_terms (store_id, product_id, term_id) values (${demo.id}::uuid, ${String(product.id)}::uuid, ${mugs.id}::uuid)
      `);
    }
    const market = demo.markets[0].code;
    const shown = await gridData(
      grid({ source: { type: "products", storeId: demo.id, market }, categories: [mugs.id], sort: "priceLow" }),
      { pageId: null, owner: null },
    );
    expect(shown.items).toHaveLength(products.length);
    expect(shown.items.every((i) => i.href.includes("/p/") && i.price !== null)).toBe(true);
    const prices = shown.items.map((i) => i.price!.view.amountMinor);
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    // On the store's own page (D53), its products in the shopper's market, whatever the grid names.
    const own = await gridData(grid({ source: { type: "products" }, categories: [mugs.id] }), {
      pageId: null,
      owner: demo.id,
      market,
    });
    expect(own.items.map((i) => i.id).sort()).toEqual(shown.items.map((i) => i.id).sort());
    // A market the store does not have shows nothing.
    expect((await gridData(grid({ source: { type: "products", storeId: demo.id, market: "ZZ" } }), { pageId: null, owner: null })).items).toEqual([]);
  });
});
