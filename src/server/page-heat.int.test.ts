import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
// lockedOut() reads the unlock pass from next/headers' cookies, not from the headers passed in.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({ cookies: async () => ({ get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined) }) }));
// A running A/B test, without building one: the tag check asks only which tests run.
const EXP = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
const OTHER = "11111111-1111-4111-8111-111111111111";
vi.mock("./experiments", () => ({ runningExperiments: async () => [{ id: EXP }] }));
vi.mock("./experiments-running", async (importOriginal) => ({ ...(await importOriginal<typeof import("./experiments-running")>()), runningExperiments: async () => [{ id: EXP }] }));

const { recordHeat, pruneHeat } = await import("./page-heat");
const { POST } = await import("@/app/api/signals/heat/route");

/**
 * Heatmaps' totals (D656): what a page view's summary adds, what is refused, the A/B tags the cookie confirms, and the prune.
 */

const run = Date.now().toString(36);
const slug = `heat-${run}`;
let storeId: string;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const NOW = new Date("2026-11-16T10:00:00Z");
const VISITOR = "22222222-2222-4222-8222-222222222222";

const consent = (version = "statistics+heat", bits = "010") => `consent_${storeId}=1.${VISITOR}.${version}.${bits}`;
const abCookie = (versions: string) => `kaizen_ab_${storeId}=${encodeURIComponent(`1.${VISITOR}.${versions}`)}`;
const asRequest = (cookie = consent(), extra: Record<string, string> = {}, ua = UA) =>
  new Headers({ "user-agent": ua, host: "localhost:3000", origin: "http://localhost:3000", referer: `http://localhost:3000/s/${slug}/no`, cookie, ...extra });
const summary = (over: Record<string, unknown> = {}) => ({
  v: 1,
  store: slug,
  path: `/s/${slug}/no/p/demo-mug`,
  seq: 0,
  device: "mobile",
  reach: 10,
  fold: 250,
  attH: 4000,
  att: new Array(20).fill(0).map((_, i) => (i === 0 ? 3000 : 0)),
  clicks: [
    ["@main", 1, 2, 0, 0],
    ["@main", 1, 2, 1, 0],
    ["@header", 0, 0, 1, 1],
  ],
  dv: 1,
  rv: 1,
  fv: 1,
  ab: [],
  ...over,
});

const days = () => db().execute<Row>(sql`select * from commerce.page_heat_days where store_id = ${storeId}::uuid order by tag`);
const cells = () => db().execute<Row>(sql`select anchor, cx, cy, tag, clicks, dead, rage from commerce.click_cells where store_id = ${storeId}::uuid order by tag, anchor`);
const set = (column: "heatmaps" | "private_mode", on: boolean) =>
  column === "heatmaps"
    ? db().execute(sql`update commerce.stores set heatmaps = ${on} where id = ${storeId}::uuid`)
    : db().execute(sql`update commerce.stores set private_mode = ${on} where id = ${storeId}::uuid`);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Heat test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo', private_mode = false, heatmaps = true where id = ${storeId}::uuid`);
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.page_heat_days where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.click_cells where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid`);
  await set("heatmaps", true);
  await set("private_mode", false);
  jar.clear();
});

afterAll(async () => {
  await closeDb();
});

describe("a page view's summary (D656)", () => {
  it("adds to the day's totals for the page's shape, and keeps no visitor", async () => {
    expect(await recordHeat({ headers: asRequest(), body: summary(), now: NOW })).toEqual({ recorded: true });
    const [row] = await days();
    expect(row).toMatchObject({ page: "/no/p/demo-mug", device: "mobile", tag: "", views: 1, clicks: 3, dead_clicks: 2, rage_clicks: 1, dead_views: 1, rage_views: 1, frustrated_views: 1 });
    expect(String(row.day).slice(0, 10)).toBe("2026-11-16");
    expect((row.reach as number[])[10]).toBe(1);
    expect(Number(row.fold_sum)).toBe(250);
    expect(Number((row.attention_ms as string[])[0])).toBe(3000);
    expect(Object.keys(row)).not.toContain("visitor");
    expect(await cells()).toEqual([
      { anchor: "@header", cx: 0, cy: 0, tag: "", clicks: 1, dead: 1, rage: 1 },
      { anchor: "@main", cx: 1, cy: 2, tag: "", clicks: 2, dead: 1, rage: 0 },
    ]);
  });

  it("counts the view and its reach once: a continuation adds attention and clicks only", async () => {
    await recordHeat({ headers: asRequest(), body: summary(), now: NOW });
    await recordHeat({ headers: asRequest(), body: summary({ seq: 1, reach: undefined, fold: undefined, attH: undefined, clicks: [["@main", 1, 2, 0, 0]], dv: 0, rv: 0, fv: 0 }), now: NOW });
    const [row] = await days();
    expect(row).toMatchObject({ views: 1, clicks: 4, dead_views: 1 });
    expect((row.reach as number[]).reduce((a, b) => a + b, 0)).toBe(1);
    expect(Number((row.attention_ms as string[])[0])).toBe(6000);
    await recordHeat({ headers: asRequest(), body: summary(), now: NOW });
    expect((await days())[0]).toMatchObject({ views: 2 });
  });

  it("refuses without consent with heatmaps named, under GPC, from a robot or another site, while off, on a page not measured, and for a locked-out visitor", async () => {
    const refused = async (reason: string, headers: Headers, body = summary()) => expect(await recordHeat({ headers, body, now: NOW })).toEqual({ recorded: false, reason });
    await refused("no_consent", asRequest(""));
    await refused("no_consent", asRequest(consent("statistics")));
    await refused("no_consent", asRequest(consent("statistics+heat", "001")));
    await refused("privacy", asRequest(consent(), { "sec-gpc": "1" }));
    await refused("bot", asRequest(consent(), {}, "Googlebot/2.1 (+http://www.google.com/bot.html)"));
    await refused("wrong_site", asRequest(consent(), { origin: "https://elsewhere.example", referer: "https://elsewhere.example/" }));
    await refused("not_measured", asRequest(), summary({ path: `/s/${slug}/no/cart` }));
    await refused("not_measured", asRequest(), summary({ path: `/s/${slug}/no/account/orders` }));
    await refused("invalid", asRequest(), summary({ clicks: [["kz-page", 1, 1, 0, 0]] }));
    await set("private_mode", true);
    await refused("locked", asRequest());
    await set("private_mode", false);
    await set("heatmaps", false);
    await refused("off", asRequest());
    expect(await days()).toHaveLength(0);
  });

  it("keeps the versions the cookie confirms for a running test, once each, beside every visitor's totals", async () => {
    const cookie = `${consent()}; ${abCookie(`${EXP}=b,${OTHER}=a`)}`;
    const ab = [[EXP, "b"], [EXP, "b"], [OTHER, "a"], [EXP, "c"]];
    expect(await recordHeat({ headers: asRequest(cookie), body: summary({ ab }), now: NOW })).toEqual({ recorded: true });
    const rows = await days();
    expect(rows.map((r) => [r.tag, r.views])).toEqual([["", 1], [`${EXP}:b`, 1]]);
    expect((await cells()).filter((c) => c.tag === `${EXP}:b`)).toHaveLength(2);
    // A version the cookie does not hold is never kept.
    await recordHeat({ headers: asRequest(consent()), body: summary({ ab: [[EXP, "b"]] }), now: NOW });
    expect((await days()).map((r) => [r.tag, r.views])).toEqual([["", 2], [`${EXP}:b`, 1]]);
  });

  it("answers the route with an empty 204 whatever happens, and refuses another site and a large body", async () => {
    const post = (body: string, headers: Headers = asRequest()) => POST(new Request("http://localhost:3000/api/signals/heat", { method: "POST", body, headers }));
    expect((await post(JSON.stringify(summary()))).status).toBe(204);
    expect((await post("not json")).status).toBe(400);
    expect((await post("x".repeat(9000))).status).toBe(413);
    expect((await post(JSON.stringify(summary()), asRequest(consent(), { origin: "https://elsewhere.example" }))).status).toBe(403);
    expect((await days())[0]).toMatchObject({ views: 1 });
  });
});

describe("the prune (D656)", () => {
  it("drops page totals after 13 months and cells after 90 days", async () => {
    const zeros = (n: number) => `{${new Array(n).fill(0).join(",")}}`;
    for (const day of ["2025-10-01", "2026-08-01", "2026-11-15"]) {
      await db().execute(sql`insert into commerce.page_heat_days (store_id, day, page, device, reach, attention_ms) values (${storeId}::uuid, ${day}::date, '/no', 'mobile', ${zeros(21)}::int[], ${zeros(20)}::bigint[])`);
      await db().execute(sql`insert into commerce.click_cells (store_id, day, page, device, anchor, cx, cy) values (${storeId}::uuid, ${day}::date, '/no', 'mobile', '@main', 0, 0)`);
    }
    const pruned = await pruneHeat(NOW);
    expect(pruned.days).toBeGreaterThanOrEqual(1);
    expect((await days()).map((r) => String(r.day).slice(0, 10)).sort()).toEqual(["2026-08-01", "2026-11-15"]);
    expect((await db().execute<Row>(sql`select day from commerce.click_cells where store_id = ${storeId}::uuid`)).map((r) => String(r.day).slice(0, 10))).toEqual(["2026-11-15"]);
  });
});
