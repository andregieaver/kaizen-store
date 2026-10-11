import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/** Brands (D204): logos in a row by screen size, a strip that keeps moving, a cap on the logos' height. */

const PICTURES = ["bike", "cabin", "lamp", "logo", "massage", "mug"];
const base = `http://localhost:${process.env.PORT ?? 3000}`;
const items = PICTURES.map((name, i) => ({ id: `i${i}`, name: `Brand ${i}`, picture: { url: `${base}/demo/${name}.svg`, width: 400, height: 200 } }));
const brands = (id: string, over: Record<string, unknown> = {}) => ({ id, type: "brands", items, ...over });

test("logos in a row follow the screen size, and are held to their height", async ({ page }) => {
  const url = await storePageWith("merker", [brands("b1", { columns: 6, logoHeight: 40, at: { sm: { columns: 3 } } })]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const cells = page.locator("[data-brands] > li");
  await expect(cells).toHaveCount(6);
  const tops = async () => (await cells.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top))));
  expect(new Set(await tops()).size).toBe(1);
  await page.setViewportSize({ width: 375, height: 800 });
  // Three to a row on Small: two rows.
  expect(new Set(await tops()).size).toBe(2);
  const heights = await page.locator(".kz-brand-logo").evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  for (const h of heights) expect(h).toBeLessThanOrEqual(40.5);
});

test("a carousel that keeps moving moves, and stops on Pause", async ({ page }) => {
  const url = await storePageWith("merker-rull", [brands("b2", { view: "carousel", speed: 2, columns: 3 })]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const strip = page.locator(".kz-brands-marquee");
  const x = () => strip.evaluate((el) => el.getBoundingClientRect().left);
  const first = await x();
  await page.waitForTimeout(700);
  expect(await x()).toBeLessThan(first - 5);
  await page.getByRole("button", { name: /pause/i }).click();
  const held = await x();
  await page.waitForTimeout(500);
  expect(Math.abs((await x()) - held)).toBeLessThan(1);
});

test("a carousel that steps moves one logo at a time", async ({ page }) => {
  const url = await storePageWith("merker-steg", [brands("b3", { view: "carousel", movement: "snap", interval: 1, columns: 3 })]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const track = page.locator(".kz-brands-snap");
  await expect.poll(() => track.evaluate((el) => el.scrollLeft), { timeout: 5000 }).toBeGreaterThan(20);
});
