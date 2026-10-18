import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { demoStoreOf, testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * One concept, themes (D273, `docs/themes-unified.md`), as the platform admin sees it: design profiles' and store templates' old addresses
 * land on the Themes page, which holds the starting content; the Stores section offers Themes alone and the Website section the site's
 * Design; a theme's Content tab gives it content of its own and publishes it (D275). `design-presets.int.test.ts` holds that a new store
 * starts from the theme's own content (`contentForLook()`).
 */

test.use({ storageState: ADMIN.state });

let presetId = "";
let source: Awaited<ReturnType<typeof demoStoreOf>>;

test.beforeAll(async () => {
  // Published content to copy from, as the starting content is.
  source = await demoStoreOf("home");
  const sql = testDb();
  try {
    const snapshot = LAUNCH_THEMES[0].snapshot;
    const [theme] = await sql`
      insert into commerce.design_presets (title, summary, snapshot, published, published_at)
      values ('E2E Unified', 'One concept.', ${sql.json(snapshot as never)}, true, now()) returning id`;
    presetId = String(theme.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${presetId}, 1, ${sql.json(snapshot as never)})`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.design_presets set published = false where id = ${presetId}`;
    await sql`update commerce.store_starters set design_preset_id = null, published = false where design_preset_id = ${presetId}`;
  } finally {
    await sql.end();
  }
  await source.putAway();
});

test("the old pages land on the Themes page, which holds the starting content, and the menus name themes only", async ({ page }) => {
  for (const old of ["/admin/platform/store-templates", "/admin/platform/design-profiles"]) {
    await page.goto(old);
    await expect(page, old).toHaveURL(/\/admin\/platform\/themes$/);
  }
  await page.goto(`/admin/platform/design-profiles/${presetId}`);
  await expect(page).toHaveURL(new RegExp(`/admin/platform/themes/${presetId}$`));

  await page.goto("/admin/platform/themes");
  await expect(page.getByRole("heading", { level: 1, name: "Themes" })).toBeVisible();
  const starting = page.getByRole("region", { name: "Starting content" });
  await expect(starting).toBeVisible();
  await expect(starting.getByRole("list", { name: "Starting content" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByText(/store template|design profile/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Store templates" })).toHaveCount(0);

  await page.goto("/admin/platform/website");
  await expect(page.getByRole("link", { name: "Design" }).first()).toBeVisible();
});

test("a theme's Content tab gives it a copy of published content and publishes it (D275)", async ({ page }) => {
  await page.goto(`/admin/platform/themes/${presetId}/content`);
  await expect(page.getByText("has no content yet")).toBeVisible();
  const give = page.getByRole("region", { name: "Give it content" });
  await give.getByRole("combobox", { name: "Copy from" }).selectOption(source.starter);
  await give.getByRole("button", { name: "Use this content" }).click();
  await expect(page.getByText("Copied. Edit it in its store admin")).toBeVisible();
  await expect(page.getByText("Not published yet")).toBeVisible();
  await page.getByRole("button", { name: "Publish the content" }).click();
  await expect(page.getByText("Published. The theme store, its photographs and new stores use this content now.")).toBeVisible();
  const sql = testDb();
  try {
    const [row] = await sql`select published, pack_key from commerce.store_starters where design_preset_id = ${presetId}`;
    expect(row).toMatchObject({ published: true, pack_key: null });
  } finally {
    await sql.end();
  }
  await expect(page.getByText(/store template|design profile/i)).toHaveCount(0);
});
