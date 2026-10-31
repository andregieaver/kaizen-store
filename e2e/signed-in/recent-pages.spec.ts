import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/** The AI manager's panel offers the pages opened last (PSI UX-06), kept in this browser, the page on screen left out. */
test.use({ storageState: OWNER.state });

test("the AI manager's panel offers the pages opened last", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/orders`);
  await expect(page).toHaveTitle(/Orders/);
  // The page is noted a moment after its title is there.
  await page.waitForTimeout(800);
  await page.goto(`/admin/${E2E_STORE}/products`);
  await page.getByRole("button", { name: /AI manager/ }).first().click();
  const recent = page.getByRole("navigation", { name: "Recent pages" });
  await expect(recent.getByRole("link", { name: "Orders" })).toBeVisible();
  await expect(recent.getByRole("link", { name: "Products" })).toHaveCount(0);
  await recent.getByRole("link", { name: "Orders" }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/${E2E_STORE}/orders$`));
});
