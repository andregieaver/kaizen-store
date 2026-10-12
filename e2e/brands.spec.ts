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

test("a carousel that keeps moving moves, and stops under the pointer", async ({ page }) => {
  const url = await storePageWith("merker-rull", [brands("b2", { view: "carousel", speed: 2, columns: 3 })]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const strip = page.locator(".kz-brands-marquee");
  const x = () => strip.evaluate((el) => el.getBoundingClientRect().left);
  const first = await x();
  await page.waitForTimeout(700);
  expect(await x()).toBeLessThan(first - 5);
  // It stops under the pointer; there is no Pause button.
  await expect(page.getByRole("button", { name: /pause/i })).toHaveCount(0);
  const window = (await page.locator(".kz-brands-window").boundingBox())!;
  await page.mouse.move(window.x + window.width / 2, window.y + window.height / 2);
  // The pause follows the pointer's arrival (a state the carousel sets): measure once it has.
  await expect(page.locator(".kz-brands-carousel")).toHaveAttribute("data-still", "");
  await page.waitForTimeout(100);
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

test("a carousel moved by the visitor steps with its arrows and stays still otherwise", async ({ page }) => {
  const url = await storePageWith("merker-piler", [brands("b4", { view: "carousel", movement: "none", columns: 3 })]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const track = page.locator(".kz-brands-snap");
  const previous = page.locator(".kz-brands-arrow").first();
  const next = page.locator(".kz-brands-arrow").last();
  await expect(previous).toBeDisabled();
  await page.waitForTimeout(1200);
  expect(await track.evaluate((el) => el.scrollLeft)).toBe(0);
  await next.click();
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(20);
  await expect(previous).toBeEnabled();
});

test("greyscale logos show their colours on hover", async ({ page }) => {
  const url = await storePageWith("merker-gra", [brands("b5", { greyscale: true, colourOnHover: true })]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const logo = page.locator(".kz-brand-logo").first();
  await expect(logo).toHaveCSS("filter", "grayscale(1)");
  await logo.hover();
  await expect(logo).toHaveCSS("filter", "none");
});
