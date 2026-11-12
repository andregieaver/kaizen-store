import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const { recordProductionReading, pruneProductionReadings } = await import("./production-reading");

/** The daily reading of production's statistics (bloat review step 0.2): one row per commerce table, the schemas, at most 80 statements, once a day, 90 days. */

const NOW = new Date("2026-11-12T03:00:00Z");
const rows = (kind: string) => db().execute<Row>(sql`select * from commerce.platform_readings where kind = ${kind} order by name`);

beforeEach(async () => {
  await db().execute(sql`delete from commerce.platform_readings`);
});

afterAll(async () => {
  await closeDb();
});

describe("the daily reading", () => {
  it("writes one table row for each commerce table, with its size", async () => {
    await recordProductionReading(NOW);
    const expected = (await db().execute<Row>(sql`select relname from pg_stat_user_tables where schemaname = 'commerce'`)).map((r) => String(r.relname)).sort();
    const kept = await rows("table");
    expect(kept.map((r) => String(r.name)).sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    for (const r of kept) expect(typeof (r.figures as Record<string, unknown>).bytes).toBe("number");
  });

  it("writes a schema row for commerce", async () => {
    await recordProductionReading(NOW);
    expect((await rows("schema")).map((r) => r.name)).toContain("commerce");
  });

  it("keeps at most 80 statements, each cut at 2,000 characters, and none where the view cannot be read", async () => {
    const result = await recordProductionReading(NOW);
    const kept = await rows("statement");
    expect(kept.length).toBeLessThanOrEqual(80);
    expect(result.statements).toBe(kept.length);
    for (const r of kept) expect(String(r.query).length).toBeLessThanOrEqual(2000);
    const ext = await db().execute<Row>(sql`select 1 from pg_extension where extname = 'pg_stat_statements'`);
    let readable = false;
    if (ext.length > 0) {
      try {
        const s = await db().execute<Row>(sql`select n.nspname from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_stat_statements'`);
        await db().execute(sql`select 1 from ${sql.raw(`${String(s[0]?.nspname ?? "public")}.pg_stat_statements`)} limit 1`);
        readable = true;
      } catch {
        readable = false;
      }
    }
    if (readable) expect(kept.length).toBeGreaterThan(0);
    else expect(result.statements).toBe(0);
  });

  it("leaves the same rows when it runs twice on one day", async () => {
    await recordProductionReading(NOW);
    const first = (await db().execute<Row>(sql`select count(*)::int as n from commerce.platform_readings`))[0].n;
    await recordProductionReading(NOW);
    const second = (await db().execute<Row>(sql`select count(*)::int as n from commerce.platform_readings`))[0].n;
    expect(second).toBe(first);
  });

  it("deletes a reading older than 90 days and keeps one of exactly 90", async () => {
    await db().execute(sql`
      insert into commerce.platform_readings (day, kind, name, figures)
      values ('2026-08-13', 'schema', 'old', '{}'::jsonb), ('2026-08-14', 'schema', 'kept', '{}'::jsonb)
    `);
    expect(await pruneProductionReadings(NOW)).toBe(1);
    expect((await rows("schema")).map((r) => r.name)).toEqual(["kept"]);
  });
});
