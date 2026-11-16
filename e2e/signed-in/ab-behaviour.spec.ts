import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Behaviour per version on an A/B test's page (D656 step 12). A running test of the about page is seeded with a version that meets far more
 * rage clicks, as tagged heatmap totals: the owner is warned above the details, reads each version's figures and is offered its heatmap and
 * recordings; a Read-only member reads the figures without the recordings. The test ends discarded afterwards. With `HEATMAP_SHOTS` set it keeps
 * a screenshot of the section.
 */

const shots = process.env.HEATMAP_SHOTS;
const EXP = randomUUID();
let storeId = "";

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`update commerce.stores set heatmaps = true where slug = ${E2E_STORE} returning id`;
    storeId = String(store.id);
    const [page] = await sql`select id, published from commerce.pages where store_id = ${storeId} and slug = 'om-oss' and type = 'page'`;
    const slug = `ab-${EXP.slice(0, 8)}-b`;
    const [copy] = await sql`
      insert into commerce.pages (store_id, slug, draft, published, published_at, type)
      values (${storeId}, ${slug}, ${sql.json({ ...page.published, slug })}, ${sql.json({ ...page.published, slug })}, now(), 'variant') returning id`;
    await sql`insert into commerce.experiments (id, store_id, name, target_page_id, primary_goal) values (${EXP}, ${storeId}, 'Shorter story', ${page.id}, 'orders')`;
    await sql`
      insert into commerce.experiment_variants (store_id, experiment_id, key, name, page_id, share)
      values (${storeId}, ${EXP}, 'a', 'Original', null, 0.5), (${storeId}, ${EXP}, 'b', 'Version B', ${copy.id}, 0.5)`;
    await sql`update commerce.experiments set status = 'running', started_at = now() - interval '9 days' where id = ${EXP}`;
    const day = new Date().toISOString().slice(0, 10);
    for (const [version, views, half, rage, dead] of [["a", 2600, 1500, 52, 130], ["b", 2550, 1100, 230, 160]] as const) {
      const reach = new Array<number>(21).fill(0);
      reach[20] = half;
      reach[4] = views - half;
      await sql`
        insert into commerce.page_heat_days (store_id, day, page, device, tag, views, reach, fold_sum, attention_ms, att_height_sum, clicks, dead_clicks, rage_clicks, dead_views, rage_views, frustrated_views)
        values (${storeId}, ${day}, '/no/om-oss', 'mobile', ${`${EXP}:${version}`}, ${views}, ${sql.array(reach)}::int[], 0, ${sql.array(new Array<number>(20).fill(0))}::bigint[], 0, ${views}, ${dead}, ${rage}, ${dead}, ${rage}, ${rage + dead})`;
    }
  } finally {
    await sql.end();
  }
});

test.afterAll(async () => {
  const sql = testDb();
  try {
    await sql`delete from commerce.page_heat_days where store_id = ${storeId} and tag like ${`${EXP}:%`}`;
    // A test that has run is kept (a rule of the database): it ends discarded, so no running test is left on the page.
    await sql`update commerce.experiments set status = 'stopped', stopped_at = now() where id = ${EXP} and status = 'running'`;
    await sql`update commerce.experiments set status = 'discarded' where id = ${EXP}`;
  } finally {
    await sql.end();
  }
});

test.describe("as the owner", () => {
  test.use({ storageState: OWNER.state });

  test("is warned of the version with more rage clicks and offered its heatmap and recordings", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/experiments/${EXP}`);
    await expect(page.getByText("Version B gets clearly more rage or dead clicks than the original.")).toBeVisible();
    await page.goto(`/admin/${E2E_STORE}/experiments/${EXP}#ab-behaviour`);
    const section = page.locator("#ab-behaviour");
    await expect(section.getByRole("heading", { name: "How visitors behaved" })).toBeVisible();
    const b = section.locator('tr[data-version="b"]');
    await expect(b).toContainText("9 %");
    await expect(b.getByRole("link", { name: "Recordings" })).toHaveAttribute("href", `/admin/${E2E_STORE}/analytics/recordings?tag=${encodeURIComponent(`${EXP}:b`)}`);
    if (shots) {
      await section.scrollIntoViewIfNeeded();
      await section.screenshot({ path: `${shots}/ab-behaviour.png` });
      await page.screenshot({ path: `${shots}/ab-test-page.png`, fullPage: true });
    }
    // The heatmap opens on that version, with its chip chosen.
    await b.getByRole("link", { name: "Heatmap" }).click();
    await expect(page.getByRole("navigation", { name: "A/B test version" }).getByRole("link", { name: "Shorter story: Version B" })).toHaveAttribute("aria-current", "true");
  });
});

test.describe("as a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("reads the figures without the recordings", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/experiments/${EXP}#ab-behaviour`);
    const section = page.locator("#ab-behaviour");
    await expect(section.getByRole("heading", { name: "How visitors behaved" })).toBeVisible();
    await expect(section.getByRole("link", { name: "Recordings" })).toHaveCount(0);
  });
});
