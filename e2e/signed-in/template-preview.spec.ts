import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * A template previewed from the builder's sidebar shows what it would place (D127). The preview page streams its content behind a
 * loading state that Next's inline scripts reveal, so the frame must run scripts; it never shares the admin's origin.
 */

test.use({ storageState: OWNER.state });

const NAME = `Preview promise ${Date.now().toString(36)}`;
const WORDS = `Free returns ${Date.now().toString(36)}`;

test.beforeAll(async () => {
  const sql = testDb();
  try {
    // One of Kaizena Flow's own templates: on the marketplace and switched on for every store until it switches it off.
    await sql`
      insert into commerce.saved_parts (store_id, kind, name, content, sharing)
      values (null, 'block', ${NAME}, ${sql.json({ id: "e2e-preview-heading", type: "heading", text: WORDS, level: 2 })}, 'marketplace')`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.saved_parts where store_id is null and name = ${NAME}`;
  } finally {
    await sql.end();
  }
});

test("a template's preview from the builder's sidebar shows its content", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/pages/new`);
  await page.getByRole("tab", { name: "Templates" }).click();
  await page.getByRole("button", { name: "Marketplace" }).click();
  const card = page.getByRole("listitem").filter({ hasText: NAME });
  await card.getByRole("button", { name: /^Preview/ }).click();
  const frame = page.frameLocator(`iframe[title*="${NAME}"]`);
  await expect(frame.getByRole("heading", { name: WORDS })).toBeVisible({ timeout: 30_000 });
});
