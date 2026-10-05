import { expect, test } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Categories and tags (D50) as shoppers meet them: a menu link to a
 * category leads to the store's products in it and its subcategories;
 * a tag's link to its products. The demo store's are seeded.
 */

test("a store's menu leads to a category's products, subcategories included, and on to a subcategory", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/s/demo/no");
  await page.getByRole("contentinfo").getByRole("link", { name: "Hjem og kjøkken" }).click();
  await expect(page).toHaveURL("/s/demo/no/category/hjem");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Hjem");
  const products = page.getByRole("main").getByRole("heading", { level: 2 });
  // In the front page's order: when they were added, then by address.
  await expect(products).toHaveText(["Demo: Bordlampe", "Demo: Keramikkopp"]);
  // Prices come with their VAT label, as everywhere in the store.
  await expect(page.getByRole("main").getByText("inkl. mva.").first()).toBeVisible();

  await page.getByRole("navigation", { name: "Hjem" }).getByRole("link", { name: "Belysning" }).click();
  await expect(page).toHaveURL("/s/demo/no/category/belysning");
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(["Demo: Bordlampe"]);
});

test("a tag lists its products in the market's language, and unknown ones are not found", async ({ page }) => {
  await page.goto("/s/demo/se/tag/nyhet");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Nyhet");
  // In the order they were added (then by address), as on the front page.
  await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText([
    "Demo: Tygkasse i canvas",
    "Demo: Anteckningsbok A5",
  ]);
  for (const path of ["/s/demo/no/category/nope", "/s/demo/no/tag/papir", "/category/nope", "/tag/nope"]) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
});

test("a category's own search title and description are used in its language only, with hreflang alternates and its own canonical (D168)", async ({ page }) => {
  // The store is made for the test, so the category's text is in place before anything about it is cached.
  const store = await testStore("e2e-term-seo");
  const sql = testDb();
  try {
    await sql`
      update commerce.terms
         set seo = ${sql.json({ "sv-SE": { title: "Hem och kök för alla", description: "Allt för ett fint hem." } })}
       where store_id = ${store.id} and kind = 'category' and slug = 'hjem'`;
  } finally {
    await sql.end();
  }

  await page.goto(`/s/${store.slug}/se/category/hjem`);
  // The title as written (no store name added), the description, and the share tags with both.
  await expect(page).toHaveTitle("Hem och kök för alla");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Allt för ett fint hem.");
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", "Hem och kök för alla");
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", "Allt för ett fint hem.");
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute("content", "Hem och kök för alla");
  // Its own address is its canonical, and the other countries and languages are alternates.
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/s/${store.slug}/se/category/hjem$`));
  await expect(page.locator('link[rel="alternate"][hreflang="sv-SE"]')).toHaveAttribute("href", new RegExp(`/s/${store.slug}/se/category/hjem$`));
  await expect(page.locator('link[rel="alternate"][hreflang="nb-NO"]')).toHaveAttribute("href", new RegExp(`/s/${store.slug}/no/category/hjem$`));
  await expect(page.locator('link[rel="alternate"][hreflang="da-DK"]')).toHaveAttribute("href", new RegExp(`/s/${store.slug}/dk/category/hjem$`));

  // Another language of the same category has no text of its own: the name as before, and nothing from the Swedish text.
  const norwegian = await page.request.get(`/s/${store.slug}/no/category/hjem`);
  const html = await norwegian.text();
  expect(html).toContain("<title>Hjem · Testbutikk</title>");
  expect(html).not.toContain("Hem och kök för alla");
  expect(html).not.toContain("Allt för ett fint hem.");
});
