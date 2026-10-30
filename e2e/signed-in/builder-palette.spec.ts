import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The builder's sidebar puts a row or a component on the page only when it is dragged there: a click on a tile adds nothing. With the
 * keyboard, Enter on a tile still adds it, so the sidebar works without a mouse.
 */
test.use({ storageState: OWNER.state });

test("a click on a sidebar tile adds nothing; a drag or Enter does", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  const rows = page.locator('[data-builder-item="row"]');
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  await page.getByRole("tab", { name: "Rows" }).click();
  const tile = page.getByRole("button", { name: "Add 2 columns" });

  await tile.click();
  await page.waitForTimeout(300);
  await expect(rows).toHaveCount(before);

  await tile.press("Enter");
  await expect(rows).toHaveCount(before + 1);

  await page.getByRole("tab", { name: "Components" }).click();
  const blocks = page.locator('[data-builder-item="block"]');
  const blocksBefore = await blocks.count();
  await page.getByRole("button", { name: "Add heading", exact: true }).click();
  await page.waitForTimeout(300);
  await expect(blocks).toHaveCount(blocksBefore);
});
