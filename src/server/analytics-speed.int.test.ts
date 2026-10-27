import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const { recordSpeed, speedReport, pruneSpeedSamples } = await import("./analytics-speed");
const { MIN_SPEED_SAMPLES, SPEED_KEEP_DAYS } = await import("@/lib/speed");
const { POST } = await import("@/app/api/visit/speed/route");

/**
 * The speed report's data (D336): what a page load's figures become, what is dropped, that nothing but the page's kind and the
 * screen is kept, the day's cap, the 75th percentile over 28 days and the daily prune.
 */

const run = Date.now().toString(36);
const slug = `speed-${run}`;
let storeId: string;
let market: string;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const NOW = new Date("2026-10-27T10:00:00Z");

const asRequest = (extra: Record<string, string> = {}, ua = UA) =>
  new Headers({ "user-agent": ua, host: "localhost:3000", origin: "http://localhost:3000", referer: `http://localhost:3000/s/${slug}/no`, ...extra });
const page = (suffix = "") => `/s/${slug}/${market.toLowerCase()}${suffix}`;
const load = (path: string, figures: Record<string, unknown> = { lcp: 1800, inp: 90, cls: 20, ttfb: 300 }, screen = "phone") => ({ store: slug, path, screen, figures });

const samples = () => db().execute<Row>(sql`select * from commerce.speed_samples where store_id = ${storeId}::uuid order by created_at, id`);
const setCounting = (on: boolean) => db().execute(sql`update commerce.stores set visit_counting = ${on} where id = ${storeId}::uuid`);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Speed test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo' where id = ${storeId}::uuid`);
  const [m] = await db().execute<Row>(sql`select market_code from commerce.store_markets where store_id = ${storeId}::uuid limit 1`).catch(() => [undefined]);
  market = String(m?.market_code ?? "NO");
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.speed_samples where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid`);
  await setCounting(true);
});

afterAll(async () => {
  await closeDb();
});

describe("a page load's figures", () => {
  it("keeps the page's kind, the screen and the figures, and nothing that names the page or the visitor", async () => {
    expect(await recordSpeed({ headers: asRequest(), body: load(page("/p/demo-mug")), now: NOW })).toEqual({ recorded: true });
    const [row] = await samples();
    expect(row).toMatchObject({ kind: "product", screen: "phone", lcp_ms: 1800, inp_ms: 90, cls_milli: 20, ttfb_ms: 300 });
    expect(String(row.day).slice(0, 10)).toBe("2026-10-27");
    expect(Object.keys(row).sort()).toEqual(["cls_milli", "created_at", "day", "id", "inp_ms", "kind", "lcp_ms", "screen", "store_id", "ttfb_ms"]);
  });

  it("drops robots, Global Privacy Control, Do Not Track, other sites and a store that does not count visits", async () => {
    expect(await recordSpeed({ headers: asRequest({}, "Googlebot/2.1 (+http://www.google.com/bot.html)"), body: load(page()), now: NOW })).toEqual({ recorded: false, reason: "bot" });
    expect(await recordSpeed({ headers: asRequest({ "sec-gpc": "1" }), body: load(page()), now: NOW })).toEqual({ recorded: false, reason: "privacy" });
    expect(await recordSpeed({ headers: asRequest({ dnt: "1" }), body: load(page()), now: NOW })).toEqual({ recorded: false, reason: "privacy" });
    expect(await recordSpeed({ headers: asRequest({ origin: "https://elsewhere.example", referer: "https://elsewhere.example/" }), body: load(page()), now: NOW })).toEqual({
      recorded: false,
      reason: "wrong_site",
    });
    expect(await recordSpeed({ headers: asRequest(), body: { ...load(page()), store: `nobody-${run}` }, now: NOW })).toEqual({ recorded: false, reason: "unknown_store" });
    await setCounting(false);
    expect(await recordSpeed({ headers: asRequest(), body: load(page()), now: NOW })).toEqual({ recorded: false, reason: "off" });
    expect(await samples()).toHaveLength(0);
  });

  it("refuses figures that are not measurements and pages that are not measured", async () => {
    expect(await recordSpeed({ headers: asRequest(), body: load(page(), { lcp: 1.5 }), now: NOW })).toEqual({ recorded: false, reason: "invalid" });
    expect(await recordSpeed({ headers: asRequest(), body: load(page(), {}), now: NOW })).toEqual({ recorded: false, reason: "invalid" });
    expect(await recordSpeed({ headers: asRequest(), body: { ...load(page()), screen: "watch" }, now: NOW })).toEqual({ recorded: false, reason: "invalid" });
    expect(await recordSpeed({ headers: asRequest(), body: load(page("/cart")), now: NOW })).toEqual({ recorded: false, reason: "not_measured" });
    expect(await samples()).toHaveLength(0);
  });

  it("keeps no more than the day's cap", async () => {
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (${storeId}::uuid, 'speed', date_trunc('day', now()), 10000)
    `);
    expect(await recordSpeed({ headers: asRequest(), body: load(page()), now: NOW })).toEqual({ recorded: false, reason: "store_full" });
    expect(await samples()).toHaveLength(0);
  });

  it("answers the browser with an empty 204 whatever happens, and refuses another site", async () => {
    const post = (body: string, headers: Record<string, string> = {}) =>
      POST(new Request("http://localhost:3000/api/visit/speed", { method: "POST", body, headers: { ...Object.fromEntries(asRequest()), ...headers } }));
    const kept = await post(JSON.stringify(load(page())));
    expect(kept.status).toBe(204);
    expect(kept.headers.get("cache-control")).toBe("no-store");
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify(load(page(), { lcp: "x" })))).status).toBe(204);
    expect((await post("x".repeat(1200))).status).toBe(413);
    expect(await samples()).toHaveLength(1);
  });
});

describe("the report", () => {
  const insert = (n: number, kind: string, screen: string, lcp: number, day = "2026-10-20") =>
    db().execute(sql`
      insert into commerce.speed_samples (store_id, day, kind, screen, lcp_ms)
      select ${storeId}::uuid, ${day}::date, ${kind}, ${screen}, ${lcp} + g from generate_series(1, ${n}) g
    `);

  it("gives the 75th percentile over the last 28 store days, and no figure under the minimum", async () => {
    await insert(40, "home", "phone", 1000);
    await insert(MIN_SPEED_SAMPLES - 1, "product", "computer", 5000);
    // Outside the 28 days: never counted.
    await insert(30, "home", "phone", 9000, "2026-09-29");
    const report = await speedReport({ id: storeId, timeZone: "Europe/Oslo", visitCounting: true }, NOW);
    expect(report).toMatchObject({ collecting: true, from: "2026-09-30", to: "2026-10-27", lastSample: "2026-10-20", loads: 40 + MIN_SPEED_SAMPLES - 1 });
    const home = report.rows.find((r) => r.kind === "home")!;
    expect(home.cells.find((c) => c.metric === "lcp")).toMatchObject({ samples: 40, value: 1030, rating: "good" });
    const product = report.rows.find((r) => r.kind === "product")!;
    expect(product.cells.find((c) => c.metric === "lcp")).toMatchObject({ samples: MIN_SPEED_SAMPLES - 1, value: null });
  });

  it("deletes samples past the keeping period and leaves the rest", async () => {
    const old = new Date(NOW.getTime() - (SPEED_KEEP_DAYS + 2) * 86_400_000).toISOString().slice(0, 10);
    await insert(3, "home", "phone", 1000, old);
    await insert(2, "home", "phone", 1000, "2026-10-26");
    expect(await pruneSpeedSamples(NOW)).toBeGreaterThanOrEqual(3);
    expect(await samples()).toHaveLength(2);
  });
});
