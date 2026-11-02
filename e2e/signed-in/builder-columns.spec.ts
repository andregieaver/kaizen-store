import { expect, test, type Locator, type Page } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Columns that hold something can go without being emptied first: a layout with fewer columns asks whether what they hold is
 * deleted with them or moved, and a column's settings can delete it. A column's tools never cover its component's, and a
 * brands component's names can be turned off.
 */
test.use({ storageState: OWNER.state, viewport: { width: 2400, height: 1000 } });

/** A new row of a layout, a text in each of its columns. */
async function rowOfTexts(page: Page, layout: string): Promise<Locator> {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Rows" }).click();
  await page.getByRole("button", { name: `Add ${layout}` }).press("Enter");
  const row = page.locator('[data-builder-item="row"]').last();
  for (const column of await row.locator('[data-builder-item="column"]').all()) {
    await column.getByRole("button", { name: /^Add rich text/ }).press("Enter");
    await page.getByRole("button", { name: "Done" }).click();
  }
  await expect(row.locator('[data-builder-item="block"]')).toHaveCount(await row.locator('[data-builder-item="column"]').count());
  return row;
}

/** Opens a column's settings by its tools. */
async function columnSettings(row: Locator, n: number) {
  await row.locator('[data-builder-item="column"]').nth(n - 1).locator('[data-builder-item="block"]').first().hover();
  await row.getByRole("button", { name: `Settings (column ${n})` }).click();
}

test("a layout with fewer columns asks first, then deletes what the columns that go hold", async ({ page }) => {
  const row = await rowOfTexts(page, "3 columns");
  await columnSettings(row, 1);
  await page.getByRole("radio", { name: "1 column" }).click();
  // Nothing changes until it is answered.
  await expect(page.getByText("Columns 2 and 3 hold 2 components.")).toBeVisible();
  await expect(row.locator('[data-builder-item="column"]')).toHaveCount(3);
  await expect(page.getByRole("button", { name: "Delete them" })).toBeFocused();
  await page.getByRole("button", { name: "Keep this layout" }).click();
  await expect(row.locator('[data-builder-item="column"]')).toHaveCount(3);

  await page.getByRole("radio", { name: "1 column" }).click();
  await page.getByRole("button", { name: "Delete them" }).click();
  await expect(row.locator('[data-builder-item="column"]')).toHaveCount(1);
  await expect(row.locator('[data-builder-item="block"]')).toHaveCount(1);

  // Moving is still there: three columns again, then two, the third's text moved to the second.
  await page.getByRole("radio", { name: "3 columns" }).click();
  await expect(row.locator('[data-builder-item="column"]')).toHaveCount(3);
  await page.getByRole("button", { name: "Done" }).click();
  await row.locator('[data-builder-item="column"]').nth(2).getByRole("button", { name: /^Add rich text/ }).press("Enter");
  await page.getByRole("button", { name: "Done" }).click();
  await columnSettings(row, 1);
  await page.getByRole("radio", { name: "2 columns" }).click();
  await expect(page.getByText("Column 3 holds 1 component.")).toBeVisible();
  await page.getByRole("button", { name: "Move them to column 2" }).click();
  await expect(row.locator('[data-builder-item="column"]')).toHaveCount(2);
  await expect(row.locator('[data-builder-item="block"]')).toHaveCount(2);
});

test("a column's settings delete it with what it holds; a row keeps its last column", async ({ page }) => {
  const row = await rowOfTexts(page, "2 columns");
  await columnSettings(row, 2);
  await page.getByRole("button", { name: "Delete column", exact: true }).click();
  await expect(row.locator('[data-builder-item="column"]')).toHaveCount(1);
  await expect(row.locator('[data-builder-item="block"]')).toHaveCount(1);
  await columnSettings(row, 1);
  await expect(page.getByRole("button", { name: "Delete column", exact: true })).toBeDisabled();
});

test("a column's tools never cover its component's", async ({ page }) => {
  const row = await rowOfTexts(page, "4 columns");
  const column = row.locator('[data-builder-item="column"]').nth(1);
  const block = column.locator('[data-builder-item="block"]').first();
  await block.hover();
  const own = column.locator(":scope > [data-builder-tools]");
  const blocks = block.locator(":scope > [data-builder-tools]");
  await expect(own).toBeVisible();
  await expect(blocks).toBeVisible();
  const a = (await own.boundingBox())!;
  const b = (await blocks.boundingBox())!;
  const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  expect(overlap, `column tools ${JSON.stringify(a)}, component tools ${JSON.stringify(b)}`).toBe(false);
  // Each can be pressed where it is drawn.
  await expect(row.getByRole("button", { name: "Delete column 2" })).toBeEnabled();
});

test("a brands component's names can be turned off", async ({ page }) => {
  const row = await rowOfTexts(page, "1 column");
  await row.locator('[data-builder-item="block"]').first().hover();
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add brands", exact: true }).click();
  await page.getByRole("tab", { name: "Style" }).click();
  const names = page.getByRole("checkbox", { name: /^Show the names/ });
  await expect(names).toBeChecked();
  await names.uncheck();
  await expect(names).not.toBeChecked();
  await names.check();
  await expect(names).toBeChecked();
});
