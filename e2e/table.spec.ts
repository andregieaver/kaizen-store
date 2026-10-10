import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/** The table component (D194): a table from Medium up; on a phone it stacks each row as a card or scrolls sideways. */

const rows = [["Size", "Price"], ["Small", "10 kr"], ["Large", "20 kr"]];
const table = (id: string, over: Record<string, unknown> = {}) => ({ id, type: "table", header: true, rows, ...over });

test("a table is a table on a computer and stacks its rows on a phone", async ({ page }) => {
  const url = await storePageWith("tabell", [table("t1", { caption: "Priser" })]);

  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  await expect(page.locator("table caption")).toHaveText("Priser");
  const cells = page.locator("tbody tr").first().locator("td");
  const [a, b] = await Promise.all([cells.nth(0).boundingBox(), cells.nth(1).boundingBox()]);
  // Side by side, and the column names are only in the header.
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(4);
  await expect(page.locator("tbody [aria-hidden=true]").first()).toBeHidden();

  await page.setViewportSize({ width: 375, height: 800 });
  const [c, d] = await Promise.all([cells.nth(0).boundingBox(), cells.nth(1).boundingBox()]);
  // One under the other, each with its column's name; the header row is not drawn but stays for screen readers.
  expect(d!.y).toBeGreaterThan(c!.y + c!.height - 1);
  await expect(page.locator("tbody [aria-hidden=true]").first()).toBeVisible();
  await expect(page.locator("tbody [aria-hidden=true]").first()).toHaveText("Size");
  await expect(page.locator("thead")).toHaveCSS("position", "absolute");
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});

test("a table that scrolls keeps its columns on a phone without widening the page", async ({ page }) => {
  const wide = Array.from({ length: 3 }, (_, r) => Array.from({ length: 8 }, (_, c) => `Cell ${r}-${c} with some words`));
  const url = await storePageWith("tabell-rull", [table("t2", { mobile: "scroll", rows: wide })]);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(url);
  const cells = page.locator("tbody tr").first().locator("td");
  const [a, b] = await Promise.all([cells.nth(0).boundingBox(), cells.nth(1).boundingBox()]);
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  expect(await page.locator("div.overflow-x-auto").evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
});
