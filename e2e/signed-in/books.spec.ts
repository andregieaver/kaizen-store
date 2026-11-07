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

test("an owner posts an entry by hand, finds it in the journal and reverses it", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/settings/books`);
  const hand = page.getByRole("region", { name: "Post an entry by hand" });
  await expect(hand).toBeVisible({ timeout: 30_000 });
  await hand.getByText("Post an entry", { exact: true }).click();
  const words = `Innskudd e2e ${Date.now().toString(36)}`;
  await hand.getByLabel("What it is").fill(words);
  await hand.getByLabel("Account 1").selectOption("1920");
  await hand.getByLabel("Debit 1").fill("100");
  await hand.getByLabel("Account 2").selectOption("2050");
  // Not balanced yet: the owner is told, and nothing is posted.
  await hand.getByLabel("Credit 2").fill("90");
  await hand.getByRole("button", { name: "Post the entry" }).click();
  await expect(hand.getByText("The debits and the credits do not add up to the same.")).toBeVisible({ timeout: 30_000 });
  await hand.getByLabel("Credit 2").fill("100");
  await hand.getByRole("button", { name: "Post the entry" }).click();
  await expect(hand.getByText("Posted.")).toBeVisible({ timeout: 30_000 });

  const journal = page.getByRole("region", { name: "Journal" });
  const entry = journal.getByRole("listitem").filter({ hasText: words });
  await expect(entry).toBeVisible({ timeout: 30_000 });
  await entry.locator("summary", { hasText: "Reverse" }).click();
  await entry.getByRole("button", { name: "Reverse" }).click();
  // The entry says which reversed it, and the reversal (newest, its words naming the entry) which it reverses.
  const withWords = journal.getByRole("listitem").filter({ hasText: words });
  await expect(withWords.filter({ hasText: /Reversed by M\d{4}-\d+/ })).toHaveCount(1, { timeout: 30_000 });
  await expect(withWords.filter({ hasText: /Reverses M\d{4}-\d+/ })).toHaveCount(1);
});

/**
 * A bank statement uploaded to the books (B4, D486): a netbank's CSV in the Bank card, its line read and, with nothing in the books that
 * moved the same money, listed as in the bank and not in the books. Each run's line says something new, so it is a new line each time.
 */
test("an owner uploads the bank's statement and sees its line waiting for the books", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/settings/books`);
  const bank = page.getByRole("region", { name: "Bank", exact: true });
  await expect(bank).toBeVisible({ timeout: 30_000 });
  const words = `Kontorrekvisita e2e ${Date.now().toString(36)}`;
  await bank.getByLabel("Statement file").setInputFiles({
    name: "kontoutskrift.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`Dato;Forklaring;Ut fra konto;Inn på konto\n15.03.2026;${words};123,45;\n`, "utf-8"),
  });
  await bank.getByRole("button", { name: "Upload the statement" }).click();
  await expect(bank.getByText("1 line read, 1 new, 0 matched to the books.")).toBeVisible({ timeout: 30_000 });
  await expect(bank.locator("summary", { hasText: "In the bank, not in the books" })).toBeVisible();
  await expect(bank.getByText(words)).toBeVisible();
});
