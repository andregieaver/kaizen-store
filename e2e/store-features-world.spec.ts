import { expect, test, type APIRequestContext } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Store features, step 4 (D178, `docs/store-features.md` 4d): a new store sells in its own country alone, in its own language and currency.
 * An address of another of its countries, of a language or of a currency it does not offer moves, for good, to the same page where it is
 * offered; a cart in a country no longer offered says so; what a shopper already bought (the withdrawal form here) still opens in its own
 * country. The store is made for this file, so nothing of it is cached before the first request.
 */

let slug: string;

test.beforeAll(async () => {
  let id: string;
  ({ slug, id } = await testStore("e2e-world"));
  // English and euro chosen (D109), but Several languages and currencies off, as Several countries: none of them is offered.
  const sql = testDb();
  try {
    await sql`update commerce.stores set locales = array['nb-NO', 'en-GB'] where id = ${id}`;
    await sql`insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${id}, 'NOK', 11.5, 1, 0), (${id}, 'EUR', 1, 1, 1)`;
  } finally {
    await sql.end();
  }
});

/** What a request answers, without following a redirect (a `Location` set twice while streaming is made one). */
async function ask(request: APIRequestContext, path: string): Promise<{ status: number; location: string | null }> {
  const response = await request.get(path, { maxRedirects: 0 });
  const values = [...new Set((response.headers()["location"] ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
  const to = values.length === 1 ? new URL(values[0], "http://x") : null;
  return { status: response.status(), location: to ? to.pathname + to.search : null };
}

test("another country, a language and a currency the store does not offer move to its own country's address, keeping the page", async ({ request }) => {
  expect(await ask(request, `/s/${slug}/no/p/demo-keramikkopp`)).toMatchObject({ status: 200 });
  expect(await ask(request, `/s/${slug}/se/p/demo-keramikkopp`)).toEqual({ status: 308, location: `/s/${slug}/no/p/demo-keramikkopp` });
  expect(await ask(request, `/s/${slug}/no-en`)).toEqual({ status: 308, location: `/s/${slug}/no` });
  expect(await ask(request, `/s/${slug}/no-eur/products`)).toEqual({ status: 308, location: `/s/${slug}/no/products` });
  expect(await ask(request, `/s/${slug}/dk-en/category/hjem`)).toEqual({ status: 308, location: `/s/${slug}/no/category/hjem` });
  // A page that streams its content (My account) moves before it starts, so the move is the response's status.
  expect(await ask(request, `/s/${slug}/se/account`)).toEqual({ status: 308, location: `/s/${slug}/no/account` });
  // An address no route matches keeps its path, and is then the 404 it was in the store's own country.
  expect(await ask(request, `/s/${slug}/se/finnes-ikke`)).toEqual({ status: 308, location: `/s/${slug}/no/finnes-ikke` });
  // A country, or a language, the store never had is no address of it.
  expect((await ask(request, `/s/${slug}/fi/p/demo-keramikkopp`)).status).toBe(404);
  expect((await ask(request, `/s/${slug}/no-de`)).status).toBe(404);
});

test("the storefront offers one country, one language and one currency, with no choosers", async ({ page }) => {
  await page.goto(`/s/${slug}/no`);
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.getByRole("link", { name: "Sverige" })).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(2);
  await expect(page.locator('link[rel="alternate"][hreflang="nb-NO"]')).toHaveCount(1);
});

test("a cart in a country no longer offered says so and leads to the store's own country; a withdrawal there still opens", async ({ page }) => {
  await page.goto(`/s/${slug}/se/cart`);
  await expect(page.getByRole("status")).toContainText("Butiken säljer inte längre till Sverige");
  await expect(page.getByRole("link", { name: "Gå till butiken för Norge" })).toHaveAttribute("href", `/s/${slug}/no`);
  const withdraw = await page.goto(`/s/${slug}/se/withdraw`);
  expect(withdraw?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "sv");
});
