import { describe, expect, it } from "vitest";

import { ANY_SUPPRESSED, ratchetCounts, UNKNOWN_CAST, UNTYPED_READ } from "../../scripts/lib/ratchet-count.mjs";
import baseline from "./ratchet.baseline.json";

/**
 * The ratchet of code review step 1.2 (findings FD6 and FH11): unchecked reads (`execute<…>(`) per file, casts through `unknown`
 * (`as unknown as`) and switched-off `any` rules in total, as `ratchet.baseline.json` records them. None may rise: a new read goes through
 * `typedRows()`/`typedRow()` (`typed-rows.ts`), a new file starts with none. And the numbers are kept true as they fall: a change that
 * types a read or drops a cast lowers the baseline with it (`node scripts/ratchet.mjs`), so the next one cannot spend the room.
 */

const now = ratchetCounts(process.cwd()) as { unknownCasts: number; anySuppressed: number; untypedReads: Record<string, number> };
const recorded: Record<string, number> = baseline.untypedReads;

describe("the ratchet (code review 1.2)", () => {
  it("adds no unchecked read: a file has no more than its baseline, and a file not in it has none", () => {
    const raised = Object.entries(now.untypedReads)
      .filter(([file, n]) => n > (recorded[file] ?? 0))
      .map(([file, n]) => `${file}: ${n} unchecked reads, baseline ${recorded[file] ?? 0}. Read through typedRows()/typedRow().`);
    expect(raised).toEqual([]);
  });

  it("adds no cast through unknown and no switched-off any", () => {
    expect(now.unknownCasts, "as unknown as in src, tests aside").toBeLessThanOrEqual(baseline.unknownCasts);
    expect(now.anySuppressed, "eslint-disable of no-explicit-any in src, tests aside").toBeLessThanOrEqual(baseline.anySuppressed);
  });

  it("keeps the baseline as low as the code: run `node scripts/ratchet.mjs` after a change lowers a number", () => {
    const lower = [
      ...Object.entries(recorded)
        .filter(([file, n]) => (now.untypedReads[file] ?? 0) < n)
        .map(([file, n]) => `${file}: ${now.untypedReads[file] ?? 0}, baseline ${n}`),
      ...(now.unknownCasts < baseline.unknownCasts ? [`as unknown as: ${now.unknownCasts}, baseline ${baseline.unknownCasts}`] : []),
      ...(now.anySuppressed < baseline.anySuppressed ? [`suppressed any: ${now.anySuppressed}, baseline ${baseline.anySuppressed}`] : []),
    ];
    expect(lower).toEqual([]);
  });

  it("counts what it says it counts", () => {
    const n = (text: string, pattern: RegExp) => (text.match(pattern) ?? []).length;
    expect(n("await tx.execute<Row>(sql`select 1`); await db().execute<Array<Row>>(sql`x`)", UNTYPED_READ)).toBe(2);
    expect(n("await typedRows(ROW, sql`select 1`, tx); await tx.execute(sql`update x`)", UNTYPED_READ)).toBe(0);
    expect(n("const s = value as unknown as Store;", UNKNOWN_CAST)).toBe(1);
    expect(n("// eslint-disable-next-line @typescript-eslint/no-explicit-any", ANY_SUPPRESSED)).toBe(1);
  });
});
