import { expect, test } from "@playwright/test";

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
