import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Stock has one reader (wave 3, D172, `docs/wave-3-inventory.md` 2.3): `commerce.variant_availability`, through `variantStockOf()` in
 * `src/server/catalog.ts`. A module that reads `commerce.available_stock` or `inventory_levels` to answer "can this be bought" would not know the
 * active locations, the stock policy or the backorder days, so it would disagree with the cart and with checkout. `getAvailability()`, the old
 * number-only door, is gone and must not come back.
 */
const ROOT = process.cwd();
const READER = /\bavailable_stock\b/;
const OLD_DOOR = /\bgetAvailability\b/;

const VIEW_ALLOWED: Record<string, string> = {};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const code = (text: string) => text.split("\n").map((l, i) => [i + 1, l] as const).filter(([, l]) => !/^\s*(\/\/|\*|\/\*)/.test(l));

describe("stock is read in one place", () => {
  const files = walk(path.join(ROOT, "src"));

  it("has no module that reads available_stock itself", () => {
    const hits: string[] = [];
    for (const file of files) {
      const name = path.relative(ROOT, file);
      if (Object.hasOwn(VIEW_ALLOWED, name)) continue;
      for (const [n, line] of code(readFileSync(file, "utf8"))) if (READER.test(line)) hits.push(`${name}:${n} ${line.trim()}`);
    }
    expect(hits).toEqual([]);
  });

  it("has no getAvailability() left, defined or called", () => {
    const hits: string[] = [];
    for (const file of files) {
      const name = path.relative(ROOT, file);
      for (const [n, line] of code(readFileSync(file, "utf8"))) if (OLD_DOOR.test(line)) hits.push(`${name}:${n} ${line.trim()}`);
    }
    expect(hits).toEqual([]);
  });
});
