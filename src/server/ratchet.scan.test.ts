import { describe, expect, it } from "vitest";

import { ANY_SUPPRESSED, BIG_FILE_BYTES, LONG_FILE_LINES, NOT_DISTINCT_STORE, ratchetCounts, UNKNOWN_CAST, unscopedWrites, UNTYPED_READ } from "../../scripts/lib/ratchet-count.mjs";
import baseline from "./ratchet.baseline.json";

/**
 * The ratchet of code review step 1.2 (findings FD6 and FH11): unchecked reads (`execute<…>(`) per file, casts through `unknown`
 * (`as unknown as`) and switched-off `any` rules in total, as `ratchet.baseline.json` records them. None may rise: a new read goes through
 * `typedRows()`/`typedRow()` (`typed-rows.ts`), a new file starts with none. And the numbers are kept true as they fall: a change that
 * types a read or drops a cast lowers the baseline with it (`node scripts/ratchet.mjs`), so the next one cannot spend the room.
 */

const now = ratchetCounts(process.cwd()) as {
  unknownCasts: number;
  anySuppressed: number;
  filesOver100Kb: number;
  filesOver2000Lines: number;
  untypedReads: Record<string, number>;
  byIdWrites: Record<string, number>;
  notDistinctStore: Record<string, number>;
};
const recorded: Record<string, number> = baseline.untypedReads;
const recordedWrites: Record<string, number> = baseline.byIdWrites;
const recordedNotDistinct: Record<string, number> = baseline.notDistinctStore;

describe("the ratchet (code review 1.2)", () => {
  it("adds no unchecked read: a file has no more than its baseline, and a file not in it has none", () => {
    const raised = Object.entries(now.untypedReads)
      .filter(([file, n]) => n > (recorded[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} unchecked reads, baseline ${recorded[file] ?? 0}. Read through typedRows()/typedRow().`);
    expect(raised).toEqual([]);
  });

  it("adds no write that picks a store's row by its id alone (code review 1.3, FV5): it names the store too", () => {
    const raised = Object.entries(now.byIdWrites)
      .filter(([file, n]) => n > (recordedWrites[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} writes by id without the store, baseline ${recordedWrites[file] ?? 0}. Add \`and store_id = …\`.`);
    expect(raised).toEqual([]);
  });

  it("adds no `store_id is not distinct from` (step 0.23): a store's rows are filtered with owned(), which an index serves", () => {
    const raised = Object.entries(now.notDistinctStore)
      .filter(([file, n]) => n > (recordedNotDistinct[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} uses of store_id is not distinct from, baseline ${recordedNotDistinct[file] ?? 0}. Filter with owned(storeId) (src/server/owned.ts); lower the baseline with node scripts/ratchet.mjs when a count falls.`);
    expect(raised).toEqual([]);
  });

  it("adds no cast through unknown and no switched-off any", () => {
    expect(now.unknownCasts, "as unknown as in src, tests aside").toBeLessThanOrEqual(baseline.unknownCasts);
    expect(now.anySuppressed, "eslint-disable of no-explicit-any in src, tests aside").toBeLessThanOrEqual(baseline.anySuppressed);
  });

  it("adds no source file over 100 KB or over 2,000 lines: read by window, the counts only fall", () => {
    const how = "Split the file, or move code out of it; never raise the number.";
    expect(now.filesOver100Kb, `source files over 100 KB. ${how}`).toBeLessThanOrEqual(baseline.filesOver100Kb);
    expect(now.filesOver2000Lines, `source files over 2,000 lines. ${how}`).toBeLessThanOrEqual(baseline.filesOver2000Lines);
  });

  it("keeps the baseline as low as the code: run `node scripts/ratchet.mjs` after a change lowers a number", () => {
    const lower = [
      ...Object.entries(recorded)
        .filter(([file, n]) => (now.untypedReads[file] ?? 0) < n)
        .map(([file, n]) => `${file}: ${now.untypedReads[file] ?? 0}, baseline ${n}`),
      ...Object.entries(recordedWrites)
        .filter(([file, n]) => (now.byIdWrites[file] ?? 0) < n)
        .map(([file, n]) => `${file}: ${now.byIdWrites[file] ?? 0} writes by id without the store, baseline ${n}`),
      ...Object.entries(recordedNotDistinct)
        .filter(([file, n]) => (now.notDistinctStore[file] ?? 0) < n)
        .map(([file, n]) => `${file}: ${now.notDistinctStore[file] ?? 0} uses of store_id is not distinct from, baseline ${n}`),
      ...(now.unknownCasts < baseline.unknownCasts ? [`as unknown as: ${now.unknownCasts}, baseline ${baseline.unknownCasts}`] : []),
      ...(now.anySuppressed < baseline.anySuppressed ? [`suppressed any: ${now.anySuppressed}, baseline ${baseline.anySuppressed}`] : []),
      ...(now.filesOver100Kb < baseline.filesOver100Kb ? [`source files over 100 KB: ${now.filesOver100Kb}, baseline ${baseline.filesOver100Kb}`] : []),
      ...(now.filesOver2000Lines < baseline.filesOver2000Lines ? [`source files over 2,000 lines: ${now.filesOver2000Lines}, baseline ${baseline.filesOver2000Lines}`] : []),
    ];
    expect(lower).toEqual([]);
  });

  it("counts what it says it counts", () => {
    const n = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
    expect(n("await tx.execute<Row>(sql`select 1`); await db().execute<Array<Row>>(sql`x`)", UNTYPED_READ)).toBe(2);
    expect(n("await typedRows(ROW, sql`select 1`, tx); await tx.execute(sql`update x`)", UNTYPED_READ)).toBe(0);
    expect(n("const s = value as unknown as Store;", UNKNOWN_CAST)).toBe(1);
    expect(n("where a.store_id is not distinct from ${x}::uuid and store_id\n  IS NOT DISTINCT FROM ${y}", NOT_DISTINCT_STORE)).toBe(2);
    expect(n("where ${owned(storeId)} and p.account_id is not distinct from ${a}::uuid", NOT_DISTINCT_STORE)).toBe(0);
    expect(n("// eslint-disable-next-line @typescript-eslint/no-explicit-any", ANY_SUPPRESSED)).toBe(1);
    // A file is long past 2,000 lines, not at 2,000; big past 100,000 bytes.
    const lines = (k: number) => Array.from({ length: k }, () => "x").join("\n");
    expect(lines(2_001).split("\n").length > LONG_FILE_LINES).toBe(true);
    expect(lines(2_000).split("\n").length > LONG_FILE_LINES).toBe(false);
    expect(Buffer.byteLength("x".repeat(BIG_FILE_BYTES + 1)) > BIG_FILE_BYTES).toBe(true);
    expect(Buffer.byteLength("x".repeat(BIG_FILE_BYTES)) > BIG_FILE_BYTES).toBe(false);
    const tables = new Set(["media", "experiments"]);
    expect(unscopedWrites("sql`delete from commerce.media where id = ${id}::uuid`", tables)).toBe(1);
    expect(unscopedWrites("sql`update commerce.experiments e set status = 'done' where e.id = ${id}::uuid`", tables)).toBe(1);
    expect(unscopedWrites("sql`delete from commerce.media where store_id = ${s}::uuid and id = ${id}::uuid`", tables)).toBe(0);
    expect(unscopedWrites("sql`update commerce.media set x = 1 where ${owned(storeId)} and id = ${id}::uuid`", tables)).toBe(0);
    // A table without a store, and a write by another key, are not this rule's.
    expect(unscopedWrites("sql`delete from commerce.accounts where id = ${id}::uuid`", tables)).toBe(0);
    expect(unscopedWrites("sql`delete from commerce.media where expires_at < now()`", tables)).toBe(0);
  });
});
