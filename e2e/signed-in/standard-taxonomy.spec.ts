import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The standard product taxonomy as the owner and shoppers meet it (wave 6 unit I, D327; row catalogue.standard-product-taxonomy): a category
 * found in the editor's Category card by what the product is and an attribute's value ticked under it, saved with the product; the store's
 * listing filtered by that value in its address; and the store's Google feed carrying Google's category and the colour. The rules are held by
 * product-taxonomy.test.ts and product-taxonomy.int.test.ts; this holds the screens and the addresses that use them.
 */

test.use({ storageState: OWNER.state });

/** A feed token of this test's own, kept by the store as feeds keep one: a hash to find it by (the encrypted copy is not read to serve it). */
const FEED_TOKEN = "e2eTaxonomyFeedToken0123456789ab";
let product = { id: "", title: "" };
let storeId = "";
let storefront = "";
let marketSlug = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${E2E_STORE}`;
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    // A product shoppers can buy, with a picture and a price, so the feed carries it; none of the store's has a standard category to start.
    await sql`update commerce.products set standard_category = null, standard_attributes = '{}' where store_id = ${storeId}`;
    const [found] = await sql<{ id: string; title: string }[]>`
      select p.id, t.title from commerce.products p
        join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
       where p.store_id = ${storeId} and p.status = 'active' and p.kind = 'goods'
         and exists (select 1 from commerce.product_media m where m.product_id = p.id)
         and exists (select 1 from commerce.product_variants v join commerce.current_prices cp on cp.variant_id = v.id where v.product_id = p.id)
       order by p.created_at, p.handle limit 1`;
    expect(found).toBeTruthy();
    product = { id: found.id, title: found.title };
    const [market] = await sql`select code from commerce.markets where store_id = ${storeId} and active order by created_at, code limit 1`;
    marketSlug = String(market.code).toLowerCase();
    storefront = `/s/${E2E_STORE}/${marketSlug}`;
    const hash = createHash("sha256").update(FEED_TOKEN).digest("hex");
    await sql`
      insert into commerce.feed_settings (store_id, token_hash, token, "on") values (${storeId}, ${hash}, 'e2e', true)
      on conflict (store_id) do update set token_hash = excluded.token_hash, token = excluded.token, "on" = true`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.products set standard_category = null, standard_attributes = '{}' where store_id = ${storeId}`;
    await sql`delete from commerce.feed_settings where store_id = ${storeId}`;
  } finally {
    await sql.end();
  }
});

test("finds a category by what the product is, ticks a colour, and saves them with the product", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products/${product.id}`);
  // The standard category is Lisa's, one step away under Advanced.
  await page.locator("[data-advanced] > summary").click();
  const card = page.getByRole("region", { name: "Product category", exact: true });
  await card.getByRole("searchbox", { name: "What is it?" }).fill("activewear");
  await card.getByRole("button", { name: /^Activewear/ }).first().click();
  await expect(card.getByTestId("standard-category")).toHaveText("Apparel & Accessories > Clothing > Activewear");
  await card.getByText("Attributes", { exact: true }).click();
  await card.locator("summary", { hasText: /^Color/ }).click();
  await card.getByRole("checkbox", { name: "Black", exact: true }).check();
  await expect(card.getByText("1 chosen").first()).toBeVisible();
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText("Saved.").first()).toBeVisible({ timeout: 30_000 });

  const sql = testDb();
  try {
    const [saved] = await sql`select standard_category, standard_attributes from commerce.products where id = ${product.id}`;
    expect(saved).toEqual({ standard_category: "aa-1-1", standard_attributes: { "1": [1] } });
  } finally {
    await sql.end();
  }
  // Read again, the card names it.
  await page.reload();
  await page.locator("[data-advanced] > summary").click();
  await expect(page.getByTestId("standard-category")).toHaveText("Apparel & Accessories > Clothing > Activewear");
});

test("the listing filters by the colour in its address, and the Google feed carries the category and the colour", async ({ page, request }) => {
  await page.goto(`${storefront}/products?t.color=black`);
  await expect(page.getByText(product.title, { exact: true }).first()).toBeVisible();
  await page.goto(`${storefront}/products?t.color=red`);
  await expect(page.getByText(product.title, { exact: true })).toHaveCount(0);

  const feed = await request.get(`/api/feeds/${FEED_TOKEN}/${marketSlug}-google.xml`);
  expect(feed.status()).toBe(200);
  const xml = await feed.text();
  const item = xml.split("<item>").find((part) => part.includes(`<g:id>`) && part.includes("<g:google_product_category>"));
  expect(item, "an item with Google's category").toBeTruthy();
  expect(item).toContain("<g:google_product_category>5322</g:google_product_category>");
  expect(item).toContain("<g:color>Black</g:color>");
});
