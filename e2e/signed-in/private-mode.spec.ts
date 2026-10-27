import { expect, test } from "@playwright/test";

import { testDb, testStore } from "../db";
import { OWNER } from "./accounts";

/**
 * Private mode as the owner meets it (wave 7 unit E, D339; row storefront.storefront-password-or-pre-launch-page), in a store of the owner's own:
 * Settings → Private mode makes the store private (in the audit log), sets a password; the store's pages then show visitors the landing page,
 * and *Preview the store* lets the owner in without the password; opening it to everyone again shows the pages.
 */

test.use({ storageState: OWNER.state });
test.describe.configure({ mode: "serial" });

let store = { slug: "", id: "" };

test.beforeAll(async () => {
  store = await testStore("privat-eier");
  const sql = testDb();
  try {
    await sql`update commerce.stores set setup_completed_at = now() where id = ${store.id}`;
    await sql`
      insert into commerce.store_members (store_id, account_id, role, kind)
      select ${store.id}, a.id, 'owner', 'staff' from commerce.accounts a where lower(a.email) = ${OWNER.email}
      on conflict (store_id, account_id) do update set role = 'owner'`;
  } finally {
    await sql.end();
  }
});

test("the owner makes the store private with a password, and the change is audited", async ({ page }) => {
  await page.goto(`/admin/${store.slug}/settings/private`);
  await page.getByRole("button", { name: "Make the store private" }).click();
  await expect(page.getByText("The store is private.").first()).toBeVisible({ timeout: 30_000 });
  await page.getByLabel("New password").fill("for venner");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(page.getByText(/Password saved/).first()).toBeVisible({ timeout: 30_000 });
  const sql = testDb();
  try {
    const rows = await sql`select action from commerce.audit_log where store_id = ${store.id} and action like 'store.private_%' order by created_at`;
    expect(rows.map((r) => r.action)).toEqual(["store.private_mode", "store.private_password"]);
  } finally {
    await sql.end();
  }
});

test("visitors see the landing page; the owner's preview lets them in without the password", async ({ page, browser }) => {
  const visitor = await browser.newContext();
  try {
    const stranger = await visitor.newPage();
    await expect(async () => {
      await stranger.goto(`/s/${store.slug}/products`);
      await expect(stranger.locator("[data-private-landing]")).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  } finally {
    await visitor.close();
  }
  await page.goto(`/admin/${store.slug}/settings/private`);
  await page.locator("[data-private-preview]").click();
  await expect(page).toHaveURL(new RegExp(`/s/${store.slug}`));
  await expect(page.locator("[data-private-landing]")).toHaveCount(0);
});

test("opening the store to everyone shows its pages to visitors again", async ({ page, browser }) => {
  await page.goto(`/admin/${store.slug}/settings/private`);
  await page.getByRole("button", { name: "Open the store to everyone" }).click();
  await expect(page.getByText("The store is open to everyone.").first()).toBeVisible({ timeout: 30_000 });
  const visitor = await browser.newContext();
  try {
    const stranger = await visitor.newPage();
    await expect(async () => {
      await stranger.goto(`/s/${store.slug}/products`);
      await expect(stranger.locator("[data-private-landing]")).toHaveCount(0, { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
  } finally {
    await visitor.close();
  }
});
