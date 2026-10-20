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

  /** Drags `source` and drops it on the *Nest columns here* strip below the components of the row's column `at`. */
  async function dropOnNest(page: Page, source: ReturnType<Page["locator"]>, row: ReturnType<Page["locator"]>, at: number) {
    await source.scrollIntoViewIfNeeded();
    const box = (await source.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12, { steps: 4 });
    const strip = row.locator('[data-builder-item="column"]').nth(at).locator('[data-builder-nest="end"]');
    await expect(strip).toBeVisible();
    // Away from the window's edges first, so the canvas stops scrolling under the pointer; then onto the strip where it now is.
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width / 2, viewport.height / 2, { steps: 8 });
    // Near the canvas's edge it scrolls under the pointer, as for a person: follow the strip until it stays put.
    let last = -1;
    for (let i = 0; i < 12; i++) {
      const zone = (await strip.boundingBox())!;
      if (Math.abs(zone.y - last) < 1) break;
      last = zone.y;
      await page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height / 2, { steps: 6 });
      await page.waitForTimeout(150);
    }
    await page.mouse.up();
  }

  async function twoColumns(page: Page) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/admin/${E2E_STORE}/pages/new`);
    await page.getByRole("tab", { name: "Rows" }).click();
    await page.getByRole("button", { name: "Add 2 columns" }).click();
    return page.locator('[data-builder-item="row"]').last();
  }

  test("a row's layout dragged into a column nests its columns there", async ({ page }) => {
    const row = await twoColumns(page);
    await dropOnNest(page, page.getByRole("button", { name: "Add 3 columns" }), row, 0);
    const nested = row.locator('[data-builder-item="block"] [data-builder-holder]');
    await expect(nested).toHaveCount(1);
    await expect(nested.locator('[data-builder-item="column"]')).toHaveCount(3);
  });

  test("the Column tile dragged into a column nests one column there", async ({ page }) => {
    const row = await twoColumns(page);
    await dropOnNest(page, page.getByRole("button", { name: "Add column", exact: true }), row, 1);
    const nested = row.locator('[data-builder-item="column"]').nth(1).locator("[data-builder-holder]");
    await expect(nested.locator('[data-builder-item="column"]')).toHaveCount(1);
  });

  test("a column dragged by its handle into the column beside it is nested there", async ({ page }) => {
    const row = await twoColumns(page);
    await row.locator('[data-builder-item="column"]').last().hover({ position: { x: 20, y: 10 } });
    const handle = row.getByRole("button", { name: /^Drag row \d+, column 2 to move it$/ });
    await expect(handle).toBeVisible();
    await dropOnNest(page, handle, row, 0);
    // The row keeps one column, holding a Columns component with the one moved.
    await expect(row.locator(':scope [data-builder-item="block"] [data-builder-holder] [data-builder-item="column"]')).toHaveCount(1);
    await expect(row.locator('[data-builder-item="column"]')).toHaveCount(2);
  });

  test("the Columns component dragged from the sidebar into a column nests two columns", async ({ page }) => {
    const row = await twoColumns(page);
    await page.getByRole("tab", { name: "Components" }).click();
    const tile = page.getByRole("button", { name: "Add columns", exact: true });
    await tile.scrollIntoViewIfNeeded();
    const box = (await tile.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 12, { steps: 4 });
    const into = (await row.locator('[data-builder-item="column"]').first().boundingBox())!;
    await page.mouse.move(into.x + into.width / 2, into.y + into.height / 2, { steps: 12 });
    await page.mouse.up();
    await expect(row.locator('[data-builder-item="block"] [data-builder-holder] [data-builder-item="column"]')).toHaveCount(2);
  });
});
