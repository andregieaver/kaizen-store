import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Who reads what (D157, docs/wave-1a-tax.md sections 3.7 and 5.2). A product's VAT rate is only `commerce.vat_rate(country,
 * category, at)`, so nothing but the VAT modules reads `commerce.vat_rates` or `countries.standard_vat_rate`; a buyer's VAT number
 * and VIES's answer are private (the cart, the order, the shopper's own pages, staff with access to the order), so only the
 * modules below read `commerce.vat_checks`, `carts.vat_number` or `orders.vat_treatment`. A module that reads one of them and is
 * not listed is new, and must be looked at (and, if a shopper or the public reaches it, kept away from other people's numbers)
 * before it is added here. The seller's own number is public by design on documents; the public routes below carry none.
 */

const files = (dir: string, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files(full, out);
    // Fixtures that tests build their rows with (`*-fixture.ts`, imported by tests only) are not the app, as in order-numbers.test.ts.
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

describe("who reads a product's rate", () => {
  it("is `commerce.vat_rate()` for everyone; the table `vat_rates` is read by the VAT modules only", () => {
    expect(readers(/commerce\.vat_rates|from vat_rates|join .*vat_rates/)).toEqual(["src/server/vat-admin.ts", "src/server/vat-categories.ts"]);
  });

  it("never reads `countries.standard_vat_rate`: the cached column is the database's own (it keeps it equal to the rate in force)", () => {
    // `b2b.ts` only mentions it in a comment; `vat-admin.ts` names the function that keeps it up to date.
    expect(readers(/standard_vat_rate|standardVatRate/)).toEqual(["src/lib/b2b.ts", "src/server/vat-admin.ts"]);
    const code = sources.filter(({ file }) => file === "src/lib/b2b.ts" || file === "src/server/vat-admin.ts");
    for (const { text } of code) {
      const lines = text.split("\n").filter((line) => /standard_vat_rate|standardVatRate/.test(line));
      for (const line of lines) expect(line, "only a comment or the sync function's name").toMatch(/\/\/|\/\*|\*|sync_standard_vat_rates/);
    }
  });
});

describe("who reads a buyer's VAT number and VIES's answer", () => {
  it("is the check log's modules, for `commerce.vat_checks`", () => {
    expect(readers(/commerce\.vat_checks/)).toEqual(["src/server/cart.ts", "src/server/tax-treatment.ts", "src/server/vat-checks.ts"]);
  });

  it("is the VAT modules and the cart, for the number on the cart and the check an order rests on", () => {
    // `personal-data.ts` (the register of personal data, D162) names the column to say what erasure does to it; it reads nothing. The erasure and the retention
    // schedule only clear a cart's link to a check (the order's own check is anonymised by `commerce.anonymise_order()`).
    expect(readers(/\bvat_check_id\b/)).toEqual(["src/lib/personal-data.ts", "src/server/cart.ts", "src/server/checkout.ts", "src/server/privacy-erasure.ts", "src/server/retention.ts", "src/server/tax-treatment.ts", "src/server/vat-checks.ts"]);
  });

  it("is the order's own modules, for the treatment an order keeps (the shopper's copy has no registered name or address)", () => {
    const orders = readers(/\bvat_treatment\b/).filter((file) => !/work|vat-treatment\.ts$/.test(file));
    // `checkout.ts` writes it, `orders.ts` reads it for the order page and for staff, `tax-treatment.ts` builds it,
    // `owner-tools.ts` mentions the column's name in a comment on what the assistant is told (kind and relief only).
    // `personal-data.ts` (the register of personal data, D162) names the keys erasure removes from it; it reads nothing. The data export reads the treatment's
    // reason code only (never the number or VIES's answer). The owner's order file (D165) reads the kind, the relief and the buyer's own number, for the
    // owner's accounting, and writes them to a file that is only ever downloaded by the owner.
    expect(orders).toEqual(["src/lib/personal-data.ts", "src/server/checkout.ts", "src/server/order-export.ts", "src/server/orders.ts", "src/server/owner-tools.ts", "src/server/privacy-export.ts", "src/server/tax-treatment.ts"]);
  });

  it("is not in a shopper's view of an order: `OrderView.vat` has no registered name or address", () => {
    const text = sources.find(({ file }) => file === "src/server/orders.ts")!.text;
    const shopperVat = text.slice(text.indexOf("function shopperVat"), text.indexOf("const toOrder"));
    expect(shopperVat).toContain("shopperTreatment");
    expect(shopperVat).not.toMatch(/registeredName|registeredAddress/);
  });
});

describe("who asks VIES", () => {
  it("is one module, with the one constant address, and only the check log's module calls it", () => {
    expect(readers(/\bVIES_URL\b|\bVIES_HOST\b/)).toEqual(["src/lib/vies.ts"]);
    expect(readers(/\bcheckVatNumber\(/)).toEqual(["src/server/vat-checks.ts", "src/server/vies.ts"]);
    // A person's text never becomes part of an address: the call builds its body from the closed list of prefixes and the number's characters.
    const call = sources.find(({ file }) => file === "src/server/vies.ts")!.text;
    expect(call).not.toMatch(/new URL\(|\$\{[^}]*\}[^`]*\/rest-api/);
  });
});

describe("what is public", () => {
  const publicModules = [
    "src/app/sitemap.xml/route.ts",
    "src/app/sitemap-kaizen.xml/route.ts",
    "src/app/llms.txt/route.ts",
    "src/app/s/[store]/llms.txt/route.ts",
    "src/lib/structured-data.ts",
    "src/lib/seo.ts",
  ].filter((file) => sources.some((s) => s.file === file));

  it("carries no VAT number or treatment: not the sitemap, llms.txt, the structured data or the search tags", () => {
    expect(publicModules.length).toBeGreaterThan(2);
    for (const file of publicModules) {
      const text = sources.find((s) => s.file === file)!.text;
      expect(text, file).not.toMatch(/vat_number|vatNumber|vat_treatment|vatTreatment|vat_checks|reverse_charge/);
    }
  });

  it("is not reached by the cart's VAT field: it sets no cookie and uses no storage", () => {
    const field = sources.find((s) => s.file === "src/components/vat-number-field.tsx");
    if (!field) return; // the shopper surface is a later step; once it exists it is held to this
    expect(field.text).not.toMatch(/localStorage|sessionStorage|document\.cookie|cookies\(\)/);
  });
});
