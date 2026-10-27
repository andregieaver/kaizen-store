import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * Content types as the owner works them (wave 6 unit H1, D326; row catalogue.metaobjects): a type made from a starting point on Website →
 * Content, an entry written in its fields' own form and published only once its required fields are filled, and the type's list saying
 * so. The server side is held by content-types.int.test.ts; this holds the screens that drive it.
 */

test.use({ storageState: OWNER.state });

test.beforeAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = coalesce(setup_completed_at, now()) where slug = ${E2E_STORE}`;
    // A run that stopped half-way leaves its types: they are made again from nothing.
    await sql`delete from commerce.content_types where store_id = (select id from commerce.stores where slug = ${E2E_STORE})`;
  } finally {
    await sql.end();
  }
});

test("makes a type from a starting point, and publishes an entry once its required fields are filled", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/content`);
  await expect(page.getByRole("heading", { level: 1, name: "Content" })).toBeVisible();
  await page.getByRole("link", { name: /Questions and answers/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "New content type" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Questions and answers");
  await page.getByRole("button", { name: "Save the type" }).click();

  // Saved, the type's entries open: none yet.
  await expect(page.getByRole("heading", { level: 1, name: "Questions and answers" })).toBeVisible();
  await expect(page.getByText("No entries yet.")).toBeVisible();
  await page.getByRole("link", { name: "New entry" }).click();

  await page.getByRole("textbox", { name: "Question", exact: true }).fill("Do you ship abroad?");
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  // The answer is required: the draft is kept, publishing waits.
  await expect(page.getByRole("alert").filter({ hasText: "Answer is required." })).toBeVisible();

  await page.locator('[contenteditable="true"]').first().click();
  await page.keyboard.type("Yes, to every country in the EU.");
  await page.getByRole("button", { name: /Publish/ }).first().click();
  // Published, the new entry's own page opens, saying so.
  await expect(page.getByRole("heading", { level: 1, name: "Do you ship abroad?" })).toBeVisible();
  await expect(page.getByRole("main").getByText("Published", { exact: true }).first()).toBeVisible();

  await page.getByRole("link", { name: "Back to Questions and answers" }).click();
  const row = page.getByRole("listitem").filter({ hasText: "Do you ship abroad?" });
  await expect(row.getByText("Published", { exact: true })).toBeVisible();
});
