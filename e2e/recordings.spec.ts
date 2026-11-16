import { randomUUID } from "node:crypto";
import { gunzipSync } from "node:zlib";

import { expect, test, type Page, type Request } from "@playwright/test";

import { storePageWith, testDb } from "./db";

/**
 * The storefront's recorder of visits (D656, `docs/heatmaps-and-recordings.md` step 9), on a fresh store that records every tab. CI has no
 * Storage, so the test answers the segment route itself and reads what the browser sent: nothing without consent to recordings or from
 * staff, a segment once the visit has lasted and had an interaction, nothing typed (not even its length), no address with a query, and a
 * withdrawal that deletes the tab's recording and stops it.
 */

const BROWSER = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
test.use({ userAgent: BROWSER });

const SECRET = "secret-123";
let path = "";
let slug = "";
let storeId = "";

test.beforeAll(async () => {
  path = await storePageWith("rec", [
    { id: randomUUID(), type: "heading", text: "Recorded page", level: 1 },
    { id: randomUUID(), type: "search", results: false },
    { id: randomUUID(), type: "newsletter", recipients: [`rec-${Date.now()}@example.com`], confirm: false, placeholder: "", submitLabel: "", successMessage: "", consent: "" },
  ]);
  slug = path.split("/")[2];
  const sql = testDb();
  try {
    const [store] = await sql`
      update commerce.stores set recordings = true, recording_share = 100, recordings_confirmed_at = now(), private_mode = false
      where slug = ${slug} returning id`;
    storeId = String(store.id);
  } finally {
    await sql.end();
  }
});

type Sent = { url: URL; text: string };

/** Answers the segment and forget routes itself and keeps what each request carried. */
async function watch(page: Page) {
  const rec: Sent[] = [];
  const forget: Sent[] = [];
  const read = (request: Request): string => {
    const body = request.postDataBuffer();
    if (!body) return "";
    const url = new URL(request.url());
    return url.searchParams.get("z") === "1" ? gunzipSync(body).toString("utf8") : body.toString("utf8");
  };
  await page.route("**/api/signals/rec**", async (route) => {
    rec.push({ url: new URL(route.request().url()), text: read(route.request()) });
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/signals/forget", async (route) => {
    forget.push({ url: new URL(route.request().url()), text: route.request().postData() ?? "" });
    await route.fulfill({ status: 204 });
  });
  return { rec, forget };
}

const allow = (page: Page, version: string, bits: string) =>
  page.context().addCookies([{ name: `consent_${storeId}`, value: `1.${randomUUID()}.${version}.${bits}`, domain: "localhost", path: "/" }]);

/** Opens the page, waits for the signals (loaded once the browser is idle), then acts like a visitor for a while. */
async function visit(page: Page) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await page.mouse.click(10, 300);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(5500);
  await page.mouse.click(20, 320);
}

const hidden = (page: Page) =>
  page.evaluate(() => {
    Object.defineProperty(document, "visibilityState", { get: () => "hidden", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });

test("records nothing without consent to recordings", async ({ page }) => {
  const { rec } = await watch(page);
  await allow(page, "statistics", "010");
  await visit(page);
  await hidden(page);
  await page.waitForTimeout(1000);
  expect(rec).toEqual([]);
});

test("records nothing for staff looking at their own store", async ({ page }) => {
  const { rec } = await watch(page);
  await allow(page, "recordings", "0001");
  await page.context().addCookies([{ name: "sb-test-auth-token", value: "x", domain: "localhost", path: "/" }]);
  await page.addInitScript((s) => localStorage.setItem("kaizen-admin-return", JSON.stringify({ [s]: `/admin/${s}` })), slug);
  await visit(page);
  await hidden(page);
  await page.waitForTimeout(1000);
  expect(rec).toEqual([]);
});

test("sends a segment once the visit has lasted and had an interaction, with nothing typed and no query in an address", async ({ page }) => {
  test.setTimeout(60_000);
  const { rec } = await watch(page);
  await allow(page, "recordings", "0001");
  await visit(page);
  await expect.poll(() => rec.length, { timeout: 20_000 }).toBeGreaterThan(0);
  const first = rec[0];
  expect(first.url.searchParams.get("seq")).toBe("0");
  const id = first.url.searchParams.get("id");
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  const segment = JSON.parse(first.text) as { v: number; meta: { pages: string[] }; events: { type: number; timestamp: number }[] };
  expect(segment.v).toBe(1);
  expect(segment.meta.pages).toEqual([path]);
  expect(segment.events.some((e) => e.type === 2)).toBe(true);
  // Times are relative to the session's start: no clock time leaves the browser.
  expect(Math.max(...segment.events.map((e) => e.timestamp))).toBeLessThan(120_000);

  // Typing in the search box and the newsletter's field, then a search page (which is never recorded).
  await page.locator("main input[type=search], main input[name=q]").first().fill(SECRET);
  await page.waitForTimeout(1500);
  await page.locator("main input[type=email]").first().fill(`${SECRET}@example.com`);
  await page.waitForTimeout(500);
  await hidden(page);
  await page.goto(`${path}?q=${SECRET}`);
  await page.waitForTimeout(2500);
  await hidden(page);
  await page.waitForTimeout(1000);

  // What was typed was recorded too (masked): a segment followed it.
  expect(rec.length).toBeGreaterThan(1);
  expect(rec.some((r) => r.text.includes('"source":5'))).toBe(true);
  const all = rec.map((r) => r.text).join("\n");
  expect(all).not.toContain(SECRET);
  expect(all).not.toMatch(/\*{10}/);
  for (const r of rec) {
    for (const e of (JSON.parse(r.text) as { events: { type: number; data?: { href?: string } }[] }).events) {
      if (e.type === 4) expect(e.data?.href ?? "").not.toContain("?");
    }
  }
  // One tab, one recording: every segment carries the same id.
  expect(new Set(rec.map((r) => r.url.searchParams.get("id")))).toEqual(new Set([id]));
});

test("a withdrawal deletes the tab's recording at once and stops it", async ({ page }) => {
  const { rec, forget } = await watch(page);
  await allow(page, "recordings", "0001");
  await visit(page);
  await expect.poll(() => rec.length, { timeout: 20_000 }).toBeGreaterThan(0);
  const id = rec[0].url.searchParams.get("id")!;
  const before = rec.length;
  await page.evaluate((name) => {
    document.cookie = `${name}=1.11111111-1111-4111-8111-111111111111.recordings.0000; Path=/`;
    window.dispatchEvent(new Event("kaizen:consent-changed"));
  }, `consent_${storeId}`);
  await expect.poll(() => forget.length, { timeout: 5000 }).toBe(1);
  expect(JSON.parse(forget[0].text)).toEqual({ store: slug, ids: [id] });
  await page.mouse.click(30, 330);
  await hidden(page);
  await page.waitForTimeout(1500);
  expect(rec.length).toBe(before);
});
