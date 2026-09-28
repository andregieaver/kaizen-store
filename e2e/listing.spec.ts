import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * Sorting and filtering a store's products (D78): the products page lists
 * the store, the dialog offers what its products have, and the choices go
 * into the address, shown above the list with a way to take each away.
 */
async function newStore(): Promise<string> {
  const slug = `listing-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null)`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("a shopper filters the store's products by kind, option and price, sorts them, and takes a filter away", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/no/products`);
  await expect(page.getByRole("heading", { level: 1, name: "Alle produkter" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Demo: Hytte/ })).toBeVisible();

  // Stays and rentals only.
  await page.getByRole("button", { name: "Filtrer og sorter" }).click();
  const dialog = page.getByRole("dialog", { name: "Filtrer og sorter" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Overnatting/ }).click();
  await dialog.getByRole("button", { name: /Utleie/ }).click();
  await dialog.getByRole("radio", { name: "Pris: høy til lav" }).check();
  await dialog.getByRole("button", { name: "Vis produktene" }).click();
  await expect(page).toHaveURL(/kind=stay&kind=rental&sort=priceHigh/);
  // New stores' All products page (D83) is a content grid: one tile per product, with its picture and title linked.
  const cards = page.locator("main li").filter({ has: page.locator("a[href*='/p/demo-']") });
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator("a").first()).toHaveAttribute("href", /demo-hytte/);

  // Take one away from above the list.
  await page.getByRole("link", { name: "Fjern Overnatting" }).click();
  await expect(page).toHaveURL(/kind=rental&sort=priceHigh/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("a").first()).toHaveAttribute("href", /demo-sykkelutleie/);

  // A variant's option and a price range, from a fresh start.
  await page.goto(`/s/${slug}/no/products`);
  await page.getByRole("button", { name: "Filtrer og sorter" }).click();
  await dialog.getByRole("button", { name: /Hvit/ }).click();
  await dialog.getByRole("textbox", { name: /^Til/ }).fill("300");
  await dialog.getByRole("button", { name: "Vis produktene" }).click();
  await expect(page).toHaveURL(/o\.colour=white&max=300/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("a").first()).toHaveAttribute("href", /demo-keramikkopp/);
  await expect(page.getByRole("link", { name: "Fjern Farge: Hvit" })).toBeVisible();

  // Nothing matches: said so, and the filters can be cleared.
  await page.goto(`/s/${slug}/no/products?kind=stay&max=100`);
  await expect(page.getByText("Ingen produkter passer til filtrene.")).toBeVisible();
  await page.getByRole("link", { name: "Fjern alle" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/no/products$`));
});

test("a category's products and search results can be filtered too", async ({ page }) => {
  const slug = await newStore();
  // In Hjem, the lamp is in Belysning below it.
  await page.goto(`/s/${slug}/no/category/hjem`);
  await page.getByRole("button", { name: "Filtrer og sorter" }).click();
  const dialog = page.getByRole("dialog", { name: "Filtrer og sorter" });
  await dialog.getByRole("checkbox", { name: /Belysning/ }).check();
  await dialog.getByRole("button", { name: "Vis produktene" }).click();
  await expect(page).toHaveURL(/category\/hjem\?category=belysning/);
  await expect(page.locator("main li a[href*='/p/demo-']")).toHaveCount(1);

  // Search results keep their search and their recorded links.
  await page.goto(`/s/${slug}/no/search?q=demo&sort=priceLow`);
  const results = page.locator("main li a[href*='/search/go']");
  await expect(results.first()).toHaveAttribute("href", /p=demo-sykkelutleie/);
});
