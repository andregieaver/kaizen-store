import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";

import { coldStartReport, latestUiBytes, pruneInstanceStarts } from "./instance-starts";

const clear = () => db().execute(sql`delete from commerce.instance_starts`);

/** Ten starts of a kind over today and yesterday: `first` ms and then `step` more for each. */
const seed = (kind: string, first: number, step: number) =>
  db().execute(sql`
    insert into commerce.instance_starts (day, kind, first_ms, rss_mb, ui_bytes)
    select (now() at time zone 'utc')::date - (i % 2), ${kind}, ${first} + ${step} * (i - 1), 300, ${kind === "health" ? 2048 : 0}
    from generate_series(1, 10) as i
  `);

beforeAll(clear);
afterAll(async () => {
  await clear();
  await closeDb();
});

describe("cold starts on Usage and limits (bloat review step 1.16)", () => {
  it("reads a day, the median and the 95th percentile by kind, and the beacons' distance from the health check", async () => {
    await clear();
    await seed("health", 60, 10);
    await seed("beacon", 100, 100);
    const report = await coldStartReport(7);
    expect(report.total).toBe(20);
    expect(report.rows.map((r) => r.kind)).toEqual(["health", "beacon"]);
    expect(report.rows[0]).toMatchObject({ kind: "health", perDay: 5, p50: 100, p95: 150 });
    expect(report.rows[1]).toMatchObject({ kind: "beacon", perDay: 5, p50: 500, p95: 1000, overHealth: 400 });
    expect(await latestUiBytes()).toBe(2048);
  });

  it("keeps 30 days: a start dated 40 days ago is deleted, and nothing else", async () => {
    await db().execute(sql`
      insert into commerce.instance_starts (day, kind, first_ms, rss_mb) values ((now() at time zone 'utc')::date - 40, 'proxy', 90, 250)
    `);
    expect(await pruneInstanceStarts()).toBe(1);
    const [left] = await db().execute<{ n: number }>(sql`select count(*)::int as n from commerce.instance_starts`);
    expect(left.n).toBe(20);
  });
});
