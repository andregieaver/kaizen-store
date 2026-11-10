import { expect, test, type Page } from "@playwright/test";

import { ADMIN_PAGES, pageParams } from "../../src/lib/admin-map";

import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * Every admin screen hands down the areas of words its parts read (PSI PERF-01, `src/components/admin/admin-text-later.ts`). An area that
 * nothing handed down is fetched in English when a part first reads it, and the part is not interactive until it arrives: an early press
 * could submit a form without its script. So any such read is a fault, noted on the page (`window.__adminTextFallbacks`), and this test
 * visits each screen without an id in its address, as the person it is for, and fails on any. Fix one by handing its area down where the
 * page is drawn (`AdminAreas` or `AdminTextScope`), never by putting the English back into every screen.
 */

const plain = ADMIN_PAGES.filter((page) => pageParams(page).length === 0);

async function fallbacksOn(page: Page, address: string): Promise<string[]> {
  const response = await page.goto(address, { waitUntil: "load" });
  // A page a role may not open, or one switched off with its feature, answers so; it has nothing to check.
  if (!response || response.status() >= 400) return [];
  await page.waitForLoadState("networkidle").catch(() => {});
  return page.evaluate(() => (window as unknown as { __adminTextFallbacks?: string[] }).__adminTextFallbacks ?? []);
}

async function visitAll(page: Page, addresses: string[]) {
  const found: string[] = [];
  for (const address of addresses) {
    const areas = await fallbacksOn(page, address);
    if (areas.length > 0) found.push(`${address}: ${areas.join(", ")}`);
  }
  expect(found, "screens reading words nothing handed down").toEqual([]);
}

test.describe("a store's screens, as its owner", () => {
  test.use({ storageState: OWNER.state });
  test("read only the words their page handed down", async ({ page }) => {
    test.setTimeout(15 * 60_000);
    await visitAll(
      page,
      plain.filter((p) => p.area === "store").map((p) => `/admin/${E2E_STORE}${p.path}`),
    );
  });
});

test.describe("the platform's and the account's screens, as a platform admin", () => {
  test.use({ storageState: ADMIN.state });
  test("read only the words their page handed down", async ({ page }) => {
    test.setTimeout(15 * 60_000);
    await visitAll(
      page,
      plain.filter((p) => p.area !== "store").map((p) => `${p.area === "platform" ? "/admin/platform" : "/admin"}${p.path}`),
    );
  });
});

test.describe("a sidebar link that was pressed (code review FS1)", () => {
  test.use({ storageState: OWNER.state });
  test("shows that it is on its way until its page comes", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/settings`);
    const link = page.getByRole("navigation").locator('a[href$="/settings/shipping"]').first();
    await expect(link).toBeVisible();
    // The next page's data is held back, as on a slow line where it was not fetched ahead.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/settings/shipping**", async (route) => {
      if (route.request().headers()["rsc"]) await held;
      await route.continue();
    });
    await link.click();
    await expect(link.locator("[data-pending]")).toHaveCount(1);
    release();
    await expect(page).toHaveURL(/\/settings\/shipping/);
    await expect(page.locator("[data-pending]")).toHaveCount(0);
  });
});
