import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import type { Blog } from "@/lib/blogs";
import { pageTag, pagesTag } from "@/lib/cache-tags";
import { pageExcerpt, parsePageContent, type PageContent, type PageType } from "@/lib/page-content";
import type { PageRole } from "@/lib/page-roles";
import { localizePage } from "@/lib/page-translation";

import { withPageAlts } from "./media-alts";
import { owned } from "./owned";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * The reads of published pages (bloat review step 2.21): the site's cached reads, the cards of a grid and a blog's feed, and the few
 * helpers they share with the writers. It imports the database client, the tag leaf, the page model, the media library's alt texts and
 * pure src/lib code, never src/server/pages.ts, which keeps the writers, imports these from here and re-exports them for its importers.
 * `route-load.graph.test.ts` holds it to 130 files and forbids it pages.ts, auth.ts, design-presets.ts, page-ai.ts and src/lib/signature.
 */

type Row = Record<string, unknown>;

/** Whose pages: a store's id, or null for Kaizen's own. */
export type PageOwner = string | null;

export const ownedBy = (owner: PageOwner, type: PageType) => sql`${owned(owner)} and type = ${type}`;

export const iso = (value: unknown) => (value == null ? null : new Date(String(value)).toISOString());

const documentRow = z.object({ id: col.uuid, slug: col.text, published: z.unknown(), draft: z.unknown() });

/**
 * The stored documents of an owner's pages by id, read whole (bloat review step 2.17): only for the rows a list or a card cannot answer
 * from its columns, a live page whose two copies differ as stored (with the draft) and a card with neither excerpt nor search description.
 */
export async function documentsById(owner: PageOwner, ids: readonly string[], withDraft: boolean, executor: Executor = db()): Promise<z.output<typeof documentRow>[]> {
  if (ids.length === 0) return [];
  return typedRows(
    documentRow,
    sql`
      select id, slug, published, case when ${withDraft} then draft end as draft from commerce.pages
      where id = any(${`{${ids.join(",")}}`}::uuid[]) and ${owned(owner)}
    `,
    executor,
  );
}

// ---------------------------------------------------------------------------
// The site
// ---------------------------------------------------------------------------

export type PublishedPage = {
  id: string;
  slug: string;
  content: PageContent;
  /** When it was last published (its last change on the site). */
  publishedAt: string;
  /** When it was first published: an article's date (D57). */
  firstPublishedAt: string;
};

const published = (row: Row, content: PageContent): PublishedPage => ({
  id: String(row.id),
  slug: String(row.slug),
  content,
  publishedAt: iso(row.published_at)!,
  firstPublishedAt: iso(row.first_published_at ?? row.published_at)!,
});

/**
 * Every published page with its whole document: only for readers that read every document, the sitemaps (the pictures in each page) and
 * llms.txt (each page's words in a language). One page: publishedPageById(). Addresses and titles: publishedPageIndex(). Cards with an
 * excerpt: articleCards() and a grid's pageCards() (bloat review step 2.17).
 */
export async function listPublishedPages(owner: PageOwner = null, type: PageType = "page"): Promise<PublishedPage[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  const rows = await readDb().execute<Row>(sql`
    select id, slug, published, published_at, first_published_at from commerce.pages
    where ${ownedBy(owner, type)} and published_at is not null
    order by ${type === "article" ? sql`coalesce(first_published_at, published_at) desc, slug` : sql`created_at`}
  `);
  // Pictures without alt texts of their own are described by the media library's (D89).
  return withPageAlts(
    rows.flatMap((row) => {
      const content = parsePageContent(row.published);
      return content ? [published(row, content)] : [];
    }),
  );
}

const publishedRow = z.object({
  id: col.uuid,
  slug: col.text,
  published: z.unknown(),
  published_at: col.timestamp,
  first_published_at: col.timestampOrNull,
});

const UUID = z.uuid();

/**
 * One published page of an owner's by its id, as the list of published pages gives it (same tag and life, so a publish or delete refreshes
 * it), or null: a draft, another owner's page, another type, or a document its schema rejects.
 */
export async function publishedPageById(owner: PageOwner, id: string, type: PageType = "page"): Promise<PublishedPage | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  cacheTag(pageTag(id));
  if (!UUID.safeParse(id).success) return null;
  const row = await typedRow(
    publishedRow,
    sql`
      select id, slug, published, published_at, first_published_at from commerce.pages
      where id = ${id}::uuid and ${ownedBy(owner, type)} and published_at is not null
    `,
    readDb(),
  );
  const content = row ? parsePageContent(row.published) : null;
  if (!row || !content) return null;
  return (await withPageAlts([published(row, content)]))[0];
}

export type PublishedPageEntry = {
  id: string;
  slug: string;
  title: string;
  /** The title in each language that has one of its own. */
  titles: Record<string, string>;
  publishedAt: string;
  firstPublishedAt: string;
  blogId: string | null;
  aiAssistants: boolean;
  searchEngines: boolean;
};

/**
 * The keys of a page index's entry, at run time: `page-list-facts.test.ts` maps each to a list fact or to what is not the page's
 * content (bloat review step 2.14). Its record's type fails the type check when an entry gains a key it lacks.
 */
const INDEX_FIELDS: Record<keyof PublishedPageEntry, true> = {
  id: true,
  slug: true,
  title: true,
  titles: true,
  publishedAt: true,
  firstPublishedAt: true,
  blogId: true,
  aiAssistants: true,
  searchEngines: true,
};
export const PAGE_INDEX_FIELDS: readonly string[] = Object.keys(INDEX_FIELDS);

const indexRow = z.object({
  id: col.uuid,
  slug: col.text,
  title: col.text,
  titles: z.record(z.string(), z.string()),
  published_at: col.timestamp,
  first_published_at: col.timestampOrNull,
  blog_id: col.textOrNull,
  ai_assistants: col.bool,
  search_engines: col.bool,
});

/**
 * Addresses, titles and flags of an owner's published pages, read from the stored JSON without parsing the document (that is the
 * saving). The list drops a published document its schema rejects; the index still names it, and its readers already meet a page that
 * is not drawn (a link that answers 404, a static param that prerenders a 404). On every page saved through savePage() the two agree.
 */
export async function publishedPageIndex(owner: PageOwner = null, type: PageType = "page"): Promise<PublishedPageEntry[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  const rows = await typedRows(
    indexRow,
    sql`
      select id, slug, coalesce(published_title, '') as title, published_titles as titles,
        published_at, first_published_at, published ->> 'blogId' as blog_id,
        coalesce((published ->> 'aiAssistants')::boolean, false) as ai_assistants,
        coalesce((published ->> 'searchEngines')::boolean, false) as search_engines
      from commerce.pages
      where ${ownedBy(owner, type)} and published_at is not null
      order by ${type === "article" ? sql`coalesce(first_published_at, published_at) desc, slug` : sql`created_at`}
    `,
    readDb(),
  );
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title,
    titles: row.titles,
    publishedAt: row.published_at,
    firstPublishedAt: row.first_published_at ?? row.published_at,
    blogId: row.blog_id,
    aiAssistants: row.ai_assistants,
    searchEngines: row.search_engines,
  }));
}

// ---------------------------------------------------------------------------
// Cards: what a grid of pages or articles and a blog's feed show of each (bloat review step 2.17)
// ---------------------------------------------------------------------------

/**
 * A published page's card facts in a language (`locale`; null, the page's own), read in SQL as `localizePage()` gives them: a translation
 * is a flat object of texts (`excerpt`, `seo.description`, `thumbnail.alt`) whose text replaces the stored one, a value that is not text
 * keeping it; nothing is cut to length. The title is the column the database derives (step 2.16). For `commerce.pages p`.
 */
export function pageCardColumns(locale: string | null): SQL {
  const tr = sql`(p.published -> 'translations' -> ${locale ?? ""}::text)`;
  const text = (key: string, stored: SQL) =>
    sql`nullif(case when jsonb_typeof(${tr} -> ${key}::text) = 'string' then ${tr} ->> ${key}::text else ${stored} end, '')`;
  return sql`p.id, p.slug, coalesce(nullif(p.published_titles ->> ${locale ?? ""}::text, ''), p.published_title) as title,
    ${text("excerpt", sql`p.published ->> 'excerpt'`)} as excerpt,
    ${text("seo.description", sql`p.published -> 'seo' ->> 'description'`)} as description,
    p.published -> 'thumbnail' ->> 'url' as image_url,
    case when jsonb_typeof(p.published -> 'thumbnail') <> 'object' then null
      when jsonb_typeof(${tr} -> 'thumbnail.alt') = 'string' then ${tr} ->> 'thumbnail.alt'
      else coalesce(p.published -> 'thumbnail' ->> 'alt', '') end as image_alt,
    p.published ->> 'blogId' as blog_id,
    case when jsonb_typeof(p.published -> 'markets') = 'array' then p.published -> 'markets' end as markets,
    p.published ->> 'author' as author, p.published ->> 'authorId' as author_id,
    coalesce(p.first_published_at, p.published_at) as first_published_at, p.published_at`;
}

export const pageCardRow = z.object({
  id: col.uuid,
  slug: col.text,
  title: col.textOrNull,
  excerpt: col.textOrNull,
  description: col.textOrNull,
  image_url: col.textOrNull,
  image_alt: col.textOrNull,
  blog_id: col.textOrNull,
  markets: z.array(z.string()).nullable(),
  author: col.textOrNull,
  author_id: col.textOrNull,
  first_published_at: col.timestamp,
  published_at: col.timestamp,
});

export type PageCard = {
  id: string;
  slug: string;
  title: string;
  /** Its excerpt, else its search description, else the start of its words, in the card's language. */
  excerpt: string;
  image: { url: string; alt: string } | null;
  blogId: string | null;
  /** The countries it is for (D338); null or empty, every one. */
  markets: string[] | null;
  author: string | null;
  authorId: string | null;
  /** When it was first published: an article's date (D57). */
  firstPublishedAt: string;
  publishedAt: string;
};

/**
 * Cards from their rows. A row without a title (a stored document that has none) is left out, as a document that does not parse was. The
 * start of a page's words (`pageExcerpt()`, at most `max` characters, in the language) is read only for a card with neither excerpt nor
 * search description: those documents alone, in one statement.
 */
export async function pageCards(owner: PageOwner, rows: readonly z.output<typeof pageCardRow>[], locale: string | null, max: number): Promise<PageCard[]> {
  const kept = rows.filter((row) => row.title !== null);
  const words = new Map<string, string>();
  const bare = kept.filter((row) => !row.excerpt && !row.description).map((row) => row.id);
  for (const doc of await documentsById(owner, bare, false, readDb())) {
    const content = parsePageContent(doc.published);
    if (content) words.set(doc.id, pageExcerpt(localizePage(content, locale), max));
  }
  return kept.map((row) => ({
    id: row.id,
    slug: row.slug,
    title: row.title ?? "",
    excerpt: row.excerpt || row.description || (words.get(row.id) ?? ""),
    image: row.image_url ? { url: row.image_url, alt: row.image_alt ?? "" } : null,
    blogId: row.blog_id,
    markets: row.markets,
    author: row.author,
    authorId: row.author_id,
    firstPublishedAt: row.first_published_at,
    publishedAt: row.published_at,
  }));
}

/**
 * Whether an article (`commerce.pages p`) belongs to a store's blog, in SQL: the first blog's are those that name none or a blog that is
 * gone, another's those that name it. The same rule as `inBlog()`.
 */
export function articleInBlog(blog: Pick<Blog, "id" | "main">): SQL {
  return blog.main
    ? sql`(p.published ->> 'blogId' is null or not exists (select 1 from commerce.blogs b where b.store_id = p.store_id and b.id::text = p.published ->> 'blogId' and not b.main))`
    : sql`p.published ->> 'blogId' = ${blog.id}`;
}

/** Whether a page (`commerce.pages p`) is listed in a country (D338): it names none, or that one. The same rule as `pageInMarket()`. */
export function pageInMarketSql(country: string): SQL {
  return sql`(coalesce(jsonb_array_length(p.published -> 'markets'), 0) = 0 or (p.published -> 'markets') ? ${country}::text)`;
}

/**
 * A store's published articles as cards in a language, newest first, at most `limit` (bloat review step 2.17): what a blog's feed shows,
 * read in SQL, with a blog's own and a country's own (D338) chosen there too. A document is read only for a card with neither excerpt nor
 * search description, for the start of its words (300 characters).
 */
export async function articleCards(
  storeId: string,
  locale: string,
  limit: number,
  { blog, market }: { blog?: Pick<Blog, "id" | "main">; market?: string } = {},
): Promise<PageCard[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(storeId));
  const rows = await typedRows(
    pageCardRow,
    sql`
      select ${pageCardColumns(locale)}
      from commerce.pages p
      where ${owned(storeId, sql`p.store_id`)} and p.type = 'article' and p.published_at is not null
        and ${blog ? articleInBlog(blog) : sql`true`}
        and ${market ? pageInMarketSql(market) : sql`true`}
      order by coalesce(p.first_published_at, p.published_at) desc, p.slug
      limit ${limit}
    `,
    readDb(),
  );
  return pageCards(storeId, rows, locale, 300);
}

/** The published page at an address, or where a page that was there went, or null. */
export async function findPublishedPage(
  owner: PageOwner,
  slug: string,
  type: PageType = "page",
): Promise<{ page: PublishedPage } | { redirect: string } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  const [row] = await readDb().execute<Row>(sql`
    select p.id, p.slug, p.published, p.published_at, p.first_published_at, p.slug <> ${slug} as moved
    from commerce.pages p
    where ${owned(owner, sql`p.store_id`)} and p.type = ${type} and p.published_at is not null
      and (p.slug = ${slug} or p.id = (
        select r.page_id from commerce.page_redirects r
        where ${owned(owner, sql`r.store_id`)} and r.type = ${type} and r.slug = ${slug}
      ))
    order by moved
    limit 1
  `);
  if (!row) return null;
  cacheTag(pageTag(String(row.id)));
  if (row.moved) return { redirect: String(row.slug) };
  const content = parsePageContent(row.published);
  if (!content) return null;
  const [page] = await withPageAlts([published(row, content)]);
  return { page };
}

/** The statement behind publishedPageNames(), apart so a test can explain it (bloat review step 2.16). */
export function namesQuery(owner: PageOwner, locale: string | null, type: PageType) {
  // The title in the shopper's language where the page is translated (D55), from the columns the database derives.
  const title = sql`coalesce(nullif(p.published_titles ->> ${locale ?? ""}, ''), p.published_title)`;
  return sql`
    select p.slug as address, p.slug, ${title} as title
    from commerce.pages p
    where ${owned(owner, sql`p.store_id`)} and p.type = ${type} and p.published_at is not null
    union all
    select r.slug, p.slug, ${title}
    from commerce.page_redirects r
    join commerce.pages p on p.id = r.page_id and p.published_at is not null
    where ${owned(owner, sql`r.store_id`)} and r.type = ${type}
  `;
}

/**
 * An owner's published pages by address, for menu links (D54): where each
 * is now and its title, also under the addresses it had before, so a link
 * follows a page that moved. Entries rather than a Map, to be cached.
 */
export async function publishedPageNames(
  owner: PageOwner,
  locale: string | null = null,
  type: PageType = "page",
): Promise<[string, { slug: string; title: string }][]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(owner));
  const rows = await readDb().execute<Row>(namesQuery(owner, locale, type));
  return rows.map((row) => [String(row.address), { slug: String(row.slug), title: String(row.title ?? row.slug) }]);
}

/**
 * Whether any of the owner's published documents (a page, an article, a header, a footer, a layout) holds a content grid of pages
 * ordered by when each was last published: every sort but by title (`gridPages()`: newest first, the default, and oldest first). There a
 * page's publish moves it in the grid, so it refreshes the whole site (bloat review step 2.14). Read fresh, never cached: a grid added a
 * moment ago counts at once.
 */
export async function hasPageGridByDate(owner: PageOwner, executor: Executor = db()): Promise<boolean> {
  const row = await typedRow(
    z.object({ found: col.bool }),
    sql`
      select exists (
        select 1 from commerce.pages
        where ${owned(owner)} and published_at is not null
          and jsonb_path_exists(published, '$.** ? (@.type == "contentGrid" && @.source.type == "pages" && (!exists(@.sort) || @.sort != "title"))')
      ) as found
    `,
    executor,
  );
  return row?.found ?? false;
}

/** A store's All products page (D83) while it is published, else null (the standard list). */
export async function productsPageOf(store: { id: string; productsPageId: string | null }): Promise<PublishedPage | null> {
  if (!store.productsPageId) return null;
  return publishedPageById(store.id, store.productsPageId);
}

/** The store's page for a role (D112) while it is published, else null (the standard page shows). */
export async function pageForRole(store: { id: string; pageRoles: Partial<Record<PageRole, string>> }, role: PageRole): Promise<PublishedPage | null> {
  const id = store.pageRoles[role];
  if (!id) return null;
  return publishedPageById(store.id, id);
}
