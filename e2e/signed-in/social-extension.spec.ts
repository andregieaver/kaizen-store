import { expect, test } from "@playwright/test";

import { ADMIN } from "./accounts";

/**
 * The social media manager as a paid extension (D870 S1.6): the platform admin finds it at Platform -> Plans -> Extensions at €39 a
 * month, with its one size, and chooses which plans include it in the same screen.
 */

test.use({ storageState: ADMIN.state, viewport: { width: 1280, height: 900 } });

test("the platform admin sees the social media manager at €39 a month and can include it in a plan", async ({ page }) => {
  await page.goto("/admin/platform/plans/extensions");
  const section = page.getByRole("region", { name: "Social media manager" });
  await expect(section).toBeVisible();
  await expect(section).toContainText("Every channel");
  await expect(section.locator('input[value="39"], input[value="39.00"], input[value="39,00"]').first()).toBeVisible();
  await section.scrollIntoViewIfNeeded();
  await section.screenshot({ path: "test-results/social-extension.png" });

  const included = page.getByRole("region", { name: "Included in plans" });
  await expect(included.getByRole("group", { name: "Social media manager" }).first()).toBeVisible();
  await included.scrollIntoViewIfNeeded();
  await included.screenshot({ path: "test-results/social-extension-plans.png" });
});
