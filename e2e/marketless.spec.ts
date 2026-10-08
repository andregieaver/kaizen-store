import { expect, test, type APIRequestContext } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/**
 * Addresses without a country (D181, `docs/marketless-addresses.md`): a store that sells in its own country alone (a new store, with the shop
 * and nothing else) has no country in its addresses. `/s/{store}/home` is its page, `/s/{store}/no/home` moves there for good, a language it
 * offers is a short prefix (`/en/home`), and the cart and checkout work and send their policy at the short address. Once it sells in several countries the short addresses move back to its own country's. The store is made for this file,
 * so nothing of it is cached before the first request.
 */

let slug: string;
let id: string;

test.beforeAll(async () => {
  const address = await storePageWith("e2e-marketless", [{ id: "h1", type: "heading", text: "Hjemme hos oss", level: 1 }], "home");
  slug = address.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${slug}`;
    id = String(store.id);
    // English offered (Several languages on), and the store open to search engines.
    await sql`update commerce.stores set locales = array['nb-NO', 'en-GB'], features = features || array['languages'], setup_completed_at = now() where id = ${id}`;
  } finally {
    await sql.end();
  }
});

/** What a request answers, without following a redirect. */
async function ask(request: APIRequestContext, path: string): Promise<{ status: number; location: string | null }> {
  const response = await request.get(path, { maxRedirects: 0 });
  const values = [...new Set((response.headers()["location"] ?? "").split(",").map((v) => v.trim()).filter(Boolean))];
  const to = values.length === 1 ? new URL(values[0], "http://x") : null;
  return { status: response.status(), location: to ? to.pathname + to.search : null };
}

test("a page is at its address without the country, and the old address moves there for good, keeping the query", async ({ page, request }) => {
  const response = await page.goto(`/s/${slug}/home`);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(`/s/${slug}/home`);
  await expect(page.getByRole("heading", { level: 1, name: "Hjemme hos oss" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "nb");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/s/${slug}/home$`));
  // The store's own links have no country either.
  await expect(page.locator(`a[href="/s/${slug}/cart"]`).first()).toBeAttached();
  await expect(page.locator(`a[href^="/s/${slug}/no/"]`)).toHaveCount(0);

  expect(await ask(request, `/s/${slug}/no/home?utm_source=mail`)).toEqual({ status: 308, location: `/s/${slug}/home?utm_source=mail` });
  expect(await ask(request, `/s/${slug}/no`)).toEqual({ status: 308, location: `/s/${slug}` });
  expect(await ask(request, `/s/${slug}/no/p/demo-keramikkopp`)).toEqual({ status: 308, location: `/s/${slug}/p/demo-keramikkopp` });
  expect(await ask(request, `/s/${slug}/no-en/home`)).toEqual({ status: 308, location: `/s/${slug}/en/home` });
  // The front door is the store's front page, not a country chooser.
  expect((await ask(request, `/s/${slug}`)).status).toBe(200);
  // An address that is nothing is still the 404 it was.
  expect((await ask(request, `/s/${slug}/finnes-ikke`)).status).toBe(404);
});

test("a language it offers is a short prefix, in that language", async ({ page }) => {
  const response = await page.goto(`/s/${slug}/en/home`);
  expect(response?.status()).toBe(200);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator(`a[href="/s/${slug}/en/cart"]`).first()).toBeAttached();
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`/s/${slug}/en/home$`));
  const alternates = await page.locator('link[rel="alternate"][hreflang]').evaluateAll((links) => links.map((l) => `${l.getAttribute("hreflang")} ${new URL(l.getAttribute("href") ?? "", location.href).pathname}`));
  // The page has no English text of its own, so only its Norwegian address is offered to search engines, without the country.
  expect(alternates).toEqual(expect.arrayContaining([`nb-NO /s/${slug}/home`]));
});

test("the cart and checkout work at the short addresses, with their policy", async ({ page, request }) => {
  for (const path of ["/cart", "/checkout"]) {
    const answer = await request.get(`/s/${slug}${path}`, { maxRedirects: 0 });
    expect(answer.headers()["content-security-policy"], path).toContain("script-src");
  }
  await page.goto(`/s/${slug}/p/demo-keramikkopp`);
  await page.getByRole("button", { name: "Legg i handlekurven" }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Lagt i handlekurven." })).toBeVisible();
  await page.getByRole("link", { name: "Gå til handlekurven" }).click();
  await expect(page).toHaveURL(`/s/${slug}/cart`);
  await expect(page.getByRole("heading", { level: 1, name: "Handlekurv" })).toBeVisible();
  await expect(page.getByText("Demo: Keramikkopp").first()).toBeVisible();
  // The header's cart link and the line's link to its product have no country either.
  await expect(page.getByRole("link", { name: /Handlekurv/ }).first()).toHaveAttribute("href", `/s/${slug}/cart`);
  await expect(page.getByRole("link", { name: "Demo: Keramikkopp" }).first()).toHaveAttribute("href", `/s/${slug}/p/demo-keramikkopp`);
});

// The sitemap is not checked here: the server caches the list of public stores for hours, so a store made a moment ago is not in it yet.
// `src/server/store-address.int.test.ts` holds that the sitemap and llms.txt list the short addresses.

test("once it sells in several countries, the short addresses move back to its own country's", async ({ request }) => {
  const sql = testDb();
  try {
    await sql`update commerce.stores set features = features || array['countries'] where id = ${id}`;
  } finally {
    await sql.end();
  }
  // The proxy reads a store's facts at most every few seconds (a switch in the admin also forgets them at once).
  await expect.poll(async () => (await ask(request, `/s/${slug}/home`)).location, { timeout: 30_000, intervals: [1_000] }).toBe(`/s/${slug}/no/home`);
  expect(await ask(request, `/s/${slug}/p/demo-keramikkopp?x=1`)).toEqual({ status: 308, location: `/s/${slug}/no/p/demo-keramikkopp?x=1` });
  expect(await ask(request, `/s/${slug}/en/home`)).toEqual({ status: 308, location: `/s/${slug}/no-en/home` });
  expect(await ask(request, `/s/${slug}/cart`)).toEqual({ status: 308, location: `/s/${slug}/no/cart` });
  expect((await ask(request, `/s/${slug}/no/home`)).status).toBe(200);
});
