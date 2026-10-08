import { expect, test } from "@playwright/test";

import { testDb } from "./db";

/**
 * A store's All products page (D83): a page of its own at /products, built
 * in the page builder, whose product grid shoppers filter and sort; the grid
 * follows each choice while the dialog is still open. Its own address leads
 * to /products, and product pages lead back to it by its name.
 */
async function newStore(): Promise<string> {
  const slug = `all-${Date.now()}`;
  const sql = testDb();
  try {
    const [request] = await sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`${slug}@example.com`}, 'Siri', 'Siris Butikk') returning id`;
    await sql`select commerce.approve_access_request(${request.id}, ${slug}, 'Siris Butikk', null)`;
    // A new store starts with the shop alone (D178): stays and rentals are switched on, as an owner would under Features, so the
    // demo cabin and bike are offered and can be filtered.
    await sql`update commerce.stores set features = array['shop', 'bookings', 'countries'] where slug = ${slug}`;
  } finally {
    await sql.end();
  }
  return slug;
}

test("the All products page's grid follows each filter while the dialog is open", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/no/products`);
  await expect(page).toHaveTitle(/^Alle produkter/);
  await expect(page.getByRole("heading", { level: 1, name: "Alle produkter" })).toBeVisible();
  const tiles = page.locator("main li").filter({ has: page.locator("a[href*='/p/']") });
  const all = await tiles.count();
  expect(all).toBeGreaterThan(3);
  await expect(page.getByRole("status").filter({ hasText: `${all} produkter` }).first()).toBeVisible();

  await page.getByRole("button", { name: "Filtrer og sorter" }).click();
  const dialog = page.getByRole("dialog", { name: "Filtrer og sorter" });
  await dialog.getByRole("button", { name: /Overnatting/ }).click();
  // Without showing the products, the address and the grid behind follow, and the dialog counts them.
  await expect(page).toHaveURL(/\/products\?kind=stay$/);
  await expect(tiles).toHaveCount(1);
  await expect(dialog.getByRole("status")).toHaveText("1 produkt");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: /Utleie/ }).click();
  await expect(page).toHaveURL(/kind=stay&kind=rental$/);
  await expect(tiles).toHaveCount(2);
  await dialog.getByRole("radio", { name: "Pris: høy til lav" }).check();
  await expect(page).toHaveURL(/kind=stay&kind=rental&sort=priceHigh$/);
  await expect(tiles.first().locator("a").first()).toHaveAttribute("href", /demo-hytte/);

  // A price typed in is applied once typing stops, and closing keeps what was chosen.
  await dialog.getByRole("textbox", { name: /^Til/ }).fill("5000");
  await dialog.getByRole("button", { name: "Lukk" }).click();
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(/max=5000/);

  // Each choice is shown over the grid, with a way to take it away.
  await page.getByRole("link", { name: "Fjern Overnatting" }).click();
  await expect(page).not.toHaveURL(/kind=stay/);
  await expect(tiles.first().locator("a").first()).toHaveAttribute("href", /demo-sykkelutleie/);
});

test("the All products page has one address, and product pages lead back to it by name", async ({ page }) => {
  const slug = await newStore();
  await page.goto(`/s/${slug}/no/alle-produkter`);
  await expect(page).toHaveURL(`/s/${slug}/no/products`);

  await page.goto(`/s/${slug}/no/p/demo-handlenett`);
  const back = page.getByRole("link", { name: "Tilbake til Alle produkter" });
  await expect(back).toHaveAttribute("href", `/s/${slug}/no/products`);
  await back.click();
  await expect(page).toHaveURL(`/s/${slug}/no/products`);

  // In Swedish, by its Swedish title.
  await page.goto(`/s/${slug}/se/p/demo-handlenett`);
  await expect(page.getByRole("link", { name: "Tillbaka till Alla produkter" })).toHaveAttribute("href", `/s/${slug}/se/products`);
});
