import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { testDb } from "../db";
import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * *Try it in your store* from the theme store (`docs/theme-phase-3.md` step 2): the owner chooses a store and the theme is added to its
 * theme library without going live (the store's look columns stay as they were), then opens there with *Switch to it*; a member who may not
 * change the website is offered no store; someone signed out is sent to sign in and back.
 */

const SLUG = `e2e-try-${Date.now().toString(36)}`;
const TITLE = "E2E Try Hearth";
let id = "";

const lookOf = async () => {
  const sql = testDb();
  try {
    const [row] = await sql`select md5(jsonb_build_array(theme, custom_css, header_id, footer_id, product_layout_id)::text) as look from commerce.stores where slug = ${E2E_STORE}`;
    return String(row.look);
  } finally {
    await sql.end();
  }
};

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const snapshot = LAUNCH_THEMES[1].snapshot;
    const [row] = await sql`
      insert into commerce.design_presets (title, summary, description, snapshot, published, published_at, slug)
      values (${TITLE}, 'Warm.', 'A theme made by the test.', ${sql.json(snapshot as never)}, true, now(), ${SLUG})
      returning id`;
    id = String(row.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${id}, 1, ${sql.json(snapshot as never)})`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.store_theme_installs where preset_id = ${id} and not live`;
    await sql`update commerce.design_presets set published = false, slug = null where id = ${id}`;
  } finally {
    await sql.end();
  }
});

test.describe("the owner", () => {
  test.use({ storageState: OWNER.state });

  test("adds a theme to a store from the theme store without making it live", async ({ page }) => {
    const before = await lookOf();
    // From the theme's page: the route knows the owner is signed in and sends them on.
    await page.goto(`/themes/${SLUG}/try`);
    await expect(page).toHaveURL(`/admin/account/themes/try/${SLUG}`);
    await expect(page.getByRole("heading", { level: 1, name: `Try ${TITLE} in your store` })).toBeVisible();
    const row = page.getByRole("listitem").filter({ has: page.getByRole("button", { name: /Add to this store/ }) }).first();
    await expect(row).toBeVisible();
    await page.getByRole("button", { name: /Add to this store/ }).first().click();
    await expect(page).toHaveURL(/\/settings\/design\/themes\/[0-9a-f-]{36}\?added=1$/, { timeout: 20_000 });
    await expect(page.getByRole("status").filter({ hasText: `“${TITLE}” is in your theme library, not live` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Switch to “${TITLE}”` })).toBeVisible();
    expect(await lookOf()).toBe(before);

    // Back on the page, the store says it has the theme already.
    await page.goto(`/admin/account/themes/try/${SLUG}`);
    await expect(page.getByText("Already in its themes").first()).toBeVisible();
  });
});

test.describe("a member who may not change the website", () => {
  test.use({ storageState: READER.state });

  test("is offered no store", async ({ page }) => {
    await page.goto(`/admin/account/themes/try/${SLUG}`);
    await expect(page.getByText("None of your stores lets you change its website.")).toBeVisible();
  });
});

test("someone signed out is sent to sign in and back", async ({ page }) => {
  await page.goto(`/themes/${SLUG}/try`);
  await page.waitForURL(/\/admin\/sign-in\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe(`/admin/account/themes/try/${SLUG}`);
});
