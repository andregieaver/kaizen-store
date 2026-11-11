import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Drop shipping as the owner sets it up (D540, step 1 of `docs/drop-shipping.md`; row orders.drop-shipping): a supplier added from Inventory →
 * Suppliers with three fields, its page opened, a product ticked and marked as sent by it, and the list showing it. The rules (own stock first,
 * the order drawn at the supplier's location, the copies) are held by suppliers.int.test.ts; this holds the screens that drive them.
 */

test.use({ storageState: OWNER.state });

const SUPPLIER = "E2E Ull";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    // A run before this one leaves its supplier: stopped here, so adding it again starts it afresh (the same row and location).
    await sql`update commerce.product_variants set supplier_id = null where store_id = ${store.id} and supplier_id in (select id from commerce.suppliers where store_id = ${store.id} and name = ${SUPPLIER})`;
    await sql`update commerce.suppliers set drop_ships = false where store_id = ${store.id} and name = ${SUPPLIER}`;
  } finally {
    await sql.end();
  }
});

test("the owner adds a supplier that ships for them and marks a product as sent by it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/inventory/suppliers`);
  await expect(page.getByRole("heading", { level: 1, name: "Suppliers" })).toBeVisible();
  const form = page.getByRole("form", { name: "Add a supplier that ships for you" });
  await form.getByLabel("Supplier").fill(SUPPLIER);
  await form.getByLabel("Email for orders").fill("ordre@e2e-ull.example");
  await form.getByLabel("Ships from").selectOption("DK");
  await form.getByRole("button", { name: "Add supplier" }).click();

  await page.waitForURL((url) => /\/inventory\/suppliers\/[0-9a-f-]{36}$/.test(url.pathname));
  await expect(page.getByRole("heading", { level: 1, name: SUPPLIER })).toBeVisible();
  await expect(page.getByText(`${SUPPLIER} was added. Now choose the products it sends.`)).toBeVisible();

  const table = page.getByRole("table", { name: "Products it sends" });
  const first = table.getByRole("row").nth(1);
  await first.getByRole("checkbox").check();
  await page.getByRole("button", { name: `Mark as sent by ${SUPPLIER}` }).click();
  await expect(page.getByText(`1 variant is now sent by ${SUPPLIER}.`)).toBeVisible();
  await expect(table.getByRole("row").nth(1)).toContainText(`Sent by ${SUPPLIER}`);

  await page.goto(`/admin/${E2E_STORE}/inventory/suppliers`);
  const row = page.getByRole("row").filter({ hasText: SUPPLIER });
  await expect(row).toContainText("Denmark");
  await expect(row).toContainText("1 variant");
  // Its location is not one of the store's own places.
  await page.goto(`/admin/${E2E_STORE}/inventory/locations`);
  await expect(page.getByRole("table")).not.toContainText(SUPPLIER);
});
