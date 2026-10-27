import { expect, test } from "@playwright/test";

import { testDb, testStore } from "./db";

/**
 * Each country's own (wave 7 unit D, D338; rows international.market-specific-content-adaptation and international.geolocation-suggestion), as
 * a visitor meets it in a new store that sells in several countries: a page for Sweden only is there in Sweden and not found in Norway; a
 * product's description for Sweden shows on its Swedish page and not on its Norwegian one; and a visitor from Sweden on a Norwegian page is
 * offered the same page for Sweden, never moved there, and can close it. Crawlers and the pay routes get no suggestion.
 */

let store = { slug: "", id: "" };
let handle = "";

test.beforeAll(async () => {
  store = await testStore("land", ["countries"]);
  const sql = testDb();
  try {
    const content = {
      title: "Bare for Sverige",
      slug: "sverige",
      thumbnail: null,
      seo: { title: "", description: "" },
      searchEngines: true,
      aiAssistants: true,
      categories: [],
      tags: [],
      markets: ["SE"],
      rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "h1", type: "heading", text: "Hej Sverige", level: 1 }] }] }],
    };
    await sql`insert into commerce.pages (store_id, slug, draft, published, published_at) values (${store.id}, 'sverige', ${sql.json(content)}, ${sql.json(content)}, now())`;
    // A product sold in Norway and Sweden, with a description for Sweden in Swedish.
    const [product] = await sql<{ id: string; handle: string }[]>`
      select p.id, p.handle from commerce.products p
       where p.store_id = ${store.id} and p.status = 'active' and p.kind = 'goods'
         and exists (select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id where v.product_id = p.id and cp.market_code = 'SE')
         and exists (select 1 from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id where v.product_id = p.id and cp.market_code = 'NO')
       order by p.created_at, p.handle limit 1`;
    expect(product).toBeTruthy();
    handle = product.handle;
    const [se] = await sql`select default_locale from commerce.markets where store_id = ${store.id} and code = 'SE'`;
    await sql`
      insert into commerce.product_market_texts (store_id, product_id, market_code, locale, description)
      values (${store.id}, ${product.id}, 'SE', ${String(se.default_locale)}, 'En beskrivning bara för Sverige.')`;
  } finally {
    await sql.end();
  }
});

test("a page for Sweden only is there in Sweden and not found in Norway", async ({ page }) => {
  const there = await page.goto(`/s/${store.slug}/se/sverige`);
  expect(there?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: "Hej Sverige", level: 1 })).toBeVisible();
  const elsewhere = await page.goto(`/s/${store.slug}/no/sverige`);
  expect(elsewhere?.status()).toBe(404);
});

test("a product's description for Sweden shows on its Swedish page, the language's on its Norwegian one", async ({ page }) => {
  await page.goto(`/s/${store.slug}/se/p/${handle}`);
  await expect(page.getByText("En beskrivning bara för Sverige.")).toBeVisible();
  await page.goto(`/s/${store.slug}/no/p/${handle}`);
  await expect(page.getByText("En beskrivning bara för Sverige.")).toHaveCount(0);
});

test("a visitor from Sweden is offered the same page for Sweden, never moved, and can close it", async ({ browser }) => {
  const context = await browser.newContext({ extraHTTPHeaders: { "x-vercel-ip-country": "SE" } });
  const page = await context.newPage();
  try {
    await page.goto(`/s/${store.slug}/no/p/${handle}`);
    await expect(page).toHaveURL(new RegExp(`/s/${store.slug}/no/p/${handle}$`));
    const hint = page.locator("[data-country-hint]");
    await expect(hint).toBeVisible();
    await expect(hint.getByRole("link")).toHaveAttribute("href", `/s/${store.slug}/se/p/${handle}`);
    await hint.getByRole("button").click();
    await expect(hint).toHaveCount(0);
    // In Sweden already: nothing to suggest.
    await page.goto(`/s/${store.slug}/se/p/${handle}`);
    await expect(page.locator("[data-country-hint]")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("crawlers and a country the store does not sell to get no suggestion", async ({ browser }) => {
  const crawler = await browser.newContext({
    extraHTTPHeaders: { "x-vercel-ip-country": "SE" },
    userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  });
  const elsewhere = await browser.newContext({ extraHTTPHeaders: { "x-vercel-ip-country": "US" } });
  try {
    for (const context of [crawler, elsewhere]) {
      const page = await context.newPage();
      await page.goto(`/s/${store.slug}/no/p/${handle}`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("[data-country-hint]")).toHaveCount(0);
    }
  } finally {
    await crawler.close();
    await elsewhere.close();
  }
});
