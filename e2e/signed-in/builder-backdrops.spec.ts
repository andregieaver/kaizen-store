import { expect, test, type Locator } from "@playwright/test";

import { testDb } from "../db";

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

test("a picture from the library goes on as a layer, placed or filling the part, and visitors get its small copy when it is blurred", async ({ page, baseURL }) => {
  // The picture is in the store's media library with its small copy, as an upload leaves it.
  const run = Date.now().toString(36);
  const big = `${baseURL}/demo/cabin.svg?layer=${run}`;
  const small = `${baseURL}/demo/mug.svg?layer=${run}`;
  const file = `layer-${run}.webp`;
  const sql = testDb();
  try {
    await sql`
      insert into commerce.media (store_id, kind, url, thumbnail_url, bucket, path, file_name, content_type, width, height)
      select id, 'image', ${big}, ${small}, 'product-media', ${`${E2E_STORE}/${file}`}, ${file}, 'image/webp', 1600, 900
      from commerce.stores where slug = ${E2E_STORE}`;
  } finally {
    await sql.end();
  }

  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Components" }).click();
  await page.getByRole("button", { name: "Add heading", exact: true }).press("Enter");
  await page.getByRole("textbox", { name: "Heading", exact: true }).click();
  await page.keyboard.type("Over a picture layer");
  await page.getByRole("button", { name: "Done" }).click();

  const row = page.locator('[data-builder-item="row"]').filter({ has: page.getByRole("heading", { name: "Over a picture layer" }) });
  await row.getByRole("button", { name: /^Settings \(row \d+\)/ }).press("Enter");
  await page.getByRole("tab", { name: "Style" }).click();

  // With no background at all, the layers are still one press away, and a picture of the owner's own is one of them.
  await page.getByRole("button", { name: "Add layers over the background" }).click();
  await page.locator("[data-add-picture-layer]").getByRole("button", { name: "Choose from the library" }).click();
  await page.getByRole("dialog").last().getByRole("button", { name: file }).click();

  // It starts placed, in the middle, half as wide as the row; its settings are open.
  const picture = row.locator("[data-fx-layers] [data-fx-pic]");
  await expect(picture).toHaveAttribute("data-fx-pic", "placed");
  await expect(picture).toHaveAttribute("src", big);
  await expect(picture).toHaveAttribute("alt", "");
  const fields = page.locator("[data-layer-fields]");
  await expect(fields.getByRole("slider", { name: "Width" })).toHaveAttribute("aria-valuetext", "50%");
  // A picture is drawn as it is: alone, it gives the hue nothing to turn.
  await expect(page.getByRole("slider", { name: "Hue" })).toHaveCount(0);

  // Filling the part it has no width of its own; blurred, it is soft on the canvas at once.
  await fields.locator("label").filter({ hasText: /^Fills the part$/ }).click();
  await expect(picture).toHaveAttribute("data-fx-pic", "cover");
  await expect(fields.getByRole("slider", { name: "Width" })).toHaveCount(0);
  const blur = fields.getByRole("slider", { name: "Blur" });
  await blur.focus();
  for (let i = 0; i < 6; i++) await blur.press("ArrowRight");
  await expect.poll(() => picture.evaluate((el) => getComputedStyle(el).filter)).toBe("blur(6px)");
  await page.getByRole("button", { name: "Done" }).click();

  const title = `Picture layer ${run}`;
  await page.getByRole("textbox", { name: "Title", exact: true }).fill(title);
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  await page.waitForURL(/saved=published/);

  // As a visitor sees it: decoration with no alt text, behind the heading, cut to fill the row; blurred, the small copy is all it is sent.
  await page.goto(`/s/${E2E_STORE}/${title.toLowerCase().replaceAll(" ", "-")}`);
  const heading = page.getByRole("heading", { name: "Over a picture layer" });
  await expect(heading).toBeVisible();
  const drawn = page.locator("[data-row]").filter({ has: heading }).locator("[data-fx-layers] [data-fx-pic]");
  await expect(drawn).toHaveAttribute("data-fx-pic", "cover");
  await expect(drawn).toHaveAttribute("src", small);
  await expect(drawn).toHaveAttribute("alt", "");
  expect(await drawn.evaluate((el) => getComputedStyle(el).objectFit)).toBe("cover");
  expect(await drawn.evaluate((el) => getComputedStyle(el).filter)).toBe("blur(6px)");
  // It reaches past its frame on every side by twice the blur, so its soft rim does not show.
  const reach = await drawn.evaluate((el) => {
    const frame = el.closest("[data-fx-layers]")!.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return [frame.left - box.left, box.right - frame.right, frame.top - box.top, box.bottom - frame.bottom].map(Math.round);
  });
  for (const side of reach) expect(side).toBeGreaterThanOrEqual(12);
});
