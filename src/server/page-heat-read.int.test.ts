import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const EXP = "3f2b8c1e-7a4d-4b9e-9c2a-1d5e6f7a8b9c";
vi.mock("./experiments", async (importOriginal) => ({ ...(await importOriginal<typeof import("./experiments")>()), runningExperiments: async () => [{ id: EXP }] }));

const { recordHeat } = await import("./page-heat");
const { heatPages, pageDevices, pageHeat, taggedTests, versionBehaviour } = await import("./page-heat-read");

/** Heatmaps' reads (D656 step 7): a view with a verified version counts once in the page list, and a page's map sums its days. */

const run = Date.now().toString(36);
const slug = `heatread-${run}`;
let storeId: string;
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const VISITOR = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-11-16T10:00:00Z");
const PERIOD = { from: "2026-11-01", to: "2026-11-17" };

const headers = () =>
  new Headers({
    "user-agent": UA,
    host: "localhost:3000",
    origin: "http://localhost:3000",
    referer: `http://localhost:3000/s/${slug}/no`,
    cookie: `consent_${storeId}=1.${VISITOR}.statistics+heat.010; kaizen_ab_${storeId}=${encodeURIComponent(`1.${VISITOR}.${EXP}=b`)}`,
  });
const summary = (over: Record<string, unknown> = {}) => ({
  v: 1,
  store: slug,
  path: `/s/${slug}/no/p/demo-mug`,
  seq: 0,
  device: "mobile",
  reach: 20,
  fold: 300,
  attH: 3000,
  att: new Array(20).fill(0).map((_, i) => (i === 1 ? 2000 : 0)),
  clicks: [["@main", 2, 3, 1, 0]],
  dv: 1,
  rv: 0,
  fv: 1,
  ab: [[EXP, "b"]],
  ...over,
});

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Heat read', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo', private_mode = false, heatmaps = true where id = ${storeId}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

describe("heatmaps' reads (D656)", () => {
  it("counts a view with a verified version once in the page list, and keeps the version's own totals apart", async () => {
    expect(await recordHeat({ headers: headers(), body: summary(), now: NOW })).toEqual({ recorded: true });
    expect(await recordHeat({ headers: headers(), body: summary({ device: "desktop", ab: [] }), now: NOW })).toEqual({ recorded: true });
    const [mug] = await heatPages(storeId, PERIOD);
    expect(mug).toMatchObject({ page: "/no/p/demo-mug", views: 2, frustratedViews: 2, deadViews: 2, clicks: 2, reachedHalf: 1 });
    expect((await heatPages(storeId, { ...PERIOD, device: "mobile" }))[0].views).toBe(1);
    expect(await pageDevices(storeId, "/no/p/demo-mug", PERIOD)).toEqual({ mobile: 1, tablet: 0, desktop: 1 });
    const version = await pageHeat(storeId, { page: "/no/p/demo-mug", device: "mobile", tag: `${EXP}:b`, ...PERIOD });
    expect(version.views).toBe(1);
  });

  it("sums a page's days: reach, attention, fold and clicks per cell", async () => {
    const all = await pageHeat(storeId, { page: "/no/p/demo-mug", device: "mobile", ...PERIOD });
    expect(all.views).toBe(1);
    expect(all.reach[20]).toBe(1);
    expect(all.attention[1]).toBe(2000);
    expect(all.foldSum).toBe(300);
    expect(all.attHeightSum).toBe(3000);
    expect(all.cells).toEqual([{ anchor: "@main", cx: 2, cy: 3, clicks: 1, dead: 1, rage: 0 }]);
    expect((await pageHeat(storeId, { page: "/no/p/demo-mug", device: "mobile", from: "2026-10-01", to: "2026-10-02" })).views).toBe(0);
  });

  it("reads a test's behaviour per version over every page, and leaves out a test the store does not have (D656 step 12)", async () => {
    expect(await versionBehaviour(storeId, EXP)).toEqual([
      { version: "b", views: 1, reachedHalf: 1, rageShare: 0, deadShare: 1, rageViews: 0, deadViews: 1, topPage: "/no/p/demo-mug" },
    ]);
    expect(await versionBehaviour(storeId, "00000000-0000-4000-8000-000000000000")).toEqual([]);
    expect(await pageDevices(storeId, "/no/p/demo-mug", PERIOD, `${EXP}:b`)).toEqual({ mobile: 1, tablet: 0, desktop: 0 });
    // The tag names no test of this store, so it offers no chip.
    expect(await taggedTests(storeId, "/no/p/demo-mug")).toEqual([]);
  });
});
