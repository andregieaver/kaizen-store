import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A level changes only with its reason (wave 3, D172, `docs/wave-3-inventory.md` 2.2): every change of `commerce.inventory_levels` becomes a row of
 * `commerce.inventory_movements` by a trigger, which reads the transaction's `kaizen.stock` context (`withStockContext()`,
 * `src/server/stock-context.ts`). A write with no context is still recorded, but as "system", which tells the owner nothing. So a module of the app
 * that inserts, updates or deletes a level must set a context, or be listed here with the reason it does not need one. The fixtures that make test
 * data are exempt: they are never imported by the app.
 */
const ROOT = process.cwd();
const WRITES = /\b(insert\s+into|update|delete\s+from)\s+commerce\.inventory_levels\b/i;
const CONTEXT = /withStockContext|stock_context|setStockContext/;

const ALLOWED: Record<string, string> = {
  "src/server/order-insert.ts": "adds a level of 0 for a variant that keeps selling past zero and has none, so there is a row to lock; a change of 0 is no movement (the trigger returns before writing one), and the sale itself is written by commerce.draw_order_stock() with the order",
  "src/server/invoice-test-fixture.ts": "test fixture",
  "src/server/analytics-insights-fixture.ts": "test fixture",
  "src/server/inventory-test-support.ts": "test fixture",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe("a level is written only with a stock context", () => {
  const files = walk(path.join(ROOT, "src"));

  it("finds the modules", () => {
    expect(files.length).toBeGreaterThan(200);
  });

  it("has no module that writes inventory_levels without a context, except the listed ones", () => {
    const hits: string[] = [];
    for (const file of files) {
      const name = path.relative(ROOT, file);
      if (Object.hasOwn(ALLOWED, name)) continue;
      const text = readFileSync(file, "utf8");
      const lines = text.split("\n");
      const writes = lines.flatMap((line, i) => (/^\s*(\/\/|\*|\/\*)/.test(line) || !WRITES.test(line) ? [] : [i + 1]));
      if (writes.length > 0 && !CONTEXT.test(text)) hits.push(`${name}:${writes.join(",")} writes a level and sets no stock context`);
    }
    expect(hits).toEqual([]);
  });

  it("lists only modules that still write a level (a stale entry is removed)", () => {
    for (const name of Object.keys(ALLOWED)) {
      const text = readFileSync(path.join(ROOT, name), "utf8");
      expect(WRITES.test(text), `${name} no longer writes a level`).toBe(true);
    }
  });
});
