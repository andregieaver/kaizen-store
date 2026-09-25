import { expect, test } from "@playwright/test";

/**
 * A store's own pages (D54) as shoppers meet them: the seeded demo store has
 * "Om oss", linked from its footer by address and named after the page.
 */

test("a store's footer leads to its page, prerendered in the store's own layout", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/s/demo/no");
  await page.getByRole("contentinfo").getByRole("link", { name: "Om oss", exact: true }).click();
  await expect(page).toHaveURL("/s/demo/no/om-oss");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Om Kaizen Demo");
  await expect(page.getByText("Vi selger ting for hjem og kontor.")).toBeVisible();
  // In the store's layout, in the market's language, with its own title and description.
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page).toHaveTitle("Om oss · Kaizen Demo");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /hjem og kontor/);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/s\/demo\/no\/om-oss$/);
  // The page spans the window: the storefront's main drops its width for it.
  const main = await page.getByRole("main").boundingBox();
  expect(main?.width).toBe(1280);
});

test("a store page is in every market, and unknown pages and the store's routes are its own", async ({ page, request }) => {
  const response = await request.get("/s/demo/se/om-oss");
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain("Om Kaizen Demo");
  expect(html).toContain('"@type":"WebPage"');
  expect((await page.goto("/s/demo/no/finnes-ikke"))?.status()).toBe(404);
  // The store's own routes come first.
  await page.goto("/s/demo/no/cart");
  await expect(page).toHaveURL("/s/demo/no/cart");
  await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("Om Kaizen Demo");
});

test("a store page reads in the market's language where it is translated, else in the main one", async ({ page }) => {
  await page.goto("/s/demo/se/om-oss");
  await expect(page.getByText("Vi säljer saker för hem och kontor.")).toBeVisible();
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", /säljer saker/);
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
  await page.goto("/s/demo/dk/om-oss");
  await expect(page.getByText("Vi selger ting for hjem og kontor.")).toBeVisible();
});
