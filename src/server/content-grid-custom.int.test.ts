import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, parsePageContent, type ContentGridBlock, type CustomGridItem, type PageContent } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { newBlock } from "@/lib/page-rows";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
const tagged = vi.hoisted(() => [] as string[]);
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: (...tags: string[]) => void tagged.push(...tags), updateTag: () => {} }));

const { gridData, listGridStores } = await import("./content-grid");
const { storeTag } = await import("./stores");
const pages = await import("./pages");
const library = await import("./media-library");

type Row = Record<string, unknown>;

/**
 * Custom grid items (D155) against a real database: a page of a store is saved with a grid of custom items, which `gridData()`
 * answers from the block (links made in the shopper's market, the language's texts over it), the media library finds an item's
 * picture in use, and the page's rules refuse what a custom grid may not hold.
 */

const run = Date.now().toString(36);
// The media library's origin: a picture of a custom item is a file in it (or on the site), never another site's.
const libraryOrigin = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "https://files.example.com";
let admin: Account;
let storeId: string;
let storeSlug: string;
let market: { code: string };
const created: string[] = [];

const item = (id: string, over: Partial<CustomGridItem> = {}): CustomGridItem => ({
  id,
  title: `Title ${id}`,
  text: "",
  picture: null,
  link: null,
  buttonLabel: "",
  date: null,
  badge: "",
  priceText: "",
  details: [],
  ...over,
});
const grid = (items: CustomGridItem[], over: Partial<ContentGridBlock> = {}): ContentGridBlock => ({
  ...(newBlock("contentGrid", () => "g1") as ContentGridBlock),
  source: { type: "custom" },
  limit: 60,
  items,
  ...over,
});
const pageOf = (block: ContentGridBlock, slug: string, extra: Partial<PageContent> = {}): PageContent => ({
  ...newPageContent(),
  title: `Page ${slug}`,
  slug: `${slug}-${run}`,
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [block] }] }],
  ...extra,
});
const save = async (owner: string | null, content: PageContent, publish = true) => {
  const result = await pages.savePage(admin, owner, null, content, { publish });
  if (result.ok) created.push(result.id);
  return result;
};

beforeAll(async () => {
  const demo = (await listGridStores()).find((s) => s.markets.length > 0);
  if (!demo) throw new Error("no open store with markets in the test database");
  storeId = demo.id;
  market = demo.markets[0];
  const [row] = await db().execute<Row>(sql`select slug from commerce.stores where id = ${storeId}::uuid`);
  storeSlug = String(row.slug);
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`custom-grid-${run}@example.com`}, 'Admin', true) returning id, email
  `);
  admin = { id: String(account.id), email: String(account.email), name: "Admin", platformAdmin: true };
});

afterAll(async () => {
  if (created.length > 0) await db().execute(sql`delete from commerce.pages where id in (${sql.join(created.map((id) => sql`${id}::uuid`), sql`, `)})`);
  await db().execute(sql`delete from commerce.media where file_name like ${`%-${run}.webp`}`);
  await closeDb();
});

describe("gridData() for custom items", () => {
  it("answers from the block: the owner's order, empty items skipped, links in the market", async () => {
    const block = grid([
      item("a", { link: { kind: "page", slug: "om-oss" }, priceText: "From 199 kr" }),
      item("b", { title: "", text: "" }),
      item("c", { link: { kind: "product", handle: "kopp" }, badge: "New" }),
      item("d", { link: { kind: "url", url: "https://example.com/x" } }),
      item("e"),
    ]);
    const data = await gridData(block, { pageId: null, owner: storeId, market: market.code });
    const slug = market.code.toLowerCase();
    expect(data.items.map((i) => i.id)).toEqual(["a", "c", "d", "e"]);
    expect(data.items.map((i) => i.href)).toEqual([`/s/${storeSlug}/${slug}/om-oss`, `/s/${storeSlug}/${slug}/p/kopp`, "https://example.com/x", ""]);
    expect(data.items[0]).toMatchObject({ priceText: "From 199 kr", price: null });
    expect(data.items[1]).toMatchObject({ badge: "New" });
    expect(data.lang).toMatch(/^[a-z]{2}$/);
  });

  it("honours the limit when it is smaller than the items", async () => {
    const block = grid([item("a"), item("b"), item("c")], { limit: 2 });
    expect((await gridData(block, { pageId: null, owner: storeId, market: market.code })).items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("is in the language of the market, with the page's translation over the items", async () => {
    const content = pageOf(grid([item("a", { link: { kind: "page", slug: "om-oss" } })]), "tr", {
      translations: { "sv-SE": { "block.g1.a.title": "Svensk titel" } },
    });
    const saved = await save(storeId, content);
    expect(saved.ok).toBe(true);
    const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${saved.ok ? saved.id : ""}::uuid`);
    const stored = parsePageContent(row.published);
    expect(stored?.translations?.["sv-SE"]).toEqual({ "block.g1.a.title": "Svensk titel" });
    const swedish = localizePage(stored!, "sv-SE").rows[0].columns[0].blocks[0] as ContentGridBlock;
    const data = await gridData(swedish, { pageId: null, owner: storeId, market: "SE" });
    expect(data.lang).toBe("sv");
    expect(data.items[0].title).toBe("Svensk titel");
    expect(data.items[0].href).toBe(`/s/${storeSlug}/se/om-oss`);
    const main = await gridData(stored!.rows[0].columns[0].blocks[0] as ContentGridBlock, { pageId: null, owner: storeId, market: "NO" });
    expect(main.items[0].title).toBe("Title a");
  });

  it("is English with links from the root on Kaizen's own pages, which have no store's products", async () => {
    const block = grid([item("a", { link: { kind: "page", slug: "pricing" } }), item("b", { link: { kind: "product", handle: "kopp" } })]);
    const data = await gridData(block, { pageId: null, owner: null });
    expect(data.lang).toBe("en");
    expect(data.items.map((i) => i.href)).toEqual(["/pricing", ""]);
  });

  it("is refreshed with its store even where it shows nothing (a market the store has not, or a store not open yet)", async () => {
    tagged.length = 0;
    const data = await gridData(grid([item("a", { link: { kind: "page", slug: "x" } })]), { pageId: null, owner: storeId, market: "ZZ" });
    expect(data.items).toEqual([]);
    // Tagged before it came out empty, so a change to the store's markets (or opening it) does not leave it empty for hours.
    expect(tagged).toContain(storeTag(storeSlug));
  });

  it("shows nothing for a store that is gone, rather than another store's links", async () => {
    const data = await gridData(grid([item("a", { link: { kind: "page", slug: "x" } })]), { pageId: null, owner: "00000000-0000-4000-8000-000000000000", market: "NO" });
    expect(data.items).toEqual([]);
  });
});

describe("saving a page with custom items", () => {
  it("keeps the items as they are written and lets the store's pages hold them", async () => {
    const saved = await save(storeId, pageOf(grid([item("a", { priceText: "From 10 kr", details: [{ id: "d1", label: "L", text: "T" }] })]), "keep"));
    expect(saved.ok).toBe(true);
    const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${saved.ok ? saved.id : ""}::uuid`);
    const block = parsePageContent(row.published)?.rows[0].columns[0].blocks[0] as ContentGridBlock;
    expect(block.items).toEqual([item("a", { priceText: "From 10 kr", details: [{ id: "d1", label: "L", text: "T" }] })]);
  });

  it("drops the items of a grid whose owner chose another source after writing them, and keeps the rest of the page", async () => {
    const away = grid([item("a", { title: "Left behind" })], { source: { type: "pages" }, limit: 6 });
    const saved = await save(storeId, pageOf(away, "away"));
    expect(saved.ok).toBe(true);
    const [row] = await db().execute<Row>(sql`select published from commerce.pages where id = ${saved.ok ? saved.id : ""}::uuid`);
    const block = parsePageContent(row.published)?.rows[0].columns[0].blocks[0] as ContentGridBlock;
    expect(block.source.type).toBe("pages");
    expect(block.items).toBeUndefined();
    expect(JSON.stringify(row.published)).not.toContain("Left behind");
  });

  it("refuses a picture from another site with the rule's own words", async () => {
    const foreign = item("a", { picture: { url: "https://t.example/p.gif", width: 1, height: 1, alt: "" } });
    expect(await save(storeId, pageOf(grid([foreign]), "foreign"))).toEqual({
      ok: false,
      problems: ["An item's picture must be a file from your media library or this site, not another site's."],
    });
  });

  it("refuses categories, filters and too many items with the rule's own words", async () => {
    const refused = await save(storeId, pageOf(grid([item("a")], { filters: true }), "refuse"));
    expect(refused).toEqual({ ok: false, problems: ["Filters are for grids of products."] });
    const many = await save(storeId, pageOf(grid(Array.from({ length: 61 }, (_, i) => item(`i${i}`))), "many"));
    expect(many.ok).toBe(false);
  });
});

describe("the media library and a custom item's picture", () => {
  it("finds the picture in use on the page, draft and published", async () => {
    const url = `${libraryOrigin}/storage/v1/object/public/product-media/${storeId}/${run}-boat.webp`;
    const [media] = await db().execute<Row>(sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, thumbnail_path, file_name, content_type, size_bytes, width, height, alt, alt_source)
      values (${storeId}::uuid, 'image', ${url}, ${`${url}-480`}, 'product-media', ${`${storeId}/${run}-boat.webp`}, ${`${storeId}/${run}-boat-480.webp`}, ${`boat-${run}.webp`}, 'image/webp', 1000, 800, 600, '', null)
      returning id
    `);
    const picture = { url, width: 800, height: 600, alt: "A boat" };
    const unused = await library.mediaUses({ storeId, storeSlug }, [String(media.id)]);
    expect(unused.get(String(media.id))).toEqual([]);
    const saved = await save(storeId, pageOf(grid([item("a", { picture })]), "boat"));
    expect(saved.ok).toBe(true);
    const uses = (await library.mediaUses({ storeId, storeSlug }, [String(media.id)])).get(String(media.id)) ?? [];
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ label: "Page: Page boat", href: expect.stringContaining("/admin/") });
  });
});
