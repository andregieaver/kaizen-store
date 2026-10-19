import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

/**
 * The page builder fills the window and nothing more on a computer: its three columns scroll on their own, so the page itself never
 * scrolls. A field's label for screen readers lies absolutely in a sidebar; while the sidebars were not positioned it was not held by
 * their scroll and made the page taller than the window, by as much as the sidebar held below it.
 */
test.use({ storageState: OWNER.state });

for (const viewport of [
  { width: 1526, height: 643 },
  { width: 1280, height: 900 },
]) {
  test(`the page builder fits a ${viewport.width} × ${viewport.height} window without the page scrolling`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(`/admin/${E2E_STORE}/pages`);
    const editors = await page
      .locator(`a[href^="/admin/${E2E_STORE}/pages/"]`)
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? "").filter((href) => /\/pages\/[0-9a-f-]{36}$/.test(href)));
    expect(editors.length).toBeGreaterThan(0);
    await page.goto(editors[0]);
    await expect(page.locator("[data-editor-bar]")).toBeVisible();
    // The columns are fitted to the window once the builder has drawn (`--builder-h`).
    await expect.poll(() => page.locator("[style*='--builder-h']").evaluate((grid) => (grid as HTMLElement).style.getPropertyValue("--builder-h"))).not.toBe("");
    const room = await page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, window: window.innerHeight }));
    expect(room.scroll).toBeLessThanOrEqual(room.window);
  });
}
