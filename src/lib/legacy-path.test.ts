// @ts-expect-error Next bundles path-to-regexp, the router's own matcher, without types.
import { match } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import { LEGACY_MATCHER, legacyPathOf, parseLegacyRequest } from "./legacy-path";
import { STATIC_EXTENSIONS } from "./redirect-path";

/** Whether Next's router would run the proxy for a path under the second matcher entry. */
const matched = (pathname: string): boolean => Boolean(match(LEGACY_MATCHER.source)(pathname));

describe("a request with no country", () => {
  it("is a path on a store's own host, or under /s/{store}/, that does not begin with a market", () => {
    expect(parseLegacyRequest("/collections/shoes", "demo")).toEqual({ store: "demo", path: "/collections/shoes", hostBased: true });
    expect(parseLegacyRequest("/products/Old-Cup", "demo")).toEqual({ store: "demo", path: "/products/old-cup", hostBased: true });
    expect(parseLegacyRequest("/pages/om-oss.html", "demo")).toEqual({ store: "demo", path: "/pages/om-oss.html", hostBased: true });
    expect(parseLegacyRequest("/s/demo/collections/shoes", null)).toEqual({ store: "demo", path: "/collections/shoes", hostBased: false });
    expect(parseLegacyRequest("/s/demo/collections/shoes/", "demo")).toEqual({ store: "demo", path: "/collections/shoes", hostBased: false });
    expect(parseLegacyRequest("/blogs/news/first-post", "demo")?.path).toBe("/blogs/news/first-post");
  });

  it("is not a path with a market, the front page, a store alone, the platform's routes or a static file", () => {
    for (const path of [
      "/", "/no", "/no/", "/no/p/lamp", "/no-en/cart", "/se-eur/category/x", "/no-en-eur/x", "/NO/x",
      "/s/demo", "/s/demo/", "/s/demo/no", "/s/demo/no/p/lamp", "/s/demo/se-en/x",
      "/_next/static/x.js", "/api/health", "/admin/demo", "/demo/x", "/kaizen/x", "/favicon.ico", "/robots.txt", "/images/logo.PNG", "/files/brochure.pdf",
    ]) {
      expect(parseLegacyRequest(path, "demo"), path).toBeNull();
    }
  });

  it("needs a store: off the platform's address with no store host, a market-less path is nobody's", () => {
    expect(parseLegacyRequest("/collections/shoes", null)).toBeNull();
    expect(parseLegacyRequest("/s/bad_slug/collections/shoes", null)).toBeNull();
  });

  it("is not an address that cannot be read in the normal form", () => {
    expect(parseLegacyRequest("/collections/a%20b", "demo")).toBeNull();
    expect(parseLegacyRequest("/a/%00", "demo")).toBeNull();
    expect(parseLegacyRequest(`/${Array.from({ length: 13 }, () => "a").join("/")}`, "demo")).toBeNull();
  });

  it("gives the path of the parts a market route sees, for an unknown market and a catch-all alike", () => {
    expect(legacyPathOf(["om-oss"])).toBe("/om-oss");
    expect(legacyPathOf(["collections", "Shoes"])).toBe("/collections/shoes");
    expect(legacyPathOf([])).toBeNull();
    expect(legacyPathOf(["admin", "x"])).toBeNull();
    expect(legacyPathOf(["img", "a.png"])).toBeNull();
    expect(legacyPathOf(["a b"])).toBeNull();
  });
});

describe("the proxy's second matcher", () => {
  const table: string[] = [
    "/collections/shoes", "/collections/all", "/products/old-cup", "/pages/about", "/pages/om-oss.html", "/blogs/news/x", "/om-oss", "/some/very/deep/old/path",
    "/s/demo/collections/shoes", "/s/demo/products/old", "/s/demo/pages/x",
    "/", "/no", "/no/", "/no/p/lamp", "/no-en/cart", "/se-eur", "/se-en-eur/x", "/dk/category/x", "/NO/p/lamp",
    "/s/demo", "/s/demo/", "/s/demo/no", "/s/demo/no/p/lamp", "/s/demo/se-en/x", "/s/demo/dk-eur/",
    "/_next/static/chunks/a.js", "/_next/image", "/api/health", "/api/cron/x", "/admin/demo/pages", "/demo/x", "/kaizen/favicon.ico", "/favicon.ico",
    "/robots.txt", "/sitemap.xml", "/images/logo.png", "/images/logo.PNG", "/files/a.pdf", "/fonts/a.woff2", "/video.mp4", "/data.json", "/a/b.css", "/x.js.map",
    "/pages/page.html", "/old.php", "/files/archive.zip", "/a.map",
    "/p/lamp", "/category/shoes", "/cart", "/checkout", "/search",
  ];

  it("keeps the proxy off every market-less path it would not answer (a legacy path is never missed)", () => {
    for (const path of table) {
      const legacy = parseLegacyRequest(path, "demo") !== null;
      // The matcher only has to be a superset: it must run for every legacy path. It may also run for a path the function then passes on.
      if (legacy) expect(matched(path), `${path} is a legacy path, so the proxy must run`).toBe(true);
      // A path the matcher leaves alone is never one the function would redirect.
      if (!matched(path)) expect(legacy, path).toBe(false);
    }
  });

  it("leaves the markets' pages, the front page, a store alone, the platform's routes and static files alone", () => {
    for (const path of [
      "/", "/no", "/no/", "/no/p/lamp", "/no-en/cart", "/se-eur", "/se-en-eur/x", "/NO/p/lamp", "/s/demo", "/s/demo/", "/s/demo/no", "/s/demo/no/p/lamp", "/s/demo/se-en/x",
      "/_next/static/chunks/a.js", "/api/health", "/admin/demo/pages", "/demo/x", "/kaizen/favicon.ico", "/favicon.ico", "/images/logo.png", "/files/a.pdf", "/fonts/a.woff2",
    ]) {
      expect(matched(path), path).toBe(false);
    }
  });

  it("runs for the shapes of an old shop; a first part that only looks like a market (/om-oss) is left to the unknown-market route, which looks it up with legacyPathOf()", () => {
    expect(matched("/om-oss")).toBe(false);
    expect(parseLegacyRequest("/om-oss", "demo")).toBeNull();
    for (const path of ["/collections/shoes", "/products/old-cup", "/pages/about", "/pages/om-oss.html", "/blogs/news/x", "/s/demo/collections/shoes", "/pages/page.html", "/old.php"]) {
      expect(matched(path), path).toBe(true);
    }
  });

  it("lists the extensions the function skips in the matcher's literal", () => {
    for (const ext of STATIC_EXTENSIONS) expect(LEGACY_MATCHER.source, ext).toContain(ext);
  });

  it("is a plain source with no capturing group beyond Next's own, so the build accepts it", () => {
    expect(LEGACY_MATCHER.source.startsWith("/(")).toBe(true);
    expect(/\((?!\?)/.exec(LEGACY_MATCHER.source.slice(2))).toBeNull();
  });
});
