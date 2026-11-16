import { writeFileSync } from "node:fs";

import { expect, test } from "@playwright/test";
import type { Browser as CoreBrowser } from "playwright-core";

import { shootMap } from "../../src/lib/map-shoot";
import { testDb } from "../db";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Heatmaps as the owner and a Read-only member meet them (D656 step 7). The test store's front page gets a month of seeded totals and a
 * picture row measured from the real page, so the hub ranks it and its map draws; only a member who may write asks for a new picture.
 * With `HEATMAP_SHOTS` set to a folder (a local run with a storage stand-in) it also keeps screenshots of the screens and the picture.
 */

const PAGE = "/no";
const shots = process.env.HEATMAP_SHOTS;

test.beforeAll(async ({ browser, baseURL }) => {
  const { picture, layout } = await shootMap(browser as unknown as CoreBrowser, `${baseURL}/s/${E2E_STORE}`, { width: 390, height: 844, mobile: true }, []);
  if (shots) writeFileSync(`${shots}/picture.jpg`, picture);
  const sql = testDb();
  try {
    const [store] = await sql`update commerce.stores set heatmaps = true where slug = ${E2E_STORE} returning id`;
    const id = String(store.id);
    await sql`delete from commerce.page_heat_days where store_id = ${id}`;
    await sql`delete from commerce.click_cells where store_id = ${id}`;
    await sql`delete from commerce.page_map_shots where store_id = ${id}`;
    const today = new Date().toISOString().slice(0, 10);
    const zeros = (n: number) => new Array<number>(n).fill(0);
    // 120 phone views over the month's last day: reach falling off down the page, attention near the top.
    const reach = zeros(21).map((_, b) => (b === 20 ? 30 : b >= 4 ? 6 : 3));
    const attention = zeros(20).map((_, b) => Math.round(120 * 4000 / (b + 1)));
    for (const [page, device, views, frustrated] of [[PAGE, "mobile", 120, 18], [PAGE, "desktop", 40, 2], ["/no/p/demo-krus", "mobile", 60, 21], ["/no/om-oss", "mobile", 35, 0]] as const) {
      await sql`
        insert into commerce.page_heat_days (store_id, day, page, device, views, reach, fold_sum, attention_ms, att_height_sum, clicks, dead_clicks, rage_clicks, dead_views, rage_views, frustrated_views)
        values (${id}, ${today}, ${page}, ${device}, ${views}, ${sql.array(device === "mobile" && page === PAGE ? reach : zeros(21).map((_, b) => (b === 20 ? views : 0)))}::int[], ${views * 350},
          ${sql.array(attention)}::bigint[], ${views * 2600}, ${views * 3}, ${frustrated}, 4, ${frustrated}, 4, ${frustrated})`;
    }
    // Clicks on the parts the page has, most on the first ones.
    const anchors = Object.keys(layout.anchors).filter((a) => a !== "@body").slice(0, 12);
    for (const [i, anchor] of anchors.entries()) {
      for (const [cx, cy, clicks] of [[5, 5, 40 - i * 3], [2, 4, 12], [8, 6, 6]] as const) {
        if (clicks <= 0) continue;
        await sql`
          insert into commerce.click_cells (store_id, day, page, device, anchor, cx, cy, clicks, dead, rage)
          values (${id}, ${today}, ${PAGE}, 'mobile', ${anchor}, ${cx}, ${cy}, ${clicks}, ${i === 1 ? 9 : 0}, ${i === 2 ? 4 : 0})`;
      }
    }
    await sql`
      insert into commerce.page_map_shots (store_id, page, device, status, shot_at, width, height, layout)
      values (${id}, ${PAGE}, 'mobile', 'done', now(), 390, ${Math.max(844, Math.min(layout.h, 10_000))}, ${sql.json(layout)})`;
  } finally {
    await sql.end();
  }
});

test.describe("as the owner", () => {
  test.use({ storageState: OWNER.state });

  test("ranks the pages where visitors get stuck and opens a page's map in its three views", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/analytics/heatmaps`);
    await expect(page.getByRole("heading", { name: "Heatmaps", level: 1 })).toBeVisible();
    const stuck = page.locator("section", { has: page.getByRole("heading", { name: "Where visitors get stuck" }) });
    // 35 % of the product page's visitors got stuck, 15 % of the front page's (both devices together).
    await expect(stuck.getByRole("listitem").first()).toContainText("/p/demo-krus");
    if (shots) await page.screenshot({ path: `${shots}/hub-computer.png`, fullPage: true });

    await page.goto(`/admin/${E2E_STORE}/analytics/heatmaps?page=${encodeURIComponent(PAGE)}`);
    await expect(page.getByRole("heading", { name: "Front page", level: 1 })).toBeVisible();
    // The device with the most views is chosen by itself.
    await expect(page.getByRole("navigation", { name: "Device" }).getByRole("link", { name: /Phone/ })).toHaveAttribute("aria-current", "true");
    await expect(page.getByRole("table", { name: "Parts clicked most" })).toBeVisible();
    await page.locator("details", { hasText: "Figures from" }).locator("summary").click();
    await expect(page.getByRole("button", { name: "Take a new picture" })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/click-computer.png`, fullPage: true });

    await page.getByRole("link", { name: "How far people scroll" }).click();
    await expect(page.getByRole("table", { name: "How far people got" })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/scroll-computer.png`, fullPage: true });
    await page.getByRole("link", { name: "Where people look" }).click();
    await expect(page.getByRole("table", { name: "Where people look most" })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/look-computer.png`, fullPage: true });

    if (shots) {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/admin/${E2E_STORE}/analytics/heatmaps`);
      await expect(page.getByRole("heading", { name: "Heatmaps", level: 1 })).toBeVisible();
      await page.screenshot({ path: `${shots}/hub-phone.png`, fullPage: true });
      for (const view of ["click", "scroll", "look"]) {
        await page.goto(`/admin/${E2E_STORE}/analytics/heatmaps?page=${encodeURIComponent(PAGE)}&view=${view}`);
        await expect(page.getByRole("heading", { name: "Front page", level: 1 })).toBeVisible();
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${shots}/${view}-phone.png`, fullPage: true });
      }
    }
  });
});

test.describe("as a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("reads the map but is not offered a new picture", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/analytics/heatmaps?page=${encodeURIComponent(PAGE)}`);
    await expect(page.getByRole("heading", { name: "Front page", level: 1 })).toBeVisible();
    await page.locator("details", { hasText: "Figures from" }).locator("summary").click();
    await expect(page.getByRole("button", { name: "Take a new picture" })).toHaveCount(0);
  });
});
