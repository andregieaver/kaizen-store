import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Combined listings (D566) as the owner makes one and a shopper uses it: two of the store's products shown together by colour, from a
 * product's own admin page; the product page then offers both, this one marked, and the other a link to its own page; the listing's cards
 * link to each. The rules are held by product-groups.int.test.ts.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const ids: Record<string, string> = {};

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    // A run before this one leaves its listing: made again from nothing.
    await sql`update commerce.products set group_id = null, group_value = '{}', group_swatch = null, group_position = 0 where store_id = ${store.id} and group_id is not null`;
    await sql`delete from commerce.product_groups where store_id = ${store.id}`;
    for (const handle of ["demo-keramikkopp", "demo-termokopp"]) {
      const [row] = await sql`select id from commerce.products where store_id = ${store.id} and handle = ${handle}`;
      ids[handle] = String(row.id);
    }
  } finally {
    await sql.end();
  }
});

test("the owner shows two products together by colour from a product's page", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products/${ids["demo-keramikkopp"]}`);
  await page.getByRole("link", { name: "Show with other products (colours, sizes…)" }).click();
  await page.waitForURL(/\/listing$/);
  await page.waitForLoadState("networkidle");
  const start = page.getByRole("form", { name: "Show together" });
  await start.getByLabel("What tells them apart").fill("Farge");
  await start.getByLabel("This product's").fill("Hvit");
  await start.getByLabel("Colour dot (optional)").fill("#f5f5f4");
  await start.getByRole("button", { name: "Show together" }).click();
  await expect(page.getByRole("heading", { name: "Products shown together" })).toBeVisible();

  const add = page.getByRole("form", { name: "Add a product" });
  await add.getByLabel("Product", { exact: true }).selectOption(ids["demo-termokopp"]);
  await add.getByLabel("This product's").fill("Svart");
  await add.getByLabel("Colour dot (optional)").fill("#1c1917");
  await add.getByRole("button", { name: "Add" }).click();
  await expect(page.locator("[data-group-member]")).toHaveCount(2);
  await expect(page.locator('[data-group-member="demo-termokopp"] input').first()).toHaveValue("Svart");
});

test("a shopper chooses between them on the product page, and the cards link to each", async ({ page }) => {
  await page.goto(`/s/${E2E_STORE}/p/demo-keramikkopp`);
  const chooser = page.locator("[data-group-chooser]");
  await expect(chooser).toContainText("Farge: Hvit");
  await expect(chooser.getByRole("link", { name: "Hvit" })).toHaveAttribute("aria-current", "page");
  await chooser.getByRole("link", { name: "Svart" }).click();
  await page.waitForURL(/\/p\/demo-termokopp$/);
  await expect(page.locator("[data-group-chooser]").filter({ hasText: "Farge: Svart" }).first()).toBeVisible();

  await page.goto(`/s/${E2E_STORE}/products`);
  const card = page.locator(".product-card").filter({ has: page.locator("[data-group-swatches]") }).first();
  await expect(card.getByRole("link", { name: "Farge: Svart" })).toHaveAttribute("href", /\/p\/demo-termokopp$/);
});
