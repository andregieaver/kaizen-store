import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/**
 * Heatmaps in the browser (D656, `docs/heatmaps-and-recordings.md` step 4): on a store with heatmaps on, a visitor who allowed statistics
 * against a banner that named heatmaps sends a summary of the page view when they leave it, and a click on text that does nothing is
 * counted as dead, on the part it fell in. Without that consent nothing is sent.
 */

type Row = Record<string, unknown>;
const BLOCK = randomUUID();
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

// Headless Chromium names itself in its user agent, which the server counts as a robot and never measures.
const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
test.use({ userAgent: BROWSER });

let path = "";
let storeId = "";
let slug = "";

test.beforeAll(async () => {
  path = await storePageWith("heat", [{ id: BLOCK, type: "heading", text: "Nothing happens when you press this", level: 2 }, { id: randomUUID(), type: "richText", doc: doc("A paragraph.") }]);
  slug = path.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`update commerce.stores set heatmaps = true, private_mode = false where slug = ${slug} returning id`;
    storeId = String(store.id);
  } finally {
    await sql.end();
  }
});

const rows = async (table: "page_heat_days" | "click_cells") => {
  const sql = testDb();
  try {
    return (await sql.unsafe(`select * from commerce.${table} where store_id = $1 and tag = ''`, [storeId])) as unknown as Row[];
  } finally {
    await sql.end();
  }
};

const allow = (page: Page, version: string, bits: string) =>
  page.context().addCookies([{ name: `consent_${storeId}`, value: `1.${randomUUID()}.${version}.${bits}`, domain: "localhost", path: "/" }]);

/** Opens the page and waits for the signals, which load once the browser is idle. */
const open = async (page: Page) => {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
};

test("a view's summary and a dead click reach the day's totals", async ({ page }) => {
  await allow(page, "statistics+heat", "010");
  await open(page);
  await page.getByRole("heading", { name: "Nothing happens when you press this" }).click();
  // The verdict comes 2.5 s after the click.
  await page.waitForTimeout(3200);
  // Closing the tab sends its summary. (Headless Chromium does not deliver a beacon sent while it navigates to another page, as
  // `performance.spec.ts` says; a browser sends on either.)
  await page.close();
  await expect.poll(async () => (await rows("page_heat_days")).length, { timeout: 10_000 }).toBe(1);
  const [day] = await rows("page_heat_days");
  expect(day).toMatchObject({ page: "/no/side", views: 1, dead_views: 1 });
  expect(Number(day.dead_clicks)).toBeGreaterThanOrEqual(1);
  const cells = await rows("click_cells");
  expect(cells.some((c) => c.anchor === BLOCK && Number(c.dead) >= 1)).toBe(true);
});

test("sends nothing without consent that named heatmaps", async ({ page }) => {
  await allow(page, "statistics", "010");
  const heat: string[] = [];
  page.on("request", (r) => {
    if (r.url().endsWith("/api/signals/heat")) heat.push(r.url());
  });
  await open(page);
  await page.goto("about:blank");
  await page.waitForTimeout(500);
  expect(heat).toEqual([]);
});

test("sends nothing under Global Privacy Control, or on the cart", async ({ browser }) => {
  const context = await browser.newContext({ userAgent: BROWSER, extraHTTPHeaders: { "Sec-GPC": "1" } });
  await context.addInitScript(() => Object.defineProperty(navigator, "globalPrivacyControl", { get: () => true }));
  const page = await context.newPage();
  await allow(page, "statistics+heat", "010");
  const heat: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/signals/")) heat.push(r.url());
  });
  await open(page);
  await page.goto("about:blank");
  await page.waitForTimeout(500);
  expect(heat).toEqual([]);
  await context.close();

  const shopper = await browser.newPage({ userAgent: BROWSER });
  await allow(shopper, "statistics+heat", "010");
  const onCart: string[] = [];
  shopper.on("request", (r) => {
    if (r.url().includes("/api/signals/")) onCart.push(r.url());
  });
  await shopper.goto(`/s/${slug}/cart`);
  await shopper.waitForLoadState("networkidle");
  await shopper.waitForTimeout(1500);
  await shopper.goto("about:blank");
  await shopper.waitForTimeout(500);
  expect(onCart).toEqual([]);
  await shopper.close();
});

test("a visitor who withdraws statistics sends nothing more, not even the view's summary", async ({ page }) => {
  await allow(page, "statistics+heat", "010");
  const heat: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/signals/")) heat.push(r.url());
  });
  await open(page);
  // What the banner does on a withdrawal: the cookie without statistics, then the event, before it reloads.
  await page.evaluate((name) => {
    document.cookie = `${name}=1.11111111-1111-4111-8111-111111111111.statistics+heat.000; Path=/`;
    window.dispatchEvent(new Event("kaizen:consent-changed"));
  }, `consent_${storeId}`);
  await page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.waitForTimeout(500);
  expect(heat).toEqual([]);
});
