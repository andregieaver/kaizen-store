import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { OWNER } from "./accounts";

/**
 * The owner's Inventory pages in a browser (wave 3, D172; wave 10 unit G, D370; row catalogue.inventory-tracking-with-reservations). The figures,
 * the movements and the stock file are held by inventory*.int.test.ts and the views by inventory-views.test.ts; this holds the screens as a person
 * uses them: the list with its figures, a change typed, reviewed and saved with a reason, the variant's history with that change, and the stock
 * file, whose export carries `on_hand_was` so a count brought back is checked against the stock it was made from.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const STORE = "e2e-inventory";
const SKU = "DEMO-TOTE";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // The owner's store, made once: other specs make theirs for the same owner at the same time, and a pending request is one per email.
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('e2e-owner-request'))`;
      if ((await tx`select 1 from commerce.stores where slug = ${STORE}`).length > 0) return;
      const [request] = await tx`insert into commerce.access_requests (email, name, store_name) values (${OWNER.email}, ${OWNER.name}, 'E2E Inventory') returning id`;
      await tx`select commerce.approve_access_request(${request.id}, ${STORE}, 'E2E Inventory', null)`;
    });
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${STORE}`;
    // The tote at 12 at the store's one location, whatever an earlier run left (a change of a level is a movement of its own).
    const [variant] = await sql`
      select v.store_id, v.id from commerce.product_variants v join commerce.stores s on s.id = v.store_id where s.slug = ${STORE} and v.sku = ${SKU}`;
    const [location] = await sql`select id from commerce.inventory_locations where store_id = ${variant.store_id} and active order by priority, created_at limit 1`;
    await sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${variant.store_id}, ${variant.id}, ${location.id}, 12)
      on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand`;
  } finally {
    await sql.end();
  }
});

test("the Inventory page lists a variant's figures, and a change is reviewed, saved with its reason and kept in its history", async ({ page }) => {
  await page.goto(`/admin/${STORE}/inventory`);
  await expect(page.getByRole("heading", { level: 1, name: "Inventory" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Inventory", exact: true }).getByRole("link", { name: "Inventory", exact: true })).toHaveAttribute("aria-current", "page");

  const table = page.getByRole("table", { name: /^One row for each variant/ });
  await expect(table).toBeVisible();
  for (const column of ["Variant", "SKU", "On hand", "Committed", "Available", "Owed", "Low-stock level"]) {
    await expect(table.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
  }
  const row = table.getByRole("row").filter({ hasText: SKU }).first();
  await expect(row).toContainText("12");

  // A counted figure, reviewed before anything is saved.
  await row.getByRole("textbox", { name: /^Set on hand to, / }).fill("9");
  await page.getByRole("button", { name: /^Review changes/ }).click();
  const review = page.getByRole("table", { name: "Changes that would be saved, before and after" });
  await expect(review).toBeVisible();
  const reviewed = review.getByRole("row").filter({ hasText: SKU });
  await expect(reviewed).toContainText("12");
  await expect(reviewed).toContainText("9");
  await page.getByLabel("Reason", { exact: true }).selectOption("count");
  await page.getByRole("button", { name: "Save changes (1)" }).click();
  await expect(page.getByRole("region", { name: "Result" }).getByRole("heading", { name: "1 figure saved" })).toBeVisible();
  await expect(table.getByRole("row").filter({ hasText: SKU }).first()).toContainText("9");

  // The variant's history: only its changes, newest first, the count on top.
  await table.getByRole("row").filter({ hasText: SKU }).first().getByRole("link", { name: "History", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${STORE}/inventory/history\\?variant=[0-9a-f-]{36}$`));
  await expect(page.getByRole("heading", { level: 1, name: "Stock history" })).toBeVisible();
  await expect(page.getByText("Showing the changes of one variant.")).toBeVisible();
  const history = page.getByRole("table", { name: "Changes of stock levels, newest first" });
  await expect(history).toBeVisible();
  for (const column of ["When", "Variant", "Change", "New on hand", "Reason", "By"]) {
    await expect(history.getByRole("columnheader", { name: column, exact: true })).toBeVisible();
  }
  const changes = history.locator("tbody tr");
  expect(await changes.count()).toBeGreaterThanOrEqual(2);
  for (const change of await changes.all()) await expect(change).toContainText(SKU);
  await expect(changes.first()).toContainText("Count");
  await expect(changes.first().getByRole("cell").nth(4)).toHaveText("9");
});

test("the stock file: the export carries on_hand_was beside on_hand, and the import page says what an import does", async ({ page }) => {
  await page.goto(`/admin/${STORE}/inventory/export`);
  await expect(page.getByRole("heading", { level: 1, name: "Export stock" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Inventory", exact: true }).getByRole("link", { name: "Export", exact: true })).toHaveAttribute("aria-current", "page");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export stock", exact: true }).click();
  const file = await downloading;
  const text = await (await file.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString("utf8"));
  const lines = text.replace(/^﻿/, "").split("\r\n");
  expect(lines[0]).toBe("sku,product,options,location,on_hand,on_hand_was,committed,available,stock_policy,backorder_days,low_stock_threshold");
  // The tote's row: on hand 9 written twice (the second the figure the file was made from), nothing held, 9 available.
  const tote = lines.find((line) => line.startsWith(`${SKU},`));
  expect(tote).toContain(",9,9,0,9,");

  await page.goto(`/admin/${STORE}/inventory/import`);
  await expect(page.getByRole("heading", { level: 1, name: "Import stock" })).toBeVisible();
  await expect(page.getByText("What an import does and does not do")).toBeVisible();
  await expect(page.locator("code", { hasText: "on_hand_was" }).first()).toBeVisible();
});
