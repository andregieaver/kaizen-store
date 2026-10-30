import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Who reads prices around the shopper's view (D335, `docs/wave-7-storefront.md` A.1): a variant switched off in a market keeps its price, and
 * `commerce.current_prices` leaves it out, so every shopper-facing read treats it as not sold there. This test reads the source and fails for a
 * module that reads the `commerce.prices` table or the `commerce.kept_prices` view (every current price, switched off or not) and is not listed
 * here with the reason it is right to. To add one: say why it never decides what a shopper is sold, or read `commerce.current_prices`.
 */
const PRICES_TABLE: Record<string, string> = {
  "src/server/products.ts": "the editor's save: it writes prices through `commerce.set_price` and ends the ones taken away",
  "src/server/product-audit.ts": "the activity log's before and after of a product's prices",
  "src/server/analytics-inventory-data.ts": "the stock value report, priced at the shelf price whatever is sold where",
  "src/server/bundles.ts": "the bundle editor's facts about the components an owner may choose",
  "src/server/cart-reminders.ts": "the sample products in the admin's preview of a reminder email",
  "src/server/market-prices.ts": "market price rules (D335 A.2): a base price and whether a market's price is the rule's, to write derived prices through `commerce.set_price`",
};

const KEPT_PRICES: Record<string, string> = {
  "src/server/products.ts": "the product editor and the Products list show and keep every price, also where the product is switched off",
  "src/server/owner-tools.ts": "`get_product` tells the AI manager every price, beside where the product is not sold",
  "src/server/admin-api.ts": "the Admin API's products (D355) carry every price the admin keeps, as the product editor shows them",
  "src/server/live-drills.ts": "the AI manager's pilot (consolidation 5) checks the price a draft product was given, as the product editor keeps it",
};

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const readersOf = (pattern: RegExp) => {
  const root = path.resolve(__dirname, "../..");
  return sources(path.join(root, "src"))
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => path.relative(root, file).split(path.sep).join("/"))
    .filter((file) => !file.startsWith("src/db/"))
    .sort();
};

describe("the readers of prices beside the shopper's view (D335)", () => {
  it("read the prices table only where they never decide what a shopper is sold", () => {
    expect(readersOf(/commerce\.prices\b/).filter((file) => !(file in PRICES_TABLE))).toEqual([]);
  });

  it("read every kept price only in the admin's own views", () => {
    expect(readersOf(/commerce\.kept_prices\b/).filter((file) => !(file in KEPT_PRICES))).toEqual([]);
  });
});
