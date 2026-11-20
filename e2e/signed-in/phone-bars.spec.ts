import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * On a phone the admin's bottom bar of sections steps aside for a page with a bar of its own at the foot of the screen (`data-bottom-bar`):
 * the page editor's Save, View page and Duplicate were drawn under it, out of reach (the owner, 20 November 2026). Elsewhere it stays.
 */
test.use({ storageState: OWNER.state, viewport: { width: 390, height: 844 } });

async function firstPage(): Promise<string> {
  const sql = testDb();
  try {
    const [page] = await sql`
      select p.id from commerce.pages p join commerce.stores s on s.id = p.store_id
      where s.slug = ${E2E_STORE} and p.type = 'page' order by p.created_at, p.slug limit 1`;
    return String(page.id);
  } finally {
    await sql.end();
  }
}

test("the page editor's own bar is in reach on a phone, with View page and Duplicate under More", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/${await firstPage()}`);
  const bar = page.locator("[data-editor-bar]");
  await expect(bar).toBeVisible();
  await expect(page.locator("[data-phone-tabs]")).toBeHidden();
  await bar.locator("[data-editor-bar-toggle]").click();
  await expect(bar.getByRole("link", { name: "View page" })).toBeInViewport();
  await expect(bar.getByRole("button", { name: "Duplicate" }).or(bar.getByRole("link", { name: "Duplicate" })).first()).toBeInViewport();
});

test("a page without a bar of its own keeps the sections at the foot of a phone's screen", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/orders`);
  await expect(page.locator("[data-phone-tabs]")).toBeVisible();
});
