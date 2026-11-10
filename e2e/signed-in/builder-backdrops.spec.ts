import { expect, test, type Locator } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * Backdrops (D534): a ready-made backdrop goes on a row in one press, one slider turns the hue of every colour of it, the layers are
 * one press further for whoever wants them (each with its blur, D535), and the page publishes as it is: its text drawn to read on the
 * backdrop, and the layers moving apart as a visitor scrolls.
 */
test.use({ storageState: OWNER.state, viewport: { width: 1600, height: 1000 } });

/** A custom property of a layer as the page carries it. */
const property = (layer: Locator, name: string) => layer.evaluate((el, key) => (el as HTMLElement).style.getPropertyValue(key), name);

test("a ready-made backdrop goes on in one press, turns its hue with one slider, and publishes with layers that move apart", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add heading", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "Heading", exact: true }).click();
  await page.keyboard.type("Over a backdrop");
  await page.getByRole("button", { name: "Done" }).click();

  const row = page.locator('[data-builder-item="row"]').filter({ has: page.getByRole("heading", { name: "Over a backdrop" }) });
  await row.getByRole("button", { name: /^Settings \(row \d+\)/ }).press("Enter");
  await page.getByRole("tab", { name: "Style" }).click();

  // Homer: one press. The background's kind follows the backdrop's own, and the canvas draws the layers still.
  const layers = row.locator("[data-fx-layers] > [data-fx-bglayer]");
  await expect(page.getByRole("slider", { name: "Hue" })).toHaveCount(0);
  await page.getByRole("button", { name: "Use Horizon" }).click();
  await expect(layers).toHaveCount(5);
  await expect(page.getByRole("radio", { name: "Gradient", exact: true })).toBeChecked();
  await expect(row.locator("[data-fx-layers] [data-fx-scroll]")).toHaveCount(0);

  // The hue: one slider turns every colour together, and Original colours takes it back.
  const glow = row.locator('[data-fx-bglayer="glow"]').last();
  const original = await property(glow, "--fx-lc1");
  expect(original).toBe("#d946ef");
  const hue = page.getByRole("slider", { name: "Hue" });
  await hue.focus();
  for (let i = 0; i < 12; i++) await hue.press("ArrowRight");
  await expect(hue).toHaveAttribute("aria-valuetext", "+60°");
  await expect.poll(() => property(glow, "--fx-lc1")).not.toBe(original);
  await page.getByRole("button", { name: "Original colours" }).click();
  await expect.poll(() => property(glow, "--fx-lc1")).toBe(original);
  await hue.focus();
  for (let i = 0; i < 26; i++) await hue.press("ArrowLeft");
  await expect(hue).toHaveAttribute("aria-valuetext", "-130°");
  const turned = await property(glow, "--fx-lc1");
  expect(turned).not.toBe(original);

  // Lisa: the layers, one press away. One is switched off, and one opened for its settings.
  await page.getByRole("button", { name: "Customise the layers (5)" }).click();
  const list = page.locator("[data-layer-fields] li");
  await expect(list).toHaveCount(5);
  await list.filter({ hasText: "Grid" }).getByRole("checkbox", { name: "Shown" }).uncheck();
  await expect(layers).toHaveCount(4);
  await list.filter({ hasText: "Stars" }).getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("slider", { name: "As the page scrolls" })).toHaveAttribute("aria-valuetext", "Close 60");
  // Out of focus, for depth (D535): the layer is marked soft, and what draws inside it is blurred, not the layer that travels.
  const blur = page.getByRole("slider", { name: "Blur" });
  await blur.focus();
  for (let i = 0; i < 3; i++) await blur.press("ArrowRight");
  await expect(blur).toHaveAttribute("aria-valuetext", "3 px");
  const soft = row.locator("[data-fx-bglayer]").filter({ has: page.locator('[data-fx-pattern="stars"]') });
  await expect(soft).toHaveAttribute("data-fx-soft", "");
  await expect.poll(() => soft.locator("[data-fx-pattern]").evaluate((el) => getComputedStyle(el).filter)).toBe("blur(3px)");
  await page.getByRole("button", { name: "Done" }).click();

  // It publishes as it is: the page check finds the text readable, as the site draws it light on the dark backdrop.
  const title = `Backdrop ${Date.now()}`;
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(/saved=published/);

  // As a visitor sees it.
  await page.goto(`/s/${E2E_STORE}/${title.toLowerCase().replace(" ", "-")}`);
  const heading = page.getByRole("heading", { name: "Over a backdrop" });
  await expect(heading).toBeVisible();
  const published = page.locator("[data-row]").filter({ has: heading });
  await expect(published).toHaveClass(/kz-on-dark/);
  // Light text: each channel well above the middle.
  const colour = await heading.evaluate((el) => getComputedStyle(el).color.match(/\d+/g)!.slice(0, 3).map(Number));
  expect(Math.min(...colour)).toBeGreaterThan(180);
  const drawn = published.locator("[data-fx-layers] > [data-fx-bglayer]");
  await expect(drawn).toHaveCount(4);
  expect(await property(published.locator('[data-fx-layers] > [data-fx-bglayer="glow"]').last(), "--fx-lc1")).toBe(turned);

  // The stars are drawn soft: the blur is on what draws them, so it is painted once, and the layer that travels carries none.
  const stars = published.locator("[data-fx-bglayer]").filter({ has: page.locator('[data-fx-pattern="stars"]') });
  expect(await stars.locator("[data-fx-pattern]").evaluate((el) => getComputedStyle(el).filter)).toBe("blur(3px)");
  expect(await stars.evaluate((el) => getComputedStyle(el).filter)).toBe("none");

  // Scrolled, the glow has fallen behind the page and the stars have run ahead of it: they move apart.
  await page.evaluate(() => window.scrollTo(0, 320));
  const travel = (layer: Locator) => layer.evaluate((el) => Number.parseFloat(getComputedStyle(el).translate.split(" ")[1] ?? "0"));
  await expect.poll(() => travel(published.locator('[data-fx-bglayer="glow"]').last())).toBeGreaterThan(10);
  await expect.poll(() => travel(stars)).toBeLessThan(-5);
});
