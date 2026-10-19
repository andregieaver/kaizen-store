import { expect, test } from "@playwright/test";

import { LAUNCH_THEMES } from "../../src/lib/launch-themes";
import { demoStoreOf, testDb } from "../db";
import { ADMIN } from "./accounts";

/**
 * The theme store's own pages (D285), as the platform admin builds them: Themes is a section of the rail beneath Website, and its page
 * offers the list of themes and a theme's page to build in the page builder, apart from Kaizena Flow's other pages. Each starts as a draft
 * that looks like the standard page; published, the site draws it with the themes in its theme store components, and Unpublish brings the
 * standard page back.
 */

test.use({ storageState: ADMIN.state });

const SLUG = `e2e-store-page-${Date.now().toString(36)}`;
let presetId = "";
let demo: Awaited<ReturnType<typeof demoStoreOf>>;

test.beforeAll(async () => {
  // A pack no other signed-in spec takes, so they never race for it.
  demo = await demoStoreOf("fashion");
  const sql = testDb();
  try {
    // Nothing built for the places yet: the standard pages show.
    await sql`delete from commerce.pages where id in (select page_id from commerce.platform_page_roles where role in ('themes', 'theme'))`;
    const snapshot = LAUNCH_THEMES[0].snapshot;
    const [theme] = await sql`
      insert into commerce.design_presets (title, summary, snapshot, published, published_at, slug, listing)
      values ('E2E Store Page', 'Built around.', ${sql.json(snapshot as never)}, true, now(), ${SLUG}, ${sql.json({ kinds: [], styles: [], pictures: [] })})
      returning id`;
    presetId = String(theme.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${presetId}, 1, ${sql.json(snapshot as never)})`;
  } finally {
    await sql.end();
  }
  await demo.linkTo(presetId);
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    // The pages it made go with their places.
    await sql`delete from commerce.pages where id in (select page_id from commerce.platform_page_roles where role in ('themes', 'theme'))`;
    if (presetId) await sql`update commerce.design_presets set published = false, slug = null where id = ${presetId}`;
  } finally {
    await sql.end();
  }
  await demo.putAway();
});

test("Themes is its own section beneath Website, and builds the theme's page in the page builder (D285)", async ({ page }) => {
  await page.goto("/admin/platform");
  const rail = page.getByRole("navigation", { name: "Platform sections" });
  // The rail is read once it is drawn, not while the page still streams in.
  await expect(rail.getByRole("link", { name: "Website" })).toBeVisible();
  const names = await rail.getByRole("link").evaluateAll((links) => links.map((link) => link.getAttribute("aria-label") ?? ""));
  expect(names[names.indexOf("Website") + 1]).toBe("Themes");
  await rail.getByRole("link", { name: "Themes" }).click();
  await expect(page).toHaveURL(/\/admin\/platform\/themes$/);

  const card = page.getByRole("region", { name: "The theme store's pages" });
  await expect(card.getByText("The standard theme page shows")).toBeVisible();
  await card.getByRole("button", { name: /^Build it in the page builder\s+for a theme's page$/ }).click();
  await expect(page).toHaveURL(/\/admin\/platform\/themes\/pages\/[0-9a-f-]{36}$/);
  const editor = page.url();

  // The theme's parts are in the palette, and the starter holds them; until published, the standard page shows.
  await page.getByRole("tab", { name: "Components" }).click();
  await expect(page.getByText("Theme store", { exact: true }).first()).toBeVisible();
  const before = await page.request.get(`/themes/${SLUG}`);
  expect(before.status()).toBe(200);
  await page.getByRole("button", { name: /^Publish/ }).click();
  await expect(page.getByText(/Published|Taken off the site|Saved/).first()).toBeVisible();

  // Not among Kaizena Flow's other pages: its old address there leads back to Themes' editor.
  await page.goto("/admin/platform/pages");
  await expect(page.getByRole("link", { name: "A theme's page" })).toHaveCount(0);
  await page.goto(editor.replace("/themes/pages/", "/pages/"));
  await expect(page).toHaveURL(editor);

  // The site draws the built page with this theme in its components.
  await page.goto(`/themes/${SLUG}`);
  await expect(page.getByRole("heading", { level: 1, name: "E2E Store Page" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What you get" })).toBeVisible();

  await page.goto("/admin/platform/themes");
  await expect(page.getByRole("region", { name: "The theme store's pages" }).getByText("Live", { exact: true })).toBeVisible();
});
