import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The owner's side of D557, D558 and D560: Settings, Products switches what product tiles show; the builder offers the basket's notes only
 * on a page chosen for the cart, the checkout, a category or a tag, and only the notes that draw there; Integrations, Instagram says it
 * cannot connect where Kaizena Flow's Instagram app is not set up (as in this build).
 */
test.use({ storageState: OWNER.state });

test("Settings, Products keeps what product tiles show", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/settings/products`);
  await expect(page.getByRole("heading", { level: 1, name: "Products" })).toBeVisible();
  const stock = page.getByRole("checkbox", { name: /^Show how many are left/ });
  const quantity = page.getByRole("checkbox", { name: /^Show a quantity chooser and Add to cart/ });
  await expect(stock).not.toBeChecked();
  await expect(quantity).not.toBeChecked();

  await stock.check();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
  await page.reload();
  await expect(stock).toBeChecked();
  await expect(quantity).not.toBeChecked();

  // Back as it was, for the other specs and the next run.
  await stock.uncheck();
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Saved.")).toBeVisible();
});

test("the basket's notes are offered only on a page chosen for the cart, checkout, a category or a tag", async ({ page }) => {
  // A page of no role: none of them.
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Components" }).click();
  await expect(page.getByRole("button", { name: "Add heading", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add free shipping", exact: true })).toHaveCount(0);

  // The page chosen for the store's tag pages: free shipping and the saving, never what goes with the cart (it draws on the cart and checkout).
  // A page is chosen for it the owner's way when none is, so the store's cached roles know it (a row written here would not reach them).
  const sql = testDb();
  let held: string | null;
  try {
    const [row] = await sql`
      select r.page_id from commerce.page_roles r join commerce.stores s on s.id = r.store_id where s.slug = ${E2E_STORE} and r.role = 'tag'`;
    held = row ? String(row.page_id) : null;
  } finally {
    await sql.end();
  }
  if (held) {
    await page.goto(`/admin/${E2E_STORE}/pages/${held}`);
  } else {
    await page.goto(`/admin/${E2E_STORE}/pages`);
    const card = page
      .getByRole("heading", { name: "Tag pages", exact: true })
      .locator("xpath=ancestor::*[.//button[normalize-space()='Start from a new page']][1]");
    await card.getByRole("button", { name: "Start from a new page" }).click();
    await page.waitForURL(new RegExp(`/admin/${E2E_STORE}/pages/[0-9a-f-]{36}`));
  }
  await page.getByRole("tab", { name: "Components" }).click();
  await expect(page.getByRole("heading", { name: "Basket notes" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add free shipping", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add you saved", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add goes well with", exact: true })).toHaveCount(0);
});

test("Integrations, Instagram says it cannot connect yet without Kaizena Flow's Instagram app", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/integrations`);
  await page.getByRole("link", { name: "Connect Instagram" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Instagram" })).toBeVisible();
  await expect(page.getByText("Instagram cannot be connected on this installation yet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect Instagram" })).toHaveCount(0);
});
