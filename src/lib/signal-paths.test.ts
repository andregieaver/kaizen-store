import { describe, expect, it } from "vitest";

import { RESERVED_ARTICLE_SLUGS, RESERVED_STORE_PAGE_SLUGS } from "./page-content";
import { PRIVATE_SEGMENTS, RESERVED_ARTICLE_SEGMENTS, RESERVED_PAGE_SEGMENTS, signalPlace } from "./signal-paths";
import { speedKind } from "./speed";
import { PRIVATE_ROUTES, placeOfPath } from "./visit-record";

const STORE = "demo";
const MARKETS = ["NO", "SE"];

/** What the server keeps: a page whose kind is measured. */
const serverKeeps = (path: string, marketless = false) => {
  const address = marketless
    ? { home: "no", marketless: true, languages: ["en"], currencies: ["eur"], keptLanguages: [], keptCurrencies: [], countries: ["no"] }
    : null;
  const place = placeOfPath(path, STORE, MARKETS, address);
  return place ? speedKind(place.landing) !== null : false;
};

const PATHS = [
  "/s/demo/no",
  "/no",
  "/no/p/blue-shirt",
  "/no/p/ab",
  "/no/category/shirts",
  "/no/tag/sale",
  "/no/products",
  "/no/blog",
  "/no/blog/a-post",
  "/no/om-oss",
  "/no/search",
  "/no-en-eur/p/x",
  "/no/blogs/a/b",
  "/no/a/b",
  "/no/withdraw",
  "/no/returns/t",
  "/no/cookies",
  "/no/cart",
  "/no/checkout",
  "/no/account/orders",
  "/no/unsubscribe/abc",
  "/no/order/123",
  "/s/demo/no/checkout",
  "/s/other/no/p/x",
];

describe("the pages heatmaps and recordings may collect on (D656)", () => {
  it("never refuses a page the server keeps, and refuses every private route", () => {
    for (const path of PATHS) {
      if (serverKeeps(path)) expect(signalPlace(path, "", STORE), path).not.toBeNull();
    }
    for (const route of PRIVATE_ROUTES) {
      expect(signalPlace(`/no/${route}`, "", STORE), route).toBeNull();
      expect(signalPlace(`/no/${route}/x`, "", STORE), route).toBeNull();
      expect(signalPlace(`/s/demo/no/${route}`, "", STORE), route).toBeNull();
    }
    for (const path of ["/no/withdraw", "/no/returns/t", "/no/checkout", "/no/a/b", "/no/blogs/a/b", "/s/other/no/p/x"]) {
      expect(signalPlace(path, "", STORE), path).toBeNull();
    }
  });

  it("keeps a store without a market in its addresses", () => {
    for (const path of ["/p/shirt", "/eur/p/x", "/en-eur/category/y", "/", "/om-oss"]) {
      if (serverKeeps(path, true)) expect(signalPlace(path, "", STORE), path).not.toBeNull();
    }
    expect(signalPlace("/p/shirt", "", STORE)).toEqual({ heat: true, rec: true });
    expect(signalPlace("/", "", STORE)).toEqual({ heat: true, rec: true });
  });

  it("never records the search page or a page showing typed words", () => {
    expect(signalPlace("/no/search", "", STORE)).toEqual({ heat: true, rec: false });
    expect(signalPlace("/no", "?q=secret", STORE)).toEqual({ heat: true, rec: false });
    expect(signalPlace("/no/p/x", "?utm_source=a", STORE)).toEqual({ heat: true, rec: true });
  });

  it("copies the server's lists exactly", () => {
    expect(PRIVATE_SEGMENTS).toEqual(PRIVATE_ROUTES);
    expect(RESERVED_PAGE_SEGMENTS).toEqual(RESERVED_STORE_PAGE_SLUGS);
    expect(RESERVED_ARTICLE_SEGMENTS).toEqual(RESERVED_ARTICLE_SLUGS);
  });
});
