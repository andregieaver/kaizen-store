import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Leaving Kaizena Flow (wave 10 unit P, D377): the owner downloads the whole store as one file from Close store, and the account page's
 * Delete your account tells the store's only owner why it cannot go yet (nothing is erased here; what erasing does is held by
 * `account-erasure.int.test.ts`, the file's contents by `store-export.int.test.ts`).
 */

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("downloads the store as one JSON file from Close store", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/settings/close`);
    const card = page.getByRole("region", { name: "Take your store with you" });
    await expect(card).toBeVisible();
    const [download] = await Promise.all([page.waitForEvent("download"), card.getByRole("button", { name: "Download the store as a file" }).click()]);
    expect(download.suggestedFilename()).toMatch(/\.json$/);
    const file = JSON.parse(await (await download.createReadStream()).toArray().then((parts) => Buffer.concat(parts).toString("utf8")));
    expect(file.schema).toBe("kaizen.store-export");
    expect(Array.isArray(file.tables.pages)).toBe(true);
  });

  test("is told why their account cannot be deleted while they are the store's only owner", async ({ page }) => {
    await page.goto("/admin/account");
    await page.getByRole("link", { name: "Delete your account …" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Delete your account" })).toBeVisible();
    await expect(page.getByText("You are the only owner of a store that is not closed.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete my account" })).toHaveCount(0);
  });
});

test.describe("a member who may only read", () => {
  test.use({ storageState: READER.state });

  test("cannot download the store", async ({ page }) => {
    // Who may download is asked before anything else: a member who is not the owner gets a 404, whatever the request.
    const response = await page.request.post(`/admin/${E2E_STORE}/settings/close/export`);
    expect(response.status()).toBe(404);
  });
});
