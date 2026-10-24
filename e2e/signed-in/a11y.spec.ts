import { expect, test } from "@playwright/test";

import { describeFindings, violationsOn } from "../a11y";
import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * The accessibility scan over the admin as signed-in people use it (PSI 2026-10-24, ACC-01): the same axe rules and the same bar as
 * `e2e/a11y.spec.ts` (serious and critical findings fail), on the pages an owner and a platform admin open most, and the admin's skip
 * link. The signed-out pages are scanned there; the Stripe forms are checked by hand.
 */

const OWNER_PAGES = [
  "/admin",
  `/admin/${E2E_STORE}`,
  `/admin/${E2E_STORE}/orders`,
  `/admin/${E2E_STORE}/products`,
  `/admin/${E2E_STORE}/customers`,
  `/admin/${E2E_STORE}/pages`,
  `/admin/${E2E_STORE}/analytics`,
  `/admin/${E2E_STORE}/support`,
  `/admin/${E2E_STORE}/settings`,
  "/admin/account",
];

const PLATFORM_PAGES = ["/admin/platform", "/admin/platform/stores", "/admin/platform/themes", "/admin/platform/ai"];

test.describe("the owner's admin", () => {
  test.use({ storageState: OWNER.state });

  for (const path of OWNER_PAGES) {
    test(`has no serious accessibility findings at ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("#admin-main")).toBeVisible();
      const findings = await violationsOn(page);
      expect(describeFindings(findings)).toEqual([]);
    });
  }

  test("starts with a skip link that takes the keyboard to the page", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/orders`);
    // Once the page has woken up: a Tab pressed while it hydrates can be lost.
    await page.waitForLoadState("networkidle");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#admin-main")).toBeFocused();
  });
});

test.describe("the platform admin", () => {
  test.use({ storageState: ADMIN.state });

  for (const path of PLATFORM_PAGES) {
    test(`has no serious accessibility findings at ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("#admin-main")).toBeVisible();
      const findings = await violationsOn(page);
      expect(describeFindings(findings)).toEqual([]);
    });
  }
});
