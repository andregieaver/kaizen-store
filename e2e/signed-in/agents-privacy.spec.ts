import { expect, test } from "@playwright/test";

import { testDb } from "../db";
import { E2E_STORE, OWNER } from "./accounts";

/**
 * The DPIA's findings as the store's owner meets them (wave 11 unit L, D391): how long the AI manager's conversations are kept, chosen on
 * Settings → AI and saved, and the support settings page saying which AI uses of customers' messages are on and that customers are told.
 */
test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

let storeId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`select id from commerce.stores where slug = ${E2E_STORE}`;
    storeId = String(store.id);
    await sql`
      insert into commerce.support_settings (store_id, mode, tone_on, summaries_on, partner) values (${storeId}, 'people', true, true, false)
      on conflict (store_id) do update set mode = 'people', tone_on = true, summaries_on = true`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.stores set assistant_keep_months = null where id = ${storeId}`;
  } finally {
    await sql.end();
  }
});

test("the owner chooses how long the AI manager's conversations are kept", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/settings/ai`);
  const card = page.locator("section", { has: page.getByRole("heading", { name: "AI manager conversations" }) });
  await expect(card).toContainText("deleted 12 months after they were written");
  await card.getByLabel("Keep for (months)").fill("6");
  await card.getByRole("button", { name: "Save" }).click();
  await expect(card.getByText("Saved. The AI manager's conversations are kept 6 months.")).toBeVisible();

  const sql = testDb();
  try {
    const [row] = await sql`select assistant_keep_months from commerce.stores where id = ${storeId}`;
    expect(row.assistant_keep_months).toBe(6);
  } finally {
    await sql.end();
  }

  // A period outside the limits is refused by the browser's own check before anything is sent.
  await card.getByLabel("Keep for (months)").fill("90");
  await card.getByRole("button", { name: "Save" }).click();
  expect(await card.getByLabel("Keep for (months)").evaluate((el) => (el as HTMLInputElement).validity.valid)).toBe(false);
});

test("the support settings say which AI uses of customers' messages are on and that customers are told", async ({ page }) => {
  await page.goto(`/admin/${E2E_STORE}/support/settings`);
  const note = page.locator("[data-ai-use]");
  await expect(note).toContainText("tone of customers' messages read by AI and AI summaries");
  await expect(note).toContainText("Customers are told so in the chat's notice");
  await expect(page.getByText("the chat's notice tells customers that an AI reads the tone of their messages")).toBeVisible();
});
