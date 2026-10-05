import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * An import and a bulk edit write products only through the editor's own door (D165, `docs/wave-2-data.md` 2.2 rule 4, 6.1, 6.5): this
 * scan holds that no module of the import, the export, the bulk editor or the job runner writes `products`, `product_variants`, `prices` or
 * `inventory_levels` itself, calls `commerce.set_price`, or fetches an address a person typed with a plain `fetch` (pictures go through
 * `safeFetch()`). `saveProduct()` (`src/server/products.ts`) is the one that does, so `commerce.set_price` keeps its one caller
 * (`price-audit-scan.test.ts`) and the editor's checks (`productProblems()`, the unit price, the VAT category, the publishing triggers) apply.
 */
const ROOT = process.cwd();
const LIB = path.join(ROOT, "src", "lib");
const SERVER = path.join(ROOT, "src", "server");

const PURE = ["product-csv", "product-csv-shopify", "product-import", "bulk-edit", "order-csv", "customer-csv", "field-csv", "csv", "data-job", "data-limits", "analytics-export"].map((n) => path.join(LIB, `${n}.ts`));
const SERVER_NAMES = /^(product-import|product-export|product-roundtrip|bulk-edit|data-jobs?|data-job-emails|data-storage|order-export|customer-export|analytics-export)[a-z-]*\.ts$/;

function serverModules(): string[] {
  if (!existsSync(SERVER)) return [];
  return readdirSync(SERVER)
    .filter((n) => SERVER_NAMES.test(n) && !/\.test\.ts$/.test(n))
    .map((n) => path.join(SERVER, n));
}

const FORBIDDEN: [RegExp, string][] = [
  [/\b(insert\s+into|update|delete\s+from)\s+commerce\.(products|product_variants|prices|inventory_levels|product_media|product_translations|product_terms)\b/i, "writes a catalogue table itself"],
  [/commerce\.set_price/i, "calls commerce.set_price itself"],
  [/(?<![A-Za-z.])fetch\(/, "fetches with a plain fetch (use safeFetch())"],
];

const ALLOWED: Record<string, string> = {
  // `data-jobs.ts` and the exports read; none writes the catalogue. Add a module here only with the reason.
};

describe("an import or a bulk edit writes only through the editor's door", () => {
  const files = [...PURE, ...serverModules()].filter((f) => existsSync(f));

  it("finds the modules", () => {
    expect(files.length).toBeGreaterThanOrEqual(PURE.length);
  });

  it("has no module that writes the catalogue, calls set_price or fetches an address with a plain fetch", () => {
    const hits: string[] = [];
    for (const file of files) {
      const name = path.relative(ROOT, file);
      if (Object.hasOwn(ALLOWED, name)) continue;
      const text = readFileSync(file, "utf8");
      for (const [i, line] of text.split("\n").entries()) {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
        for (const [re, why] of FORBIDDEN) if (re.test(line)) hits.push(`${name}:${i + 1} ${why}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("imports no server-only module into the pure libraries (they run in the browser too)", () => {
    for (const file of PURE) {
      const text = readFileSync(file, "utf8");
      expect([path.basename(file), /from "server-only"|from "@\/server\//.test(text)]).toEqual([path.basename(file), false]);
    }
  });
});
