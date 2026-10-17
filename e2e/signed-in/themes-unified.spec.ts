import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * One concept, themes (D273, `docs/themes-unified.md`), as the platform admin sees it: design profiles' and store templates' old addresses
 * land on the Themes page, which holds the demo stores; the Stores section offers Themes alone and the Website section the site's Design; a
 * theme's page chooses the demo store each look starts new stores from, saved at once. `design-presets.int.test.ts` holds that a new store
 * starts from the look's demo store (`demoStoreForLook()`).
 */

test.use({ storageState: ADMIN.state });

let presetId = "";

test.beforeAll(async () => {
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
  } finally {
    await sql.end();
  }
});

test("the old pages land on the Themes page, which holds the demo stores, and the menus name themes only", async ({ page }) => {
  for (const old of ["/admin/platform/store-templates", "/admin/platform/design-profiles"]) {
    await page.goto(old);
    await expect(page, old).toHaveURL(/\/admin\/platform\/themes$/);
  }
  await page.goto(`/admin/platform/design-profiles/${presetId}`);
  await expect(page).toHaveURL(new RegExp(`/admin/platform/themes/${presetId}$`));

  await page.goto("/admin/platform/themes");
  await expect(page.getByRole("heading", { level: 1, name: "Themes" })).toBeVisible();
  const demo = page.getByRole("region", { name: "Demo stores" });
  await expect(demo).toBeVisible();
  await expect(demo.getByRole("list", { name: "Demo stores" }).getByRole("listitem").first()).toBeVisible();
  await expect(page.getByText(/store template|design profile/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Store templates" })).toHaveCount(0);

  await page.goto("/admin/platform/website");
  await expect(page.getByRole("link", { name: "Design" }).first()).toBeVisible();
});

test("a theme's page chooses the demo store each look starts new stores from", async ({ page }) => {
  await page.goto(`/admin/platform/themes/${presetId}`);
  const demo = page.getByRole("region", { name: "Demo stores" });
  await expect(demo).toBeVisible();
  await demo.getByRole("combobox", { name: "E2E Unified (its own look)" }).selectOption("fashion");
  await demo.getByRole("button", { name: "Save the demo stores" }).click();
  await expect(page.getByText("Saved. New stores started from these looks begin with their demo store")).toBeVisible();
  const sql = testDb();
  try {
    const [row] = await sql`select listing from commerce.design_presets where id = ${presetId}`;
    expect(row.listing).toMatchObject({ pack: "fashion" });
  } finally {
    await sql.end();
  }
  await expect(page.getByText(/store template|design profile/i)).toHaveCount(0);
});
