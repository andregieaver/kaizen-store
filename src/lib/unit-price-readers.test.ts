import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Who reads a variant's content (D160, docs/wave-1d-unit-price.md 6.3). The price per kg, litre or metre is only worked out by
 * `unitPrice()` in `src/lib/unit-price.ts`, from the price as the surface shows it, so the few modules that read the content
 * columns do it to hand a `ShownMeasure` to the surfaces (never to divide), and nothing else touches them. A module that reads
 * the columns and is not listed is new, and must be looked at before it is added here: it must not work out a figure of its own.
 */

const files = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/-fixture\.tsx?$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
};

const root = path.resolve(__dirname, "../..");
const sources = files(path.join(root, "src")).map((file) => ({ file: path.relative(root, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));

const readers = (pattern: RegExp) =>
  sources
    .filter(({ file, text }) => file !== "src/db/schema.ts" && pattern.test(text))
    .map(({ file }) => file)
    .sort();

describe("who reads a variant's content", () => {
  it("is the catalogue, cart, checkout, order, subscription and list reads, the product's save and audit, and the unit price modules", () => {
    expect(readers(/measure_amount|measureAmount|parseMeasureAmount|normaliseMeasureAmount|measureFromColumns/)).toEqual([
      "src/lib/product-input.ts",
      "src/lib/unit-price-rules.ts",
      "src/lib/unit-price.ts",
      "src/server/cart.ts",
      "src/server/catalog.ts",
      "src/server/checkout.ts",
      "src/server/orders.ts",
      "src/server/product-audit.ts",
      "src/server/products.ts",
      "src/server/standing-orders.ts",
      "src/server/subscriptions.ts",
      "src/server/unit-price-gaps.ts",
    ]);
  });

  it("reads the sold line's snapshot only where an order line is read: the order view, the checkout's insert and the renewal", () => {
    expect(readers(/\bmeasure_(amount|unit|base)\b/).filter((file) => !/unit-price/.test(file))).toEqual([
      "src/server/cart.ts",
      "src/server/catalog.ts",
      "src/server/checkout.ts",
      "src/server/orders.ts",
      "src/server/product-audit.ts",
      "src/server/products.ts",
      "src/server/standing-orders.ts",
      "src/server/subscriptions.ts",
    ]);
  });
});

describe("the unit price is worked out in one place", () => {
  it("no module outside unit-price.ts does arithmetic on a content", () => {
    for (const { file, text } of sources) {
      if (file === "src/lib/unit-price.ts") continue;
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        expect(line, `${file}:${i + 1} does arithmetic on a content`).not.toMatch(/measure\??\.amount\s*[*/+-]|[*/]\s*\w*measure\??\.amount|(parseFloat|Number)\(\s*\w*measure\??\.amount/);
      });
    }
  });

  it("the 30-day reference price is never given to the unit price", () => {
    for (const { file, text } of sources) {
      if (file === "src/lib/unit-price.ts") continue;
      text.split("\n").forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (!/\b(unitPrice|unitPriceShown|lineUnitPriceText|priceUnitSentence)\(/.test(line)) return;
        expect(line, `${file}:${i + 1} hands the reference price to a unit price`).not.toMatch(/referenceMinor|prior_30d|prior30d/);
      });
    }
  });
});
