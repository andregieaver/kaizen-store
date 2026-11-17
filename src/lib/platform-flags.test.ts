import { describe, expect, it } from "vitest";

import {
  COSTLY_ALLOWED,
  dayDifference,
  emptyReading,
  FLAG_IDS,
  platformFlags,
  WHOLE_READ_ALLOWED,
  type DailyReading,
  type StatementReading,
} from "./platform-flags";

const MB = 1024 * 1024;
const stmt = (key: string, text: string, calls: number, meanMs: number, rows = 0): StatementReading => ({ key, text, calls, totalMs: calls * meanMs, meanMs, rows });
const reading = (day: string, patch: Partial<DailyReading> = {}): DailyReading => ({ ...emptyReading(day), ...patch });
const ids = (flags: { id: string }[]) => flags.map((f) => f.id);

const T1 = "2026-11-17";
const T0 = "2026-11-16";

describe("platformFlags", () => {
  it("costly_statement: 8 ms run 20 times raises, 4 ms does not", () => {
    const yesterday = reading(T0, { statements: [stmt("a", "select 1", 100, 8), stmt("b", "select 2", 100, 4)] });
    const today = reading(T1, { statements: [stmt("a", "select 1", 120, 8), stmt("b", "select 2", 120, 4)] });
    // cumulative totals: yesterday 800 and 400 ms, today 960 and 480 ms: 20 calls each
    const flags = platformFlags(today, yesterday);
    expect(flags.filter((f) => f.id === "costly_statement").map((f) => f.subject)).toEqual(["select 1"]);
    expect(flags[0].values).toMatchObject({ calls: 20, ms: 8 });
  });

  it("costly_statement: a written exception with a ceiling quiets it only up to the ceiling", () => {
    const yesterday = reading(T0, { statements: [stmt("a", "select 1", 100, 8)] });
    const today = reading(T1, { statements: [stmt("a", "select 1", 120, 8)] });
    expect(ids(platformFlags(today, yesterday, { costlyAllowed: [{ key: "a", ceilingMs: 10 }] }))).toEqual([]);
    expect(ids(platformFlags(today, yesterday, { costlyAllowed: [{ key: "a", ceilingMs: 6 }] }))).toEqual(["costly_statement"]);
  });

  it("whole_table_read: 600 rows scanned 20 times raises; 400 rows, an allowed table and 10 scans do not", () => {
    const table = (rows: number, seq: number, name = "t") => ({ name, rows, bytes: 1, seqScans: seq, seqRowsRead: seq * rows });
    const yesterday = reading(T0, { tables: [table(600, 100), table(400, 100, "small"), table(600, 100, "ten")] });
    const today = reading(T1, { tables: [table(600, 120), table(400, 120, "small"), table(600, 110, "ten")] });
    expect(platformFlags(today, yesterday).map((f) => [f.id, f.subject])).toEqual([["whole_table_read", "t"]]);
    expect(ids(platformFlags(today, yesterday, { wholeReadAllowed: [{ table: "t" }] }))).toEqual([]);
  });

  it("idle_write: an update called 100 times that changed 5 rows raises; 50 rows does not", () => {
    const yesterday = reading(T0, { statements: [stmt("u", "  UPDATE commerce.x set a = $1", 10, 1, 0), stmt("v", "update commerce.y set a = $1", 10, 1, 0), stmt("s", "select $1", 10, 1, 0)] });
    const today = reading(T1, {
      statements: [stmt("u", "  UPDATE commerce.x set a = $1", 110, 1, 5), stmt("v", "update commerce.y set a = $1", 110, 1, 50), stmt("s", "select $1", 110, 1, 0)],
    });
    const flags = platformFlags(today, yesterday);
    expect(flags.map((f) => [f.id, f.values])).toEqual([["idle_write", { calls: 100, changed: 5 }]]);
  });

  it("new_top_statement: a statement new among the 25 most called raises", () => {
    const yesterday = reading(T0, { statements: [stmt("old", "select 1", 10, 1)] });
    const today = reading(T1, { statements: [stmt("old", "select 1", 20, 1), stmt("new", "select 2", 500, 1)] });
    expect(platformFlags(today, yesterday).map((f) => [f.id, f.subject])).toEqual([["new_top_statement", "select 2"]]);
  });

  it("a statement absent from yesterday raises only new_top_statement, never a difference-based flag", () => {
    const yesterday = reading(T0);
    const today = reading(T1, { statements: [stmt("big", "update commerce.z set a = $1", 1_000_000, 50, 0)] });
    expect(ids(platformFlags(today, yesterday))).toEqual(["new_top_statement"]);
  });

  it("cron_schema_large: 81 MB raises, 79 MB does not, 21 MB raises at a 20 MB ceiling", () => {
    const at = (mb: number) => reading(T1, { schemas: [{ name: "cron", bytes: mb * MB }] });
    expect(ids(platformFlags(at(81), reading(T0)))).toEqual(["cron_schema_large"]);
    expect(ids(platformFlags(at(79), reading(T0)))).toEqual([]);
    expect(ids(platformFlags(at(21), reading(T0), { cronSchemaMaxBytes: 20 * MB }))).toEqual(["cron_schema_large"]);
  });

  it("unused_hot_index: only 56 days after opening, on a hot table, backing no constraint", () => {
    const indexes = [
      { table: "orders", name: "orders_a_idx", scans: 0, backsConstraint: false },
      { table: "orders", name: "orders_pkey", scans: 0, backsConstraint: true },
      { table: "orders", name: "orders_b_idx", scans: 5, backsConstraint: false },
      { table: "stores", name: "stores_c_idx", scans: 0, backsConstraint: false },
    ];
    const today = reading(T1, { indexes });
    expect(platformFlags(today, reading(T0), { openedOn: "2026-09-22" }).map((f) => f.subject)).toEqual(["orders_a_idx"]);
    expect(ids(platformFlags(today, reading(T0), { openedOn: "2026-09-23" }))).toEqual([]);
    expect(ids(platformFlags(today, reading(T0)))).toEqual([]);
  });

  it("idle_route_calls: 1,200 idle calls raise only with idleCallsOn, and a null worked is skipped", () => {
    const job = (runs: number, worked: number | null, name = "route.a") => ({ job: name, runs, worked });
    const yesterday = reading(T0, { jobs: [job(0, 0), job(0, null, "route.b"), job(0, 0, "other")] });
    const today = reading(T1, { jobs: [job(1_300, 100), job(5_000, null, "route.b"), job(5_000, 0, "other")] });
    expect(ids(platformFlags(today, yesterday))).toEqual([]);
    expect(ids(platformFlags(today, yesterday, { idleCallsOn: true }))).toEqual(["idle_route_calls"]);
    const quiet = reading(T1, { jobs: [job(1_000, 0)] });
    expect(ids(platformFlags(quiet, yesterday, { idleCallsOn: true }))).toEqual([]);
  });

  it("ai_over_bar: over its bar for 7 days raises, for 6 does not", () => {
    const ai = (daysOver: number) => reading(T1, { ai: [{ feature: "chat", figure: "cost", value: 12, bar: 10, daysOver }] });
    expect(ids(platformFlags(ai(7), reading(T0)))).toEqual(["ai_over_bar"]);
    expect(ids(platformFlags(ai(6), reading(T0)))).toEqual([]);
    expect(ids(platformFlags(reading(T1, { ai: [{ feature: "chat", figure: "cost", value: 9, bar: 10, daysOver: 9 }] }), reading(T0)))).toEqual([]);
  });

  it("a counter that went down (a reset) gives a difference of 0 and no flag", () => {
    const yesterday = reading(T0, {
      statements: [stmt("a", "update commerce.x set a = $1", 5_000, 50, 5_000)],
      tables: [{ name: "t", rows: 900, bytes: 1, seqScans: 5_000, seqRowsRead: 1 }],
    });
    const today = reading(T1, {
      statements: [stmt("a", "update commerce.x set a = $1", 3, 50, 0)],
      tables: [{ name: "t", rows: 900, bytes: 1, seqScans: 2, seqRowsRead: 1 }],
    });
    expect(platformFlags(today, yesterday)).toEqual([]);
    expect(dayDifference(today, yesterday).statements[0]).toMatchObject({ calls: 0, totalMs: 0 });
  });

  it("the written lists stay small and each entry has a reason", () => {
    expect(WHOLE_READ_ALLOWED.length).toBeLessThanOrEqual(5);
    expect(COSTLY_ALLOWED.length).toBeLessThanOrEqual(3);
    for (const e of [...WHOLE_READ_ALLOWED, ...COSTLY_ALLOWED]) expect(e.reason.length).toBeGreaterThanOrEqual(20);
  });

  it("names eight flags", () => {
    expect(FLAG_IDS).toHaveLength(8);
  });
});

describe("dayDifference", () => {
  it("shows the schema change, the costliest statements and the tables read whole the most", () => {
    const yesterday = reading(T0, {
      schemas: [{ name: "cron", bytes: 10 * MB }, { name: "commerce", bytes: 5 * MB }, { name: "gone", bytes: 1 }],
      statements: [stmt("a", "select 1", 10, 1), stmt("b", "select 2", 10, 1)],
      tables: [{ name: "x", rows: 1, bytes: 1, seqScans: 1, seqRowsRead: 10 }],
    });
    const today = reading(T1, {
      schemas: [{ name: "cron", bytes: 12 * MB }, { name: "commerce", bytes: 5 * MB }, { name: "fresh", bytes: 9 }],
      statements: [stmt("a", "select 1", 20, 1), stmt("b", "select 2", 20, 9), stmt("c", "select 3", 99, 9)],
      tables: [{ name: "x", rows: 1, bytes: 1, seqScans: 4, seqRowsRead: 40 }],
    });
    const d = dayDifference(today, yesterday);
    expect(d.schemas[0]).toEqual({ name: "cron", bytesChange: 2 * MB });
    expect(d.schemas.map((s) => s.name)).not.toContain("fresh");
    expect(d.statements.map((s) => s.key)).toEqual(["b", "a"]);
    expect(d.tables).toEqual([{ name: "x", seqScans: 3, seqRowsRead: 30 }]);
  });
});
