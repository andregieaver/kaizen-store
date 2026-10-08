import { expect, test, type APIRequestContext } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Store features, step 5 (D178, `docs/store-features.md` 4e): with the online shop switched off the store is a website. Its front page draws
 * without products, its header has no cart, search or account, and the shop's own addresses (a product, All products, the cart, checkout,
 * search) are the store's 404. While an order can still be withdrawn from, the footer keeps the withdrawal link and the withdrawal form opens;
 * a website with nothing sold has no such link. The stores are made for this file, so nothing of them is cached before the first request.
 */

let selling: string;
let quiet: string;

/** A store made as sign-up makes it, with the online shop switched off; `sold` gives it an order received two days ago, still in its 14 days. */
async function website(name: string, sold: boolean): Promise<string> {
  const { slug, id } = await testStore(name);
  const sql = testDb();
  try {
    if (sold) {
      // The order is placed while the shop is on: a website takes none (`orders_store_open()`).
      const number = `W${Date.now().toString(36)}`;
      const [order] = await sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address, delivered_at)
        values (${id}, ${number}, 'NO', 'NOK', 'nb-NO', ${`${number}@example.com`}, 'fulfilled', 10000, 0, 0, 2000, 10000, '{"name":"A"}'::jsonb,
          '{"name":"A","line1":"G 1","postalCode":"0150","city":"Oslo","country":"NO"}'::jsonb, now() - interval '2 days')
        returning id`;
      const [variant] = await sql`select v.id from commerce.product_variants v join commerce.products p on p.id = v.product_id where p.store_id = ${id} and p.kind = 'goods' order by v.sku limit 1`;
      await sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${id}, ${order.id}, ${variant.id}, 'X', 'Thing', 1, 10000, 100, 10000, 2000, 0.25, 'txcd_99999999', 'physical')`;
    }
    await sql`update commerce.stores set features = '{}' where id = ${id}`;
    // Without a front page of its own, a website's front page is its name (never a list of products).
    if (!sold) await sql`update commerce.stores set front_page_id = null where id = ${id}`;
  } finally {
    await sql.end();
  }
  return slug;
}

test.beforeAll(async () => {
  selling = await website("e2e-website", true);
  quiet = await website("e2e-website-quiet", false);
});

async function status(request: APIRequestContext, path: string): Promise<number> {
  return (await request.get(path, { maxRedirects: 0 })).status();
}

test("the shop's own addresses are the store's 404", async ({ request }) => {
  for (const path of ["/p/demo-keramikkopp", "/products", "/cart", "/checkout", "/search", "/wishlist", "/category/hjem"]) {
    expect(await status(request, `/s/${selling}${path}`), path).toBe(404);
  }
  // What was bought keeps its pages: the withdrawal form opens.
  expect(await status(request, `/s/${selling}/withdraw`)).toBe(200);
});

test("the front page draws as a website: no products, cart, search or account, and the withdrawal link while an order can be withdrawn from", async ({ page }) => {
  const response = await page.goto(`/s/${selling}`);
  expect(response?.status()).toBe(200);
  // The front page copied from the template holds a heading over a grid of products: the heading stays, the grid draws nothing.
  await expect(page.getByRole("heading", { name: "Produkter" })).toBeVisible();
  await expect(page.locator('main a[href*="/p/"]')).toHaveCount(0);
  for (const path of ["/cart", "/search", "/account", "/wishlist"]) await expect(page.locator(`a[href="/s/${selling}${path}"]`), path).toHaveCount(0);
  await expect(page.locator(`footer a[href="/s/${selling}/withdraw"]`)).toHaveCount(1);
});

test("a website that has sold nothing has no withdrawal link, and without a front page shows its name", async ({ page }) => {
  await page.goto(`/s/${quiet}`);
  await expect(page.getByRole("heading", { level: 1, name: "Testbutikk" })).toBeVisible();
  await expect(page.locator('main a[href*="/p/"]')).toHaveCount(0);
  await expect(page.locator(`a[href="/s/${quiet}/withdraw"]`)).toHaveCount(0);
  await expect(page.locator(`a[href="/s/${quiet}/cookies"]`).first()).toBeVisible();
});
