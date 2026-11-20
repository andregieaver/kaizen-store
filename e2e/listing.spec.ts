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
    // A new store starts with the shop alone (D178): stays and rentals are switched on, as an owner would under Features, so the
    // demo cabin and bike are offered and can be filtered.
    await sql`update commerce.stores set features = array['shop', 'bookings'] where slug = ${slug}`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("a shopper filters the store's products by kind, option and price, sorts them, and takes a filter away", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/products`);
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
  const cards = page.locator("main li:visible").filter({ has: page.locator("a[href*='/p/demo-']") });
  await expect(cards).toHaveCount(2);
  await expect(cards.first().locator("a").first()).toHaveAttribute("href", /demo-hytte/);

  // Take one away from above the list.
  await page.getByRole("link", { name: "Fjern Overnatting" }).click();
  await expect(page).toHaveURL(/kind=rental&sort=priceHigh/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("a").first()).toHaveAttribute("href", /demo-sykkelutleie/);

  // A variant's option and a price range, from a fresh start.
  await page.goto(`/s/${slug}/products`);
  await page.getByRole("button", { name: "Filtrer og sorter" }).click();
  await dialog.getByRole("button", { name: /Hvit/ }).click();
  await dialog.getByRole("textbox", { name: /^Til/ }).fill("300");
  await dialog.getByRole("button", { name: "Vis produktene" }).click();
  await expect(page).toHaveURL(/o\.colour=white&max=300/);
  await expect(cards).toHaveCount(1);
  await expect(cards.first().locator("a").first()).toHaveAttribute("href", /demo-keramikkopp/);
  await expect(page.getByRole("link", { name: "Fjern Farge: Hvit" })).toBeVisible();

  // Nothing matches: said so, and the filters can be cleared.
  await page.goto(`/s/${slug}/products?kind=stay&max=100`);
  await expect(page.getByText("Ingen produkter passer til filtrene.")).toBeVisible();
  await page.getByRole("link", { name: "Fjern alle" }).click();
  await expect(page).toHaveURL(new RegExp(`/s/${slug}/products$`));
});

test("a category's products and search results can be filtered too", async ({ page }) => {
  const slug = await newStore();
  // In Hjem, the lamp is in Belysning below it.
  await page.goto(`/s/${slug}/category/hjem`);
  await page.getByRole("button", { name: "Filtrer og sorter" }).click();
  const dialog = page.getByRole("dialog", { name: "Filtrer og sorter" });
  await dialog.getByRole("checkbox", { name: /Belysning/ }).check();
  await dialog.getByRole("button", { name: "Vis produktene" }).click();
  await expect(page).toHaveURL(/category\/hjem\?category=belysning/);
  await expect(page.locator("main li:visible a[href*='/p/demo-']")).toHaveCount(1);

  // Search results keep their search and their recorded links.
  await page.goto(`/s/${slug}/search?q=demo&sort=priceLow`);
  const results = page.locator("main li a[href*='/search/go']");
  await expect(results.first()).toHaveAttribute("href", /p=demo-sykkelutleie/);
});

/** The distinct products a document's tiles carry, by their `data-item-id`. */
const itemIds = (html: string) => [...new Set([...html.matchAll(/data-item-id="([^"]+)"/g)].map((match) => match[1]))];

test("an unfiltered listing sends each product once", async ({ request }) => {
  // Its grid as built is drawn once, in the prerendered page; only the controls stream in beside it (bloat review step 2.12).
  const res = await request.get("/s/demo/no/products");
  expect(res.status()).toBe(200);
  const html = await res.text();
  const ids = itemIds(html);
  expect(ids.length).toBeGreaterThanOrEqual(1);
  for (const id of ids) {
    // Once in the markup, and once in the payload, where the props are JSON inside a JavaScript string.
    expect(html.split(`data-item-id="${id}"`).length - 1, id).toBe(1);
    expect(html.split('data-item-id\\":\\"' + id + '\\"').length - 1, id).toBe(1);
  }
  const bytes = Buffer.byteLength(html);
  console.log(`/s/demo/no/products: ${bytes} bytes, ${ids.length} products`);
  expect(bytes).toBeLessThanOrEqual(120000);
});

test("the built grid shows without scripts", async ({ browser, request }) => {
  const ids = itemIds(await (await request.get("/s/demo/no/products")).text());
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("/s/demo/no/products");
    await expect(page.locator("main li[data-item-id]:visible")).toHaveCount(ids.length);
  } finally {
    await context.close();
  }
});
