import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The owner's side of the unit price (D160, D379; row international.unit-price-indication): a variant's content typed in the product editor,
 * saved through the editor's own save, kept as the variant's measure, and drawn on the storefront as the price per litre beside the price.
 * The arithmetic and the rules are held by the unit and integration tests; this holds the screen that feeds them. The owner works in a
 * store of their own, so the other specs' store is not touched.
 */

const STORE = "e2e-unit";

let product: { id: string; handle: string; variant: string };

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`
        insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Unit') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Unit', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()), private_mode = false where slug = ${STORE}`;
    const [row] = await sql`
      select p.id, p.handle, v.id as variant from commerce.products p
        join commerce.stores s on s.id = p.store_id
        join commerce.product_variants v on v.store_id = p.store_id and v.product_id = p.id
       where s.slug = ${STORE} and v.sku = 'DEMO-MUG-WHITE'`;
    product = { id: String(row.id), handle: String(row.handle), variant: String(row.variant) };
    // Start without content, so the test sees the editor write it.
    await sql`update commerce.product_variants set measure_amount = null, measure_unit = null, measure_base = null where product_id = ${product.id}`;
  } finally {
    await sql.end();
  }
});

test("an owner types a variant's content, saves, and the storefront shows the price per litre", async ({ browser }) => {
  const context = await browser.newContext({ storageState: OWNER.state });
  const page = await context.newPage();
  await page.goto(`/admin/${STORE}/products/${product.id}`);

  // The content is in the first variant's details, folded away until opened.
  await page.getByText(/^Barcode, cost, weight, content and customs for /).first().click();
  const total = page.getByLabel(/^Total content of /).first();
  await total.fill("350");
  await page.getByRole("combobox", { name: /^Unit of the content of / }).first().selectOption("ml");
  await page.getByRole("button", { name: "Save", exact: true }).first().click();
  await expect(page.getByText(/^Saved\./).first()).toBeVisible();

  const sql = testDb();
  try {
    const saved = await sql`select measure_amount::text as amount, measure_unit as unit from commerce.product_variants where product_id = ${product.id} and measure_unit is not null`;
    expect(saved).toEqual([{ amount: "350.0000", unit: "ml" }]);
  } finally {
    await sql.end();
  }

  // The editor shows what was kept after a reload.
  await page.reload();
  await page.getByText(/^Barcode, cost, weight, content and customs for /).first().click();
  await expect(page.getByLabel(/^Total content of /).first()).toHaveValue(/^350/);
  await context.close();

  // The storefront draws the price per litre beside the price, for a visitor.
  const visitor = await browser.newContext();
  const shop = await visitor.newPage();
  await shop.goto(`/s/${STORE}/no/p/${product.handle}`);
  const unit = shop.locator("[data-unit-price]").first();
  await expect(unit).toBeVisible();
  // 249,00 kr for 350 ml is 711,43 kr per litre.
  await expect(unit).toContainText("711,43 kr/l");
  await visitor.close();
});
