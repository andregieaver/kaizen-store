import { expect, test } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/**
 * Product recommendations (D139): a product grid that recommends shows what everyone is shown, then the shopper's own picks
 * from what their tab remembers; products they put in the cart are not offered; what they click and add is recorded for the
 * owner's figures, under an id the tab made.
 */

const grid = {
  id: "grid",
  type: "contentGrid",
  source: { type: "products", recommend: { mix: { upsell: true, crossSell: true, complement: true }, explain: true } },
  categories: [],
  tags: [],
  sort: "newest",
  limit: 4,
  columns: { mobile: 2, tablet: 2, desktop: 4 },
  show: { image: false, heading: true, excerpt: false, price: true, button: true },
  buttonLabel: "",
  emptyText: "",
  headingLevel: 3,
  excerptLines: 2,
  gap: 16,
};

async function recommendingStore() {
  const address = await storePageWith("rec", [grid]);
  const slug = address.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    await sql`insert into commerce.recommendation_settings (store_id, enabled, ai, holdout_percent) values (${store.id}, true, false, 0)`;
    return { address, slug, storeId: String(store.id), sql };
  } catch (error) {
    await sql.end();
    throw error;
  }
}

test("the grid shows picks with a reason, leaves out what the shopper has looked at, and records clicks and adds", async ({ page }) => {
  const { address, slug, storeId, sql } = await recommendingStore();
  try {
    // A visitor with nothing to go on: what the store sells.
    await page.goto(address);
    const tiles = page.locator("li[data-item-id]");
    await expect(tiles.first()).toBeVisible();
    await expect(page.getByText("Populært i butikken").first()).toBeVisible();
    // The tab reported what it was shown, under a random id and the ranking it got.
    await expect.poll(async () => Number((await sql`select count(*)::int as n from commerce.recommendation_events where store_id = ${storeId} and event = 'impression'`)[0].n)).toBeGreaterThan(0);
    const arms = await sql`select distinct arm, placement from commerce.recommendation_events where store_id = ${storeId}`;
    expect(arms).toEqual([expect.objectContaining({ arm: "ai", placement: "page" })]);

    // Looking at a product is remembered in the tab only, and the same grid then recommends around it.
    const [notebook] = await sql`select id from commerce.products where store_id = ${storeId} and handle = 'demo-notatbok'`;
    await page.goto(`/s/${slug}/no/p/demo-notatbok`);
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem("kaizen_rec"))).toContain("views");
    await page.goto(address);
    await expect(tiles.first()).toBeVisible();
    // What was looked at is not offered back, and what shares its tag is, with the reason.
    await expect(page.locator(`li[data-item-id="${notebook.id}"]`)).toHaveCount(0);
    await expect(page.getByText(/^Fordi du så på /).first()).toBeVisible();

    // A click is remembered, and adding that product to the cart is credited to the recommendation.
    const first = tiles.first();
    const id = await first.getAttribute("data-item-id");
    await first.getByRole("link").first().click();
    await page.waitForURL(/\/p\//);
    await expect.poll(async () => Number((await sql`select count(*)::int as n from commerce.recommendation_events where store_id = ${storeId} and event = 'click' and product_id = ${id!}`)[0].n)).toBe(1);
    await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
    await expect(page.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();
    await expect.poll(async () => Number((await sql`select count(*)::int as n from commerce.recommendation_adds where store_id = ${storeId} and product_id = ${id!}`)[0].n)).toBe(1);

    // What is in the cart is not recommended again.
    await page.goto(address);
    await expect(tiles.first()).toBeVisible();
    await expect(page.locator(`li[data-item-id="${id}"]`)).toHaveCount(0);
  } finally {
    await sql.end();
  }
});

test("a store that has not switched recommendations on shows the grid as built, with no tab storage and no requests", async ({ page }) => {
  const address = await storePageWith("rec-off", [grid]);
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(address);
  await page.goto(`${address.replace(/[^/]+$/, "")}p/demo-keramikkopp`);
  expect(await page.evaluate(() => sessionStorage.getItem("kaizen_rec"))).toBeNull();
  // Nothing is asked for or reported.
  expect(requests.some((url) => url.includes("/api/recommendations"))).toBe(false);
});
