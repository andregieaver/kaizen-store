import { expect, test, type Locator, type Page } from "@playwright/test";
import type postgres from "postgres";

import { storePageWith } from "./db";

/**
 * The carousel's behaviour (D155, B) in a real browser: arrows, dots, rewind, snapping, and an autoplay that is safe
 * (never under reduced motion, stops for good on any interaction, holds while the pointer is over it, always a Pause
 * button). Testimonials share the carousel with the content grid, so they carry the tests.
 */

const quotes = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: `q${i + 1}`, quote: `Sitat nummer ${i + 1}`, name: `Kunde ${i + 1}`, role: "", picture: null }));

const carousel = (extra: Record<string, postgres.JSONValue> = {}, count = 9): postgres.JSONValue => ({
  id: "t",
  type: "testimonials",
  items: quotes(count),
  columns: 3,
  look: "cards",
  display: "carousel",
  ...extra,
});

const track = (page: Page) => page.locator("[data-carousel-track]");
const scrolled = (element: Locator) => element.evaluate((el) => Math.abs(el.scrollLeft));
const maxScroll = (element: Locator) => element.evaluate((el) => el.scrollWidth - el.clientWidth);
/** Waits until the row has stopped moving and says where it rests. */
const settled = async (element: Locator) => {
  let last = -1;
  await expect
    .poll(async () => {
      const now = await scrolled(element);
      const same = Math.abs(now - last) < 0.5;
      last = now;
      return same;
    }, { intervals: [150, 150, 150, 150, 150, 150] })
    .toBe(true);
  return scrolled(element);
};

async function open(page: Page, block: postgres.JSONValue, name = "carousel") {
  const address = await storePageWith(name, [block]);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(address);
  await page.waitForLoadState("networkidle");
  return address;
}

test("a testimonials carousel is unchanged by default: two arrows, off at the ends, nothing moves by itself", async ({ page }) => {
  await open(page, carousel());
  const row = track(page);
  const previous = page.getByRole("button", { name: "Forrige" });
  const next = page.getByRole("button", { name: "Neste" });
  await expect(previous).toBeDisabled();
  await expect(next).toBeEnabled();
  // No dots, no Pause button, nothing announced, snapping to the start of a tile.
  await expect(page.locator("[data-carousel-dot], [data-carousel-toggle]")).toHaveCount(0);
  await expect(row).not.toHaveAttribute("aria-live", /.*/);
  await expect(row).not.toHaveAttribute("data-snap", /.*/);
  await expect(row).toHaveCSS("scroll-snap-type", "x mandatory");
  await page.waitForTimeout(1500);
  expect(await scrolled(row)).toBe(0);

  await next.click();
  await expect(previous).toBeEnabled();
  expect(await settled(row)).toBeGreaterThan(100);
  // Straight to the end: next is off there, and nothing goes round.
  for (let i = 0; i < 4; i++) if (await next.isEnabled()) await next.click().then(() => settled(row));
  await expect(next).toBeDisabled();
  const end = await settled(row);
  expect(Math.round(end)).toBe(Math.round(await maxScroll(row)));
  await previous.click();
  await expect(next).toBeEnabled();
  expect(await settled(row)).toBeLessThan(end);
});

test("dots are a labelled group of buttons, one a page, that follow the scrolling and move it", async ({ page }) => {
  await open(page, carousel({ carousel: { dots: true } }));
  const row = track(page);
  const group = page.getByRole("group", { name: "Sider" });
  const dots = group.getByRole("button");
  await expect(dots).toHaveCount(3);
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
  await expect(dots.nth(0)).toHaveAccessibleName("Gå til side 1 av 3");
  await expect(dots.nth(2)).toHaveAccessibleName("Gå til side 3 av 3");

  await dots.nth(1).click();
  await expect(dots.nth(1)).toHaveAttribute("aria-current", "true");
  await expect(dots.nth(0)).not.toHaveAttribute("aria-current", "true");
  const middle = await settled(row);
  expect(middle).toBeGreaterThan(100);

  // The arrows move them too.
  await page.getByRole("button", { name: "Neste" }).click();
  await expect(dots.nth(2)).toHaveAttribute("aria-current", "true");
  await dots.nth(0).click();
  await expect(dots.nth(0)).toHaveAttribute("aria-current", "true");
  expect(await settled(row)).toBe(0);
});

test("no dots are drawn when everything fits on one page", async ({ page }) => {
  await open(page, carousel({ carousel: { dots: true } }, 3));
  await expect(page.getByRole("button", { name: "Neste" })).toBeDisabled();
  await expect(page.locator("[data-carousel-dot]")).toHaveCount(0);
});

test("rewind sends the next arrow from the end back to the first tile, without cloning one", async ({ page }) => {
  await open(page, carousel({ carousel: { rewind: true } }));
  const row = track(page);
  const next = page.getByRole("button", { name: "Neste" });
  await expect(row.locator("> *")).toHaveCount(9);
  for (let i = 0; i < 2; i++) await next.click().then(() => settled(row));
  expect(Math.round(await settled(row))).toBe(Math.round(await maxScroll(row)));
  // Still on at the end.
  await expect(next).toBeEnabled();
  await next.click();
  await expect.poll(() => scrolled(row)).toBe(0);
  await expect(page.getByRole("button", { name: "Forrige" })).toBeDisabled();
  // The same nine tiles, so a reader hears "Sitat nummer 1" once.
  await expect(row.locator("> *")).toHaveCount(9);
  await expect(page.getByText("Sitat nummer 1", { exact: true })).toHaveCount(1);
});

test("snapping can rest at the centre of a tile or be free, and arrows can be left out", async ({ page }) => {
  await open(page, carousel({ carousel: { snap: "center", arrows: false } }), "snap-center");
  await expect(track(page)).toHaveAttribute("data-snap", "center");
  await expect(track(page).locator("> *").first()).toHaveCSS("scroll-snap-align", "center");
  await expect(page.getByRole("button", { name: "Neste" })).toHaveCount(0);
  // Without arrows the row still scrolls by itself.
  expect(await maxScroll(track(page))).toBeGreaterThan(100);

  await open(page, carousel({ carousel: { snap: "none" } }), "snap-none");
  await expect(track(page)).toHaveCSS("scroll-snap-type", "none");
});

test("the controls are operable with the keyboard and show where the focus is", async ({ page }) => {
  await open(page, carousel({ carousel: { dots: true } }));
  const row = track(page);
  const next = page.getByRole("button", { name: "Neste" });
  const dot2 = page.getByRole("button", { name: "Gå til side 2 av 3" });
  // Tab in order to the second dot, then the next arrow.
  const focusOn = async (target: Locator) => {
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      if (await target.evaluate((el) => el === document.activeElement)) return;
    }
    throw new Error("The control cannot be reached with the Tab key.");
  };
  await focusOn(dot2);
  await expect(dot2).toBeFocused();
  // A visible outline, not left to the browser's mood.
  await expect(dot2).toHaveCSS("outline-style", "solid");
  await expect(dot2).not.toHaveCSS("outline-width", "0px");
  await page.keyboard.press("Enter");
  await expect(dot2).toHaveAttribute("aria-current", "true");
  expect(await settled(row)).toBeGreaterThan(100);
  const after = await scrolled(row);
  await focusOn(next);
  await expect(next).toBeFocused();
  await expect(next).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("Space");
  expect(await settled(row)).toBeGreaterThan(after);
});

test("autoplay moves a page every few seconds, tells nothing while it plays, and has a Pause button", async ({ page }) => {
  await open(page, carousel({ carousel: { autoplay: { seconds: 3 }, rewind: true } }));
  const row = track(page);
  const pause = page.getByRole("button", { name: "Sett karusellen på pause" });
  await expect(pause).toBeVisible();
  await expect(row).toHaveAttribute("aria-live", "off");
  // The pointer is away, so it moves.
  await page.mouse.move(2, 2);
  await expect.poll(() => scrolled(row), { timeout: 8000 }).toBeGreaterThan(100);
  // Pause by hand: it stops and says Play; the page is told politely now.
  await pause.click();
  const play = page.getByRole("button", { name: "Spill av karusellen" });
  await expect(play).toBeVisible();
  await expect(row).toHaveAttribute("aria-live", "polite");
  const held = await settled(row);
  await page.waitForTimeout(4500);
  expect(await scrolled(row)).toBe(held);
  // Play starts it again, by hand.
  await play.click();
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  await page.mouse.move(2, 2);
  await expect.poll(() => scrolled(row), { timeout: 8000 }).not.toBe(held);
});

test("autoplay stops for good when the visitor scrolls", async ({ page }) => {
  await open(page, carousel({ carousel: { autoplay: { seconds: 3 }, rewind: true } }));
  const row = track(page);
  await page.mouse.move(2, 2);
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  // A press on the row is the visitor's.
  const box = (await row.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + 20);
  await expect(page.getByRole("button", { name: "Spill av karusellen" })).toBeVisible();
  await page.mouse.move(2, 2);
  const stopped = await settled(row);
  await page.waitForTimeout(4500);
  expect(await scrolled(row)).toBe(stopped);
});

test("autoplay stops for good when the visitor uses the wheel over it", async ({ page }) => {
  await open(page, carousel({ carousel: { autoplay: { seconds: 3 } } }));
  const row = track(page);
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(150, 0);
  await expect(page.getByRole("button", { name: "Spill av karusellen" })).toBeVisible();
  await page.mouse.move(2, 2);
  const stopped = await settled(row);
  await page.waitForTimeout(4500);
  expect(await scrolled(row)).toBe(stopped);
});

test("autoplay stops for good when focus goes inside", async ({ page }) => {
  await open(page, carousel({ carousel: { autoplay: { seconds: 3 } } }));
  const row = track(page);
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  await page.getByRole("button", { name: "Neste" }).focus();
  await expect(page.getByRole("button", { name: "Spill av karusellen" })).toBeVisible();
  await page.mouse.move(2, 2);
  const stopped = await settled(row);
  await page.waitForTimeout(4500);
  expect(await scrolled(row)).toBe(stopped);
});

test("autoplay waits while the pointer is over the carousel", async ({ page }) => {
  await open(page, carousel({ carousel: { autoplay: { seconds: 3 } } }));
  const row = track(page);
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // Autoplay starts when the page does, so under load a first step can land before the pointer does: what is asked
  // is that nothing moves once the pointer is over it, so the row is let settle and then holds.
  const held = await settled(row);
  await page.waitForTimeout(4500);
  expect(await scrolled(row)).toBe(held);
  // Held, not stopped: still a Pause button.
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  await page.mouse.move(2, 2);
  await expect.poll(() => scrolled(row), { timeout: 8000 }).toBeGreaterThan(100);
});

test("autoplay never starts under reduced motion, and there is no button for it", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, carousel({ carousel: { autoplay: { seconds: 3 }, rewind: true } }));
  const row = track(page);
  await page.mouse.move(2, 2);
  await page.waitForTimeout(4500);
  expect(await scrolled(row)).toBe(0);
  await expect(page.locator("[data-carousel-toggle]")).toHaveCount(0);
  await expect(row).not.toHaveAttribute("aria-live", /.*/);
  // The arrows still work, and without smooth scrolling.
  await page.getByRole("button", { name: "Neste" }).click();
  await expect.poll(() => scrolled(row)).toBeGreaterThan(100);
});

test("without JavaScript the row scrolls and everything in it can be reached", async ({ browser }) => {
  const address = await storePageWith("nojs", [carousel({ carousel: { dots: true, autoplay: { seconds: 3 } } })]);
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(address);
  const last = page.getByText("Sitat nummer 9", { exact: true });
  await expect(last).toHaveCount(1);
  // Past the row's edge to begin with, then brought into view by scrolling the row.
  const edge = (await track(page).boundingBox())!;
  expect((await last.boundingBox())!.x).toBeGreaterThan(edge.x + edge.width - 1);
  await last.scrollIntoViewIfNeeded();
  const seen = (await last.boundingBox())!;
  expect(seen.x).toBeLessThan(edge.x + edge.width);
  // No dots and no Pause button that would do nothing.
  await expect(page.locator("[data-carousel-dot], [data-carousel-toggle]")).toHaveCount(0);
  await context.close();
});

// ---------------------------------------------------------------------------------------------------------------------
// The component's own listeners and observers (review of D155, B): what the controller's tests cannot reach.
// ---------------------------------------------------------------------------------------------------------------------

const root = (page: Page) => page.locator("[data-carousel-track]").locator("xpath=..");

test("autoplay holds while the tab is hidden and goes on when it is shown again", async ({ page }) => {
  await open(page, carousel({ carousel: { autoplay: { seconds: 3 }, rewind: true } }));
  const row = track(page);
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  await page.mouse.move(2, 2);
  const hide = (hidden: boolean) =>
    page.evaluate((value) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  // Where it rests when the tab goes hidden: on a slow machine the first step (3 s after the page woke) may already have been taken.
  const resting = await settled(row);
  await hide(true);
  await page.waitForTimeout(4500);
  expect(await scrolled(row)).toBe(resting);
  // Held, not stopped: still a Pause button, and it moves again once the tab is back.
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  await hide(false);
  await expect.poll(() => scrolled(row), { timeout: 8000 }).not.toBe(resting);
});

test("autoplay stops for good on a key press or a touch inside the carousel", async ({ page }) => {
  for (const type of ["keydown", "touchstart"] as const) {
    await open(page, carousel({ carousel: { autoplay: { seconds: 3 } } }), `autoplay-${type}`);
    const row = track(page);
    await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
    await root(page).evaluate((el, kind) => el.dispatchEvent(kind === "keydown" ? new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }) : new Event("touchstart", { bubbles: true })), type);
    await expect(page.getByRole("button", { name: "Spill av karusellen" }), type).toBeVisible();
    await page.mouse.move(2, 2);
    const stopped = await settled(row);
    await page.waitForTimeout(4500);
    expect(await scrolled(row), type).toBe(stopped);
  }
});

test("autoplay stops and its button goes when the visitor asks for less motion while it plays", async ({ page }) => {
  await open(page, carousel({ carousel: { autoplay: { seconds: 3 }, rewind: true } }));
  const row = track(page);
  await expect(page.getByRole("button", { name: "Sett karusellen på pause" })).toBeVisible();
  await page.mouse.move(2, 2);
  // The setting changes live (the device's switch), not only at load.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator("[data-carousel-toggle]")).toHaveCount(0);
  await expect(row).not.toHaveAttribute("aria-live", /.*/);
  const held = await settled(row);
  await page.waitForTimeout(4500);
  expect(await scrolled(row)).toBe(held);
});

test("the dots follow tiles added or taken away, which change what the row scrolls through but not its own box", async ({ page }) => {
  await open(page, carousel({ carousel: { dots: true } }));
  const dots = page.locator("[data-carousel-dot]");
  await expect(dots).toHaveCount(3);
  // Three tiles to a screen: taking away three leaves two pages, adding three makes three again.
  await track(page).evaluate((el) => {
    for (let i = 0; i < 3; i++) el.lastElementChild?.remove();
  });
  await expect(dots).toHaveCount(2);
  await track(page).evaluate((el) => {
    for (let i = 0; i < 3; i++) el.appendChild(el.firstElementChild!.cloneNode(true));
  });
  await expect(dots).toHaveCount(3);
  // Down to one page: no dots at all.
  await track(page).evaluate((el) => {
    while (el.children.length > 3) el.lastElementChild?.remove();
  });
  await expect(dots).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Neste" })).toBeDisabled();
});

test("a row nobody can tab into (no links, no arrows, no dots) takes a tab stop of its own, which scrolls it by keyboard", async ({ page }) => {
  await open(page, carousel({ carousel: { arrows: false } }), "keyboard-row");
  const row = track(page);
  await expect(row).toHaveAttribute("tabindex", "0");
  await expect(row).toHaveAccessibleName("Karusell");
  await row.focus();
  await expect(row).toBeFocused();
  await expect(row).toHaveCSS("outline-style", "solid");
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => scrolled(row)).toBeGreaterThan(20);
});

test("a row with something else to tab to keeps no tab stop of its own", async ({ page }) => {
  // The arrows are there.
  await open(page, carousel(), "keyboard-arrows");
  await expect(track(page)).not.toHaveAttribute("tabindex", /.*/);
  // Dots without arrows are buttons too.
  await open(page, carousel({ carousel: { arrows: false, dots: true } }), "keyboard-dots");
  await expect(page.locator("[data-carousel-dot]").first()).toBeVisible();
  await expect(track(page)).not.toHaveAttribute("tabindex", /.*/);
  // Everything on one page: nothing to scroll, so no stop either.
  await open(page, carousel({ carousel: { arrows: false } }, 3), "keyboard-short");
  await expect(track(page)).not.toHaveAttribute("tabindex", /.*/);
});
