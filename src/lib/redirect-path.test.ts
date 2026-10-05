import { describe, expect, it } from "vitest";

import { RESERVED_STORE_PAGE_SLUGS } from "./page-content";
import {
  PLATFORM_SEGMENTS,
  RESERVED_SOURCE_SEGMENTS,
  SEGMENTS_MAX,
  SOURCE_MAX,
  STATIC_EXTENSIONS,
  TARGET_MAX,
  WORKING_SEGMENTS,
  decodeKeepingReserved,
  encodeAddress,
  isReservedPath,
  isStoreMarket,
  looksLikeMarket,
  mergeQuery,
  normalisePath,
  normaliseSource,
  normaliseTarget,
  pathOfTarget,
  splitAddress,
  splitMarket,
  type AddressContext,
} from "./redirect-path";

const ctx: AddressContext = { store: "demo", countries: ["no", "se", "dk"], ownHosts: ["demo.kaizen.example", "shop.demo.no"] };

describe("the normal form of a path", () => {
  it.each([
    ["/Collections/Shoes", "/collections/shoes"],
    ["collections/shoes", "/collections/shoes"],
    ["/collections/shoes/", "/collections/shoes"],
    ["//collections///shoes//", "/collections/shoes"],
    ["/a/./b/../c", "/a/c"],
    ["/../../a", "/a"],
    ["/", "/"],
    ["", "/"],
    ["/%C3%A5rets-tilbud", "/årets-tilbud"],
    ["/Å", "/å"],
    ["/pages/om-oss.html", "/pages/om-oss.html"],
    ["/a%20b", null],
    ["/a b", null],
    ["/a\\b", null],
    ["/a%5Cb", null],
    ["/a%00b", null],
    ["/a\tb", null],
    ["/a%ZZ", null],
    ["/a%", null],
    ["/a?b", null],
    ["/a#b", null],
  ])("reads %j as %j", (input, expected) => {
    expect(normalisePath(input)).toBe(expected);
  });

  it("decodes once: %2F, %3F, %23 and %25 stay encoded, in lower case, and a double encoding is not decoded twice", () => {
    expect(normalisePath("/a%2Fb")).toBe("/a%2fb");
    expect(normalisePath("/a%3Fb%23c")).toBe("/a%3fb%23c");
    expect(normalisePath("/50%25-off")).toBe("/50%25-off");
    expect(normalisePath("/a%2520b")).toBe("/a%2520b");
    expect(decodeKeepingReserved("/%C3%A5/%2f")).toBe("/å/%2f");
    expect(decodeKeepingReserved("/%C3")).toBeNull();
  });

  it("reads Unicode in its composed form and in lower case", () => {
    // `a` and a combining ring is the same address as `å`.
    expect(normalisePath("/året")).toBe("/året");
    expect(normalisePath("/ÅRET")).toBe("/året");
  });

  it("holds the limits: 12 parts, 200 characters a part, 500 for a source and 2,000 for a target", () => {
    expect(SEGMENTS_MAX).toBe(12);
    const twelve = `/${Array.from({ length: 12 }, () => "a").join("/")}`;
    expect(normalisePath(twelve)).toBe(twelve);
    expect(normalisePath(`${twelve}/a`)).toBeNull();
    expect(normalisePath(`/${"a".repeat(200)}`)).not.toBeNull();
    expect(normalisePath(`/${"a".repeat(201)}`)).toBeNull();
    const long = `/${Array.from({ length: 4 }, () => "a".repeat(150)).join("/")}`;
    expect(long.length).toBeGreaterThan(SOURCE_MAX);
    expect(normalisePath(long)).toBeNull();
    expect(normalisePath(long, TARGET_MAX)).toBe(long);
  });

  it("is idempotent over a spread of strings (a seeded property)", () => {
    let seed = 12345;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    const pieces = ["a", "B", "ø", "Å", "å", "/", "//", ".", "..", "-", "_", "%C3%A5", "%2F", "%25", "%2f", "1", "é", "é", "İ", "ß", "Σ", "ǅ"];
    for (let i = 0; i < 2000; i += 1) {
      const n = 1 + Math.floor(next() * 8);
      const raw = Array.from({ length: n }, () => pieces[Math.floor(next() * pieces.length)]).join("");
      const once = normalisePath(raw);
      if (once === null) continue;
      expect([raw, normalisePath(once)]).toEqual([raw, once]);
      // The database's check: a leading slash, no capital letter, no trailing slash (but for the root).
      expect(once.startsWith("/")).toBe(true);
      expect(/[A-Z]/.test(once)).toBe(false);
      expect(once === "/" || !once.endsWith("/")).toBe(true);
      expect(once.includes("//")).toBe(false);
    }
  });
});

describe("splitting an address", () => {
  it("cuts the query and the fragment, and treats an empty `?` or `#` as none", () => {
    expect(splitAddress("/a/b?x=1&y=2#top")).toEqual({ path: "/a/b", query: "?x=1&y=2", fragment: "#top" });
    expect(splitAddress("/a#frag?not-a-query")).toEqual({ path: "/a", query: "", fragment: "#frag?not-a-query" });
    expect(splitAddress("/a?")).toEqual({ path: "/a", query: "", fragment: "" });
    expect(splitAddress("/a#")).toEqual({ path: "/a", query: "", fragment: "" });
    expect(splitAddress("/a")).toEqual({ path: "/a", query: "", fragment: "" });
  });
});

describe("markets", () => {
  it("knows the shape of a market and the store's own", () => {
    for (const ok of ["no", "no-en", "no-eur", "no-en-eur", "SE"]) expect(looksLikeMarket(ok), ok).toBe(true);
    for (const no of ["collections", "p", "n", "pages", "no_en", "2a"]) expect(looksLikeMarket(no), no).toBe(false);
    expect(isStoreMarket("no-en-eur", ctx.countries)).toBe(true);
    expect(isStoreMarket("fi", ctx.countries)).toBe(false);
    expect(isStoreMarket("collections", ctx.countries)).toBe(false);
  });

  it("removes a market and `/s/{store}` from the front of a path", () => {
    expect(splitMarket("/no/p/lamp", ctx)).toEqual({ path: "/p/lamp", market: "no", viaStore: false });
    expect(splitMarket("/no", ctx)).toEqual({ path: "/", market: "no", viaStore: false });
    expect(splitMarket("/s/demo/se-en/category/x", ctx)).toEqual({ path: "/category/x", market: "se-en", viaStore: true });
    expect(splitMarket("/s/demo/collections/x", ctx)).toEqual({ path: "/collections/x", market: null, viaStore: true });
    expect(splitMarket("/fi/p/lamp", ctx)).toEqual({ path: "/fi/p/lamp", market: null, viaStore: false });
    expect(splitMarket("/s/other/no/p", ctx)).toEqual({ path: "/s/other/no/p", market: null, viaStore: false });
    expect(splitMarket("/p/lamp", ctx)).toEqual({ path: "/p/lamp", market: null, viaStore: false });
  });
});

describe("a source", () => {
  const ok = (raw: string) => {
    const r = normaliseSource(raw, ctx);
    return r.ok ? r.source : r;
  };

  it("is read into the normal form, with a note when a query string or fragment was cut", () => {
    expect(normaliseSource("/Old-Cup", ctx)).toEqual({ ok: true, source: "/old-cup", notes: [] });
    expect(normaliseSource("/collections/shoes?sort=price#x", ctx)).toEqual({ ok: true, source: "/collections/shoes", notes: ["source.query_dropped"] });
    expect(ok("products/old-cup/")).toBe("/products/old-cup");
    expect(ok("  /pages/om-oss.html  ")).toBe("/pages/om-oss.html");
  });

  it("reads a full address on the store's own host as its path, and refuses one on another website", () => {
    expect(ok("https://shop.demo.no/collections/old")).toBe("/collections/old");
    expect(ok("http://shop.demo.no/collections/old?x=1")).toBe("/collections/old");
    expect(ok("//demo.kaizen.example/products/old")).toBe("/products/old");
    expect(ok("https://SHOP.demo.no/Old")).toBe("/old");
    expect(normaliseSource("https://evil.example/old", ctx)).toEqual({ ok: false, code: "source.external" });
    expect(normaliseSource("https://shop.demo.no:8443/old", ctx)).toEqual({ ok: false, code: "source.external" });
    expect(normaliseSource("https://user:pw@shop.demo.no/old", ctx)).toEqual({ ok: false, code: "source.invalid" });
    expect(normaliseSource("javascript:alert(1)", ctx)).toEqual({ ok: false, code: "source.invalid" });
    expect(normaliseSource("ftp://shop.demo.no/old", ctx)).toEqual({ ok: false, code: "source.invalid" });
  });

  it("refuses what it cannot serve: empty, unreadable, the front page, a country, a working page", () => {
    expect(normaliseSource("", ctx)).toEqual({ ok: false, code: "source.missing" });
    expect(normaliseSource("   ", ctx)).toEqual({ ok: false, code: "source.missing" });
    expect(normaliseSource("/a b", ctx)).toEqual({ ok: false, code: "source.invalid" });
    expect(normaliseSource("/a\u0007b", ctx)).toEqual({ ok: false, code: "source.invalid" });
    expect(normaliseSource("/", ctx)).toEqual({ ok: false, code: "source.root" });
    expect(normaliseSource("https://shop.demo.no", ctx)).toEqual({ ok: false, code: "source.root" });
    expect(normaliseSource("/no/p/x", ctx)).toEqual({ ok: false, code: "source.market_prefix", address: "/no/p/x" });
    expect(normaliseSource("/no-en", ctx)).toEqual({ ok: false, code: "source.market_prefix", address: "/no-en" });
    // A first part that only looks like a market is not one of the store's (`om-oss` is Norwegian for "about us"): the unknown-market route serves it.
    expect(normaliseSource("/om-oss", ctx)).toEqual({ ok: true, source: "/om-oss", notes: [] });
    expect(normaliseSource("/xx/p/x", ctx)).toEqual({ ok: true, source: "/xx/p/x", notes: [] });
    expect(normaliseSource("/s/demo/no/p/x", ctx)).toEqual({ ok: false, code: "source.market_prefix", address: "/s/demo/no/p/x" });
    expect(normaliseSource("/cart", ctx)).toEqual({ ok: false, code: "source.reserved", address: "/cart" });
    expect(normaliseSource("/Checkout/pay", ctx)).toEqual({ ok: false, code: "source.reserved", address: "/checkout/pay" });
    expect(normaliseSource("/admin", ctx)).toEqual({ ok: false, code: "source.reserved", address: "/admin" });
    expect(normaliseSource("/s/other/x", ctx)).toEqual({ ok: false, code: "source.reserved", address: "/s/other/x" });
  });

  it("does not reserve the content routes: Shopify's /products/old-cup is the common source", () => {
    for (const path of ["/products/old-cup", "/blog/old-post", "/p/old", "/category/old", "/tag/old", "/collections/all"]) expect(ok(path), path).toBe(path);
  });
});

describe("a target", () => {
  const read = (raw: string) => normaliseTarget(raw, ctx);

  it("is a path on the store, with its query and fragment kept", () => {
    expect(read("/Category/Shoes")).toEqual({ ok: true, target: "/category/shoes", path: "/category/shoes", notes: [] });
    expect(read("/search?q=Cup#results")).toEqual({ ok: true, target: "/search?q=Cup#results", path: "/search", notes: [] });
    expect(read("/")).toEqual({ ok: true, target: "/", path: "/", notes: [] });
    expect(read("p/lamp")).toMatchObject({ ok: true, target: "/p/lamp" });
  });

  it("removes a country (and /s/{store}) with a note, so a pasted full address works", () => {
    expect(read("/no/p/lamp")).toEqual({ ok: true, target: "/p/lamp", path: "/p/lamp", notes: ["target.market_removed"] });
    expect(read("/s/demo/se-en/category/x?y=1")).toEqual({ ok: true, target: "/category/x?y=1", path: "/category/x", notes: ["target.market_removed"] });
    expect(read("https://shop.demo.no/no/p/lamp#a")).toEqual({ ok: true, target: "/p/lamp#a", path: "/p/lamp", notes: ["target.market_removed"] });
    expect(read("/no")).toEqual({ ok: true, target: "/", path: "/", notes: ["target.market_removed"] });
  });

  it("refuses another website, a scheme other than https, credentials and control characters", () => {
    expect(read("")).toEqual({ ok: false, code: "target.missing" });
    expect(read("https://evil.example/x")).toEqual({ ok: false, code: "target.external" });
    expect(read("//evil.example/x")).toEqual({ ok: false, code: "target.external" });
    expect(read("https:/evil.example/x")).toEqual({ ok: false, code: "target.external" });
    expect(read("https://evil.example@shop.demo.no/x")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("http://shop.demo.no/x")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("javascript:alert(1)")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("data:text/html,x")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("/a\u0001b")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("/a b")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("/\\evil.example")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("/a?x=1 2")).toEqual({ ok: false, code: "target.invalid" });
    expect(read(`/${"a".repeat(2001)}`)).toEqual({ ok: false, code: "target.invalid" });
  });

  it("refuses the platform's routes and another store's pages, and a protocol-relative path can never be built from a path", () => {
    expect(read("/admin")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("/api/x")).toEqual({ ok: false, code: "target.invalid" });
    expect(read("/s/other/no/p/x")).toEqual({ ok: false, code: "target.invalid" });
    // Extra slashes are read as a host, which is not this store's.
    expect(read("///evil.example")).toEqual({ ok: false, code: "target.external" });
    const collapsed = read("/%2F%2Fevil.example");
    expect(collapsed).toMatchObject({ ok: true, target: "/%2f%2fevil.example" });
  });

  it("goes to the working pages too (a search, the cart)", () => {
    expect(read("/search?q=x")).toMatchObject({ ok: true, path: "/search" });
    expect(read("/cart")).toMatchObject({ ok: true, path: "/cart" });
  });

  it("gives the path of a stored target", () => {
    expect(pathOfTarget("/p/lamp?x=1#a")).toBe("/p/lamp");
    expect(pathOfTarget("/")).toBe("/");
  });
});

describe("the request's query string", () => {
  it("is appended to a target with no query, whole parameters only", () => {
    expect(mergeQuery("/category/shoes", "?utm_source=a&page=2")).toBe("/category/shoes?utm_source=a&page=2");
    expect(mergeQuery("/category/shoes", "")).toBe("/category/shoes");
    expect(mergeQuery("/category/shoes", "?")).toBe("/category/shoes");
    expect(mergeQuery("/category/shoes#top", "?a=1")).toBe("/category/shoes?a=1#top");
  });

  it("adds only the parameters whose names the target does not have, and keeps the fragment", () => {
    expect(mergeQuery("/search?q=cup", "?q=other&page=2")).toBe("/search?q=cup&page=2");
    expect(mergeQuery("/search?q=cup#r", "?Q=x&utm=1")).toBe("/search?q=cup&Q=x&utm=1#r");
    expect(mergeQuery("/search?q=cup", "?q=other")).toBe("/search?q=cup");
    expect(mergeQuery("/a?x=1", "?x%5B%5D=2&x=3")).toBe("/a?x=1&x%5B%5D=2");
  });

  it("carries at most 1,000 characters of the request's, never half a parameter", () => {
    const pair = `p=${"x".repeat(398)}`;
    const merged = mergeQuery("/a", `?${pair}&q=${"y".repeat(398)}&r=${"z".repeat(398)}&s=1`);
    expect(merged.length).toBeLessThanOrEqual(2 + 1_000 + 1);
    expect(merged.startsWith("/a?p=x")).toBe(true);
    expect(merged.endsWith("&s=1")).toBe(false);
  });
});

describe("what is reserved", () => {
  it("is the store's working pages and the platform's routes, and nothing of the content routes", () => {
    const content = ["blog", "category", "p", "products", "tag"];
    expect([...WORKING_SEGMENTS].sort()).toEqual(RESERVED_STORE_PAGE_SLUGS.filter((s) => !content.includes(s)).sort());
    for (const c of content) expect(RESERVED_SOURCE_SEGMENTS).not.toContain(c);
    expect(PLATFORM_SEGMENTS).toEqual(["admin", "api", "auth", "_next", "s", "r", "demo", "kaizen"]);
    expect(isReservedPath("/cart/x")).toBe(true);
    expect(isReservedPath("/collections/x")).toBe(false);
    expect(isReservedPath("/")).toBe(false);
  });

  it("lists the static files the proxy never looks at", () => {
    expect(STATIC_EXTENSIONS).toContain("pdf");
    expect(STATIC_EXTENSIONS).not.toContain("html");
  });
});

describe("an address as a Location header", () => {
  it("percent-encodes every character that is not ASCII, as UTF-8, and keeps what is already an escape", () => {
    expect(encodeAddress("/products/ζώνη")).toBe("/products/%CE%B6%CF%8E%CE%BD%CE%B7");
    expect(encodeAddress("/pages/zażółć")).toBe("/pages/za%C5%BC%C3%B3%C5%82%C4%87");
    expect(encodeAddress("/search?q=blå")).toBe("/search?q=bl%C3%A5");
    expect(encodeAddress("/p/x?q=æ&r=1#ø")).toBe("/p/x?q=%C3%A6&r=1#%C3%B8");
    expect(encodeAddress("/a%2fb/c%3f%23%25")).toBe("/a%2fb/c%3f%23%25");
    expect(encodeAddress("/p/x?q=%C3%A5&w=å")).toBe("/p/x?q=%C3%A5&w=%C3%A5");
  });

  it("encodes a lone percent sign, a space-like or unsafe character and a lone surrogate, never throwing", () => {
    expect(encodeAddress("/a?x=100%")).toBe("/a?x=100%25");
    expect(encodeAddress('/a?x="<>"')).toBe("/a?x=%22%3C%3E%22");
    expect(encodeAddress("/a\ud800b")).toBe("/a%EF%BF%BDb");
  });

  it("is ASCII for any address, and applying it again changes nothing", () => {
    const samples = ["/", "/ø/å/æ", "/p/ζώνη?q=日本語#ø", "/x%zz", "/a?b=%", "/a%2Fb", "/😀/p", "/p/\u0100\u00ff\u0400"];
    for (const sample of samples) {
      const once = encodeAddress(sample);
      expect(/^[\x21-\x7e]*$/.test(once), once).toBe(true);
      expect(encodeAddress(once)).toBe(once);
    }
  });

  it("decodes back to the address that was typed", () => {
    const typed = "/products/ζώνη?q=blå";
    const [path, query] = encodeAddress(typed).split("?");
    expect(decodeURIComponent(path) + "?" + decodeURIComponent(query)).toBe(typed);
  });
});
