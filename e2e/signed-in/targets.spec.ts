import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * A target for orders as the owner sets it (wave 8 unit D, D348; row analytics.targets-alerts-forecasting): saved on Analytics → Settings under
 * *Targets for orders, conversion and more*, listed there, and drawn on the Overview with its meter while its period runs. The progress is held by
 * analytics-targets.test.ts and analytics-briefing.int.test.ts; this holds the screens.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`
      delete from commerce.analytics_targets
      where store_id = (select id from commerce.stores where slug = ${E2E_STORE}) and metric = 'orders' and target_value = 4321
    `;
  } finally {
    await sql.end();
  }
});

test("sets a month's target for orders and follows it on the Overview", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/analytics/settings`);
  const section = page.getByRole("region", { name: "Targets for orders, conversion and more" });
  await expect(section).toBeVisible();
  await section.getByRole("combobox", { name: /What to aim for/ }).selectOption("orders");
  await section.getByRole("combobox", { name: /Period/ }).selectOption("month");
  await section.getByRole("textbox", { name: /^Target/ }).fill("4321");
  await section.getByRole("button", { name: "Save target" }).click();
  await expect(section.getByText("Saved. The overview shows it while its period runs.")).toBeVisible();
  await expect(section.getByRole("table")).toContainText("Orders");
  await expect(section.getByRole("table")).toContainText(/4[,\s\u00a0\u202f]?321/);

  await page.goto(`/admin/${E2E_STORE}/analytics`);
  const running = page.locator("[data-running-targets]");
  await expect(running).toBeVisible({ timeout: 20_000 });
  const card = running.locator('[data-target="orders"]');
  await expect(card).toContainText("Orders,");
  await expect(card.getByRole("meter")).toBeVisible();
});
