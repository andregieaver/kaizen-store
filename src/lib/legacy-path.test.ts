import { describe, expect, it } from "vitest";

import { legacyPathOf, parseLegacyRequest } from "./legacy-path";


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
