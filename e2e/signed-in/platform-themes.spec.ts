import { type Browser, expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * Kaizena Flow's own site on themes (D251 to D253, `docs/theme-phase-4.md`), as its platform admin sees it, signed in with the second step:
 * a published theme is added to the site's library without going live, opened, its CSS saved into it while the live look stays, previewed
 * on Kaizena Flow's own pages, switched to and back, and removed, with Kaizena Flow's pages and menus the same throughout. The server side is
 * held by platform-theme-installs.int.test.ts and platform-theme-updates.int.test.ts.
 */

test.use({ storageState: ADMIN.state });

const LAUNCH = LAUNCH_THEMES[0];
const TITLE = "E2E platform theme";
const CSS = ".e2e-platform { outline: 1px solid #123456; }";
let presetId = "";

/** Kaizena Flow's look columns, and a fingerprint of everything of its site that is not its look. */
async function siteNow() {
  const sql = testDb();
  try {
    const [row] = await sql`
      select s.theme, s.fonts, s.custom_css, s.header_id, s.footer_id,
        md5(coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'slug', p.slug, 'draft', p.draft, 'published', p.published) order by p.id)
                        from commerce.pages p where p.store_id is null and p.type in ('page', 'article')), '[]')::text) as pages,
        md5(coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'items', m.items) order by m.id) from commerce.menus m where m.store_id is null), '[]')::text) as menus
      from commerce.platform_settings s
    `;
    return row;
  } finally {
    await sql.end();
  }
}

const customLive = async () => {
  const sql = testDb();
  try {
    const [custom] = await sql`select live from commerce.platform_theme_installs where preset_id is null`;
    return Boolean(custom?.live);
  } finally {
    await sql.end();
  }
};

/** A run that stopped half-way may leave the site wearing the test's theme: it is switched back the way an admin would. */
async function backToCustom(browser: Browser) {
  if (await customLive()) return;
  const context = await browser.newContext({ storageState: ADMIN.state });
  try {
    const page = await context.newPage();
    await page.goto("/admin/platform/themes");
    await page.getByRole("button", { name: "Switch to it (Custom)" }).click();
    await expect.poll(customLive).toBe(true);
  } finally {
    await context.close();
  }
}

test.beforeAll(async ({ browser }) => {
  await backToCustom(browser);
  const sql = testDb();
  try {
    // The test's theme and installs from an earlier run gone.
    await sql`delete from commerce.platform_theme_installs where title = ${TITLE} and not live`;
    // Versions are never deleted: a theme left by an earlier run is archived, so only this run's is offered.
    await sql`update commerce.design_presets set published = false, archived_at = now() where title = ${TITLE} and archived_at is null`;
    const snapshot = { ...LAUNCH.snapshot, header: null, footer: null, productLayout: null };
    const [preset] = await sql`
      insert into commerce.design_presets (title, snapshot, published) values (${TITLE}, ${sql.json(snapshot)}, true) returning id`;
    presetId = String(preset.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${presetId}, 1, ${sql.json(snapshot)})`;
    // The theme's fonts are on the platform already: nothing is fetched from Google in a test.
    for (const family of Object.values(LAUNCH.snapshot.theme.settings.fonts).filter((f): f is string => Boolean(f))) {
      await sql`insert into commerce.fonts (family, slug, category, css, bytes) values (${family}, ${family.toLowerCase().replace(/\s+/g, "-")}, 'sans-serif', '', 0) on conflict (family) do nothing`;
    }
  } finally {
    await sql.end();
  }
});

test.afterAll(async ({ browser }) => {
  await backToCustom(browser);
  const sql = testDb();
  try {
    await sql`delete from commerce.platform_theme_installs where preset_id = ${presetId} and not live`;
    await sql`update commerce.design_presets set published = false, archived_at = now() where id = ${presetId}`;
  } finally {
    await sql.end();
  }
});

test("the platform admin adds a theme, customises and previews it, switches to it and back, and removes it", async ({ page }) => {
  const before = await siteNow();

  // Added without going live.
  await page.goto("/admin/platform/themes");
  await expect(page.getByRole("heading", { level: 1, name: "Themes" })).toBeVisible();
  await page.getByRole("button", { name: `Add (${TITLE})` }).click();
  const installed = page.getByRole("list", { name: "Installed themes" });
  await expect(installed.getByRole("button", { name: `Remove ${TITLE}` })).toBeVisible();
  expect(await siteNow()).toEqual(before);

  // Opened, its own CSS saved into it while the live look stays.
  await page.getByRole("link", { name: `Preview and customise ${TITLE}` }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Customise “${TITLE}”` })).toBeVisible();
  await expect(page.getByText("Installed, not live")).toBeVisible();
  const installId = page.url().split("/").at(-1) ?? "";
  await page.getByRole("textbox", { name: "CSS" }).fill(CSS);
  await page.getByRole("button", { name: "Save CSS" }).click();
  await expect(page.getByText("Saved in this theme.")).toBeVisible();
  expect(await siteNow()).toEqual(before);

  // Previewed on Kaizena Flow's own pages, inert and not for search engines.
  await page.goto(`/admin/platform/themes/${installId}/preview`);
  await expect(page.getByRole("status").getByText(`Preview of “${TITLE}”`)).toBeVisible();
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  expect(await page.locator("[inert][data-theme-preview]").count()).toBe(1);

  // Switched to: the site wears the theme's look and its CSS; pages and menus stay.
  await page.goto("/admin/platform/themes");
  await page.getByRole("button", { name: `Switch to it (${TITLE})` }).click();
  await expect(installed.getByRole("listitem").filter({ hasText: TITLE })).toContainText("Live");
  await expect.poll(async () => (await siteNow()).custom_css).toBe(CSS);
  const worn = await siteNow();
  expect(worn.custom_css).toBe(CSS);
  expect((worn.theme as { settings: { light: { accent: string } } }).settings.light.accent).toBe(LAUNCH.snapshot.theme.settings.light.accent);
  expect({ pages: worn.pages, menus: worn.menus }).toEqual({ pages: before.pages, menus: before.menus });
  await page.goto("/");
  await expect(page.locator("main").first()).toBeVisible();
  expect(await page.content()).toContain("e2e-platform");

  // Switched back to its own look, exactly as it was, and the theme removed.
  await page.goto("/admin/platform/themes");
  await page.getByRole("button", { name: "Switch to it (Custom)" }).click();
  await expect(installed.getByRole("button", { name: `Switch to it (${TITLE})` })).toBeVisible();
  await expect.poll(siteNow).toEqual(before);
  await page.getByRole("button", { name: `Remove ${TITLE}` }).click();
  await expect(installed.getByRole("button", { name: `Remove ${TITLE}` })).toHaveCount(0);
});
