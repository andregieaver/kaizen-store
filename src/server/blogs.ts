import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import { atomFeed, FEED_ENTRIES_MAX } from "@/lib/atom";
import {
  articlePath,
  authorProblems,
  blogOfArticle,
  blogPath,
  blogProblems,
  blogTitle,
  feedPath,
  inBlog,
  type AuthorProblem,
  type Blog,
  type BlogAuthor,
  type BlogCommentSetting,
  type BlogInput,
  type BlogProblem,
} from "@/lib/blogs";
import { isSafeAddress } from "@/lib/field-parts";
import { t } from "@/lib/i18n";
import { pageExcerpt, type PageContent } from "@/lib/page-content";
import { pageInMarket } from "@/lib/page-markets";
import { localizePage } from "@/lib/page-translation";
import { marketUrl } from "@/lib/paths";

import { audit, type Account } from "./auth";
import { listPublishedPages, pagesTag, type PublishedPage } from "./pages";
import { resolveShop } from "./shop";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's blogs and authors (wave 7 unit G, D341, `docs/wave-7-storefront.md` G): the only writer of `commerce.blogs` and
 * `commerce.blog_authors`, and the reads the storefront, the feed, the admin and the AI manager share. Blogs and authors are part of what
 * a store's pages draw, so they are cached under the store's pages tag (`pagesTag()`), which every change here refreshes.
 */

const blogRow = z.object({
  id: col.uuid,
  handle: col.text,
  main: col.bool,
  titles: z.record(z.string(), z.string()).catch({}),
  listing_page_id: col.uuid.nullable(),
  comments: z.enum(["off", "moderated", "automatic"]),
  position: col.int,
});

const toBlog = (row: z.output<typeof blogRow>): Blog => ({
  id: row.id,
  handle: row.handle,
  main: row.main,
  titles: row.titles,
  listingPageId: row.listing_page_id,
  comments: row.comments,
  position: row.position,
});

const blogsQuery = (storeId: string) => sql`
  select id, handle, main, titles, listing_page_id, comments, position from commerce.blogs
  where store_id = ${storeId}::uuid order by main desc, position, created_at
`;

/** The store's blogs, its first one first, for its pages (cached with its pages). */
export async function storeBlogs(storeId: string): Promise<Blog[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(storeId));
  return (await typedRows(blogRow, blogsQuery(storeId), readDb())).map(toBlog);
}

/** The same, read now: for the admin and anything that writes. */
export async function blogsNow(storeId: string): Promise<Blog[]> {
  return (await typedRows(blogRow, blogsQuery(storeId))).map(toBlog);
}

const authorRow = z.object({ id: col.uuid, name: col.text, picture_url: col.textOrNull, bio: col.text, link: col.textOrNull });
const toAuthor = (row: z.output<typeof authorRow>): BlogAuthor => ({ id: row.id, name: row.name, picture: row.picture_url, bio: row.bio, link: row.link });
const authorsQuery = (storeId: string) => sql`
  select id, name, picture_url, bio, link from commerce.blog_authors where store_id = ${storeId}::uuid order by lower(name), created_at
`;

/** The store's authors, for its articles (cached with its pages). */
export async function storeAuthors(storeId: string): Promise<BlogAuthor[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(storeId));
  return (await typedRows(authorRow, authorsQuery(storeId), readDb())).map(toAuthor);
}

export async function authorsNow(storeId: string): Promise<BlogAuthor[]> {
  return (await typedRows(authorRow, authorsQuery(storeId))).map(toAuthor);
}

/** An article's author record, when it names one of the store's. */
export const authorOf = (authors: readonly BlogAuthor[], content: Pick<PageContent, "authorId">): BlogAuthor | null =>
  content.authorId ? (authors.find((a) => a.id === content.authorId) ?? null) : null;

/** Who wrote an article, by name: its author record, else its free-text name, else the store. */
export const bylineOf = (author: BlogAuthor | null, content: Pick<PageContent, "author">, store: string): string =>
  author?.name || content.author || store;

// ---------------------------------------------------------------------------------------------------------------------------------
// Articles by blog
// ---------------------------------------------------------------------------------------------------------------------------------

/** The blog's published articles, newest first (an article without a blog of its own is the first blog's). */
export async function blogArticles(storeId: string, blog: Pick<Blog, "id">): Promise<PublishedPage[]> {
  const [blogs, articles] = await Promise.all([storeBlogs(storeId), listPublishedPages(storeId, "article")]);
  return articles.filter((article) => inBlog(blogs, blog, article.content));
}

/** The blog at an address: the first one for `/blog` (handle null), else the one with that handle (never the first one's). */
export async function findBlog(storeId: string, handle: string | null): Promise<Blog | null> {
  const blogs = await storeBlogs(storeId);
  return (handle === null ? blogs.find((b) => b.main) : blogs.find((b) => !b.main && b.handle === handle)) ?? null;
}

/** Where an article lives: its blog and its address inside a market. */
export async function articlePlace(storeId: string, content: Pick<PageContent, "blogId">, slug: string): Promise<{ blog: Blog; path: string } | null> {
  const blog = blogOfArticle(await storeBlogs(storeId), content);
  return blog ? { blog, path: articlePath(blog, slug) } : null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * A blog's Atom feed in one market (its language): its published articles, newest first, with title, summary, date, author and address.
 * Cached with the store's pages, so publishing, unpublishing or a schedule's run refreshes it. Null when there is no such store, market
 * or blog.
 */
export async function blogFeed(storeSlug: string, marketSlug: string, handle: string | null): Promise<string | null> {
  "use cache";
  cacheLife("hours");
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  const { store, market } = shop;
  cacheTag(pagesTag(store.id));
  const blog = await findBlog(store.id, handle);
  if (!blog) return null;
  const [all, authors] = await Promise.all([blogArticles(store.id, blog), storeAuthors(store.id)]);
  // An article for other countries only (D338) is not in this country's feed.
  const articles = all.filter((article) => pageInMarket(article.content, market.code));
  const m = t(market.lang);
  const name = blogTitle(blog, market.locale, store.localization.locales[0], m.blog);
  const url = (path: string) => marketUrl(store.slug, market.slug, path);
  return atomFeed({
    id: url(blogPath(blog)),
    title: `${name} · ${store.name}`,
    link: url(blogPath(blog)),
    self: url(feedPath(blog)),
    lang: market.locale,
    author: store.name,
    // A blog with no articles yet: the moment the feed was made (cached with the pages).
    fallbackUpdated: new Date().toISOString(),
    entries: articles.slice(0, FEED_ENTRIES_MAX).map((article) => {
      const c = localizePage(article.content, market.locale);
      const link = url(articlePath(blog, article.slug));
      return {
        id: link,
        title: c.title,
        link,
        summary: c.excerpt || c.seo.description || pageExcerpt(c, 300),
        published: article.firstPublishedAt,
        updated: article.publishedAt,
        author: bylineOf(authorOf(authors, c), c, store.name),
      };
    }),
  });
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Writing blogs
// ---------------------------------------------------------------------------------------------------------------------------------

export type BlogSaveResult = { ok: true; id: string } | { ok: false; problems: BlogProblem[] | ["missing"] | ["listing_page"] };

/** The names the store's languages may have: only its own locales, trimmed, empty ones left out. */
const cleanTitles = (titles: Record<string, string>, locales: readonly string[]) =>
  Object.fromEntries(
    Object.entries(titles)
      .filter(([locale]) => locales.includes(locale))
      .map(([locale, title]) => [locale, title.trim()] as const)
      .filter(([, title]) => title.length > 0),
  );

/**
 * Saves a blog: a new one (`id` null) or one of the store's. The first blog keeps its address (`/blog`) and lists on the `blog` page role,
 * so its handle and listing page are not taken from the input. A listing page must be one of the store's pages. Audited.
 */
export async function saveBlog(account: Account, store: Pick<Store, "id" | "localization">, id: string | null, input: BlogInput): Promise<BlogSaveResult> {
  const blogs = await blogsNow(store.id);
  const current = id === null ? null : (blogs.find((b) => b.id === id) ?? null);
  if (id !== null && !current) return { ok: false, problems: ["missing"] };
  const main = current?.main ?? false;
  const handle = input.handle.trim().toLowerCase();
  const problems = blogProblems(
    { ...input, handle },
    { main, others: blogs.filter((b) => b.id !== id).map((b) => b.handle), count: id === null ? blogs.length : 0 },
  );
  if (problems.length > 0) return { ok: false, problems };
  const titles = cleanTitles(input.titles, store.localization.keptLocales);
  const listing = main ? null : input.listingPageId;
  if (listing) {
    const own = await typedRow(z.object({ ok: col.bool }), sql`
      select exists (select 1 from commerce.pages where id = ${listing}::uuid and store_id = ${store.id}::uuid and type = 'page') as ok
    `);
    if (!own?.ok) return { ok: false, problems: ["listing_page"] };
  }
  const comments = input.comments as BlogCommentSetting;
  let savedId: string;
  if (current) {
    await db().execute(sql`
      update commerce.blogs set handle = ${main ? current.handle : handle}, titles = ${JSON.stringify(titles)}::jsonb,
        listing_page_id = ${listing}::uuid, comments = ${comments}, updated_at = now()
      where id = ${current.id}::uuid and store_id = ${store.id}::uuid
    `);
    savedId = current.id;
  } else {
    const row = await typedRow(z.object({ id: col.uuid }), sql`
      insert into commerce.blogs (store_id, handle, titles, listing_page_id, comments, position)
      values (${store.id}::uuid, ${handle}, ${JSON.stringify(titles)}::jsonb, ${listing}::uuid, ${comments},
        (select coalesce(max(position), 0) + 1 from commerce.blogs where store_id = ${store.id}::uuid))
      returning id
    `);
    savedId = row!.id;
  }
  await audit(
    account.id,
    store.id,
    "store.article_blog_saved",
    { blog: savedId, handle: main ? "blog" : handle, comments, created: current === null },
    { target: { type: "blog", id: savedId } },
  );
  return { ok: true, id: savedId };
}

export type BlogDeleteResult = { ok: true } | { ok: false; problem: "missing" | "main" | "articles" };

/** Deletes one of the store's blogs other than the first, only while no article (draft or published) names it. Audited. */
export async function deleteBlog(account: Account, storeId: string, id: string): Promise<BlogDeleteResult> {
  const blog = (await blogsNow(storeId)).find((b) => b.id === id);
  if (!blog) return { ok: false, problem: "missing" };
  if (blog.main) return { ok: false, problem: "main" };
  const used = await typedRow(z.object({ n: col.int }), sql`
    select count(*)::int as n from commerce.pages
    where store_id = ${storeId}::uuid and type = 'article' and (draft ->> 'blogId' = ${id} or published ->> 'blogId' = ${id})
  `);
  if ((used?.n ?? 0) > 0) return { ok: false, problem: "articles" };
  await db().execute(sql`delete from commerce.blogs where id = ${id}::uuid and store_id = ${storeId}::uuid and not main`);
  await audit(account.id, storeId, "store.article_blog_deleted", { blog: id, handle: blog.handle }, { target: { type: "blog", id } });
  return { ok: true };
}

/** How many articles (drafts included) each of the store's blogs has, by blog id; the first blog counts those that name none. */
export async function articleCounts(storeId: string): Promise<Map<string, number>> {
  const [blogs, rows] = await Promise.all([
    blogsNow(storeId),
    typedRows(z.object({ blog: col.textOrNull, n: col.int }), sql`
      select draft ->> 'blogId' as blog, count(*)::int as n from commerce.pages
      where store_id = ${storeId}::uuid and type = 'article' group by 1
    `),
  ]);
  const counts = new Map<string, number>(blogs.map((b) => [b.id, 0]));
  for (const row of rows) {
    const blog = blogOfArticle(blogs, { blogId: row.blog ?? undefined });
    if (blog) counts.set(blog.id, (counts.get(blog.id) ?? 0) + row.n);
  }
  return counts;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Writing authors
// ---------------------------------------------------------------------------------------------------------------------------------

export type AuthorInput = { name: string; picture: string | null; bio: string; link: string | null };
export type AuthorSaveResult = { ok: true; id: string } | { ok: false; problems: AuthorProblem[] | ["missing"] | ["picture"] };

/** Saves an author (new with `id` null). The picture must be in the store's media library; the link a safe address. Audited without the name. */
export async function saveAuthor(account: Account, storeId: string, id: string | null, input: AuthorInput): Promise<AuthorSaveResult> {
  const authors = await authorsNow(storeId);
  if (id !== null && !authors.some((a) => a.id === id)) return { ok: false, problems: ["missing"] };
  const clean = { name: input.name.trim(), bio: input.bio.trim(), link: input.link?.trim() || null, picture: input.picture?.trim() || null };
  const problems = authorProblems(clean, { count: id === null ? authors.length : 0, safe: isSafeAddress });
  if (problems.length > 0) return { ok: false, problems };
  if (clean.picture) {
    const own = await typedRow(z.object({ ok: col.bool }), sql`
      select exists (select 1 from commerce.media where store_id = ${storeId}::uuid and (url = ${clean.picture} or thumbnail_url = ${clean.picture})) as ok
    `);
    if (!own?.ok) return { ok: false, problems: ["picture"] };
  }
  let savedId: string;
  if (id) {
    await db().execute(sql`
      update commerce.blog_authors set name = ${clean.name}, picture_url = ${clean.picture}, bio = ${clean.bio}, link = ${clean.link}, updated_at = now()
      where id = ${id}::uuid and store_id = ${storeId}::uuid
    `);
    savedId = id;
  } else {
    const row = await typedRow(z.object({ id: col.uuid }), sql`
      insert into commerce.blog_authors (store_id, name, picture_url, bio, link)
      values (${storeId}::uuid, ${clean.name}, ${clean.picture}, ${clean.bio}, ${clean.link}) returning id
    `);
    savedId = row!.id;
  }
  await audit(account.id, storeId, "store.article_author_saved", { author: savedId, created: id === null }, { target: { type: "blog_author", id: savedId } });
  return { ok: true, id: savedId };
}

/** Deletes an author; articles that named them show their free-text name again. Audited. */
export async function deleteAuthor(account: Account, storeId: string, id: string): Promise<boolean> {
  const rows = await db().execute(sql`delete from commerce.blog_authors where id = ${id}::uuid and store_id = ${storeId}::uuid returning id`);
  if (rows.length === 0) return false;
  await audit(account.id, storeId, "store.article_author_deleted", { author: id }, { target: { type: "blog_author", id } });
  return true;
}
