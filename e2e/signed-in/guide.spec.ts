import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { ADMIN, E2E_STORE, OWNER } from "./accounts";

/**
 * Guide (D909): the panel at the rail's foot lists the level's places with a way to each, and a place asked for from it is shown on
 * arrival whatever the person's level. Every signed-in person is Quiet (`auth.setup.ts`), so these tests ask from the panel and nothing
 * starts by itself on the other specs' pages; nothing here changes the person's level.
 */
test.use({ storageState: OWNER.state });

async function openGuide(page: Page) {
  const button = page.getByRole("button", { name: /^Open Guide, \d+ of \d+ places found$/ });
  await expect(button).toBeVisible();
  await button.click();
  const panel = page.getByRole("dialog", { name: "Guide" });
  await expect(panel).toBeVisible();
  return panel;
}

async function found(storeSlug: string | null): Promise<string[]> {
  const sql = testDb();
  try {
    const rows = storeSlug
      ? await sql`select g.state from commerce.guide_progress g join commerce.accounts a on a.id = g.account_id join commerce.stores s on s.id = g.store_id
                   where lower(a.email) = ${OWNER.email} and s.slug = ${storeSlug}`
      : [];
    return rows[0]?.state?.found ?? [];
  } finally {
    await sql.end();
  }
}

test("says nothing by itself in Quiet: no welcome on Home", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}`);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForTimeout(2500);
  await expect(page.locator("[data-guide-spotlight]")).toHaveCount(0);
  await expect(page.locator("[data-guide-dot]")).toHaveCount(0);
});

test("lists the store's places and shows the rail when asked, the page dimmed around it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/orders`);
  const panel = await openGuide(page);
  await expect(panel.getByRole("heading", { name: "Places in your admin" })).toBeVisible();
  for (const place of ["The rail", "Your next step", "Orders", "Products", "Settings"]) await expect(panel.getByText(place, { exact: true }).first()).toBeVisible();
  await panel.getByRole("listitem").filter({ hasText: "The rail" }).getByRole("button").click();
  await page.waitForURL((url) => url.pathname === `/admin/${E2E_STORE}`);
  const step = page.getByRole("dialog", { name: "This is the rail: every part of your store" });
  await expect(step).toBeVisible();
  await expect(step).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(step).toHaveCount(0);
  await expect.poll(() => found(E2E_STORE)).toContain("rail");
});

test("puts a beacon on Products when asked, its card open, gone once answered", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}`);
  const panel = await openGuide(page);
  await panel.getByRole("listitem").filter({ hasText: /^Products/ }).getByRole("button").click();
  await page.waitForURL((url) => url.pathname === `/admin/${E2E_STORE}/products`);
  const card = page.getByRole("dialog", { name: "This is Products" });
  await expect(card).toBeVisible();
  await expect(page.getByRole("button", { name: "Guide has a tip about Products" })).toHaveAttribute("aria-expanded", "true");
  await card.getByRole("button", { name: "Got it" }).click();
  await expect(card).toHaveCount(0);
  await expect(page.locator("[data-guide-dot]")).toHaveCount(0);
  await expect.poll(() => found(E2E_STORE)).toContain("products");
});

test("closes with Escape and keeps the person's level", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}`);
  const panel = await openGuide(page);
  await expect(panel.getByRole("button", { name: "Quiet" })).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
});

test.describe("on the platform", () => {
  test.use({ storageState: ADMIN.state });

  test("lists the platform's own sections", async ({ page }) => {
    await page.goto("/admin/platform");
    const panel = await openGuide(page);
    for (const place of ["The rail", "Stores", "Settings"]) await expect(panel.getByText(place, { exact: true }).first()).toBeVisible();
  });
});
