import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The owner lets the AI answer the store's contact forms first (`docs/100-day-challenge.md` B2, D797): Lisa's switch, one step away under
 * Advanced beside where the forms' messages go, saved to the desk's `form_ai`.
 */
test.use({ storageState: OWNER.state });

let storeId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    await sql`
      insert into commerce.support_settings (store_id, mode, form_ai) values (${storeId}, 'ai_first', false)
      on conflict (store_id) do update set mode = 'ai_first', form_ai = false`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.support_settings set form_ai = false where store_id = ${storeId}`;
  } finally {
    await sql.end();
  }
});

test("the owner lets the AI answer the contact forms' messages first, under Advanced", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/support/settings`);
  const formAi = page.getByRole("checkbox", { name: /Let the AI answer messages from your contact forms first/ });
  // Lisa's setting: not in Homer's way until Advanced is opened.
  await expect(formAi).toBeHidden();
  await page.locator("[data-advanced] > summary").click();
  await expect(formAi).not.toBeChecked();
  await expect(page.getByText("it reads no orders: anyone can type an address into a form")).toBeVisible();
  await formAi.check();
  if (process.env.SHOT_FILE) await page.locator("[data-advanced]").screenshot({ path: process.env.SHOT_FILE });
  await page.getByRole("button", { name: "Save", exact: true }).click();

  const sql = testDb();
  try {
    await expect.poll(async () => (await sql`select form_ai from commerce.support_settings where store_id = ${storeId}`)[0]?.form_ai).toBe(true);
  } finally {
    await sql.end();
  }
});
