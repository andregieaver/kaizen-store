import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { StatementRecord } from "@/db/statement-count";

/**
 * Whole page documents read per page a shopper opens (bloat review step 2.17): a cold home, a built page and a product page read at most
 * three (the page drawn, its header and footer), the blog's listing none, and the feed at most 50 rows from its card statement and no
 * document. On a store with 30 published pages and 60 published articles, all with excerpts. Cached reads run (next/cache is mocked), as
 * every statement of a cold function would.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { closeDb, db } = await import("@/db/client");
const { countStatements } = await import("@/db/statement-count");
const { newBlock } = await import("@/lib/page-rows");
const { featureOn } = await import("@/lib/store-features");
const { documentsRead, selectsDocument } = await import("./page-documents-test-support");
const { makeCapacityStore } = await import("./capacity-test-support");
const { getStore } = await import("./stores");
const { resolveShop } = await import("./shop");
const { afterSaleOpenCached } = await import("./after-sale");
const { siteLayoutForVisitor } = await import("./site-layouts");
const { legalLinksFor } = await import("./legal-links");
const { textStylesCssFor } = await import("./text-styles");
const { findPublishedPage, pageForRole, publishedPageById } = await import("./pages");
const { placePageForVisitor } = await import("./role-pages");
const { productLayoutFor } = await import("./product-layouts");
const { blogCategoryIds, blogFeed, findBlog } = await import("./blogs");
const { gridData } = await import("./content-grid");
const { siteTerms } = await import("./taxonomy");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let store = { id: "", slug: "" };
let market = "";
let product = "";

/** A stored page or article with an excerpt, as savePage() writes one. */
const page = (title: string, slug: string, rows: unknown[] = []) => ({
  title,
  slug,
  thumbnail: null,
  seo: { title: "", description: "" },
  searchEngines: true,
  aiAssistants: true,
  categories: [],
  tags: [],
  excerpt: `About ${title}`,
  rows,
});

beforeAll(async () => {
  store = await makeCapacityStore("documents", run);
  // Only this test's pages and articles: the demo content is taken away first.
  await db().execute(sql`update commerce.stores set front_page_id = null, products_page_id = null where id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.page_roles where store_id = ${store.id}::uuid`);
  await db().execute(sql`delete from commerce.pages where store_id = ${store.id}::uuid and type in ('page', 'article')`);
  await db().execute(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
    select ${store.id}::uuid, kind, kind || '-' || n, doc, doc, now() - make_interval(mins => n), now() - make_interval(mins => n)
    from (
      select 'page' as kind, n from generate_series(1, 30) as n union all select 'article', n from generate_series(1, 60) as n
    ) as made,
    lateral (
      select jsonb_build_object('title', initcap(kind) || ' ' || n, 'slug', kind || '-' || n, 'thumbnail', null,
        'seo', jsonb_build_object('title', '', 'description', ''), 'searchEngines', true, 'aiAssistants', true,
        'categories', '[]'::jsonb, 'tags', '[]'::jsonb, 'excerpt', 'About ' || kind || ' ' || n, 'rows', '[]'::jsonb) as doc
    ) as built
  `);
  // The front page holds a grid of the blog's articles: its cards are read from columns.
  const grid = { ...newBlock("contentGrid", () => "front-grid"), source: { type: "articles" } };
  const front = JSON.stringify(page("Welcome", "page-1", [{ id: "row-1", type: "row", layout: "1", columns: [{ id: "column-1", blocks: [grid] }] }]));
  const [first] = await db().execute<Row>(sql`
    update commerce.pages set draft = ${front}::jsonb, published = ${front}::jsonb where store_id = ${store.id}::uuid and type = 'page' and slug = 'page-1'
    returning id
  `);
  await db().execute(sql`update commerce.stores set front_page_id = ${String(first.id)}::uuid where id = ${store.id}::uuid`);
  await db().execute(sql`
    insert into commerce.blogs (store_id, handle, main, titles) values (${store.id}::uuid, 'blog', true, '{}'::jsonb) on conflict do nothing
  `);
  const shop = await getStore(store.slug);
  market = shop!.markets[0].slug;
  const [row] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.id}::uuid and status = 'active' order by handle limit 1`);
  product = String(row.id);
}, 60_000);

afterAll(async () => {
  await closeDb();
});

/** The store's frame: what `src/app/s/[store]/[market]/layout.tsx` awaits before any page content (as query-budget.int.test.ts). */
async function storeFrame() {
  await getStore(store.slug);
  const shop = await resolveShop(store.slug, market);
  if (!shop) throw new Error("no shop");
  const afterSale = featureOn(shop.store, "shop") || (await afterSaleOpenCached(shop.store.id));
  await Promise.all([
    siteLayoutForVisitor(shop.store.id, "header", shop.ab),
    siteLayoutForVisitor(shop.store.id, "footer", shop.ab),
    legalLinksFor(shop.store, shop.market, afterSale),
  ]);
  await textStylesCssFor(shop.store.id);
  return shop;
}

/** The front page (`(shop)/page.tsx`): the chosen page for this visitor, and the grids it holds. */
async function home() {
  const shop = await storeFrame();
  const chosen = shop.store.frontPageId ? await publishedPageById(shop.store.id, shop.store.frontPageId) : null;
  const { page: front } = await placePageForVisitor(shop.store.id, "front", chosen, shop.ab);
  for (const row of front?.content.rows ?? []) {
    for (const column of row.columns) {
      for (const block of column.blocks) {
        if (block.type === "contentGrid") await gridData(block, { pageId: front!.id, owner: shop.store.id, market: shop.market.slug });
      }
    }
  }
}

/** A built page (`(shop)/[slug]/page.tsx`): the page at its address. */
async function builtPage() {
  const shop = await storeFrame();
  const found = await findPublishedPage(shop.store.id, "page-7");
  if (!found || !("page" in found)) throw new Error("no page-7");
}

/** A product page (`(shop)/p/[handle]`): the product's layout. */
async function productPage() {
  const shop = await storeFrame();
  await productLayoutFor(shop.store.id, product);
}

/** The first blog's listing (`(shop)/blog/blog-listing.tsx`, StoreBlog): its page or its grid, and the categories its articles are in. */
async function blogListing() {
  const shop = await resolveShop(store.slug, market);
  const blog = shop ? await findBlog(shop.store.id, null) : null;
  if (!shop || !blog) throw new Error("no blog");
  const chosen = await pageForRole(shop.store, "blog");
  if (chosen) return;
  const grid = { ...newBlock("contentGrid", () => "blog-index"), source: { type: "articles", blog: blog.id }, limit: 48 } as Parameters<typeof gridData>[0];
  await Promise.all([gridData(grid, { pageId: null, owner: shop.store.id, market: shop.market.slug }), siteTerms(shop.store.id, "article")]);
  await blogCategoryIds(shop.store.id, blog);
}

const record = (text: string, rows: number): StatementRecord => ({ text, values: [], rows, ms: 0, startedAt: 0, control: false });

describe("what counts as a whole page document", () => {
  it("is a select list's draft or published, whole", () => {
    expect(selectsDocument("select id, draft from commerce.pages where id = $1")).toBe(true);
    expect(selectsDocument("select p.id, p.published from commerce.pages p")).toBe(true);
    expect(selectsDocument("select coalesce(published, draft) as content from commerce.pages")).toBe(true);
    expect(selectsDocument("select id, slug, published, case when $1 then draft end as draft from commerce.pages")).toBe(true);
    expect(selectsDocument("select id, published_at, published_title, published_titles, published is not null as live from commerce.pages")).toBe(false);
    expect(selectsDocument("select p.published ->> 'title' as title, jsonb_typeof(p.published -> 'markets') from commerce.pages p")).toBe(false);
    expect(documentsRead([record("select id, published from commerce.pages", 4), record("select id, published_at from commerce.pages", 9)])).toBe(4);
  });
});

describe("whole page documents read per page (bloat review step 2.17)", () => {
  for (const [name, open] of [
    ["a cold home", home],
    ["a built page", builtPage],
    ["a product page", productPage],
  ] as const) {
    it(`reads at most 3 for ${name}`, async () => {
      const { statements } = await countStatements(open);
      expect(documentsRead(statements)).toBeLessThanOrEqual(3);
    });
  }

  it("reads none for the blog's listing", async () => {
    const { statements } = await countStatements(blogListing);
    expect(statements.filter((s) => selectsDocument(s.text)).map((s) => s.text)).toEqual([]);
  });

  it("reads at most 50 cards and no document for the blog's feed", async () => {
    const { result, statements } = await countStatements(() => blogFeed(store.slug, market, null));
    expect(result).toContain("<feed");
    const cards = statements.filter((s) => /from commerce\.pages p/.test(s.text) && /as excerpt/.test(s.text));
    expect(cards).toHaveLength(1);
    expect(cards[0].rows).toBe(50);
    expect(documentsRead(statements)).toBe(0);
  });
});
