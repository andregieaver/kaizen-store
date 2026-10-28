import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Analytics → Live as the owner meets it (wave 8 unit C, D347; row analytics.live-view): the figures of now and today, and the page reads
 * them again by itself while it is open. The figures are held by analytics-live.int.test.ts; this holds the screen.
 */

test.use({ storageState: OWNER.state });

test("shows today's figures and reads them again by itself", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/analytics/live`);
  await expect(page.getByRole("heading", { name: "Live", level: 1 })).toBeVisible();
  const live = page.locator("[data-live]");
  for (const label of ["Visitors now", "Orders today", "Revenue today", "Carts in use", "Checkouts in progress"]) {
    await expect(live.getByText(label, { exact: true })).toBeVisible();
  }
  const updated = live.getByText(/^Updated /);
  const first = await updated.textContent();
  // A refresh every 10 seconds: the time it says changes without a reload.
  await expect(updated).not.toHaveText(first ?? "", { timeout: 25_000 });
});
