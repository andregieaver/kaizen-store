import { expect, test, type Page } from "@playwright/test";

/** The storefront's header, menus and bottom bars (D30). */

const headerTop = (page: Page) =>
  page.evaluate(() => Math.round(document.querySelector("header")!.parentElement!.getBoundingClientRect().top));

test("on a computer, the header's menu links and hides while scrolling down", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await page.goto("/s/demo/no");
  const menu = page.getByRole("navigation", { name: "Hovedmeny" });
  await expect(page.getByRole("link", { name: "Kaizen Demo" }).first()).toBeVisible();
  await menu.getByRole("link", { name: "Notatbok" }).click();
  await expect(page).toHaveURL("/s/demo/no/p/demo-notatbok");
  // Scroll the product page, not the moment before it arrives.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Notatbok");

  await page.mouse.wheel(0, 400);
  await expect.poll(() => headerTop(page)).toBeLessThan(0);
  await page.mouse.wheel(0, -100);
  await expect.poll(() => headerTop(page)).toBe(0);
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("the menu slides out, and closes with Escape or a chosen link", async ({ page }) => {
    await page.goto("/s/demo/no");
    const dialog = page.getByRole("dialog", { name: "Meny" });
    // A tap before the page has come alive does nothing, so tap again as a shopper would.
    await expect(async () => {
      await page.getByRole("button", { name: "Åpne menyen" }).first().click();
      await expect(dialog.getByRole("link", { name: "Bordlampe" })).toBeInViewport({ timeout: 1000 });
    }).toPass();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();

    // The bottom bar's Menu button opens the same menu.
    await page.locator("[data-default-bar]").getByRole("button", { name: "Åpne menyen" }).click();
    await dialog.getByRole("link", { name: "Kopp" }).click();
    await expect(page).toHaveURL("/s/demo/no/p/demo-keramikkopp");
    await expect(dialog).toBeHidden();
  });

  test("a product page's bottom bar adds to the cart, and hides while scrolling up", async ({ page }) => {
    await page.goto("/s/demo/no/p/demo-notatbok");
    const bar = page.locator("[data-product-bar]");
    await expect(page.locator("[data-default-bar]")).toBeHidden();
    const lined = await bar.locator("option", { hasText: "Linjert" }).getAttribute("value");
    await bar.getByRole("combobox", { name: "Velg variant" }).selectOption(lined!);
    await bar.getByRole("button", { name: "Legg i handlekurven" }).click();
    await expect(bar.getByText("Lagt i handlekurven.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Handlekurv (1)" }).first()).toBeAttached();

    const barTop = () => bar.evaluate((el) => Math.round(el.getBoundingClientRect().top));
    // One step at a time: the browser merges scrolls within a frame into one.
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect.poll(() => headerTop(page)).toBeLessThan(0);
    await page.evaluate(() => window.scrollTo(0, 300));
    await expect.poll(barTop).toBeGreaterThanOrEqual(844);
    await page.evaluate(() => window.scrollTo(0, 600));
    await expect.poll(barTop).toBeLessThan(844);
    await expect.poll(() => headerTop(page)).toBeLessThan(0);
  });
});
