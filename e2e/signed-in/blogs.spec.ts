import { expect, test } from "@playwright/test";

import { newPageContent } from "../../src/lib/page-content";
import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Blogs in depth as the owner and a visitor meet them (wave 7 unit G, D341; row storefront.blog-multiple-blogs-authors-comments-rss): the
 * owner makes a second blog that shows comments at once and an author; puts an article in it with that author in the editor and publishes it;
 * the article is at the blog's own address (its old /blog address moves there), with the author under it and the blog's feed linked and
 * listing it; a visitor's comment is shown at once and staff mark it as spam, which takes it away; and an article's draft is scheduled and the
 * schedule cancelled. Everything here is made for this run and taken away after it: the shared store's other pages and settings are not
 * touched. The rules are held by blogs.int.test.ts, blogs.test.ts, blog-comments.test.ts and atom.test.ts; this holds the screens.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const run = Date.now().toString(36);
const handle = `e2e-news-${run}`;
const blogName = `E2E news ${run}`;
const authorName = `Ada Writer ${run}`;
const slug = `e2e-article-${run}`;
const laterSlug = `e2e-later-${run}`;
const commentText = `A comment from the e2e run ${run}`;
let storeId = "";
let articleId = "";
let laterId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where id = ${storeId}`;
    // Two drafts of this run's own, as the editor would have saved them.
    const draft = (title: string, address: string) => ({ ...newPageContent(), title, slug: address });
    const [a] = await sql`
      insert into commerce.pages (store_id, type, slug, draft) values (${storeId}, 'article', ${slug}, ${sql.json(draft(`E2E article ${run}`, slug) as never)}) returning id`;
    const [b] = await sql`
      insert into commerce.pages (store_id, type, slug, draft) values (${storeId}, 'article', ${laterSlug}, ${sql.json(draft(`E2E later ${run}`, laterSlug) as never)}) returning id`;
    articleId = String(a.id);
    laterId = String(b.id);
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.pages where store_id = ${storeId} and slug in (${slug}, ${laterSlug})`;
    await sql`delete from commerce.blogs where store_id = ${storeId} and handle = ${handle}`;
    await sql`delete from commerce.blog_authors where store_id = ${storeId} and name = ${authorName}`;
  } finally {
    await sql.end();
  }
});

test("makes a blog that shows comments at once, and an author", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/articles/blogs`);
  await expect(page.getByRole("heading", { level: 1, name: "Blogs" })).toBeVisible();
  // The first blog is there already, at /blog.
  await expect(page.getByRole("listitem").filter({ hasText: "/blog" }).first()).toBeVisible();
  await page.getByRole("textbox", { name: /^Name/ }).first().fill(blogName);
  await page.getByRole("textbox", { name: "Address", exact: true }).fill(handle);
  await page.getByRole("radio", { name: /Shown at once/ }).check();
  await page.getByRole("button", { name: "Save the blog" }).click();
  await expect(page.getByText("The blog is saved.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: `/blogs/${handle}` })).toBeVisible();

  await page.goto(`/admin/${E2E_STORE}/articles/authors`);
  await expect(page.getByRole("heading", { level: 1, name: "Authors" })).toBeVisible();
  await page.getByRole("textbox", { name: "Name", exact: true }).fill(authorName);
  await page.getByRole("textbox", { name: "A few words about them" }).fill("Writes about the shop's news.");
  await page.getByRole("textbox", { name: "Link", exact: true }).fill("https://ada.example");
  await page.getByRole("button", { name: "Save the author" }).click();
  await expect(page.getByText("The author is saved.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: authorName })).toBeVisible();
});

test("puts an article in the blog with its author, at the blog's address with its feed", async ({ page, request }) => {
  await page.goto(`/admin/${E2E_STORE}/articles/${articleId}`);
  // The editor is drawn for this article before anything is chosen in it.
  const blog = page.getByRole("combobox", { name: "In the blog" });
  await expect(blog).toBeVisible();
  await blog.selectOption({ label: `${blogName} (/blogs/${handle})` });
  await page.getByRole("combobox", { name: "Author", exact: true }).selectOption({ label: authorName });
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await expect(page.locator("[data-editor-bar]").getByRole("status")).toContainText(/Published/);

  // Its old address moves to its blog's own.
  await page.goto(`/s/${E2E_STORE}/no/blog/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/blogs/${handle}/${slug}$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`E2E article ${run}`);
  const author = page.locator("[data-blog-author]");
  await expect(author.getByText(authorName)).toBeVisible();
  await expect(author.getByText("Writes about the shop's news.")).toBeVisible();
  const data = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text));
  expect(data.find((d) => d["@type"] === "Article")).toMatchObject({ author: { "@type": "Person", name: authorName, url: "https://ada.example" } });
  const feedHref = await page.locator('head link[rel="alternate"][type="application/atom+xml"]').getAttribute("href");
  expect(feedHref).toMatch(new RegExp(`/blogs/${handle}/feed\\.atom$`));
  const feed = await request.get(feedHref!);
  expect(feed.headers()["content-type"]).toContain("application/atom+xml");
  const xml = await feed.text();
  expect(xml).toContain(`<title>E2E article ${run}</title>`);
  expect(xml).toContain(`<name>${authorName}</name>`);
});

test("shows a visitor's comment at once on that blog, and staff take it away as spam", async ({ page }) => {
  await page.goto(`/s/${E2E_STORE}/no/blogs/${handle}/${slug}`);
  const comments = page.locator("[data-blog-comments]");
  await expect(comments.getByRole("textbox", { name: "Navn" })).toBeVisible();
  // A person takes a few seconds to write: a form sent sooner is a robot's.
  await page.waitForTimeout(3_500);
  await comments.getByRole("textbox", { name: "Navn" }).fill("Vera Visitor");
  await comments.getByRole("textbox", { name: "Kommentar" }).fill(commentText);
  await comments.getByRole("button", { name: "Send kommentaren" }).click();
  await expect(comments.getByRole("status")).toHaveText("Takk. Kommentaren din står på siden.");
  await page.reload();
  await expect(page.locator("[data-comment]").filter({ hasText: commentText })).toBeVisible();

  await page.goto(`/admin/${E2E_STORE}/articles/comments?status=approved`);
  await expect(page.getByRole("heading", { level: 1, name: "Comments" })).toBeVisible();
  const row = page.getByRole("listitem").filter({ hasText: commentText });
  await row.getByRole("button", { name: "Spam", exact: true }).click();
  // Marked as spam, it leaves the shown comments.
  await expect(row).toHaveCount(0);
  await page.goto(`/admin/${E2E_STORE}/articles/comments?status=spam`);
  await expect(page.getByRole("listitem").filter({ hasText: commentText })).toBeVisible();

  await page.goto(`/s/${E2E_STORE}/no/blogs/${handle}/${slug}`);
  await expect(page.locator("[data-blog-comments]").getByRole("heading", { name: "Kommentarer" })).toBeVisible();
  await expect(page.getByText(commentText)).toHaveCount(0);
});

test("schedules an article's draft on the store's clock and cancels the schedule", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/articles/${laterId}`);
  const opener = page.locator("[data-schedule-button]");
  await expect(opener).toBeVisible();
  await opener.click();
  const dialog = page.getByRole("dialog", { name: "Publish it later" });
  await expect(dialog).toBeVisible();
  // Tomorrow at nine is filled in.
  await expect(dialog.getByLabel("Time", { exact: true })).toHaveValue("09:00");
  await dialog.getByRole("button", { name: "Schedule", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Scheduled for");
  await expect(opener).toContainText("Scheduled for");

  const sql = testDb();
  try {
    const [row] = await sql`select status from commerce.page_schedules where store_id = ${storeId} and page_id = ${laterId} order by created_at desc limit 1`;
    expect(row.status).toBe("waiting");
  } finally {
    await sql.end();
  }
  // Not published before its time.
  expect((await page.goto(`/s/${E2E_STORE}/no/blog/${laterSlug}`))?.status()).toBe(404);

  await page.goto(`/admin/${E2E_STORE}/articles/${laterId}`);
  await page.locator("[data-schedule-button]").click();
  const again = page.getByRole("dialog", { name: "Publish it later" });
  await again.getByRole("button", { name: "Cancel the schedule" }).click();
  await expect(again.getByRole("status")).toContainText("The schedule is cancelled");
});
