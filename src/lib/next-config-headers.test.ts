import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import config from "../../next.config";

/**
 * The headers `next.config.ts` really returns: the pay routes' policy is on the pay routes of both shapes of address and nowhere else;
 * `nosniff` is on every path and the admin's frame rule on the admin only (PSI 2026-10-24, SEC-07).
 */
describe("next.config headers (wave 1, 1e)", async () => {
  const resolved = await config("phase-production-server");
  const entries = (await resolved.headers?.()) ?? [];
  const forPath = (path: string) => entries.filter((entry) => pathToRegexp(entry.source).test(path));
  /** The entries carrying the pay routes' full policy (the only one with `script-src`). */
  const payPolicy = (path: string) =>
    forPath(path).filter((entry) => entry.headers.some((h) => h.key === "Content-Security-Policy" && h.value.includes("script-src")));
  const headersFor = (path: string) => Object.fromEntries(forPath(path).flatMap((entry) => entry.headers.map((h) => [h.key, h.value])));

  it("sends the policy on the cart, checkout and order of a store at /s/{store}/{market}", () => {
    for (const path of ["/s/x/no/cart", "/s/x/no/checkout", "/s/x/no/order/6f1c", "/s/x/no-en-eur/checkout"]) {
      const found = payPolicy(path);
      expect(found).toHaveLength(1);
      expect(found[0].headers.map((h) => h.key)).toContain("Content-Security-Policy");
    }
  });

  it("sends it on a store's own host, where the market comes first, and for an A/B token", () => {
    for (const path of ["/no/checkout", "/se/cart", "/no~abc/order/123", "/no~3fa9c1d2b_7b21aa90c/checkout"]) {
      expect(payPolicy(path), path).toHaveLength(1);
    }
  });

  it("does not send it on the store's other pages, Kaizena Flow's pages or the admin", () => {
    for (const path of ["/s/x/no", "/s/x/no/products", "/s/x/no/account", "/", "/blog/cart", "/admin/x/orders", "/api/chat", "/s/x"]) {
      expect(payPolicy(path), path).toHaveLength(0);
    }
  });

  it("sends nosniff everywhere, and the pay policy wins on the pay routes (it comes later)", () => {
    for (const path of ["/", "/s/x/no", "/s/x/no/checkout", "/admin/x/orders", "/api/chat", "/_next/static/chunks/a.js"]) {
      expect(headersFor(path)["X-Content-Type-Options"], path).toBe("nosniff");
    }
    expect(headersFor("/s/x/no/checkout")["Content-Security-Policy"]).toContain("script-src");
  });

  it("lets only Kaizena Flow (and the theme store's host) frame any page, and nothing frame the pay routes (PSI SEC-07)", () => {
    for (const path of ["/admin", "/admin/x/orders", "/admin/account/themes/abc/preview", "/", "/s/x/no", "/api/chat"]) {
      expect(headersFor(path)["Content-Security-Policy"], path).toMatch(/^frame-ancestors 'self'/);
    }
    expect(headersFor("/s/x/no/checkout")["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
  });

  it("keeps the other keys of the configuration", async () => {
    expect(resolved.cacheComponents).toBe(true);
    expect(resolved.poweredByHeader).toBe(false);
    expect(typeof resolved.redirects).toBe("function");
    expect(typeof resolved.rewrites).toBe("function");
  });
});
