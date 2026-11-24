import { expect, test } from "@playwright/test";

import { ADMIN } from "./accounts";

/**
 * Legal reviews (D892) as the platform's owner meets them: the list of drafts, a draft as written with a box per point, and a view kept on
 * one point, shown with who wrote it; the page comes back to that point.
 */

test.use({ storageState: ADMIN.state });

test("reads a draft and keeps a view on one point", async ({ page }) => {
  await page.goto("/admin/legal");
  await expect(page.getByRole("heading", { name: "Legal reviews", level: 1 })).toBeVisible();
  await page.getByRole("link", { name: "Read and answer" }).first().click();
  await expect(page.getByRole("heading", { name: "Your view, point by point" })).toBeVisible();
  await expect(page.getByText("Contacting businesses by country").first()).toBeVisible();

  const norway = page.locator('form[data-legal-item="NO"]');
  const view = `Reading confirmed (${Date.now().toString(36)}).`;
  await norway.getByLabel("Your view").fill(view);
  await norway.getByRole("button", { name: "Keep this view" }).click();
  await expect(page).toHaveURL(/saved=NO/);
  await expect(page.locator('form[data-legal-item="NO"]')).toContainText(view);
  await expect(page.locator('form[data-legal-item="NO"]')).toContainText(ADMIN.name);
  await expect(page.locator('form[data-legal-item="NO"]')).toContainText("Kept.");
});
