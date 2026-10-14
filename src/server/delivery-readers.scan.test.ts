import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Who reads the shipping prices (D237, `docs/wave-3-shipping-methods.md` 6.4): what a cart is charged is decided by ONE reader, `resolveDelivery()` in
 * `delivery-options.ts` (`chosenDelivery()` its short form), which `cartSummary()` and `placeOrder()` both call. This test reads the source and fails for a
 * module that reads `shipping_rates` (the flat rate), `shipping_method_rates` (methods' tiers) or `local_delivery_areas` and is not in the list below with
 * the reason it is right to. To add one: say why it does not decide what a cart is charged, or route it through `resolveDelivery()`.
 */
const READERS: Record<string, string> = {
  "src/server/delivery-options.ts": "the one reader of a cart's delivery (`marketShipping()`, `resolveDelivery()`) and the mismatch check",
  "src/server/checkout.ts": "`placeOrder()` keeps the flat rate for a subscription (D25) and the standard delivery; the basket's own price comes from `resolveDelivery()`",
  "src/server/shipping-methods.ts": "the admin's reads and saves of methods, rates, zones and profiles",
  "src/server/local-delivery.ts": "the admin's reads and saves of local areas",
  "src/server/settings.ts": "the admin's flat rate editor",
  "src/server/orders.ts": "`getCheckoutInfo()`: the flat rate the cart page shows before a cart exists",
  "src/server/subscriptions.ts": "renewals pay the flat rate (D25)",
  "src/server/standing-orders.ts": "weekly boxes pay the flat rate (D102)",
  "src/server/draft-orders.ts": "drafts are priced on the flat rate or the staff's own (D173)",
  "src/server/returns.ts": "the standard delivery of an order from before it was kept on the order (D153)",
  "src/server/seo.ts": "structured data and the chat agent name one price only when it is unambiguous (2.6)",
  "src/server/legal-facts.ts": "the legal starters' shipping facts",
  "src/server/setup.ts": "the setup wizard's progress",
  "src/server/store-translate.ts": "the areas' names and information to translate (D110)",
  "src/server/tax-reports-fixture.ts": "a test fixture",
};

const TABLES = /commerce\.(shipping_rates|shipping_method_rates|local_delivery_areas)\b/;

function sources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) sources(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

describe("the readers of shipping prices (D237)", () => {
  it("are the listed modules only", () => {
    const root = path.resolve(__dirname, "../..");
    const found = sources(path.join(root, "src"))
      .filter((file) => TABLES.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file).split(path.sep).join("/"))
      .filter((file) => !file.startsWith("src/db/"))
      .sort();
    expect(found.filter((file) => !(file in READERS))).toEqual([]);
  });

  it("leave the tiers of methods to the delivery reader, the admin and structured data", () => {
    const root = path.resolve(__dirname, "../..");
    const found = sources(path.join(root, "src"))
      .filter((file) => /commerce\.shipping_method_rates\b/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(root, file).split(path.sep).join("/"))
      .sort();
    expect(found).toEqual(["src/server/delivery-options.ts", "src/server/seo.ts", "src/server/shipping-methods.ts"]);
  });
});
