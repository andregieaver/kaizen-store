import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER, QUIET, READER } from "./accounts";

/**
 * The signed-in admin as two people see it (D158): the owner has the whole store, the Read-only member reads and is refused
 * what their role does not hold, and the activity log's person filter offers each only who they may see.
 */

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("opens the store, its Team page and the activity log, and is offered every member in the person filter", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}`);
    await expect(page.locator("[data-admin-rail]")).toBeVisible();
    await page.goto(`/admin/${E2E_STORE}/staff`);
    await expect(page.getByRole("heading", { level: 1, name: "Team" })).toBeVisible();
    await expect(page.getByText(READER.email).first()).toBeVisible();

    await page.goto(`/admin/${E2E_STORE}/activity`);
    const people = page.locator('select[name="person"] option');
    await expect(people.filter({ hasText: READER.name })).toHaveCount(1);
    await expect(people.filter({ hasText: QUIET.name })).toHaveCount(1);
  });
});

test.describe("a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("reads the store but is not shown the Team page", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/orders`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // Refused as not found (the page streams, so the status is already sent; the page is the 404).
    await page.goto(`/admin/${E2E_STORE}/staff`);
    await expect(page.getByRole("heading", { level: 1, name: "404" })).toBeVisible();
    await expect(page.getByText(QUIET.email)).toHaveCount(0);
  });

  test("is offered only themselves and the people in the entries they may see, never a member who left none", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/activity`);
    const people = page.locator('select[name="person"] option');
    await expect(people.filter({ hasText: READER.name })).toHaveCount(1);
    await expect(people.filter({ hasText: QUIET.name })).toHaveCount(0);
    await expect(people.filter({ hasText: QUIET.email })).toHaveCount(0);
  });
});
