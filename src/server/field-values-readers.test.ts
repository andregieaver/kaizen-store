import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Who reads what was entered in custom fields (D120). A customer's and an
 * order's values are for staff only and must never reach the storefront, the
 * chat agent, search, filters, structured data, emails, integrations or the
 * shopper's own pages. Those all read fields through a few modules, each of
 * which names the kinds of thing it reads; a module that reads
 * `commerce.field_values` and is not listed here is new, and must be looked at
 * (and, if it is anything a shopper reaches, kept away from customers' and
 * orders' values) before it is added.
 */

const READERS = [
  // `getFieldData()` by entity, and the variants' read: what the site's `shownFieldsFor()` refuses for staff's things.
  "src/server/custom-fields.ts",
  // The worklist for translating: only the kinds of thing with public fields.
  "src/server/field-translate.ts",
  // Keyword search: products only.
  "src/server/field-search.ts",
  // The listing's filters: products only.
  "src/server/listing.ts",
  // A content grid's tile fields: products, pages and articles.
  "src/server/field-tiles.ts",
  // Duplicating a page: copies a page's or article's values to the copy, staff only.
  "src/server/page-duplicate.ts",
];

function sources(root: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const full = path.join(root, name);
    if (statSync(full).isDirectory()) found.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.(test|int\.test)\.(ts|tsx)$/.test(name)) found.push(full);
  }
  return found;
}

const root = process.cwd();
const all = sources(path.join(root, "src")).map((file) => path.relative(root, file));
const mentions = (file: string) => readFileSync(path.join(root, file), "utf8");

describe("who reads custom field values", () => {
  it("is a short list of modules, none of which is a shopper's page, an email or an integration", () => {
    const reading = all.filter((file) => /commerce\.field_values/.test(mentions(file)) && !file.startsWith("src/db/"));
    expect(reading.sort()).toEqual([...READERS].sort());
  });

  it("never reads customers' or orders' values by name, apart from the staff's own editors", () => {
    // The staff editors (`field-entities.ts`) reach them through `getFieldData()`, checked against the store's own thing.
    const naming = all.filter(
      (file) => !file.startsWith("src/db/") && /field_values[\s\S]{0,300}'(customer|order)'/.test(mentions(file)) && !READERS.includes(file),
    );
    expect(naming).toEqual([]);
    for (const file of READERS.filter((f) => f !== "src/server/custom-fields.ts")) {
      expect(mentions(file), file).not.toMatch(/'(customer|order)'/);
    }
  });

  it("is not reached from the shopper's pages, the chat agent, emails, integrations or webhooks", () => {
    const shopper = all.filter(
      (file) =>
        file.startsWith("src/app/s/") ||
        file.startsWith("src/app/api/") ||
        (file.startsWith("src/components/") && !file.startsWith("src/components/admin/")) ||
        /^src\/server\/(chat|email|shopper-emails|integrations|slack|stripe-webhooks|order-emails|cart-reminders|search|knowledge)/.test(file),
    );
    expect(shopper.length).toBeGreaterThan(20);
    const reaching = shopper.filter((file) => /getFieldData\(|commerce\.field_values|field-entities/.test(mentions(file)));
    expect(reaching).toEqual([]);
  });
});
