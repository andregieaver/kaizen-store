import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const { recordOwnSpeed, ownSpeedReport, pruneOwnSpeedSamples } = await import("./own-speed");
const { MIN_SPEED_SAMPLES, SPEED_KEEP_DAYS } = await import("@/lib/speed");
const { POST } = await import("@/app/api/visit/speed/own/route");

/** The speed of Kaizena Flow's own site and of the admin (D390): what a page load becomes, what is dropped, the report and the prune. */

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
const NOW = new Date("2026-10-29T10:00:00Z");
const headers = (extra: Record<string, string> = {}, ua = UA) => new Headers({ "user-agent": ua, host: "localhost:3000", origin: "http://localhost:3000", ...extra });
const load = (store: string, path: string, figures: Record<string, unknown> = { lcp: 1200, inp: 80, cls: 10, ttfb: 200 }, screen = "computer") => ({ store, path, screen, figures });
const rows = () => db().execute<Row>(sql`select * from commerce.own_speed_samples order by created_at, id`);

beforeEach(async () => {
  await db().execute(sql`delete from commerce.own_speed_samples`);
  await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket like 'speed:%'`);
});

afterAll(async () => {
  await closeDb();
});

describe("a page load of the site or the admin", () => {
  it("keeps the site, the kind and the screen, and nothing that names the page or the person", async () => {
    expect(await recordOwnSpeed({ headers: headers(), body: load("admin", "/admin/acme/orders"), now: NOW })).toEqual({ recorded: true });
    expect(await recordOwnSpeed({ headers: headers(), body: load("platform", "/no/themes/atelier", { lcp: 900 }, "phone"), now: NOW })).toEqual({ recorded: true });
    const kept = await rows();
    expect(kept.map((r) => [r.site, r.kind, r.screen, r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day)])).toEqual([
      ["admin", "list", "computer", "2026-10-29"],
      ["platform", "product", "phone", "2026-10-29"],
    ]);
    expect(JSON.stringify(kept)).not.toMatch(/acme|atelier|Safari/);
  });

  it("drops a robot, Global Privacy Control, a page not measured, another site and a figure out of range", async () => {
    expect(await recordOwnSpeed({ headers: headers({}, "Googlebot/2.1"), body: load("admin", "/admin") })).toMatchObject({ reason: "bot" });
    expect(await recordOwnSpeed({ headers: headers({ "sec-gpc": "1" }), body: load("admin", "/admin") })).toMatchObject({ reason: "privacy" });
    expect(await recordOwnSpeed({ headers: headers(), body: load("admin", "/admin/sign-in") })).toMatchObject({ reason: "not_measured" });
    expect(await recordOwnSpeed({ headers: headers(), body: load("acme", "/admin") })).toMatchObject({ reason: "invalid" });
    expect(await recordOwnSpeed({ headers: headers(), body: load("admin", "/admin", { lcp: -1 }) })).toMatchObject({ reason: "invalid" });
    expect(await rows()).toHaveLength(0);
  });

  it("answers 204 from the same site and 403 from another, keeping only the first", async () => {
    const post = (origin: string) =>
      POST(new Request("http://localhost:3000/api/visit/speed/own", { method: "POST", headers: headers({ origin }), body: JSON.stringify(load("platform", "/")) }));
    expect((await post("http://localhost:3000")).status).toBe(204);
    expect((await post("https://evil.example")).status).toBe(403);
    expect(await rows()).toHaveLength(1);
  });
});

describe("the report and the prune", () => {
  it("gives a figure from the 75th percentile only with enough page loads, and prunes old days", async () => {
    for (let i = 1; i <= MIN_SPEED_SAMPLES; i++) {
      await recordOwnSpeed({ headers: headers(), body: load("admin", "/admin/acme", { lcp: i * 100 }), now: NOW });
    }
    await recordOwnSpeed({ headers: headers(), body: load("admin", "/admin/acme/orders", { lcp: 500 }), now: NOW });
    const report = await ownSpeedReport("admin", NOW);
    expect(report.loads).toBe(MIN_SPEED_SAMPLES + 1);
    const home = report.rows.find((r) => r.kind === "home")!;
    expect(home.cells.find((c) => c.metric === "lcp")).toMatchObject({ value: 1500, rating: "good" });
    const list = report.rows.find((r) => r.kind === "list")!;
    expect(list.cells.find((c) => c.metric === "lcp")).toMatchObject({ value: null, samples: 1 });
    expect((await ownSpeedReport("platform", NOW)).loads).toBe(0);

    const later = new Date(NOW.getTime() + (SPEED_KEEP_DAYS + 1) * 86_400_000);
    expect(await pruneOwnSpeedSamples(later)).toBe(MIN_SPEED_SAMPLES + 1);
  });
});
