import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { FLAG_IDS } from "@/lib/platform-flags";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const { currentFlags } = await import("./platform-flags");
const { recordProductionReading } = await import("./production-reading");

/**
 * The database flags (bloat review step 1.13) read from stored readings: two days are seeded long before any real reading, so a test never
 * meets production-shaped rows, and `now` keeps the read on the seeded days.
 */

const YESTERDAY = "2020-01-01";
const TODAY = "2020-01-02";
const READ_DAY = "2020-01-03";
const NOW = new Date(`${TODAY}T08:00:00Z`);
const MB = 1024 * 1024;

const put = (day: string, kind: string, name: string, figures: Record<string, unknown>, query: string | null = null) =>
  db().execute(sql`insert into commerce.platform_readings (day, kind, name, figures, query) values (${day}::date, ${kind}, ${name}, ${JSON.stringify(figures)}::jsonb, ${query})`);

const clean = () => db().execute(sql`delete from commerce.platform_readings where day between '2020-01-01' and '2020-01-31'`);

const statement = (calls: number, mean: number, rows: number) => ({ calls, total_ms: calls * mean, mean_ms: mean, rows, top: "both" });

beforeAll(async () => {
  await clean();
  // An 8 ms statement run 20 times.
  await put(YESTERDAY, "statement", "q-cost", statement(100, 8, 0), "select a from commerce.t where x = $1");
  await put(TODAY, "statement", "q-cost", statement(120, 8, 0), "select a from commerce.t where x = $1");
  // An update called 100 times that changed 5 rows.
  await put(YESTERDAY, "statement", "q-write", statement(10, 1, 0), "update commerce.t set a = $1 where id = $2");
  await put(TODAY, "statement", "q-write", statement(110, 1, 5), "update commerce.t set a = $1 where id = $2");
  // A statement new among the 25 most called.
  await put(TODAY, "statement", "q-new", statement(9_000, 1, 9_000), "select b from commerce.u");
  // A 600-row table scanned 20 times.
  await put(YESTERDAY, "table", "wide", { rows: 600, bytes: 1, seq_scan: 100, seq_tup_read: 60_000 });
  await put(TODAY, "table", "wide", { rows: 600, bytes: 1, seq_scan: 120, seq_tup_read: 72_000 });
  // The cron schema at 81 MB.
  await put(YESTERDAY, "schema", "cron", { bytes: 70 * MB, tables: 2 });
  await put(TODAY, "schema", "cron", { bytes: 81 * MB, tables: 2 });
  // An unused index on orders.
  await put(TODAY, "index", "orders.orders_unused_idx", { scans: 0, backs_constraint: false });
  await put(TODAY, "index", "orders.orders_pkey", { scans: 0, backs_constraint: true });
  // 1,200 idle route calls.
  await put(YESTERDAY, "job", "route.alpha", { runs: 0, worked: 0 });
  await put(TODAY, "job", "route.alpha", { runs: 1_300, worked: 100 });
  // An AI figure over its bar for 7 days.
  await put(TODAY, "ai", "chat.cost", { value: 12, bar: 10, days_over: 7 });
});

afterAll(async () => {
  await clean();
  await closeDb();
});

describe("the database flags", () => {
  it("raises each flag for its seeded case", async () => {
    const found = await currentFlags(NOW, { openedOn: "2019-11-03", idleCallsOn: true });
    expect(found).not.toBeNull();
    const byId = new Map((found?.flags ?? []).map((f) => [f.id, f] as const));
    expect([...byId.keys()].sort()).toEqual([...FLAG_IDS].sort());
    expect(byId.get("costly_statement")?.values).toMatchObject({ calls: 20, ms: 8 });
    expect(byId.get("whole_table_read")).toMatchObject({ subject: "wide", values: { rows: 600, n: 20 } });
    expect(byId.get("idle_write")?.values).toMatchObject({ calls: 100, changed: 5 });
    expect(byId.get("cron_schema_large")?.values).toMatchObject({ size: "81 MB" });
    expect(byId.get("unused_hot_index")).toMatchObject({ subject: "orders_unused_idx", values: { table: "orders" } });
    expect(byId.get("new_top_statement")?.subject).toContain("select b from commerce.u");
    expect(byId.get("idle_route_calls")?.values).toMatchObject({ n: 1_200 });
    expect(byId.get("ai_over_bar")?.values).toMatchObject({ value: 12, bar: 10 });
  });

  it("leaves the unused index and the idle routes off with no options", async () => {
    const ids = ((await currentFlags(NOW))?.flags ?? []).map((f) => f.id);
    expect(ids).not.toContain("unused_hot_index");
    expect(ids).not.toContain("idle_route_calls");
    expect(ids).toContain("costly_statement");
  });

  it("has the day's difference for the screen", async () => {
    const found = await currentFlags(NOW);
    expect(found?.today.day).toBe(TODAY);
    expect(found?.yesterday.day).toBe(YESTERDAY);
    expect(found?.difference.schemas[0]).toEqual({ name: "cron", bytesChange: 11 * MB });
  });

  it("gives null when a single day is stored", async () => {
    expect(await currentFlags(new Date(`${YESTERDAY}T08:00:00Z`))).toBeNull();
  });

  it("stores an index row for every index of commerce.orders and a job row for every scheduled job", async () => {
    const result = await recordProductionReading(new Date(`${READ_DAY}T03:00:00Z`));
    const indexes = await db().execute<Row>(sql`select name from commerce.platform_readings where day = ${READ_DAY}::date and kind = 'index'`);
    const expected = await db().execute<Row>(sql`select indexrelname from pg_stat_user_indexes where schemaname = 'commerce' and relname = 'orders'`);
    expect(expected.length).toBeGreaterThan(0);
    const names = new Set(indexes.map((r) => String(r.name)));
    for (const r of expected) expect(names.has(`orders.${String(r.indexrelname)}`)).toBe(true);
    const jobs = await db().execute<Row>(sql`select name from commerce.platform_readings where day = ${READ_DAY}::date and kind = 'job'`);
    const cron = await db().execute<Row>(sql`select job from commerce.cron_jobs`);
    expect(jobs.map((r) => String(r.name)).sort()).toEqual(cron.map((r) => String(r.job)).sort());
    expect(result.indexes).toBe(indexes.length);
    expect(result.jobs).toBe(jobs.length);
  });
});
