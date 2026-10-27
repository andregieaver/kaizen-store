import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The read replica (D314, `docs/capacity.md` step 3.4) may lag a moment behind the primary, so only reads that can afford that use it:
 * the analytics pages' own data. A new reader is a decision, written here with its reason; never a cache refilled after `updateTag()`,
 * anything read after a write in the same request, checkout, stock, payments or tax reports.
 */
const ROOT = process.cwd();

const REPLICA_DB: Record<string, string> = {
  "src/db/client.ts": "where it is made",
  "src/server/analytics-totals.ts": "setBasedReplica(), the analytics pages' heavy reads",
};

const REPLICA_READS = new Set([
  "src/server/analytics-customers-data.ts",
  "src/server/analytics-discounts-data.ts",
  "src/server/analytics-geo-data.ts",
  "src/server/analytics-inventory-data.ts",
  "src/server/analytics-payments-data.ts",
  "src/server/analytics-products-data.ts",
  "src/server/analytics-refunds-data.ts",
  "src/server/analytics-returns-data.ts",
  "src/server/analytics-subscriptions-data.ts",
  "src/server/analytics-time-data.ts",
  "src/server/analytics-traffic-data.ts",
  "src/server/analytics-totals.ts",
  "src/server/report-query.ts",
]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("the read replica's readers (D314)", () => {
  const sources = files(path.join(ROOT, "src")).map((f) => ({ file: path.relative(ROOT, f), text: readFileSync(f, "utf8") }));

  it("is reached only from the listed modules", () => {
    expect(sources.filter((s) => /\breplicaDb\b/.test(s.text)).map((s) => s.file).sort()).toEqual(Object.keys(REPLICA_DB).sort());
    expect(sources.filter((s) => /\bsetBasedReplica\b/.test(s.text)).map((s) => s.file).sort()).toEqual([...REPLICA_READS].sort());
  });

  it("keeps tax reports and stock on the primary", () => {
    for (const file of ["src/server/tax-reports.ts", "src/server/tax-reconciliation.ts", "src/server/inventory.ts"]) {
      expect(REPLICA_READS.has(file), file).toBe(false);
    }
  });
});
