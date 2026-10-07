import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The Selling group's features (D178 step 3, `docs/store-features.md` 4c) reach shoppers through two helpers, read from the source here:
 * - whether a product's kind is offered (an appointment, a stay or a rental, one sold only as a subscription) is asked only through `OFFERED`
 *   (`src/server/product-conditions.ts`), which every shopper-facing product read already asks (`audience-readers.scan.test.ts` lists them);
 *   nothing else calls `commerce.kind_offered()`;
 * - a purchase option (selling plan) is offered to a shopper only while Subscriptions is on: every shopper-facing read of `selling_plans`
 *   asks `plansOffered()`, and the booking pickers' loaders ask the booking's own feature.
 * Tests are exempt; migrations are SQL and not read here.
 */
const ROOT = process.cwd();

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** The source without its comment lines, so a comment that names a function is no reader. */
const code = (text: string) =>
  text
    .split("\n")
    .filter((line) => !/^\s*(\*|\/\/|\/\*|--)/.test(line))
    .join("\n");

const files = sources(path.join(ROOT, "src")).map((full) => ({ file: path.relative(ROOT, full).split(path.sep).join("/"), text: code(readFileSync(full, "utf8")) }));
const textOf = (file: string) => files.find((f) => f.file === file)?.text ?? "";

describe("readers of the Selling group's features (D178)", () => {
  it("asks whether a kind is offered only through OFFERED", () => {
    const callers = files.filter(({ text }) => /commerce\.kind_offered\(/.test(text)).map(({ file }) => file);
    expect(callers).toEqual(["src/server/product-conditions.ts"]);
    expect(textOf("src/server/product-conditions.ts")).toMatch(/export const OFFERED = sql`[^`]*commerce\.kind_offered\(p\.store_id, p\.kind, p\.subscription_only\)/);
  });

  it("offers purchase options to shoppers only while Subscriptions is on", () => {
    // Each reads selling plans for a shopper: the product page's options, the cart's lines and what a checkout sells.
    for (const file of ["src/server/catalog.ts", "src/server/cart.ts", "src/server/checkout.ts"]) {
      expect(textOf(file), file).toMatch(/\$\{plansOffered\(/);
    }
  });

  it("offers a booking's times only while its own feature is on", () => {
    expect(textOf("src/server/appointments.ts")).toMatch(/commerce\.feature_on\(s\.id, 'appointments'\)/);
    expect(textOf("src/server/ranges.ts")).toMatch(/commerce\.feature_on\(s\.id, 'bookings'\)/);
    // Nothing of the Selling group is read from the old modules' column any more.
    const modules = files.filter(({ text }) => /'(bookings|deliveries)' = any\s*\(\s*\w*\.?modules\)/.test(text)).map(({ file }) => file);
    expect(modules).toEqual([]);
  });
});
