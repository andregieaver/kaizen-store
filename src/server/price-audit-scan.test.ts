import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * A price only changes through `commerce.set_price`, and every caller of it must write the price down (wave 1, 1f, docs/wave-1-trust.md 2.10): a
 * new caller of the function that does not write `product.price_changed` fails here, so a price cannot change without an entry.
 * Market price rules (D335 A.2) are the second caller: inside a product's save its derived prices are in that save's entries (the snapshot is
 * read after the save), and a rule saved or taken away, or the rates changing, writes one entry for the batch with its counts.
 */
const walk = (dir: string, found: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, found);
    // Fixtures that tests build their rows with (`*-fixture.ts`, imported by tests only) are not the app, as in `document-readers.test.ts`.
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.int\.test\.ts$/.test(name) && !/-fixture\.tsx?$/.test(name)) found.push(path);
  }
  return found;
};

describe("every caller of commerce.set_price writes the price entry", () => {
  const files = walk(join(process.cwd(), "src")).filter((file) => !file.endsWith("src/db/schema.ts"));
  const callers = files.filter((file) => /commerce\.set_price\s*\(/.test(readFileSync(file, "utf8")));

  it("finds the two callers there are today", () => {
    expect(callers.map((f) => f.replace(process.cwd(), "")).sort()).toEqual(["/src/server/market-prices.ts", "/src/server/products.ts"]);
  });

  it("whose rule changes write their batch's entry, and whose work after a rate change does too", () => {
    const rules = readFileSync(join(process.cwd(), "src/server/market-prices.ts"), "utf8");
    expect(rules).toContain('"settings.market_price_rule"');
    expect(rules).toContain('"settings.market_price_rule_removed"');
    const rates = readFileSync(join(process.cwd(), "src/server/localization.ts"), "utf8");
    expect(rates.match(/deriveForProducts\(/g)?.length).toBe(rates.match(/"settings\.market_prices_derived"/g)?.length);
  });

  it("which writes the entry around its save, and the entry is the one the activity log knows", () => {
    for (const file of callers.filter((f) => f.endsWith("products.ts"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).toMatch(/auditProductSave\(/);
      expect(text, file).toMatch(/productSnapshot\(/);
    }
    const audit = readFileSync(join(process.cwd(), "src/server/product-audit.ts"), "utf8");
    expect(audit).toContain('"product.price_changed"');
    expect(audit).toMatch(/"price"/);
  });

  it("and nothing outside the product editor's save changes a price some other way", () => {
    const writers = files.filter((file) => /update commerce\.prices|insert into commerce\.prices/.test(readFileSync(file, "utf8")));
    // The editor's own save ends a price (history kept), and a rule marks and ends its own (D335); seeds and migrations are not application code.
    expect(writers.map((f) => f.replace(process.cwd(), "")).sort()).toEqual(["/src/server/market-prices.ts", "/src/server/products.ts"]);
  });
});
