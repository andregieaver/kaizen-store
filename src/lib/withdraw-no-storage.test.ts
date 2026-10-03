import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { KNOWN_COOKIES } from "./cookie-consent";
import { RESERVED_STORE_PAGE_SLUGS } from "./page-content";
import { placeOfPath } from "./visit-record";

/**
 * The withdrawal function (D153) sets no cookie and keeps nothing in the browser: its own code never touches either. The
 * only cookie it reads is the signed-in customer's own, through `getCustomer()`. A scan of its source, so a later change
 * that adds one has to come here and decide (and then list it in `KNOWN_COOKIES`).
 */

const ROOTS = ["src/app/s/[store]/[market]/withdraw", "src/app/s/[store]/[market]/returns", "src/components/withdraw", "src/lib/withdraw-form.ts"];

function files(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => files(join(path, name)));
}

describe("the withdrawal function sets no cookie and stores nothing in the browser (D153)", () => {
  const sources = ROOTS.flatMap(files)
    .filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.ts$/.test(f))
    .map((f) => ({ f, text: readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "") }));

  it("finds its own code", () => {
    expect(sources.length).toBeGreaterThanOrEqual(8);
  });

  it("never reads or writes a cookie or the browser's storage itself", () => {
    for (const { f, text } of sources) {
      expect(text, f).not.toMatch(/\bcookies\s*\(/);
      expect(text, f).not.toMatch(/document\.cookie|Set-Cookie|localStorage|sessionStorage|indexedDB|navigator\.sendBeacon/i);
      expect(text, f).not.toMatch(/next\/headers/);
    }
  });

  it("is not a page address a store's own pages can take, and not one a visit is counted at", () => {
    expect(RESERVED_STORE_PAGE_SLUGS).toEqual(expect.arrayContaining(["withdraw", "returns"]));
    // The function's own address, with or without an order in it, is never a landing page of its own, and a return's secret address is not kept.
    const markets = ["NO"];
    expect(placeOfPath("/s/demo/no/withdraw?order=1042&key=cs_secret", "demo", markets)?.landing).toBe("(other)");
    expect(placeOfPath(`/s/demo/no/returns/${"a".repeat(64)}`, "demo", markets)?.landing).toBe("(other)");
  });

  it("lists no cookie of its own", () => {
    for (const cookie of KNOWN_COOKIES) expect(JSON.stringify(cookie).toLowerCase()).not.toMatch(/withdraw|return/);
  });
});
