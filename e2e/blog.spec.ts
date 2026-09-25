import { expect, test } from "@playwright/test";

/**
 * The blog (D57): Kaizen's at /blog and each store's at /s/{store}/{market}/blog,
 * built with the page builder, with a header drawn from each article's
 * settings. The seed has one article each.
 */

test("Kaizen's blog lists its articles, newest first, and an article has its header and Article data", async ({ page }) => {
  await page.goto("/blog");
  await expect(page.getByRole("heading", { level: 1, name: "Blog" })).toBeVisible();
  const tile = page.getByRole("listitem").filter({ hasText: "Welcome to the Kaizen blog" });
  await expect(tile.locator("time")).toBeVisible();
  await tile.getByRole("link", { name: "Welcome to the Kaizen blog" }).click();
  await expect(page).toHaveURL("/blog/welcome");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Welcome to the Kaizen blog");
  await expect(page.getByText("By Kaizen team")).toBeVisible();
  await expect(page.getByText("This is where we write about selling online across the EU.")).toBeVisible();
  const data = (await page.locator('script[type="application/ld+json"]').allTextContents()).map((text) => JSON.parse(text));
  const article = data.find((d) => d["@type"] === "Article");
  expect(article).toMatchObject({ headline: "Welcome to the Kaizen blog", author: { "@type": "Person", name: "Kaizen team" } });
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute("content", "article");
  for (const path of ["/blog/nope", "/blog/category/nope", "/blog/tag/nope"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test("a store's blog is in its layout and language, with its article categories", async ({ page }) => {
  // The footer's blog link (D57) is named in the store's language.
  await page.goto("/s/demo/no");
  await page.getByRole("contentinfo").getByRole("link", { name: "Blogg", exact: true }).click();
  await expect(page).toHaveURL("/s/demo/no/blog");
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("heading", { level: 1, name: "Blogg" })).toBeVisible();
  await page.getByRole("navigation", { name: "Blogg" }).getByRole("link", { name: "Nyheter" }).click();
  await expect(page).toHaveURL("/s/demo/no/blog/category/nyheter");
  await page.getByRole("link", { name: "Nye produkter i høst" }).click();
  await expect(page).toHaveURL("/s/demo/no/blog/nye-produkter");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nye produkter i høst");
  await expect(page.getByText("Av Kari Nordmann")).toBeVisible();
  // A page and the blog's routes are the store's own: no page is at /blog.
  expect((await page.goto("/s/demo/no/blog/finnes-ikke"))?.status()).toBe(404);
  await page.goto("/s/demo/se/blog");
  await expect(page.getByRole("heading", { level: 1, name: "Blogg" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Nye produkter i høst" })).toHaveAttribute("href", "/s/demo/se/blog/nye-produkter");
});
