import { describe, expect, it } from "vitest";

import { countByKind, counterpartOf, fateOf, kindOfOldPath, oldPathOf, readSitemap, sureTarget } from "./old-shop";
import { emptyIndex, type RedirectIndex } from "./redirects";

describe("reading a sitemap", () => {
  it("reads Shopify's index and a page list, entities and CDATA included, without duplicates", () => {
    const index = readSitemap(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://myshop.com/sitemap_products_1.xml?from=1&amp;to=99</loc></sitemap>
  <sitemap><loc>https://myshop.com/sitemap_pages_1.xml</loc></sitemap>
</sitemapindex>`);
    expect(index).toEqual({ index: true, locs: ["https://myshop.com/sitemap_products_1.xml?from=1&to=99", "https://myshop.com/sitemap_pages_1.xml"] });
    const urls = readSitemap(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <url><loc>https://myshop.com/products/wool-hat</loc><image:image><image:loc>https://cdn.shopify.com/hat.jpg</image:loc></image:image></url>
  <url><loc><![CDATA[https://myshop.com/products/blå-genser]]></loc></url>
  <url><loc> https://myshop.com/products/wool-hat </loc></url>
</urlset>`);
    expect(urls).toEqual({ index: false, locs: ["https://myshop.com/products/wool-hat", "https://myshop.com/products/blå-genser"] });
  });

  it("is null for a page that is not a sitemap, and stops at the most it keeps", () => {
    expect(readSitemap("<!doctype html><html><body>Not found</body></html>")).toBeNull();
    const many = `<urlset>${Array.from({ length: 10 }, (_, i) => `<url><loc>https://a.com/p${i}</loc></url>`).join("")}</urlset>`;
    expect(readSitemap(many, 3)?.locs).toHaveLength(3);
  });
});

describe("an old address as a redirect's source", () => {
  it("keeps the old shop's own host only, any www., in the normal form", () => {
    expect(oldPathOf("https://www.myshop.com/products/Wool-Hat?variant=1", "myshop.com")).toBe("/products/wool-hat");
    expect(oldPathOf("https://myshop.com/products/wool-hat", "www.myshop.com")).toBe("/products/wool-hat");
    expect(oldPathOf("https://cdn.shopify.com/products/wool-hat", "myshop.com")).toBeNull();
    expect(oldPathOf("https://myshop.com/", "myshop.com")).toBeNull();
    expect(oldPathOf("ftp://myshop.com/x", "myshop.com")).toBeNull();
    expect(oldPathOf("not a url", "myshop.com")).toBeNull();
  });

  it("takes a language folder off before a known section, so a product in five languages is one address", () => {
    expect(oldPathOf("https://myshop.com/en/products/wool-hat", "myshop.com")).toBe("/products/wool-hat");
    expect(oldPathOf("https://myshop.com/de-de/collections/hats", "myshop.com")).toBe("/collections/hats");
    expect(oldPathOf("https://myshop.com/en/about-us", "myshop.com")).toBe("/en/about-us");
    expect(oldPathOf("https://myshop.com/no", "myshop.com")).toBe("/no");
  });
});

describe("what an old address was, and its address here", () => {
  it.each([
    ["/products/wool-hat", "product", "/p/wool-hat"],
    ["/collections/hats/products/wool-hat", "product", "/p/wool-hat"],
    ["/collections/hats", "category", "/category/hats"],
    ["/collections/hats/red", "category", "/category/hats"],
    ["/collections/all", "category", "/products"],
    ["/collections", "category", "/products"],
    ["/pages/about-us", "page", "/about-us"],
    ["/blogs/news", "blog", "/blog"],
    ["/blogs/news/tagged/wool", "blog", "/blog"],
    ["/blogs/news/winter-sale", "article", "/blog/winter-sale"],
    ["/product/wool-hat", "product", "/p/wool-hat"],
    ["/product-category/clothes/hats", "category", "/category/hats"],
    ["/product-tag/wool", "category", "/tag/wool"],
    ["/shop", "category", "/products"],
    ["/somewhere/else", "other", null],
  ])("%s is a %s, here %s", (path, kind, here) => {
    expect(kindOfOldPath(path)).toBe(kind);
    expect(counterpartOf(path)).toBe(here);
  });
});

describe("where an old address leads now", () => {
  const live = new Set(["/p/wool-hat", "/category/hats"]);
  const index: RedirectIndex = {
    manual: new Map([
      ["/products/wool-hat", "/p/wool-hat"],
      ["/products/gone", "/p/sold-out"],
      ["/pages/a", "/pages/b"],
      ["/pages/b", "/pages/a"],
    ]),
    automatic: new Map([["/p/old-name", null]]),
  };

  it("is live, redirected to a page, broken, or missing", () => {
    expect(fateOf("/p/wool-hat", { live, index })).toEqual({ fate: "live" });
    expect(fateOf("/products/wool-hat", { live, index })).toEqual({ fate: "redirected", to: "/p/wool-hat" });
    expect(fateOf("/products/gone", { live, index })).toEqual({ fate: "broken" });
    expect(fateOf("/pages/a", { live, index })).toEqual({ fate: "broken" });
    expect(fateOf("/p/old-name", { live, index })).toEqual({ fate: "broken" });
    expect(fateOf("/products/new", { live, index: emptyIndex() })).toEqual({ fate: "missing" });
  });

  it("is sure only of the same thing under our shape when it is live here", () => {
    expect(sureTarget("/products/wool-hat", live)).toBe("/p/wool-hat");
    expect(sureTarget("/collections/hats/red", live)).toBe("/category/hats");
    expect(sureTarget("/collections/all", live)).toBeNull();
    expect(sureTarget("/products/scarf", live)).toBeNull();
    expect(sureTarget("/somewhere/else", live)).toBeNull();
  });

  it("counts by kind, in a fixed order, and how many of each lead somewhere", () => {
    expect(
      countByKind([
        { kind: "page", fate: "missing" },
        { kind: "product", fate: "redirected" },
        { kind: "product", fate: "broken" },
        { kind: "product", fate: "live" },
      ]),
    ).toEqual([
      { kind: "product", total: 3, working: 2 },
      { kind: "page", total: 1, working: 0 },
    ]);
  });
});
