import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/** Before and after (D413): two pictures over each other and a slider that reveals either, by pointer and by keyboard. */

const base = `http://localhost:${process.env.PORT ?? 3000}`;
const picture = (name: string, alt: string) => ({ url: `${base}/demo/${name}.svg`, width: 800, height: 600, alt });
const block = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: "beforeAfter",
  before: picture("cabin", "The cabin before"),
  after: picture("lamp", "The cabin after"),
  ...over,
});

/** How far from the left the after picture starts, in percent (its clip). */
const shownFrom = (slider: ReturnType<import("@playwright/test").Page["locator"]>) =>
  slider.locator("[data-before-after-after]").evaluate((el) => Number(/inset\(0(?:px)? 0(?:px)? 0(?:px)? ([\d.]+)%\)/.exec((el as HTMLElement).style.clipPath)?.[1] ?? NaN));

test("starts in the middle with its words, and the arrow keys, Home and End move the slider", async ({ page }) => {
  const url = await storePageWith("for-og-etter", [block("ba")]);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(url);
  const slider = page.locator("[data-before-after]");
  await expect(slider).toBeVisible();
  await expect(slider.getByRole("img", { name: "The cabin before" })).toBeVisible();
  await expect(slider.getByRole("img", { name: "The cabin after" })).toBeAttached();
  const range = slider.getByRole("slider");
  await expect(range).toHaveAccessibleName(/before and after|før og etter/i);
  await expect(range).toHaveValue("50");
  expect(await shownFrom(slider)).toBe(50);
  // The visitor's language's words on the pictures (a Norwegian store).
  await expect(slider.getByText("Før", { exact: true })).toBeVisible();
  await expect(slider.getByText("Etter", { exact: true })).toBeVisible();

  await range.focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(range).toHaveValue("52");
  expect(await shownFrom(slider)).toBe(52);
  await page.keyboard.press("Home");
  expect(await shownFrom(slider)).toBe(0);
  await page.keyboard.press("End");
  expect(await shownFrom(slider)).toBe(100);
});

test("a press or drag anywhere on the picture moves the slider there", async ({ page }) => {
  const url = await storePageWith("for-og-etter-dra", [block("ba", { start: 20 })]);
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto(url);
  const slider = page.locator("[data-before-after]");
  await expect(slider.getByRole("slider")).toHaveValue("20");
  const box = (await slider.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => shownFrom(slider)).toBeGreaterThan(70);
  expect(await shownFrom(slider)).toBeLessThan(80);
});

test("the owner's own words, or none, and nothing at all without both pictures", async ({ page }) => {
  const url = await storePageWith("for-og-etter-ord", [
    block("own", { beforeLabel: "Gammel", afterLabel: "Ny", htmlId: "own" }),
    block("bare", { hideLabels: true, htmlId: "bare" }),
    block("half", { after: null }),
  ]);
  await page.goto(url);
  await expect(page.locator("[data-before-after]")).toHaveCount(2);
  const own = page.locator("#own");
  await expect(own.getByText("Gammel", { exact: true })).toBeVisible();
  await expect(own.getByText("Ny", { exact: true })).toBeVisible();
  await expect(page.locator("#bare [data-kz-text=caption]")).toHaveCount(0);
});
