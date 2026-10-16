import { expect, test } from "@playwright/test";
import type { Browser } from "playwright-core";
import sharp from "sharp";

import { designPreviewPath } from "../src/lib/design-presets";
import { LAUNCH_THEMES } from "../src/lib/launch-themes";
import { shootLook } from "../src/lib/theme-shoot";
import { testDb } from "./db";

/**
 * The theme shots' photographer (`docs/theme-showcase-phase-2.md` step 1) against the running site: a published theme's public preview,
 * alone (`embed=1`), photographed at a computer's and a phone's width, at full length and its first screen, its parts measured, and nothing
 * blank. The job runs exactly this in a browser of its own (`src/server/theme-shot-runner.ts`).
 */

let id = "";
const SLUG = `e2e-shots-${Date.now().toString(36)}`;

test.beforeAll(async ({ baseURL }) => {
  const sql = testDb();
  try {
    const snapshot = LAUNCH_THEMES[0].snapshot;
    // With the words of one highlight written (`docs/theme-showcase-phase-2.md` step 2).
    const listing = { kinds: [], styles: [], pictures: [], highlights: { devices: { title: "On every screen", text: "A computer and two phones." } } };
    const [row] = await sql`
      insert into commerce.design_presets (title, summary, snapshot, published, published_at, slug, listing)
      values ('E2E Shots', 'Photographed by the test.', ${sql.json(snapshot as never)}, true, now(), ${SLUG}, ${sql.json(listing)})
      returning id`;
    id = String(row.id);
    await sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${id}, 1, ${sql.json(snapshot as never)})`;
    // Its highlights as the job leaves them, drawn from a public picture of the site's own.
    const [standard] = await sql`select id from commerce.stores where is_template limit 1`;
    const file = (kind: string) => ({ path: `platform/theme-shots/${id}/u/highlights-${kind}.webp`, url: `${baseURL}/demo/themes/calm-v2.webp`, width: 1600, height: 1000, bytes: 1 });
    await sql`
      insert into commerce.theme_shots (preset_id, version, showcase_store_id, kind, status, pictures, finished_at)
      values (${id}, 1, ${String(standard.id)}, 'highlights', 'done', ${sql.json({ devices: file("devices"), collage: file("collage"), closeup: file("closeup") })}, now())`;
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`update commerce.design_presets set published = false, slug = null where id = ${id}`;
  } finally {
    await sql.end();
  }
});

/** Whether a photograph shows something: its pixels differ, so it is not one flat colour. */
async function drawn(png: Buffer): Promise<boolean> {
  const stats = await sharp(png).stats();
  return stats.channels.slice(0, 3).some((channel) => channel.stdev > 6);
}

test("photographs a theme's preview at a computer's width: the whole page and its first screen, with its parts measured", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const shot = await shootLook(browser as unknown as Browser, `${baseURL}${designPreviewPath(id, null, false, false, true)}`, "computer");
  const full = await sharp(shot.full).metadata();
  const screen = await sharp(shot.screen).metadata();
  expect(full.width).toBe(1440);
  expect(full.height).toBe(shot.parts.length);
  expect(shot.parts.length).toBeGreaterThan(900);
  expect([screen.width, screen.height]).toEqual([1440, 900]);
  expect(shot.parts.header?.height ?? 0).toBeGreaterThan(20);
  expect(shot.parts.product?.height ?? 0).toBeGreaterThan(100);
  expect(shot.parts.footer?.height ?? 0).toBeGreaterThan(20);
  expect(await drawn(shot.full)).toBe(true);
  expect(await drawn(shot.screen)).toBe(true);
});

test("photographs it at a phone's width: one pixel per point at full length, twice that on its first screen", async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  const shot = await shootLook(browser as unknown as Browser, `${baseURL}${designPreviewPath(id, null, false, false, true)}`, "phone");
  const full = await sharp(shot.full).metadata();
  const screen = await sharp(shot.screen).metadata();
  expect(full.width).toBe(390);
  expect(screen.width).toBe(780);
  expect(screen.height).toBe(Math.min(844, shot.parts.length) * 2);
  expect(await drawn(shot.screen)).toBe(true);
});

test("refuses a preview that is not there (it streams its not-found page with a 200), as the job then tries again later", async ({ browser, baseURL }) => {
  await expect(shootLook(browser as unknown as Browser, `${baseURL}${designPreviewPath("00000000-0000-4000-8000-000000000000", null, false, false, true)}`, "computer")).rejects.toThrow(
    /did not show the theme/,
  );
});

test("a theme's page shows its highlights, each with its words where written", async ({ page }) => {
  await page.goto(`/themes/${SLUG}`);
  const highlights = page.getByRole("region", { name: "Highlights" });
  await expect(highlights).toBeVisible();
  await expect(highlights.getByRole("img")).toHaveCount(3);
  await expect(highlights.getByRole("img", { name: "E2E Shots: on a computer and two phones" })).toBeVisible();
  await expect(highlights.getByText("On every screen")).toBeVisible();
  await expect(highlights.getByText("A computer and two phones.")).toBeVisible();
  // One without words shows its picture, named for what it shows.
  await expect(highlights.getByRole("img", { name: "E2E Shots: the product page up close" })).toBeVisible();
});
