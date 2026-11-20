import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The builder's sidebar puts a row or a component on the page when it is dragged there; a click on the tile itself adds nothing. Each tile
 * has a small Add button of its own, so adding never needs a drag (WCAG 2.2 2.5.7): a click or Enter on it adds where the selection is.
 */
test.use({ storageState: OWNER.state });

test("a click on a sidebar tile adds nothing; its Add button adds, by pointer or Enter", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  const rows = page.locator('[data-builder-item="row"]');
  await expect(rows.first()).toBeVisible();
  const before = await rows.count();
  await page.getByRole("tab", { name: "Rows" }).click();

  await page.locator("[data-palette-tile]").filter({ hasText: "2 columns" }).click();
  await page.waitForTimeout(300);
  await expect(rows).toHaveCount(before);

  const add = page.getByRole("button", { name: "Add 2 columns" });
  await add.click();
  await expect(rows).toHaveCount(before + 1);
  await add.press("Enter");
  await expect(rows).toHaveCount(before + 2);

  await page.getByRole("tab", { name: "Components" }).click();
  const blocks = page.locator('[data-builder-item="block"]');
  const blocksBefore = await blocks.count();
  await page.locator("[data-palette-tile]").filter({ has: page.getByText("Heading", { exact: true }) }).click();
  await page.waitForTimeout(300);
  await expect(blocks).toHaveCount(blocksBefore);
  await page.getByRole("button", { name: "Add heading", exact: true }).click();
  await expect(blocks).toHaveCount(blocksBefore + 1);
});

/**
 * The settings panel's fields load with the panel (bloat review step 2.30, `lazy/builder-fields.tsx`) and are fetched when the builder is
 * idle. A component added and opened as soon as the page is awake still opens with its fields, and what is typed lands in it.
 */
test("a component opened before the builder is idle opens with its fields", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  // The tab answering is the page awake; the fields' chunk is fetched later, when the browser is idle.
  const components = page.getByRole("tab", { name: "Components" });
  await components.click();
  await expect(components).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Add button", exact: true }).press("Enter");
  const panel = page.locator("[data-settings-panel]");
  await expect(panel.getByRole("tab", { name: "Content" })).toHaveAttribute("aria-selected", "true");
  const text = panel.getByRole("textbox", { name: "Text", exact: true });
  await text.click();
  await page.keyboard.type("Shop now");
  await expect(text).toContainText("Shop now");
});
