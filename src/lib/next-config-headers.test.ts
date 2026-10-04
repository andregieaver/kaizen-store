import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import config from "../../next.config";

/** The headers `next.config.ts` really returns: the policy is on the pay routes of both shapes of address and nowhere else. */
describe("next.config headers (wave 1, 1e)", async () => {
  const resolved = await config("phase-production-server");
  const entries = (await resolved.headers?.()) ?? [];
  const forPath = (path: string) => entries.filter((entry) => pathToRegexp(entry.source).test(path));

  it("sends the policy on the cart, checkout and order of a store at /s/{store}/{market}", () => {
    for (const path of ["/s/x/no/cart", "/s/x/no/checkout", "/s/x/no/order/6f1c", "/s/x/no-en-eur/checkout"]) {
      const found = forPath(path);
      expect(found).toHaveLength(1);
      expect(found[0].headers.map((h) => h.key)).toContain("Content-Security-Policy");
    }
  });

  it("sends it on a store's own host, where the market comes first, and for an A/B token", () => {
    for (const path of ["/no/checkout", "/se/cart", "/no~abc/order/123", "/no~3fa9c1d2b_7b21aa90c/checkout"]) {
      expect(forPath(path), path).toHaveLength(1);
    }
  });

  it("does not send it on the store's other pages, Kaizen's pages or the admin", () => {
    for (const path of ["/s/x/no", "/s/x/no/products", "/s/x/no/account", "/", "/blog/cart", "/admin/x/orders", "/api/chat", "/s/x"]) {
      expect(forPath(path), path).toHaveLength(0);
    }
  });

  it("keeps the other keys of the configuration", async () => {
    expect(resolved.cacheComponents).toBe(true);
    expect(resolved.poweredByHeader).toBe(false);
    expect(typeof resolved.redirects).toBe("function");
    expect(typeof resolved.rewrites).toBe("function");
  });
});
