import { describe, expect, it } from "vitest";

import { NOT_FOUND_DAY_CAP, NOT_FOUND_KEEP_DAYS, NOT_FOUND_SUGGESTIONS, NOT_FOUND_WINDOWS } from "./data-limits";
import { PROBES, lastPartOf, recordablePath, suggestTargets, wordsOf, type Candidate } from "./not-found";
import { normalisePath } from "./redirect-path";

describe("what the 404 report records", () => {
  it.each([
    "/collections/shoes",
    "/collections/all",
    "/products/old-cup",
    "/pages/om-oss.html",
    "/pages/om-oss",
    "/blogs/news/how-to-pick-a-lamp",
    "/old-page",
    "/p/gone",
    "/a/b/c/d/e/f/g/h",
    "/category/sko-og-støvler",
    "/products/2024-collection-lamp",
  ])("accepts %s", (path) => {
    expect(recordablePath(path)).toBe(true);
  });

  it("refuses a working page, the platform's routes and the front page", () => {
    for (const path of ["/", "/cart", "/cart/x", "/checkout", "/order/abc", "/account/orders", "/returns/x", "/download/x", "/subscription/x", "/unsubscribe/x", "/withdraw", "/wishlist", "/deliveries", "/search", "/cookies", "/api/x", "/admin/x", "/_next/x", "/s/demo/x", "/r/CODE", "/auth/x", "/demo/x", "/kaizen/x"]) {
      expect(recordablePath(path), path).toBe(false);
    }
  });

  it("refuses an address that is long or deep, or has a part that is a token, an id or a UUID", () => {
    expect(recordablePath(`/${"a".repeat(201)}`)).toBe(false);
    expect(recordablePath("/a/b/c/d/e/f/g/h/i")).toBe(false);
    expect(recordablePath(`/x/${"a".repeat(101)}`)).toBe(false);
    expect(recordablePath("/orders/5f3a9c0d8b7e6a4c1d2e3f40")).toBe(false);
    expect(recordablePath("/x/0123456789abcdef01234567")).toBe(false);
    expect(recordablePath("/x/0123456789abcdef0123456")).toBe(true);
    expect(recordablePath("/invite/123e4567-e89b-12d3-a456-426614174000")).toBe(false);
    expect(recordablePath("/x/4799887766554")).toBe(false);
    expect(recordablePath("/x/+4799887766554")).toBe(false);
    expect(recordablePath("/x/12345")).toBe(true);
    expect(recordablePath("/x/12%2034%2056%2078")).toBe(false);
    expect(recordablePath("/x/+47-123-45-678")).toBe(false);
    expect(recordablePath("/x/123.456.78")).toBe(false);
    expect(recordablePath("/x/1234567")).toBe(true);
    expect(recordablePath("/blog/2026-10-05")).toBe(true);
    expect(recordablePath("/x/12%252520345678")).toBe(false);
    expect(recordablePath("/token/abcdefghijklmnopqrstuvwxyz012345")).toBe(false);
    expect(recordablePath("/token/abcdefghijklmnopqrstuvwxyz-012345-and-more")).toBe(true);
  });

  it("refuses an address with an email in it or an encoded control character", () => {
    expect(recordablePath("/unsubscribe/anna@example.com")).toBe(false);
    expect(recordablePath("/x/anna@example.com")).toBe(false);
    expect(recordablePath("/x/a%0ab")).toBe(false);
    expect(recordablePath("/x/a%00b")).toBe(false);
    expect(recordablePath("/x/a%7Fb")).toBe(false);
    expect(recordablePath("/x/50%25")).toBe(true);
  });

  it("refuses an email that was encoded again, as a mail client may link it, in any of its forms", () => {
    expect(recordablePath("/john%40example.com")).toBe(false);
    expect(recordablePath("/john%2540example.com")).toBe(false);
    expect(recordablePath("/x/john%252540example.com")).toBe(false);
    expect(recordablePath("/unsubscribe%2fjohn%2540example.com")).toBe(false);
    // The path as `normalisePath()` makes it from a double-encoded request is one of these, so the whole route is held, not only a literal `@`.
    expect(recordablePath(normalisePath("/john%2540example.com") ?? "/")).toBe(false);
    expect(recordablePath("/x/50%2525")).toBe(true);
    expect(recordablePath("/x/100%25-cotton")).toBe(true);
  });

  it("refuses a run of eight or more digits (a national identity number, a phone number) in any form, and keeps a year or a short number", () => {
    for (const path of ["/12345678901", "/+4790012345", "/x/4790012345", "/x/123456789", "/x/%2b4790012345", "/x/12345678901%2fy", "/x/12345678", "/x/12345-67890"]) expect(recordablePath(path), path).toBe(false);
    for (const path of ["/x/2024", "/products/2024-collection-lamp", "/x/1234567"]) expect(recordablePath(path), path).toBe(true);
  });

  it("refuses the probes robots make, and nothing a legacy shop would have", () => {
    for (const path of ["/wp-login.php", "/wp-admin/x", "/wp-content/uploads/x", "/.env", "/.git/config", "/a/.hidden", "/cgi-bin/x", "/phpmyadmin/index.php", "/xmlrpc.php", "/vendor/phpunit/x", "/a/vendor/b", "/node_modules/x", "/config.php", "/db.sql", "/backup.bak", "/site.zip", "/app.env", "/x.git"]) {
      expect(recordablePath(path), path).toBe(false);
    }
    expect(PROBES.last).toContain(".php");
    for (const path of ["/pages/php-tips", "/collections/git-gifts", "/products/env-friendly-bag", "/vendors/acme", "/wp"]) expect(recordablePath(path), path).toBe(true);
  });

  it("is only ever asked about a path in the normal form, which has no query string or fragment", () => {
    expect(normalisePath("/Collections/Shoes?utm=1")).toBeNull();
    expect(recordablePath("/a/b")).toBe(true);
    expect(recordablePath("a/b")).toBe(false);
  });

  it("states the report's constants", () => {
    expect([NOT_FOUND_DAY_CAP, NOT_FOUND_KEEP_DAYS, NOT_FOUND_SUGGESTIONS]).toEqual([1_000, 90, 3]);
    expect(NOT_FOUND_WINDOWS).toEqual([30, 7, 90]);
  });
});

describe("words and last parts", () => {
  it("folds accents and case, splits on anything but letters and digits, and leaves one-letter and stop words out", () => {
    expect(wordsOf("Sko-og-Støvler_2024")).toEqual(["sko", "stovler", "2024"]);
    expect(wordsOf("Blåbær")).toEqual(["blabaer"]);
    expect(wordsOf("The Summer Shoes")).toEqual(["summer", "shoes"]);
    expect(wordsOf("café crème")).toEqual(["cafe", "creme"]);
    expect(wordsOf("")).toEqual([]);
  });
  it("takes the last part without a page extension", () => {
    expect(lastPartOf("/pages/om-oss.html")).toBe("om-oss");
    expect(lastPartOf("/a/b/c.php")).toBe("c");
    expect(lastPartOf("/a/b.png")).toBe("b.png");
    expect(lastPartOf("/")).toBe("");
  });
});

describe("suggested targets", () => {
  const pool: Candidate[] = [
    { kind: "product", path: "/p/summer-shoes", slug: "summer-shoes", title: "Summer shoes" },
    { kind: "product", path: "/p/lamp", slug: "lamp", title: "Table lamp" },
    { kind: "product", path: "/p/brass-lamp", slug: "brass-lamp", title: "Brass lamp" },
    { kind: "category", path: "/category/shoes", slug: "shoes", title: "Shoes" },
    { kind: "category", path: "/category/lamps", slug: "lamps", title: "Lamps" },
    { kind: "tag", path: "/tag/sale", slug: "sale", title: "On sale" },
    { kind: "page", path: "/om-oss", slug: "om-oss", title: "Om oss" },
    { kind: "page", path: "/frakt", slug: "frakt", title: "Frakt og levering" },
    { kind: "article", path: "/blog/how-to-pick-a-lamp", slug: "how-to-pick-a-lamp", title: "How to pick a lamp" },
  ];
  const paths = (missing: string, candidates = pool) => suggestTargets(missing, candidates).map((s) => s.path);

  it("puts the same last part first, then the largest share of shared words", () => {
    expect(paths("/collections/shoes")[0]).toBe("/category/shoes");
    expect(paths("/products/lamp")[0]).toBe("/p/lamp");
    expect(paths("/pages/om-oss.html")[0]).toBe("/om-oss");
    expect(paths("/collections/summer-shoes")).toEqual(["/p/summer-shoes", "/category/shoes"]);
  });

  it("lets the shape of an old shop's address say which kind it wants, and ranks products before pages when nothing says", () => {
    const tied: Candidate[] = [
      { kind: "page", path: "/mug-red", slug: "mug-red", title: "Red" },
      { kind: "product", path: "/p/mug-big", slug: "mug-big", title: "Big" },
      { kind: "category", path: "/category/mug-new", slug: "mug-new", title: "New" },
    ];
    expect(paths("/x/mug", tied)).toEqual(["/p/mug-big", "/category/mug-new", "/mug-red"]);
    expect(paths("/collections/mug", tied)[0]).toBe("/category/mug-new");
    expect(paths("/products/mug", tied)[0]).toBe("/p/mug-big");
    expect(paths("/pages/mug", tied)[0]).toBe("/mug-red");
    // The exact last part still comes first, whatever the shape says.
    expect(paths("/collections/lamp")[0]).toBe("/p/lamp");
  });

  it("compares the title's words too, with accents folded", () => {
    expect(paths("/pages/frakt-levering")).toEqual(["/frakt"]);
    expect(paths("/pages/FRAKT-OG-LEVERING")).toEqual(["/frakt"]);
    expect(paths("/x/cafe", [{ kind: "page", path: "/kafe", slug: "kafe", title: "Café" }])).toEqual(["/kafe"]);
  });

  it("suggests nothing below half the words or without a whole word, and nothing for the front page", () => {
    expect(paths("/collections/winter-boots-kids")).toEqual([]);
    expect(paths("/collections/xyz")).toEqual([]);
    expect(paths("/")).toEqual([]);
    expect(paths("/a")).toEqual([]);
    // Half of the words is enough, less is not: two of four are shared with `summer-shoes`, two of five are not.
    expect(paths("/collections/summer-shoes-sale-today")).toEqual(["/p/summer-shoes"]);
    expect(paths("/collections/summer-shoes-sale-today-now")).toEqual([]);
  });

  it("gives at most three, once each, and the same answer every time", () => {
    const many: Candidate[] = Array.from({ length: 8 }, (_, i) => ({ kind: "product", path: `/p/lamp-${i}`, slug: `lamp-${i}`, title: `Lamp ${i}` }));
    const a = suggestTargets("/products/lamp", many);
    expect(a).toHaveLength(3);
    expect(suggestTargets("/products/lamp", [...many].reverse())).toEqual(a);
    expect(suggestTargets("/products/lamp", [...many, ...many]).map((s) => s.path)).toEqual(a.map((s) => s.path));
    expect(suggestTargets("/products/lamp", many, 1)).toHaveLength(1);
  });

  it("scores in 0 to 1 and sorts by it", () => {
    const out = suggestTargets("/collections/brass-lamp", pool);
    expect(out[0]).toMatchObject({ path: "/p/brass-lamp", score: 1 });
    for (const s of out) expect(s.score).toBeGreaterThan(0);
    for (const s of out) expect(s.score).toBeLessThanOrEqual(1);
    expect(out.map((s) => s.score)).toEqual([...out.map((s) => s.score)].sort((a, b) => b - a));
  });

  it("never reads anything but the pool: no candidate, no suggestion", () => {
    expect(suggestTargets("/products/lamp", [])).toEqual([]);
  });
});
