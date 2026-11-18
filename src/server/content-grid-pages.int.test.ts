import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { countStatements } from "@/db/statement-count";
import { newPageContent, type ContentGridBlock, type PageContent } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const { gridData } = await import("./content-grid");
const { makeCapacityStore } = await import("./capacity-test-support");
const { documentsRead, selectsDocument } = await import("./page-documents-test-support");

type Row = Record<string, unknown>;

/**
 * A grid of articles draws its cards from SQL (bloat review step 2.17): the same items as the parsed and localized documents gave, and a
 * document read only for a card with neither excerpt nor search description.
 */

const run = Date.now().toString(36);
let storeId = "";
let storeSlug = "";
let otherBlog = "";
const grid = (overrides: Partial<ContentGridBlock> = {}): ContentGridBlock => ({
  ...(newBlock("contentGrid", () => "g") as ContentGridBlock),
  source: { type: "articles" },
  limit: 48,
  ...overrides,
});

/** An article as savePage() stores it: one paragraph of words, so a card without an excerpt has the start of them. */
const article = (slug: string, overrides: Partial<PageContent> = {}): PageContent => ({
  ...newPageContent(),
  title: `Title ${slug}`,
  slug,
  rows: [
    {
      id: "row-1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "column-1",
          blocks: [{ id: "block-1", type: "richText", doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `The words of ${slug}.` }] }] } }],
        },
      ],
    },
  ] as PageContent["rows"],
  ...overrides,
});

/** Inserts published articles, the first newest. */
async function publish(contents: PageContent[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [n, content] of contents.entries()) {
    const json = JSON.stringify(content);
    const [row] = await db().execute<Row>(sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
      values (${storeId}::uuid, 'article', ${content.slug}, ${json}::jsonb, ${json}::jsonb, now(), ${`2026-10-01T10:00:00Z`}::timestamptz - make_interval(hours => ${n}))
      returning id
    `);
    ids.push(String(row.id));
  }
  return ids;
}

beforeAll(async () => {
  const store = await makeCapacityStore("grid-cards", run);
  storeId = store.id;
  storeSlug = store.slug;
  // Two countries in two languages: Norway in Norwegian and Finland in English.
  await db().execute(sql`update commerce.markets set active = false where store_id = ${storeId}::uuid and code not in ('NO', 'FI')`);
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values
      (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', '{nb-NO}', true), (${storeId}::uuid, 'FI', 'EUR', 'en-GB', '{en-GB}', true)
    on conflict (store_id, code) do update set default_locale = excluded.default_locale, locales = excluded.locales, active = true
  `);
  // Several countries (D178), so each has its own address; and none of the store's demo articles.
  await db().execute(sql`update commerce.stores set features = array(select distinct unnest(features || '{countries}'::text[])) where id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.pages where store_id = ${storeId}::uuid and type = 'article'`);
  await db().execute(sql`
    insert into commerce.blogs (store_id, handle, main, titles) values (${storeId}::uuid, 'blog', true, '{}'::jsonb) on conflict do nothing
  `);
  const [other] = await db().execute<Row>(sql`
    insert into commerce.blogs (store_id, handle, main, titles, position) values (${storeId}::uuid, ${`news-${run}`}, false, '{}'::jsonb, 1) returning id
  `);
  otherBlog = String(other.id);
});

afterEach(async () => {
  await db().execute(sql`delete from commerce.pages where store_id = ${storeId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

const picture = { url: "https://example.com/cup.jpg", width: 800, height: 600, alt: "A cup" };

describe("a grid of articles drawn from SQL (bloat review step 2.17)", () => {
  it("gives the same items as the localized documents, in Norwegian and in English", async () => {
    const [translated, described, bare, pictured, elsewhere, titleOnly] = await publish([
      article(`translated-${run}`, { excerpt: "An excerpt", translations: { "nb-NO": { title: "Oversatt", excerpt: "Et utdrag" } } }),
      article(`described-${run}`, { seo: { title: "", description: "A description" }, translations: { "nb-NO": { "seo.description": "En beskrivelse" } } }),
      article(`bare-${run}`),
      article(`pictured-${run}`, { excerpt: "With a picture", thumbnail: picture, translations: { "nb-NO": { "thumbnail.alt": "En kopp" } } }),
      article(`elsewhere-${run}`, { excerpt: "In the other blog", blogId: otherBlog }),
      article(`title-only-${run}`, { excerpt: "Only the title is translated", translations: { "nb-NO": { title: "Bare tittelen" } } }),
    ]);
    const base = (market: string) => `/s/${storeSlug}/${market}`;
    const date = (hours: number) => new Date(Date.parse("2026-10-01T10:00:00Z") - hours * 3_600_000).toISOString();
    const items = async (market: string) =>
      (await gridData(grid(), { pageId: null, owner: storeId, market: market.toUpperCase() })).items.map(({ id, href, title, excerpt, image, date }) => ({ id, href, title, excerpt, image, date }));
    expect(await items("no")).toEqual([
      { id: translated, href: `${base("no")}/blog/translated-${run}`, title: "Oversatt", excerpt: "Et utdrag", image: null, date: date(0) },
      { id: described, href: `${base("no")}/blog/described-${run}`, title: `Title described-${run}`, excerpt: "En beskrivelse", image: null, date: date(1) },
      { id: bare, href: `${base("no")}/blog/bare-${run}`, title: `Title bare-${run}`, excerpt: `The words of bare-${run}.`, image: null, date: date(2) },
      { id: pictured, href: `${base("no")}/blog/pictured-${run}`, title: `Title pictured-${run}`, excerpt: "With a picture", image: { url: picture.url, alt: "En kopp" }, date: date(3) },
      { id: elsewhere, href: `${base("no")}/blogs/news-${run}/elsewhere-${run}`, title: `Title elsewhere-${run}`, excerpt: "In the other blog", image: null, date: date(4) },
      { id: titleOnly, href: `${base("no")}/blog/title-only-${run}`, title: "Bare tittelen", excerpt: "Only the title is translated", image: null, date: date(5) },
    ]);
    expect(await items("fi")).toEqual([
      { id: translated, href: `${base("fi")}/blog/translated-${run}`, title: `Title translated-${run}`, excerpt: "An excerpt", image: null, date: date(0) },
      { id: described, href: `${base("fi")}/blog/described-${run}`, title: `Title described-${run}`, excerpt: "A description", image: null, date: date(1) },
      { id: bare, href: `${base("fi")}/blog/bare-${run}`, title: `Title bare-${run}`, excerpt: `The words of bare-${run}.`, image: null, date: date(2) },
      { id: pictured, href: `${base("fi")}/blog/pictured-${run}`, title: `Title pictured-${run}`, excerpt: "With a picture", image: { url: picture.url, alt: "A cup" }, date: date(3) },
      { id: elsewhere, href: `${base("fi")}/blogs/news-${run}/elsewhere-${run}`, title: `Title elsewhere-${run}`, excerpt: "In the other blog", image: null, date: date(4) },
      { id: titleOnly, href: `${base("fi")}/blog/title-only-${run}`, title: `Title title-only-${run}`, excerpt: "Only the title is translated", image: null, date: date(5) },
    ]);
  });

  it("reads no document for 24 articles that all have excerpts", async () => {
    await publish(Array.from({ length: 24 }, (_, n) => article(`excerpt-${n}-${run}`, { excerpt: `Excerpt ${n}` })));
    const { result, statements } = await countStatements(() => gridData(grid({ limit: 24 }), { pageId: null, owner: storeId, market: "NO" }));
    expect(result.items).toHaveLength(24);
    expect(statements.filter((s) => selectsDocument(s.text))).toEqual([]);
    expect(documentsRead(statements)).toBe(0);
  });

  it("reads the documents of the cards with neither excerpt nor description, and only those", async () => {
    await publish(
      Array.from({ length: 24 }, (_, n) => (n === 3 || n === 17 ? article(`plain-${n}-${run}`) : article(`excerpt-${n}-${run}`, { excerpt: `Excerpt ${n}` }))),
    );
    const { result, statements } = await countStatements(() => gridData(grid({ limit: 24 }), { pageId: null, owner: storeId, market: "NO" }));
    expect(result.items).toHaveLength(24);
    const documents = statements.filter((s) => selectsDocument(s.text));
    expect(documents).toHaveLength(1);
    expect(documents[0].rows).toBe(2);
    expect(result.items[3].excerpt).toBe(`The words of plain-3-${run}.`);
  });
});
