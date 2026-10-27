import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { COMMENTS_PER_VISITOR_HOUR } from "@/lib/blog-comments";
import { newPageContent, type PageContent } from "@/lib/page-content";
import { childText, childrenNamed, parseXml } from "@/lib/xml-tree.test-helper";

import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { savePage, getPageForEdit } = await import("./pages");
const { blogFeed, blogsNow, deleteBlog, saveAuthor, saveBlog, storeBlogs, articleCounts } = await import("./blogs");
const { approvedComments, commentsOf, countCommentsOf, deleteComment, eraseComments, listComments, moderateComment, postComment } = await import("./blog-comments");
const { cancelSchedule, runSchedules, scheduleOf, schedulePage } = await import("./page-schedules");
const { preflightOwnerTool, runOwnerTool } = await import("./owner-tools");

type Row = Record<string, unknown>;

/**
 * Blogs in depth (wave 7 unit G, D341, `docs/wave-7-storefront.md` G): a store's first blog is there from its first moment and another is
 * made through the Blogs page's writer; an article names only its own store's blog and author; each blog's Atom feed lists its published
 * articles only (a test parses it); visitors' comments are counted per visitor, checked for spam and kept as the blog says, one store never
 * reaching another's, exported and erased by the person's address; a scheduled article is published by the job at its time in the name of
 * who scheduled it, and not before; and the AI manager reads and proposes the same.
 */

let fx: Fixture;
let other: Fixture;
const run = Date.now().toString(36);

const article = (slug: string, o: Partial<PageContent> = {}): PageContent => ({ ...newPageContent(), title: `Article ${slug}`, slug: `${slug}-${run}`, ...o });

async function saved(fixture: Fixture, content: PageContent, publish: boolean, id: string | null = null): Promise<string> {
  const { account } = await ownerOf(fixture);
  const result = await savePage(account, fixture.storeId, id, content, { publish, type: "article" });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
}

/** A visitor's comment, each from an address of its own unless one is given (the limit per visitor is tested apart). */
let visitor = 0;
const post = (fixture: Fixture, articleId: string, o: Partial<Parameters<typeof postComment>[0]> = {}, address = `10.0.${run.length}.${++visitor}`) =>
  postComment({ store: fixture.slug, market: "no", article: articleId, name: "Kari", email: "", body: `A thoughtful comment ${Math.random()}`, website: "", elapsed: 30_000, ...o }, address);

beforeAll(async () => {
  fx = await makeStore("blogs");
  other = await makeStore("blogs-other");
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("blogs", () => {
  it("gives a new store its first blog at /blog, and another through the Blogs page's writer", async () => {
    const blogs = await blogsNow(fx.storeId);
    expect(blogs.map((b) => [b.handle, b.main, b.comments])).toEqual([["blog", true, "moderated"]]);
    const { account, store } = await ownerOf(fx);
    const made = await saveBlog(account, store, null, { handle: "news", titles: { "nb-NO": "Nyheter" }, comments: "automatic", listingPageId: null });
    expect(made.ok).toBe(true);
    expect(await saveBlog(account, store, null, { handle: "news", titles: {}, comments: "moderated", listingPageId: null })).toEqual({ ok: false, problems: ["handle_taken"] });
    // Another store's page is never a blog's listing page.
    const [foreign] = await db().execute<Row>(sql`insert into commerce.pages (store_id, type, slug, draft) values (${other.storeId}::uuid, 'page', ${`p-${run}`}, '{}'::jsonb) returning id`);
    expect(await saveBlog(account, store, null, { handle: "tips", titles: {}, comments: "moderated", listingPageId: String(foreign.id) })).toEqual({ ok: false, problems: ["listing_page"] });
    // The first blog stays at /blog whatever is typed.
    const main = (await blogsNow(fx.storeId)).find((b) => b.main)!;
    expect((await saveBlog(account, store, main.id, { handle: "renamed", titles: { "nb-NO": "Bloggen" }, comments: "off", listingPageId: null })).ok).toBe(true);
    expect((await blogsNow(fx.storeId)).find((b) => b.main)).toMatchObject({ handle: "blog", comments: "off", titles: { "nb-NO": "Bloggen" } });
    await saveBlog(account, store, main.id, { handle: "", titles: {}, comments: "moderated", listingPageId: null });
    // One store never sees another's.
    expect((await blogsNow(other.storeId)).map((b) => b.handle)).toEqual(["blog"]);
    expect(await deleteBlog(account, other.storeId, made.ok ? made.id : "")).toEqual({ ok: false, problem: "missing" });
    expect(await deleteBlog(account, fx.storeId, main.id)).toEqual({ ok: false, problem: "main" });
  });

  it("keeps an article's blog and author only when they are the store's own, and refuses deleting a blog with articles", async () => {
    const news = (await blogsNow(fx.storeId)).find((b) => b.handle === "news")!;
    const otherMain = (await blogsNow(other.storeId))[0];
    const { account } = await ownerOf(fx);
    const author = await saveAuthor(account, fx.storeId, null, { name: "Kari Nordmann", picture: null, bio: "Writes about coffee.", link: "https://kari.example" });
    expect(author.ok).toBe(true);
    expect(await saveAuthor(account, fx.storeId, null, { name: "X", picture: null, bio: "", link: "javascript:alert(1)" })).toEqual({ ok: false, problems: ["link_unsafe"] });
    expect(await saveAuthor(account, fx.storeId, null, { name: "X", picture: "https://elsewhere.example/a.webp", bio: "", link: null })).toEqual({ ok: false, problems: ["picture"] });
    const authorId = author.ok ? author.id : "";
    const id = await saved(fx, article("in-news", { blogId: news.id, authorId }), true);
    expect((await getPageForEdit(fx.storeId, id, "article"))!.draft).toMatchObject({ blogId: news.id, authorId });
    // Another store's blog and the first blog are not written down: the article is the first blog's.
    const foreign = await saved(fx, article("foreign", { blogId: otherMain.id, authorId }), false);
    expect((await getPageForEdit(fx.storeId, foreign, "article"))!.draft.blogId).toBeUndefined();
    const elsewhere = await saved(other, article("no-author", { authorId }), false);
    expect((await getPageForEdit(other.storeId, elsewhere, "article"))!.draft.authorId).toBeUndefined();
    expect((await articleCounts(fx.storeId)).get(news.id)).toBe(1);
    expect(await deleteBlog(account, fx.storeId, news.id)).toEqual({ ok: false, problem: "articles" });
  });
});

describe("the Atom feed", () => {
  it("lists a blog's published articles with title, summary, date, author and address, and nothing else", async () => {
    const news = (await storeBlogs(fx.storeId)).find((b) => b.handle === "news")!;
    await saved(fx, article("news-two", { blogId: news.id, excerpt: "The second piece of news." }), true);
    await saved(fx, article("news-draft", { blogId: news.id }), false);
    await saved(fx, article("main-one"), true);
    const doc = parseXml((await blogFeed(fx.slug, "no", "news"))!);
    expect(doc.name).toBe("feed");
    const entries = childrenNamed(doc, "entry");
    const titles = entries.map((e) => childText(e, "title"));
    expect(titles).toEqual(expect.arrayContaining([`Article news-two`, `Article in-news`]));
    expect(titles).not.toContain("Article news-draft");
    expect(titles).not.toContain("Article main-one");
    const two = entries.find((e) => childText(e, "title") === "Article news-two")!;
    expect(childText(two, "summary")).toBe("The second piece of news.");
    expect(childrenNamed(two, "link")[0].attributes.href).toMatch(new RegExp(`/blogs/news/news-two-${run}$`));
    const inNews = entries.find((e) => childText(e, "title") === "Article in-news")!;
    expect(childText(childrenNamed(inNews, "author")[0], "name")).toBe("Kari Nordmann");
    expect(childrenNamed(doc, "link").find((l) => l.attributes.rel === "self")!.attributes.href).toMatch(/\/blogs\/news\/feed\.atom$/);
    // The first blog's feed has its own articles only; a blog that is not there has no feed.
    const main = parseXml((await blogFeed(fx.slug, "no", null))!);
    expect(childrenNamed(main, "entry").map((e) => childText(e, "title"))).toContain("Article main-one");
    expect(childrenNamed(main, "entry").map((e) => childText(e, "title"))).not.toContain("Article news-two");
    expect(await blogFeed(fx.slug, "no", "nothing-here")).toBeNull();
    expect(await blogFeed(other.slug, "no", "news")).toBeNull();
  });
});

describe("comments", () => {
  let mainArticle: string;
  let newsArticle: string;
  let otherArticle: string;

  beforeAll(async () => {
    const news = (await blogsNow(fx.storeId)).find((b) => b.handle === "news")!;
    mainArticle = await saved(fx, article("commented"), true);
    newsArticle = await saved(fx, article("commented-news", { blogId: news.id }), true);
    otherArticle = await saved(other, article("other-commented"), true);
  });

  it("holds a comment for staff on a moderated blog, shows one at once on an automatic blog, and takes none with comments off", async () => {
    const held = await post(fx, mainArticle);
    expect(held).toEqual({ status: 200, body: { ok: true, shown: false } });
    expect(await approvedComments(fx.storeId, mainArticle)).toEqual([]);
    const shown = await post(fx, newsArticle, { body: "Shown at once, thank you." });
    expect(shown).toEqual({ status: 200, body: { ok: true, shown: true } });
    expect((await approvedComments(fx.storeId, newsArticle)).map((c) => c.body)).toEqual(["Shown at once, thank you."]);
    const { account, store } = await ownerOf(fx);
    const main = (await blogsNow(fx.storeId)).find((b) => b.main)!;
    await saveBlog(account, store, main.id, { handle: "", titles: {}, comments: "off", listingPageId: null });
    expect((await post(fx, mainArticle)).body).toEqual({ ok: false, error: "closed" });
    await saveBlog(account, store, main.id, { handle: "", titles: {}, comments: "moderated", listingPageId: null });
  });

  it("checks for spam in code: a robot's is dropped, links and the same text again are kept as spam and never shown", async () => {
    const before = (await listComments(fx.storeId, "spam")).length;
    expect((await post(fx, newsArticle, { website: "http://robot.example" })).body).toEqual({ ok: true, shown: false });
    expect((await post(fx, newsArticle, { body: "Cheap at https://a.example and https://b.example" })).body).toEqual({ ok: true, shown: false });
    expect((await post(fx, newsArticle, { body: "Shown at once, thank you." })).body).toEqual({ ok: true, shown: false });
    expect((await post(fx, newsArticle, { elapsed: 500 })).body).toEqual({ ok: true, shown: false });
    const spam = await listComments(fx.storeId, "spam");
    expect(spam.length - before).toBe(3);
    expect(spam.flatMap((c) => c.spamReasons)).toEqual(expect.arrayContaining(["links", "repeated", "too_fast"]));
    // A robot's comment was not kept at all.
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.blog_comments where store_id = ${fx.storeId}::uuid and spam_reasons @> array['honeypot']`);
    expect(Number(kept.n)).toBe(0);
    expect((await approvedComments(fx.storeId, newsArticle)).map((c) => c.body)).toEqual(["Shown at once, thank you."]);
  });

  it("counts a visitor's comments by a hash of their address, never keeping the address", async () => {
    const address = "203.0.113.9";
    const send = () => postComment({ store: other.slug, market: "no", article: otherArticle, name: "Ola", email: "", body: `Comment ${Math.random()}`, website: "", elapsed: 20_000 }, address);
    for (let i = 0; i < COMMENTS_PER_VISITOR_HOUR; i++) expect((await send()).status).toBe(200);
    expect(await send()).toEqual({ status: 429, body: { ok: false, error: "busy" } });
    // Another visitor is not held back by it.
    expect((await postComment({ store: other.slug, market: "no", article: otherArticle, name: "Per", email: "", body: "Hello there", website: "", elapsed: 20_000 }, "203.0.113.10")).status).toBe(200);
    const [stored] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.chat_usage where store_id = ${other.storeId}::uuid and bucket like 'comment:%' and bucket like ${`%${address}%`}
    `);
    expect(Number(stored.n)).toBe(0);
  });

  it("never reaches another store's article or comments", async () => {
    expect((await postComment({ store: fx.slug, market: "no", article: otherArticle, name: "Kari", email: "", body: "Hi", website: "", elapsed: 20_000 }, "198.51.100.1")).status).toBe(404);
    const theirs = (await listComments(other.storeId, "pending"))[0];
    const { account } = await ownerOf(fx);
    expect(await moderateComment(account, fx.storeId, theirs.id, "approve")).toBe(false);
    expect(await deleteComment(account, fx.storeId, theirs.id)).toBe(false);
    expect((await listComments(other.storeId, "pending")).map((c) => c.id)).toContain(theirs.id);
    expect((await listComments(fx.storeId, "pending")).map((c) => c.id)).not.toContain(theirs.id);
  });

  it("shows a comment once staff approve it, and takes it away when they refuse it", async () => {
    const waiting = (await listComments(fx.storeId, "pending")).find((c) => c.pageId === mainArticle)!;
    const { account } = await ownerOf(fx);
    expect(await moderateComment(account, fx.storeId, waiting.id, "approve")).toBe(true);
    expect((await approvedComments(fx.storeId, mainArticle)).map((c) => c.id)).toEqual([waiting.id]);
    expect(await moderateComment(account, fx.storeId, waiting.id, "reject")).toBe(true);
    expect(await approvedComments(fx.storeId, mainArticle)).toEqual([]);
    const [audit] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where store_id = ${fx.storeId}::uuid and action = 'store.article_comment_moderated' and details ->> 'comment' = ${waiting.id}
    `);
    expect(Number(audit.n)).toBe(2);
  });

  it("exports and erases a person's comments by their address, in their own store only", async () => {
    const email = `reader-${run}@example.com`;
    await post(fx, mainArticle, { email: email.toUpperCase(), body: "Mine, with my email." });
    await postComment({ store: other.slug, market: "no", article: otherArticle, name: "Kari", email, body: "In the other store", website: "", elapsed: 20_000 }, "192.0.2.50");
    const mine = await commentsOf(fx.storeId, [email]);
    expect(mine.map((c) => [c.body, c.status])).toEqual([["Mine, with my email.", "pending"]]);
    expect(await countCommentsOf(db(), fx.storeId, [email])).toBe(1);
    expect(await db().transaction((tx) => eraseComments(tx, fx.storeId, [email]))).toBe(1);
    expect(await commentsOf(fx.storeId, [email])).toEqual([]);
    expect((await commentsOf(other.storeId, [email])).length).toBe(1);
  });
});

describe("scheduled articles", () => {
  it("are published by the job at their time, in the name of who scheduled them, and not before", async () => {
    const { account } = await ownerOf(fx);
    const id = await saved(fx, article("later"), false);
    const at = new Date(Date.now() + 3_600_000);
    expect(await schedulePage(account, fx.storeId, id, "article", at)).toMatchObject({ ok: true });
    expect((await scheduleOf(fx.storeId, id)).waiting?.at).toBe(at.toISOString());
    // Before its time nothing happens: it is not published, so not in the feed.
    await runSchedules(new Date(Date.now() + 60_000));
    expect((await getPageForEdit(fx.storeId, id, "article"))!.published).toBe(false);
    expect(childrenNamed(parseXml((await blogFeed(fx.slug, "no", null))!), "entry").map((e) => childText(e, "title"))).not.toContain("Article later");
    const ran = await runSchedules(new Date(at.getTime() + 60_000));
    expect(ran.published).toBeGreaterThanOrEqual(1);
    expect(ran.stores).toContain(fx.storeId);
    expect((await getPageForEdit(fx.storeId, id, "article"))!.state).toBe("published");
    expect(childrenNamed(parseXml((await blogFeed(fx.slug, "no", null))!), "entry").map((e) => childText(e, "title"))).toContain("Article later");
    expect((await scheduleOf(fx.storeId, id)).waiting).toBeNull();
    const [who] = await db().execute<Row>(sql`select updated_by from commerce.pages where id = ${id}::uuid`);
    expect(String(who.updated_by)).toBe(account.id);
  });

  it("fail for one whose maker may no longer publish, wait while the store is not open, and are cancelled on asking", async () => {
    const { account } = await ownerOf(other);
    const gone = await saved(other, article("gone-maker"), false);
    const at = new Date(Date.now() + 3_600_000);
    // A staff member who scheduled it and was removed since.
    const [staff] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`staff-${run}@example.com`}, 'Staff') returning id`);
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${other.storeId}::uuid, ${String(staff.id)}::uuid, 'admin')`);
    await schedulePage({ ...account, id: String(staff.id) }, other.storeId, gone, "article", at);
    await db().execute(sql`delete from commerce.store_members where store_id = ${other.storeId}::uuid and account_id = ${String(staff.id)}::uuid`);
    const waits = await saved(other, article("store-closed"), false);
    await schedulePage(account, other.storeId, waits, "article", at);
    const cancelled = await saved(other, article("cancelled"), false);
    await schedulePage(account, other.storeId, cancelled, "article", at);
    expect(await cancelSchedule(account, other.storeId, cancelled, "article")).toBe(true);

    await runSchedules(new Date(at.getTime() + 60_000));
    expect((await getPageForEdit(other.storeId, gone, "article"))!.published).toBe(false);
    expect((await scheduleOf(other.storeId, gone)).lastFailure?.problem).toMatch(/may no longer publish/);
    expect((await getPageForEdit(other.storeId, cancelled, "article"))!.published).toBe(false);

    // A store that is not open: the schedule waits, nothing is published.
    const later = await saved(other, article("suspended"), false);
    await schedulePage(account, other.storeId, later, "article", new Date(Date.now() + 7_200_000));
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${other.storeId}::uuid`);
    try {
      await runSchedules(new Date(Date.now() + 8_000_000));
      expect((await getPageForEdit(other.storeId, later, "article"))!.published).toBe(false);
      expect((await scheduleOf(other.storeId, later)).waiting).not.toBeNull();
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${other.storeId}::uuid`);
    }
    // Another store's page is never scheduled from here.
    expect(await schedulePage(account, fx.storeId, later, "article", at)).toEqual({ ok: false, problem: "missing" });
  });
});

describe("the AI manager's blogs", () => {
  it("reads the blogs and the comments waiting without a visitor's words, and refuses before a yes what the pages refuse", async () => {
    const c = { ...(await ownerOf(fx)), invalidate: () => {} };
    const [first] = await db().execute<Row>(sql`select id from commerce.pages where store_id = ${fx.storeId}::uuid and type = 'article' and published_at is not null limit 1`);
    await post(fx, String(first.id), { body: "Waiting for the owner to read." });
    const blogs = (await runOwnerTool(c, "list_blogs", {})) as { blogs: { address: string; feed: string }[]; comments_waiting: number };
    expect(blogs.blogs.map((b) => b.address)).toEqual(["/blog", "/blogs/news"]);
    expect(blogs.blogs[1].feed).toMatch(/\/blogs\/news\/feed\.atom$/);
    const waiting = (await runOwnerTool(c, "blog_comments", { status: "pending" })) as { comments: Record<string, unknown>[] };
    expect(waiting.comments.length).toBeGreaterThan(0);
    for (const comment of waiting.comments) {
      expect(comment).not.toHaveProperty("body");
      expect(comment).not.toHaveProperty("name");
      expect(comment).not.toHaveProperty("email");
    }
    const theirs = (await listComments(other.storeId, "pending"))[0];
    await expect(preflightOwnerTool(c, "moderate_blog_comment", { comment: theirs.id, action: "approve" })).rejects.toThrow(/not one of this store's/);
    const mine = waiting.comments[0].id as string;
    await expect(preflightOwnerTool(c, "moderate_blog_comment", { comment: mine, action: "spam" })).resolves.toBeUndefined();
    const id = await saved(fx, article("ai-later"), false);
    await expect(preflightOwnerTool(c, "schedule_article", { article: id, at: "2020-01-01 09:00" })).rejects.toThrow(/minutes from now/);
    const when = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
    await expect(preflightOwnerTool(c, "schedule_article", { article: id, at: `${when} 09:00` })).resolves.toBeUndefined();
    const done = (await runOwnerTool(c, "schedule_article", { article: id, at: `${when} 09:00` })) as { publishes_at: string };
    expect(done.publishes_at).toBe(`${when} 09:00 (${c.store.timeZone})`);
    expect((await runOwnerTool(c, "schedule_article", { article: id, at: null })) as { done: string }).toMatchObject({ done: expect.stringMatching(/cancelled/) });
  });
});
