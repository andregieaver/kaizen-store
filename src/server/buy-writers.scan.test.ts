import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * The product page carries `buyFacts()` in its prerender (bloat review step 2.13, `src/server/buy-facts.ts`): what an owner set about
 * buying is read once per store and market and kept for hours, until a writer refreshes its tag. A module that writes one of the
 * eleven tables behind the facts calls `refreshBuyFacts()` itself (after its write has committed) or is listed below; the platform's
 * `checkout_ui` calls `refreshBuyPlatform()`. The list starts empty and only shrinks: a writer is never added to it, it calls the refresh.
 */

const ROOT = process.cwd();
const WRITES =
  /\b(insert\s+into|update|delete\s+from)\s+commerce\.(payment_providers|stripe_accounts|checkout_providers|mollie_connections|payment_methods|checkout_fields|order_settings|automations|price_breaks|price_list_breaks|product_schemes)\b/i;
/**
 * The defaults row `createDraft()` and `requestQuote()` insert to take a lock (`on conflict (store_id) do nothing`): it changes no buy
 * fact (quote_requests defaults to 'off', the facts' own fallback), and a refresh there would let any shopper's quote request empty the
 * store's cached product pages.
 */
const LOCK_ROW = /insert\s+into\s+commerce\.order_settings\s*\(store_id\)\s*values\s*\([^)]*\)\s*on\s+conflict\s*\(store_id\)\s*do\s+nothing/gi;
/** Test support writes the tables to arrange a case; nothing is cached there. */
const TEST_SUPPORT = /(fixture|test-support)\.ts$/;

/** Writers whose callers refresh the facts. Take a module off when it refreshes itself; never add one. */
const REFRESHED_BY_CALLERS = new Set<string>([]);

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const all = ["src/server", "src/app", "src/lib", "src/components"].flatMap(sources).map((path) => relative(ROOT, join(ROOT, path)));
const writers = all.filter((path) => !TEST_SUPPORT.test(path) && WRITES.test(read(path).replace(LOCK_ROW, ""))).sort();

describe("writers of a buy fact refresh it", () => {
  it("finds the writers", () => {
    expect(writers).toEqual(
      [
        "src/server/settings.ts",
        "src/server/connect.ts",
        "src/server/express-checkout.ts",
        "src/server/mollie.ts",
        "src/server/payment-methods.ts",
        "src/server/checkout-rules.ts",
        "src/server/order-settings.ts",
        "src/server/suppliers.ts",
        "src/server/automations.ts",
        // Switching a flow on switches off the automation it replaces (D767 slice 3).
        "src/server/flows.ts",
        "src/server/products.ts",
        "src/server/price-lists.ts",
      ].sort(),
    );
  });

  it.each(writers)("%s calls refreshBuyFacts() or is listed", (path) => {
    if (REFRESHED_BY_CALLERS.has(path)) return;
    expect(read(path).includes("refreshBuyFacts("), `${path} writes a table behind buyFacts() without calling refreshBuyFacts()`).toBe(true);
  });

  it("lists only writers that still rely on their callers", () => {
    for (const path of REFRESHED_BY_CALLERS) {
      expect(writers, `${path} no longer writes a buy fact's table: take it off the list`).toContain(path);
      expect(read(path).includes("refreshBuyFacts("), `${path} refreshes itself now: take it off the list`).toBe(false);
    }
  });

  it("refreshes every store's facts where the platform's checkout look is written", () => {
    const files = all.filter((path) => /update\s+commerce\.platform_settings/i.test(read(path)) && read(path).includes("checkout_ui"));
    expect(files.length).toBeGreaterThan(0);
    for (const path of files) expect(read(path).includes("refreshBuyPlatform("), `${path} writes checkout_ui without refreshBuyPlatform()`).toBe(true);
  });

  it("keeps the lock row of a quote request free of refreshes", () => {
    expect(WRITES.test(read("src/server/quote-requests.ts").replace(LOCK_ROW, ""))).toBe(false);
    expect(WRITES.test(read("src/server/draft-orders.ts").replace(LOCK_ROW, ""))).toBe(false);
  });
});
