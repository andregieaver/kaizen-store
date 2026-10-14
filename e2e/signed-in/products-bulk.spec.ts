import { expect, test } from "@playwright/test";

import { applyPercent } from "../../src/lib/bulk-edit";
import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Bulk editing as the owner does it in the products list (wave 2, D165; row catalogue.bulk-editing): tick products, choose an
 * action, review what it will change, apply it in one confirmed step, and undo it. The server side is held by
 * bulk-edit.int.test.ts; this holds the screen that drives it.
 */

test.use({ storageState: OWNER.state });

async function pricesOf(handles: string[]) {
  const sql = testDb();
  try {
    return await sql<{ handle: string; amount: number }[]>`
      select p.handle, cp.amount_minor::int as amount
        from commerce.products p
        join commerce.stores s on s.id = p.store_id and s.slug = ${E2E_STORE}
        join commerce.product_variants v on v.product_id = p.id
        join commerce.current_prices cp on cp.variant_id = v.id
       where p.handle = any(${handles}) and cp.market_code = 'NO'
       order by p.handle, v.id, cp.market_code`;
  } finally {
    await sql.end();
  }
}

test("ticks two products, lowers their price by 10 % in one confirmed step, and undoes it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/products`);
  const boxes = page.getByRole("checkbox", { name: /^Choose (?!all)/ });
  await expect(boxes.first()).toBeVisible();

  // Two products that have a price in every market they sell in.
  const sql = testDb();
  const priced = await sql<{ title: string; handle: string }[]>`
    select t.title, p.handle from commerce.products p
      join commerce.stores s on s.id = p.store_id and s.slug = ${E2E_STORE}
      join commerce.product_translations t on t.product_id = p.id and t.locale = 'nb-NO'
     where p.kind = 'goods' and p.status <> 'archived'
       and exists (select 1 from commerce.product_variants v join commerce.current_prices cp on cp.variant_id = v.id where v.product_id = p.id)
     order by p.handle limit 2`;
  await sql.end();
  expect(priced).toHaveLength(2);
  const before = await pricesOf(priced.map((p) => p.handle));

  for (const product of priced) await page.getByRole("checkbox", { name: `Choose ${product.title}`, exact: true }).check();
  const bar = page.getByRole("region", { name: "Bulk actions" });
  await expect(bar.getByText("2 products chosen")).toBeVisible();

  await bar.getByRole("button", { name: "Change price" }).click();
  await bar.getByLabel("A percentage").check();
  await bar.locator("#bulk-percent").fill("-10");
  await bar.getByRole("button", { name: "Review" }).click();

  const confirm = bar.getByRole("group", { name: "Confirm" });
  await expect(confirm.getByText(/this will change 2 of 2 products/)).toBeVisible();
  await confirm.getByRole("button", { name: "Apply to 2 products" }).click();

  const result = page.getByRole("region", { name: "Result" });
  await expect(result.getByRole("heading", { name: "Change price: done" })).toBeVisible();
  await expect(result.getByText("2 products: 2 changed, 0 left as they were, 0 failed.")).toBeVisible();
  const after = await pricesOf(priced.map((p) => p.handle));
  expect(after.map((p) => p.amount)).toEqual(before.map((p) => applyPercent(p.amount, -1000)));

  await result.getByRole("button", { name: "Undo this change" }).click();
  await expect(result.getByRole("status").filter({ hasText: /^Put back \d+ change/ })).toBeVisible();
  expect((await pricesOf(priced.map((p) => p.handle))).map((p) => p.amount)).toEqual(before.map((p) => p.amount));
});
