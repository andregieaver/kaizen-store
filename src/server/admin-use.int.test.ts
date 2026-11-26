import { gunzipSync, gzipSync } from "node:zlib";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { memoryFiles } from "./recording-files-test-support";

vi.mock("server-only", () => ({}));

const { makeAccount } = await import("./trust-fixtures");
const { adminRecordingOf, adminRecordings, adminScreenFigures, serveAdminRecordingEvents } = await import("./admin-use");

type Row = Record<string, unknown>;

/**
 * Platform → Admin use (D895 phase 3b): each screen's figures over the last 30 days worked out in code, the recordings most frustrated
 * first, and one recording's events only once the viewing is in the activity log.
 */
const NOW = new Date("2021-06-20T10:00:00Z");
const zeros = (n: number) => `{${new Array(n).fill(0).join(",")}}`;
let viewer = "";
const ids = [crypto.randomUUID(), crypto.randomUUID()];

beforeAll(async () => {
  // The sanitiser reads the storage host, as the stores' recordings test sets it.
  process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://project.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test";
  viewer = (await makeAccount("admin-use-viewer", { platformAdmin: true })).id;
  const reach = `{${[...new Array(20).fill(0), 12].join(",")}}`;
  await db().execute(sql`
    insert into commerce.platform_admin_heat_days (day, screen, device, views, reach, attention_ms, frustrated_views, dead_clicks, rage_clicks)
    values ('2021-06-18', 's/products', 'desktop', 24, ${reach}::int[], ${zeros(20)}::bigint[], 6, 7, 2),
           ('2021-06-19', 's/products', 'mobile', 6, ${zeros(21)}::int[], ${zeros(20)}::bigint[], 0, 0, 0),
           ('2021-05-01', 's/settings/tax', 'desktop', 90, ${zeros(21)}::int[], ${zeros(20)}::bigint[], 90, 90, 9)
  `);
  await db().execute(sql`
    insert into commerce.platform_admin_recordings (id, day, started_at, last_at, device, entry_screen, screens, age_band, dead_clicks, rage_clicks, seqs, segments)
    values (${ids[0]}::uuid, '2021-06-19', '2021-06-19T09:00:00Z', '2021-06-19T09:10:00Z', 'desktop', 's/products', '{s/products}', 'week', 1, 0, '{0}', 1),
           (${ids[1]}::uuid, '2021-06-19', '2021-06-19T08:00:00Z', '2021-06-19T08:10:00Z', 'mobile', 's', '{s}', 'older', 3, 2, '{0}', 1)
  `);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.platform_admin_heat_days where day between '2021-05-01' and '2021-06-30'`);
  await db().execute(sql`delete from commerce.platform_admin_recordings where id = any(${`{${ids.join(",")}}`}::uuid[])`);
  await closeDb();
});

describe("Admin use", () => {
  it("sums each screen's last 30 days and works the shares out in code", async () => {
    const products = (await adminScreenFigures(NOW)).find((r) => r.screen === "s/products");
    expect(products).toEqual({ screen: "s/products", views: 30, deadClicks: 7, rageClicks: 2, frustratedPct: 20, endPct: 40 });
    expect((await adminScreenFigures(NOW)).some((r) => r.screen === "s/settings/tax")).toBe(false);
  });

  it("lists the most frustrated recording first", async () => {
    const mine = (await adminRecordings()).filter((r) => ids.includes(r.id)).map((r) => r.id);
    expect(mine).toEqual([ids[1], ids[0]]);
  });

  it("writes the viewing to the activity log before it sends the events, and sends nothing when it cannot", async () => {
    const files = memoryFiles();
    await files.upload(`admin/${ids[0]}/000.gz`, new Uint8Array(gzipSync(JSON.stringify({ v: 1, events: [{ type: 4, timestamp: 0, data: { href: "s/products", width: 1, height: 1 } }] }))));
    const failing = vi.fn(async () => {
      throw new Error("no log");
    });
    expect(await serveAdminRecordingEvents(viewer, ids[0], { files, log: failing })).toEqual({ status: 503 });
    const answer = await serveAdminRecordingEvents(viewer, ids[0], { files });
    expect(answer.status).toBe(200);
    if (answer.status === 200) expect(JSON.parse(gunzipSync(answer.body).toString("utf8"))).toHaveLength(1);
    const [logged] = await db().execute<Row>(
      sql`select action, target_type from commerce.audit_log where account_id = ${viewer}::uuid and target_id = ${ids[0]} order by created_at desc limit 1`,
    );
    expect(logged).toEqual({ action: "platform.admin_recording_viewed", target_type: "admin_recording" });
    expect(await serveAdminRecordingEvents(viewer, crypto.randomUUID(), { files })).toEqual({ status: 404 });
    expect(await adminRecordingOf("not-an-id")).toBeNull();
  });
});
