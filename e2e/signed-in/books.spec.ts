import { expect, test } from "@playwright/test";

import { E2E_STORE, OWNER } from "./accounts";

test.use({ storageState: OWNER.state });

/**
 * The store's own books (B2, D478) as an owner opens them on Settings → Books: from a day, then the trial balance of this year, its reports and locking
 * the books through a day. A book is never deleted, so a run that finds the books open goes on from there.
 */
test("an owner opens the store's books, reads the trial balance and the reports, and locks them through a day", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/settings/books`);
  await expect(page.getByRole("heading", { name: "Books", level: 1 })).toBeVisible();
  const open = page.getByRole("button", { name: "Open the books" });
  if (await open.isVisible()) {
    await page.getByLabel("Books from").fill("2026-01-01");
    await open.click();
    // The page draws the open books in the form's place.
    await expect(page.getByText("Books from 1 January 2026, in NOK")).toBeVisible({ timeout: 30_000 });
  }
  const trial = page.getByRole("region", { name: "Trial balance" });
  await expect(trial).toBeVisible({ timeout: 30_000 });
  await expect(trial.getByText(/Result for the period|Nothing posted in these days yet/)).toBeVisible();
  // The reports of the same days (step 3b): the profit and loss, the balance sheet on the last day, and VAT by code with its term.
  await expect(page.getByRole("region", { name: "Profit and loss" }).getByText(/Result for the period|No income or costs in these days yet/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Balance sheet" }).getByText(/Total assets|Nothing posted by this day yet/)).toBeVisible();
  await expect(page.getByRole("region", { name: "VAT by code" }).getByText(/VAT terms are two months/)).toBeVisible();

  const lock = page.getByRole("region", { name: "Lock the books" });
  await lock.getByLabel("Locked through").fill("2026-01-31");
  await lock.getByRole("button", { name: "Lock" }).click();
  await expect(lock.getByText("Locked.")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/Locked through/).first()).toBeVisible();
});
