import { expect, test } from "@playwright/test";

import { storePageWith } from "./db";

/** The gallery (D209): columns by screen size, a lightbox with the previous and the next, a carousel. */

const base = `http://localhost:${process.env.PORT ?? 3000}`;
const PICTURES = ["bike", "cabin", "lamp", "mug"];
const items = [
  ...PICTURES.map((name, i) => ({ id: `p${i}`, kind: "image", picture: { url: `${base}/demo/${name}.svg`, width: 400, height: 300 }, alt: `Bilde ${name}`, caption: i === 0 ? "Sykkelen" : "" })),
  { id: "v1", kind: "video", source: "youtube", link: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", picture: null, alt: "Verkstedet", caption: "En tur" },
];
const gallery = (id: string, over: Record<string, unknown> = {}) => ({ id, type: "gallery", items, ...over });

test("a grid follows the screen size, and the lightbox shows each piece full size with the previous and the next", async ({ page }) => {
  const url = await storePageWith("galleri", [gallery("g1", { columns: 4, at: { sm: { columns: 2 } } })]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const tiles = page.locator("[data-gallery] > li");
  await expect(tiles).toHaveCount(5);
  const rows = async () => new Set(await tiles.evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)))).size;
  // Four to a row: two rows on a computer, three on a phone.
  expect(await rows()).toBe(2);
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await rows()).toBe(3);
  await page.setViewportSize({ width: 1200, height: 800 });

  await page.getByRole("link", { name: "Bilde bike" }).click();
  const dialog = page.locator("dialog.kz-lightbox");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("img", { name: "Bilde bike" })).toBeVisible();
  await expect(dialog.getByText("Sykkelen")).toBeVisible();
  await expect(dialog.getByText("1 av 5")).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(dialog.getByRole("img", { name: "Bilde cabin" })).toBeVisible();
  await dialog.getByRole("button", { name: "Forrige" }).click();
  await dialog.getByRole("button", { name: "Forrige" }).click();
  // Round to the last: the video, which still asks before anything loads from YouTube.
  await expect(dialog.getByText("5 av 5")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Verkstedet/ })).toBeVisible();
  await expect(dialog.locator("iframe")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("a gallery as a carousel scrolls with its arrows", async ({ page }) => {
  const url = await storePageWith("galleri-rull", [gallery("g2", { view: "carousel", columns: 2 })]);
  await page.setViewportSize({ width: 1200, height: 800 });
  await page.goto(url);
  const track = page.locator("[data-gallery][data-carousel-track]");
  await expect(track).toBeVisible();
  await page.getByRole("button", { name: "Neste" }).click();
  await expect.poll(() => track.evaluate((el) => el.scrollLeft)).toBeGreaterThan(20);
});
