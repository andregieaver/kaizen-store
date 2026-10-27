import { expect, test } from "@playwright/test";

/**
 * A store's blog as a visitor and a feed reader meet it (wave 7 unit G, D341; row storefront.blog-multiple-blogs-authors-comments-rss): the
 * first blog stays at /blog, its page head and its articles' link its Atom feed at /blog/feed.atom, which lists its published articles; an
 * article offers the comment form (held for the store by default) and no comment is shown before one is approved; a blog that is not there
 * is a 404. The demo store's seed has one article; nothing here changes it.
 */

test("a store's blog links its Atom feed, which lists its published articles", async ({ page, request }) => {
  await page.goto("/s/demo/no/blog");
  await expect(page.getByRole("heading", { level: 1, name: "Blogg" })).toBeVisible();
  const feedLink = page.locator('head link[rel="alternate"][type="application/atom+xml"]');
  await expect(feedLink).toHaveAttribute("href", /\/s\/demo\/no\/blog\/feed\.atom$/);

  const feed = await request.get("/s/demo/no/blog/feed.atom");
  expect(feed.status()).toBe(200);
  expect(feed.headers()["content-type"]).toContain("application/atom+xml");
  const xml = await feed.text();
  expect(xml).toContain('<feed xmlns="http://www.w3.org/2005/Atom"');
  expect(xml).toContain("<title>Nye produkter i høst</title>");
  expect(xml).toMatch(/<link rel="alternate" type="text\/html" href="[^"]*\/s\/demo\/no\/blog\/nye-produkter"\/>/);

  // Another blog that is not there has no page and no feed.
  expect((await page.goto("/s/demo/no/blogs/finnes-ikke"))?.status()).toBe(404);
  expect((await request.get("/s/demo/no/blogs/finnes-ikke/feed.atom")).status()).toBe(404);
});

test("an article links its blog's feed and offers the comment form, with nothing shown before the store approves it", async ({ page }) => {
  await page.goto("/s/demo/no/blog/nye-produkter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nye produkter i høst");
  await expect(page.locator('head link[rel="alternate"][type="application/atom+xml"]')).toHaveAttribute("href", /\/blog\/feed\.atom$/);
  const comments = page.locator("[data-blog-comments]");
  await expect(comments.getByRole("heading", { name: "Kommentarer" })).toBeVisible();
  await expect(comments.getByText("Ingen kommentarer ennå. Skriv den første.")).toBeVisible();
  await expect(comments.getByRole("textbox", { name: "Navn" })).toBeVisible();
  await expect(comments.getByRole("textbox", { name: "Kommentar" })).toBeVisible();
  // The email is optional and never shown; the form sets no cookie.
  await expect(comments.getByText("Bare butikken ser den. Den vises aldri.")).toBeVisible();
  const cookies = await page.context().cookies();
  expect(cookies.map((c) => c.name).filter((name) => /comment|blog/i.test(name))).toEqual([]);
  // A mistake shows by its field, before anything is sent.
  await comments.getByRole("button", { name: "Send kommentaren" }).click();
  await expect(comments.getByText("Skriv navnet ditt.")).toBeVisible();
  await expect(comments.getByText("Skriv kommentaren din.")).toBeVisible();
});
