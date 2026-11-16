import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { testDb } from "../db";

import { E2E_STORE, OWNER, READER } from "./accounts";

/**
 * Recordings as the owner and a Read-only member meet them (D656 step 11). Two recordings are seeded on the test store; CI has no
 * Storage, so the player is fed a fixed events file through the browser (`RECORDING_EVENTS` may name a real one for screenshots), while the
 * events route itself is asked directly: 200 and an audit row for the owner, 404 and none for anyone else. The replay's frame stays
 * sandboxed without scripts, and the page's policy reports nothing.
 */

const shots = process.env.HEATMAP_SHOTS;
const PHONE = randomUUID();
const COMPUTER = randomUUID();
let storeId = "";

/** A small page as rrweb draws it: a heading, a button, a few moves, a frustrated click and a second page. */
function fixture(width: number, height: number) {
  let id = 0;
  const el = (tagName: string, attributes: Record<string, string>, childNodes: unknown[] = []) => ({ type: 2, tagName, attributes, childNodes, id: ++id });
  const text = (textContent: string) => ({ type: 3, textContent, id: ++id });
  const doc = { type: 0, childNodes: [] as unknown[], id: ++id };
  doc.childNodes.push(
    { type: 1, name: "html", publicId: "", systemId: "", id: ++id },
    el("html", { lang: "en" }, [
      el("head", {}, [el("style", { _cssText: "body{font-family:sans-serif;margin:0;background:#faf7f2;color:#222}header{padding:16px 24px;background:#1f3a2e;color:#fff}main{padding:24px}h1{font-size:32px}button{padding:12px 20px;border-radius:999px;border:0;background:#c96b3c;color:#fff;font-size:16px}" })]),
      el("body", {}, [el("header", {}, [text("Demo store")]), el("main", {}, [el("h1", {}, [text("Hand-thrown mugs")]), el("p", {}, [text("Stoneware, made in small batches.")]), el("button", {}, [text("Add to cart")])])]),
    ]),
  );
  const moves = Array.from({ length: 12 }, (_, i) => ({ type: 3, timestamp: 1500 + i * 400, data: { source: 1, positions: [{ x: 40 + i * 20, y: 120 + i * 15, id: 1, timeOffset: 0 }] } }));
  return [
    { type: 4, timestamp: 0, data: { href: "http://localhost/s/demo/no", width, height } },
    { type: 2, timestamp: 10, data: { node: doc, initialOffset: { top: 0, left: 0 } } },
    { type: 5, timestamp: 20, data: { tag: "kz-page", payload: { path: "/no" } } },
    ...moves,
    { type: 3, timestamp: 6800, data: { source: 2, type: 2, id: 9, x: 120, y: 260 } },
    { type: 5, timestamp: 6810, data: { tag: "kz-click", payload: { dead: true, rage: false } } },
    { type: 5, timestamp: 8000, data: { tag: "kz-click", payload: { dead: false, rage: true } } },
    { type: 5, timestamp: 14_000, data: { tag: "kz-page", payload: { path: "/no/p/demo-krus" } } },
    { type: 3, timestamp: 20_000, data: { source: 3, id: 1, x: 0, y: 200 } },
  ];
}

test.beforeAll(async () => {
  const sql = testDb();
  try {
    const [store] = await sql`update commerce.stores set recordings = true, recording_share = 50, recordings_confirmed_at = now() where slug = ${E2E_STORE} returning id`;
    storeId = String(store.id);
    await sql`delete from commerce.recordings where store_id = ${storeId}`;
    const now = Date.now();
    for (const [id, device, w, h, ago, rage, dead, pages] of [
      [PHONE, "mobile", 390, 840, 3_600_000, 2, 1, ["/no", "/no/p/demo-krus"]],
      [COMPUTER, "desktop", 1440, 900, 7_200_000, 0, 0, ["/no/om-oss"]],
    ] as const) {
      const started = new Date(Math.floor((now - ago) / 600_000) * 600_000);
      await sql`
        insert into commerce.recordings (id, store_id, day, started_at, last_at, duration_ms, device, width, height, entry_page, pages, clicks, dead_clicks, rage_clicks, mask, seqs, segments, sealed)
        values (${id}, ${storeId}, ${started.toISOString().slice(0, 10)}, ${started}, ${started}, 125000, ${device}, ${w}, ${h}, ${pages[0]}, ${sql.array([...pages])}, 7, ${dead}, ${rage}, 'balanced', '{}', 0, false)`;
    }
  } finally {
    await sql.end();
  }
});

const audits = async (id: string) => {
  const sql = testDb();
  try {
    return await sql`select account_id from commerce.audit_log where store_id = ${storeId} and action = 'analytics.recording_viewed' and target_id = ${id}`;
  } finally {
    await sql.end();
  }
};

async function feed(page: Page, id: string, events: unknown[]) {
  await page.route(`**/analytics/recordings/${id}/events`, (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(events) }));
}

test.describe("as the owner", () => {
  test.use({ storageState: OWNER.state });

  test("lists the recordings, most frustrated first, and plays one in a frame without scripts", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && /Content Security Policy|Refused to/.test(m.text())) problems.push(m.text());
    });
    await page.goto(`/admin/${E2E_STORE}/analytics/recordings`);
    await expect(page.getByRole("heading", { name: "Recordings", level: 1 })).toBeVisible();
    const rows = page.locator("li", { has: page.getByRole("link", { name: "Watch" }) });
    await expect(rows.first()).toContainText("Phone");
    await expect(rows.first()).toContainText("2 rage");
    await expect(page.getByRole("navigation", { name: "Filters" }).getByRole("link", { name: /Rage clicks/ })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/recordings-computer.png`, fullPage: true });

    const real = process.env.RECORDING_EVENTS;
    await feed(page, PHONE, real ? (JSON.parse(readFileSync(real, "utf8")) as unknown[]) : fixture(390, 840));
    await rows.first().getByRole("link", { name: "Watch" }).click();
    await expect(page.getByRole("heading", { name: /A visit/, level: 1 })).toBeVisible();
    const frame = page.locator("[data-recording-stage] iframe");
    await expect(frame).toBeAttached();
    const sandbox = (await frame.getAttribute("sandbox")) ?? "";
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-scripts");
    const marks = page.getByRole("region", { name: "What happened" });
    if (!real) {
      await expect(marks.getByRole("button", { name: /A click that did nothing/ })).toBeVisible();
      await expect(marks.getByRole("button", { name: /Opened \/no\/p\/demo-krus/ })).toBeVisible();
      await expect(page.frameLocator("[data-recording-stage] iframe").getByText("Hand-thrown mugs")).toBeVisible();
    }
    await page.getByRole("button", { name: "Play" }).click();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    if (shots) await page.screenshot({ path: `${shots}/player-phone-recording.png`, fullPage: true });
    expect(problems).toEqual([]);

    if (shots) {
      await feed(page, COMPUTER, process.env.RECORDING_EVENTS_DESKTOP ? (JSON.parse(readFileSync(process.env.RECORDING_EVENTS_DESKTOP, "utf8")) as unknown[]) : fixture(1440, 900));
      await page.goto(`/admin/${E2E_STORE}/analytics/recordings/${COMPUTER}`);
      await expect(page.locator("[data-recording-stage] iframe")).toBeAttached();
      await page.waitForTimeout(1000);
      await page.screenshot({ path: `${shots}/player-computer-recording.png`, fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`/admin/${E2E_STORE}/analytics/recordings`);
      await page.screenshot({ path: `${shots}/recordings-phone.png`, fullPage: true });
      await page.goto(`/admin/${E2E_STORE}/analytics/settings#recordings`);
      await page.locator("#recordings").scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${shots}/recordings-settings-phone.png`, fullPage: true });
    }
  });

  test("the events route logs the viewing and answers the owner", async ({ page }) => {
    const answer = await page.request.get(`/admin/${E2E_STORE}/analytics/recordings/${COMPUTER}/events`);
    expect(answer.status()).toBe(200);
    expect(answer.headers()["cache-control"]).toContain("no-store");
    expect(Array.isArray(await answer.json())).toBe(true);
    expect(await audits(COMPUTER)).toHaveLength(1);
  });
});

test.describe("as a Read-only member", () => {
  test.use({ storageState: READER.state });

  test("is offered no recordings, and their events are not found", async ({ page }) => {
    await page.goto(`/admin/${E2E_STORE}/analytics/heatmaps`);
    await expect(page.getByRole("link", { name: "Recordings" })).toHaveCount(0);
    const before = (await audits(PHONE)).length;
    const answer = await page.request.get(`/admin/${E2E_STORE}/analytics/recordings/${PHONE}/events`);
    expect(answer.status()).toBe(404);
    expect(await audits(PHONE)).toHaveLength(before);
    await page.goto(`/admin/${E2E_STORE}/analytics/recordings/${PHONE}`);
    await expect(page.locator("[data-recording-stage]")).toHaveCount(0);
  });
});
