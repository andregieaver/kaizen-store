import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Analytics → Reports as the owner meets it (wave 8 unit A, D345; rows analytics.custom-report-builder-and-shopifyql and
 * analytics.standard-sales-reports): a ready report opens in one press with its table and the sentence that says what it is; the builder
 * offers only cuts the figures allow; the report is saved under a name, found again in the list, downloaded as a CSV and deleted. The
 * figures are held by report-query.int.test.ts; this holds the screen.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

const NAME = `Variants ${Date.now().toString(36)}`;

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.saved_reports where title = ${NAME}`;
  } finally {
    await sql.end();
  }
});

test("opens a ready report, saves a changed one, downloads it and deletes it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/analytics/reports`);
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Sales by product", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Sales by product", level: 1 })).toBeVisible();
  await expect(page.getByText(/Revenue, units sold, orders and gross profit by product/)).toBeVisible();
  await expect(page.locator("[data-report-table]")).toBeVisible();

  // Refunds cannot be cut by a product: choosing them takes the cut away rather than offering a report that cannot run.
  const builder = page.locator("[data-report-builder]");
  await builder.getByRole("checkbox", { name: "Refunds" }).check();
  await expect(builder.getByRole("combobox", { name: "Cut by", exact: true })).toHaveValue("");
  await builder.getByRole("checkbox", { name: "Refunds" }).uncheck();

  // By variant instead, and shown.
  await builder.getByRole("combobox", { name: "Cut by", exact: true }).selectOption("variant");
  await builder.getByRole("button", { name: "Show" }).click();
  await expect(page).toHaveURL(/[?&]q=/);
  await expect(page.locator("[data-report-table] thead")).toContainText("Variant");

  // Saved under a name, it opens as itself.
  await page.getByLabel("Name").fill(NAME);
  await page.getByRole("button", { name: "Save report" }).click();
  await expect(page.getByRole("heading", { name: NAME, level: 1 })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Saved." })).toBeVisible();

  // The CSV is the table.
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download CSV" }).click();
  const file = await downloading;
  const csv = readFileSync((await file.path())!, "utf8");
  expect(csv.split("\r\n")[0]).toMatch(/^period_from,period_to,.*variant,net_sales/);

  // Listed, then deleted.
  await page.goto(`/admin/${E2E_STORE}/analytics/reports`);
  await page.getByRole("list", { name: "Your reports" }).getByRole("link", { name: NAME }).click();
  await page.getByRole("button", { name: "Delete report" }).click();
  await expect(page.getByRole("heading", { name: "Reports", level: 1 })).toBeVisible();
  await expect(page.getByRole("list", { name: "Your reports" })).toHaveCount(0);
});
