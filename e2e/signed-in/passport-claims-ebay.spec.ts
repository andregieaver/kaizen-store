import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The screens of D552, D554 and D555 as the owner uses them: a product's passport filled in and published, then read on its public page as
 * anyone who scans the code would; the environmental claims on the live site listed with a link to fix each; and eBay's page choosing a
 * product to list. The rules behind them are held by green-claims.int.test.ts, product-passports.int.test.ts and ebay.int.test.ts (against a
 * stand-in for eBay); here eBay is never called: the connection is a row, and listing only queues the product for the five-minute job.
 */

test.use({ storageState: OWNER.state });

let productId = "";
let title = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    const [product] = await sql<{ id: string; title: string }[]>`
      select p.id, t.title from commerce.products p join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
      where p.store_id = ${store.id} and p.status = 'active' and p.kind = 'goods' order by p.created_at, p.handle limit 1`;
    productId = product.id;
    title = product.title;
    // A run before this one leaves its passport, its claim and its eBay rows: made again from nothing.
    await sql`delete from commerce.product_passports where store_id = ${store.id}`;
    await sql`delete from commerce.marketplace_listings where store_id = ${store.id}`;
    await sql`delete from commerce.marketplace_orders where store_id = ${store.id}`;
    await sql`delete from commerce.marketplace_connections where store_id = ${store.id}`;
    await sql`
      update commerce.product_translations set description = regexp_replace(description, ' Helt miljøvennlig\\.$', '') || ' Helt miljøvennlig.'
      where product_id = ${product.id} and locale = 'nb-NO'`;
    await sql`
      insert into commerce.marketplace_connections (store_id, channel, state, settings)
      values (${store.id}, 'ebay', 'connected',
        ${sql.json({ marketplace: "EBAY_DE", fulfillmentPolicyId: "6196932000", paymentPolicyId: "6196933000", returnPolicyId: "6196934000", merchantLocationKey: "oslo-1", categoryId: "20625" })})`;
  } finally {
    await sql.end();
  }
});

test("the owner publishes a product's passport, and anyone reads it at its address", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products/${productId}`);
  await page.getByRole("link", { name: "Product passport" }).click();
  await page.waitForURL(new RegExp(`/products/${productId}/passport$`));
  await expect(page.locator("[data-passport-state]")).toHaveAttribute("data-passport-state", "draft");

  // Publishing with nothing in it is refused, in words.
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByText("Add the materials, or how to care for, repair or recycle it, before publishing.")).toBeVisible();

  await page.getByRole("button", { name: "Add a material" }).click();
  await page.getByLabel("Material").fill("Steintøy");
  await page.getByLabel("% of the product").fill("100");
  await page.getByLabel("% of it recycled").fill("30");
  await page.getByLabel("How to care for it").fill("Tåler oppvaskmaskin.");
  await page.getByRole("button", { name: "Save and publish" }).click();
  await expect(page.getByText("Published: the code and the link open it.")).toBeVisible();
  await expect(page.locator("[data-passport-state]")).toHaveAttribute("data-passport-state", "live");
  await expect(page.getByRole("img", { name: "The code for the product" })).toBeVisible();

  const address = await page.getByRole("link", { name: "Open the passport" }).getAttribute("href");
  expect(address).toMatch(/\/passport\/[0-9a-f-]{36}$/);
  const passport = new URL(address!).pathname;
  await page.goto(passport);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByText("Steintøy: 100 % (30 % resirkulert)")).toBeVisible();
  await expect(page.getByText("Tåler oppvaskmaskin.")).toBeVisible();
  const json = await page.request.get(`${passport}/json`);
  expect(await json.json()).toMatchObject({ schema: "kaizenaflow.passport/1", recycledShare: 30 });
});

test("the owner sees the environmental claims on the live site, with a link to the product", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products/claims`);
  await expect(page.getByRole("heading", { level: 1, name: "Environmental claims" })).toBeVisible();
  // The demo catalogue has claims of its own: the row of this product is the one.
  const row = page.getByRole("row").filter({ hasText: title }).filter({ hasText: "miljøvennlig" });
  await expect(row).toHaveCount(1);
  await row.getByRole("link", { name: "Edit" }).click();
  await page.waitForURL(new RegExp(`/products/${productId}$`));
});

test("the owner chooses a product to list on eBay, and stops listing it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/integrations/ebay`);
  await expect(page.getByRole("heading", { level: 1, name: "eBay" })).toBeVisible();
  await expect(page.getByLabel("Category number")).toHaveValue("20625");
  const product = page.getByRole("listitem").filter({ hasText: "DEMO-MUG-WHITE" });
  await product.getByRole("checkbox").check();
  await page.getByRole("button", { name: "List on eBay" }).click();
  await expect(page.getByText("1 product changed.")).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "DEMO-MUG-WHITE" })).toContainText("Waiting to be sent");
  await page.getByRole("listitem").filter({ hasText: "DEMO-MUG-WHITE" }).getByRole("checkbox").check();
  await page.getByRole("button", { name: "Stop listing" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: "DEMO-MUG-WHITE" })).toContainText("Not on eBay");
  await expect(page.getByRole("heading", { name: "Orders from eBay" })).toBeVisible();
  await expect(page.getByText("No orders from eBay yet.")).toBeVisible();
});
