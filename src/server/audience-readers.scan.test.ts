import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Who a store sells to (B2B) is the owner's choice only while Sell to businesses is on (D178, `docs/store-features.md`): everything a
 * shopper meets reads the effective audience, `store.audience` from `getStore()` (`effectiveAudience()`) or, in SQL,
 * `commerce.store_audience(s.audience, s.features)` (`STORE_AUDIENCE` in `product-conditions.ts`). Read from the source:
 * - the stores' raw `audience` column is read only by the modules listed here, each with why;
 * - the owner's own choice (`chosenAudience`) is read only where it is edited.
 * Tests are exempt; migrations are SQL and not read here.
 */
const ROOT = process.cwd();

/** Modules that read `stores.audience` itself, and why. */
const RAW_READERS: Record<string, string> = {
  "src/server/stores.ts": "getStore() reads the column and the features, and gives the effective audience (and the owner's choice apart)",
  "src/server/product-conditions.ts": "STORE_AUDIENCE: the SQL fragment that applies the feature",
};

/** Modules that may read the owner's own choice of audience. */
const CHOICE_READERS = new Set(["src/server/stores.ts", "src/app/admin/(gated)/[store]/settings/company/page.tsx"]);

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** The source without its comment lines, so a comment that names the column is no reader. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
    .join("\n");

const files = sources(path.join(ROOT, "src")).map((full) => ({ file: path.relative(ROOT, full).split(path.sep).join("/"), text: code(readFileSync(full, "utf8")) }));

describe("readers of a store's audience (D178)", () => {
  it("reads the stores' audience column only through the effective audience", () => {
    const raw = files
      .filter(({ text }) =>
        text
          .split("\n")
          // `s.audience`, `st.audience` or `stores.audience` in SQL, unless handed straight to `commerce.store_audience()`.
          .some((line) => /\b(s|st|stores)\.audience\b/.test(line.replace(/commerce\.store_audience\((s|st)\.audience, (s|st)\.features\)/g, ""))),
      )
      .map(({ file }) => file)
      .filter((file) => !file.startsWith("src/db/"));
    expect(raw.filter((file) => !(file in RAW_READERS))).toEqual([]);
  });

  it("reads the owner's own choice only where it is edited", () => {
    const readers = files.filter(({ text }) => /\bchosenAudience\b/.test(text)).map(({ file }) => file);
    expect(readers.filter((file) => !CHOICE_READERS.has(file))).toEqual([]);
  });

  it("asks every shopper-facing product read whether the product is offered", () => {
    // Each of these lists, finds or sells products to shoppers: a business-only product must not leak where the store sells to consumers.
    const offered = [
      "src/server/catalog.ts",
      "src/server/listing.ts",
      "src/server/search.ts",
      "src/server/recommend.ts",
      "src/server/seo.ts",
      "src/server/cart.ts",
      "src/server/checkout.ts",
      "src/server/wishlists.ts",
      "src/server/wordpress-shop.ts",
      "src/server/standing-orders.ts",
    ];
    for (const file of offered) {
      expect(files.find((f) => f.file === file)?.text, file).toMatch(/\$\{OFFERED\}/);
    }
  });
});
