import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Where money is written or shown to shoppers, every read is checked (code review step 1.1, finding FV1): it goes through
 * `typedRows()`/`typedRow()` (`src/server/typed-rows.ts`), whose `col.minor` and `col.currency` throw `RowShapeError` naming a changed
 * column, never `execute<Row>()`, whose `Number()` turns one into NaN or 0. These are the modules the review named; a read added to one of
 * them is typed from the start. The rest of `src/server` is held by the ratchet of step 1.2.
 */

const ROOT = process.cwd();

const MONEY_MODULES = [
  "src/server/checkout.ts",
  "src/server/order-insert.ts",
  "src/server/order-edits.ts",
  "src/server/returns.ts",
  "src/server/exchanges.ts",
  "src/server/draft-orders.ts",
  "src/server/stripe-refunds.ts",
  "src/server/billing.ts",
  "src/server/catalog.ts",
  "src/server/cart.ts",
  "src/server/listing.ts",
  "src/server/search.ts",
];

/** An untyped read: `execute<…>(`, on `db()`, a transaction or any other executor. */
const UNTYPED_READ = /\.execute<[^(]*>\(/;

describe("the money modules' reads (code review FV1)", () => {
  it.each(MONEY_MODULES)("%s reads only through typedRows() or typedRow()", (path) => {
    const text = readFileSync(join(ROOT, path), "utf8");
    const lines = text.split("\n").flatMap((line, i) => (UNTYPED_READ.test(line) ? [`${path}:${i + 1}: ${line.trim()}`] : []));
    expect(lines).toEqual([]);
  });

  it("catches an untyped read", () => {
    expect(UNTYPED_READ.test("  const [row] = await tx.execute<Row>(sql`select 1`);")).toBe(true);
    expect(UNTYPED_READ.test("  const rows = await db().execute<{ n: number }>(sql`select 1`);")).toBe(true);
    expect(UNTYPED_READ.test("  const rows = await tx.execute<Array<Row>>(sql`select 1`);")).toBe(true);
    expect(UNTYPED_READ.test("  const rows = await typedRows(ROW, sql`select 1`, tx);")).toBe(false);
  });
});
