import { expect, test, type Page } from "@playwright/test";

import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * A column dragged by its handle onto the *New line* strip under its line goes on a line of its own (D187), in a store's page
 * builder and in Kaizena Flow's own, which is the same builder given another context.
 */

async function dragOntoNewLine(page: Page) {
  await page.getByRole("tab", { name: "Rows" }).click();
  await page.getByRole("button", { name: "Add 2 columns" }).click();
  const row = page.locator('[data-builder-item="row"]').last();
  await expect(row.locator('[data-builder-item="column"]')).toHaveCount(2);
  await expect(row.locator("[data-builder-line]")).toHaveCount(0);

  // Each column holds a text from its top edge, as Kaizena Flow's pages do: pointed at over its text, the column's handle still shows.
  for (const column of await row.locator('[data-builder-item="column"]').all()) {
    await column.getByRole("button", { name: /^Add rich text/ }).click();
    // The new text's settings open: done with them.
    await page.getByRole("button", { name: "Done" }).click();
  }
  await expect(row.locator('[data-builder-item="block"]')).toHaveCount(2);
  const handle = row.getByRole("button", { name: /^Drag row \d+, column 2 to move it$/ });
  await row.locator('[data-builder-item="block"]').last().hover();
  await expect(handle).toBeVisible();
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  // Past the sensor's 5 px, then to the strip under the line, which is drawn only while a column is dragged.
  await page.mouse.move(start.x + start.width / 2 + 10, start.y + start.height / 2 + 10, { steps: 4 });
  const strip = row.locator('[data-builder-newline="1"]');
  await expect(strip).toBeVisible();
  const zone = (await strip.boundingBox())!;
  await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 12 });
  await expect(row.getByText("New line", { exact: true })).toBeVisible();
  await page.mouse.up();

  await expect(row.locator("[data-builder-line]")).toHaveCount(2);
  await expect(row.locator('[data-builder-line="1"] [data-builder-item="column"]')).toHaveCount(1);
}

test.describe("a store's page builder", () => {
  test.use({ storageState: OWNER.state });
  test("a column dragged onto the strip under its line goes on a new line", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/admin/${E2E_STORE}/pages/new`);
    await dragOntoNewLine(page);
  });
});

test.describe("Kaizena Flow's page builder", () => {
  test.use({ storageState: ADMIN.state });
  test("a column dragged onto the strip under its line goes on a new line", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/admin/platform/pages/new");
    await dragOntoNewLine(page);
  });
});

test.describe("nested columns (D294)", () => {
  test.use({ storageState: OWNER.state });
  test("a Columns component in a column takes components into its columns, and a column dragged into it", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/admin/${E2E_STORE}/pages/new`);
    await page.getByRole("tab", { name: "Rows" }).click();
    await page.getByRole("button", { name: "Add 2 columns" }).click();
    const row = page.locator('[data-builder-item="row"]').last();
    // Pressed in its first column, the Columns component goes there.
    await row.locator('[data-builder-item="column"]').first().click({ position: { x: 6, y: 6 } });
    await page.getByRole("tab", { name: "Components" }).click();
    await page.getByRole("button", { name: "Add columns" }).click();
    // Its settings open: done with them.
    await page.getByRole("button", { name: "Done" }).click();
    const nested = row.locator('[data-builder-item="block"] [data-builder-holder]');
    await expect(nested).toHaveCount(1);
    await expect(nested.locator('[data-builder-item="column"]')).toHaveCount(2);

    // The row's second column dragged onto the Columns component's columns becomes its third.
    const handle = row.getByRole("button", { name: /^Drag row \d+, column 2 to move it$/ });
    await row.locator('[data-builder-item="column"]').last().hover();
    await expect(handle).toBeVisible();
    const start = (await handle.boundingBox())!;
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
    await page.mouse.down();
    await page.mouse.move(start.x + start.width / 2 + 10, start.y + start.height / 2 + 10, { steps: 4 });
    const into = (await nested.locator('[data-builder-item="column"]').last().boundingBox())!;
    await page.mouse.move(into.x + into.width - 8, into.y + into.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(nested.locator('[data-builder-item="column"]')).toHaveCount(3);
    // The row keeps the one column holding the component: four columns in all.
    await expect(row.locator('[data-builder-item="column"]')).toHaveCount(4);
  });
});
