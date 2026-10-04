import { describe, expect, it } from "vitest";

import { fromStoresOwnPage, NEW_VISITS_PER_ADDRESS_WINDOW, NEW_VISITS_PER_STORE_DAY, OTHER_PAGE, PAGE_VIEW_CAP, placeOfPath, visitBody } from "./visit-record";

const markets = ["NO", "SE"];

describe("visitBody", () => {
  const ok = { store: "demo", path: "/s/demo/no" };

  it("takes what the beacon sends", () => {
    expect(visitBody.safeParse({ ...ok, referrer: "www.google.com", utm_source: "a", utm_medium: "b", utm_campaign: "c", gclid: true }).success).toBe(true);
    expect(visitBody.safeParse(ok).success).toBe(true);
  });

  it("refuses a store that is not a slug, a path that is not one and a click id that carries a value", () => {
    expect(visitBody.safeParse({ ...ok, store: "Demo Store" }).success).toBe(false);
    expect(visitBody.safeParse({ ...ok, store: "ab" }).success).toBe(false);
    expect(visitBody.safeParse({ ...ok, path: "no/cart" }).success).toBe(false);
    expect(visitBody.safeParse({ ...ok, path: "/a b" }).success).toBe(false);
    expect(visitBody.safeParse({ ...ok, path: "/<script>" }).success).toBe(false);
    expect(visitBody.safeParse({ ...ok, path: `/${"a".repeat(300)}` }).success).toBe(false);
    expect(visitBody.safeParse({ ...ok, gclid: "EAIaIQobChMI" }).success).toBe(false);
    expect(visitBody.safeParse({ ...ok, utm_campaign: "x".repeat(81) }).success).toBe(false);
  });

  it("keeps nothing it was not asked for", () => {
    const parsed = visitBody.parse({ ...ok, ip: "1.2.3.4", userAgent: "Mozilla" });
    expect(Object.keys(parsed)).toEqual(["store", "path"]);
  });
});

describe("placeOfPath", () => {
  it("knows a store's pages on the platform and on its own host", () => {
    expect(placeOfPath("/s/demo/no/p/blue-mug", "demo", markets)).toEqual({ market: "NO", kind: "product", handle: "blue-mug", landing: "/no/p/blue-mug" });
    expect(placeOfPath("/se/p/blue-mug", "demo", markets)).toEqual({ market: "SE", kind: "product", handle: "blue-mug", landing: "/se/p/blue-mug" });
    expect(placeOfPath("/s/demo/no/checkout", "demo", markets)).toEqual({ market: "NO", kind: "checkout", handle: null, landing: "/no/checkout" });
    expect(placeOfPath("/s/demo/no", "demo", markets)).toEqual({ market: "NO", kind: "other", handle: null, landing: "/no" });
  });

  it("reads a market with language, currency and A/B versions as its country", () => {
    expect(placeOfPath("/s/demo/no-en-eur/cart", "demo", markets)?.market).toBe("NO");
    expect(placeOfPath("/s/demo/no~0a1b2c3db/cart", "demo", markets)).toMatchObject({ market: "NO", kind: "cart" });
    // A param that is not a market with well-formed tokens is not one of the store's pages.
    expect(placeOfPath("/s/demo/no~nonsense/cart", "demo", markets)).toBeNull();
  });

  it("knows the front door", () => {
    expect(placeOfPath("/s/demo", "demo", markets)).toEqual({ market: null, kind: "other", handle: null, landing: "/" });
    expect(placeOfPath("/", "demo", markets)).toEqual({ market: null, kind: "other", handle: null, landing: "/" });
  });

  it("drops what is not one of the store's pages", () => {
    expect(placeOfPath("/s/other/no/cart", "demo", markets)).toBeNull();
    expect(placeOfPath("/s/demo/dk/cart", "demo", markets)).toBeNull();
    expect(placeOfPath("/admin/demo", "demo", markets)).toBeNull();
    expect(placeOfPath("/api/visit", "demo", markets)).toBeNull();
  });

  it("ignores a query or fragment", () => {
    expect(placeOfPath("/s/demo/no/p/mug?x=1#y", "demo", markets)).toMatchObject({ kind: "product", handle: "mug" });
  });
});

describe("the cap", () => {
  it("is a number of page views a person cannot reach in a day", () => {
    expect(PAGE_VIEW_CAP).toBeGreaterThanOrEqual(1000);
  });
});

/** What is stored of a path (D152): a short list of shapes, never a raw path, an id or a token. */
describe("the landing path that is stored", () => {
  const landing = (path: string) => placeOfPath(path, "demo", markets)?.landing;

  it("keeps the shapes of the store's own pages, with the market's country in front", () => {
    expect(landing("/s/demo")).toBe("/");
    expect(landing("/s/demo/no")).toBe("/no");
    expect(landing("/s/demo/no/p/blue-mug")).toBe("/no/p/blue-mug");
    expect(landing("/s/demo/no/cart")).toBe("/no/cart");
    expect(landing("/s/demo/no/checkout")).toBe("/no/checkout");
    expect(landing("/s/demo/no/search")).toBe("/no/search");
    expect(landing("/s/demo/no/products")).toBe("/no/products");
    expect(landing("/s/demo/no/category/mugs")).toBe("/no/category/mugs");
    expect(landing("/s/demo/no/tag/new")).toBe("/no/tag/new");
    expect(landing("/s/demo/no/blog")).toBe("/no/blog");
    expect(landing("/s/demo/no/blog/our-story")).toBe("/no/blog/our-story");
    expect(landing("/s/demo/no/about-us")).toBe("/no/about-us");
    // On the store's own host, with language, currency and A/B choices in the market's address.
    expect(landing("/se-en-eur/p/blue-mug")).toBe("/se/p/blue-mug");
    expect(landing("/no~0a1b2c3db/cart")).toBe("/no/cart");
  });

  it("drops the query and fragment, and a handle is decoded and checked", () => {
    expect(landing("/s/demo/no/p/blue-mug?utm_source=x&token=secret#top")).toBe("/no/p/blue-mug");
    expect(landing("/s/demo/no/p/caf%C3%A9")).toBe("/no/p/café");
    expect(landing("/s/demo/no/p/%3Cscript%3E")).toBe(OTHER_PAGE);
    expect(landing("/s/demo/no/p/a%20b")).toBe(OTHER_PAGE);
    expect(landing(`/s/demo/no/p/${"a".repeat(101)}`)).toBe(OTHER_PAGE);
    expect(landing("/s/demo/no/p/blue-mug/anything/after")).toBe(OTHER_PAGE);
  });

  it("never keeps a token or an id: every route that has one is (other)", () => {
    const secrets = [
      "/s/demo/no/account/sign-in/AbCdEf0123456789secrettoken",
      "/s/demo/no/account/invoice/tok123",
      "/s/demo/no/account/documents/inv_AbCdEf0123456789tok123",
      "/s/demo/no/account/company/invite/tok123",
      "/s/demo/no/account/orders/0b3c9a42-6d0e-4b7e-9c35-2f4d9c6a7e11",
      "/s/demo/no/order/0b3c9a42-6d0e-4b7e-9c35-2f4d9c6a7e11",
      "/s/demo/no/cart/restore/tok123",
      "/s/demo/no/download/tok123",
      "/s/demo/no/subscription/tok123",
      "/s/demo/no/unsubscribe/tok123",
      "/s/demo/no/wishlist/saved",
      "/s/demo/no/search/go",
      "/no/unsubscribe/tok123",
    ];
    for (const path of secrets) {
      const kept = landing(path);
      expect(kept, path).toBe(OTHER_PAGE);
      expect(kept).not.toContain("tok123");
      expect(kept).not.toContain("0b3c9a42");
    }
    // The place is still known, so the visit is counted: only the address is not kept.
    expect(placeOfPath("/s/demo/no/account/sign-in/secret", "demo", markets)).toMatchObject({ market: "NO", landing: OTHER_PAGE });
  });

  it("is (other) for the store's working routes, whatever they are called, and for what is not a slug", () => {
    for (const route of ["account", "order", "unsubscribe", "download", "subscription", "deliveries", "wishlist", "cookies"]) {
      expect(landing(`/s/demo/no/${route}`), route).toBe(OTHER_PAGE);
    }
    expect(landing("/s/demo/no/Secret_Token_123")).toBe(OTHER_PAGE);
    expect(landing(`/s/demo/no/${"a".repeat(81)}`)).toBe(OTHER_PAGE);
    expect(landing("/s/demo/no/category/Mugs%20and")).toBe(OTHER_PAGE);
    expect(landing("/s/demo/no/blog/category")).toBe(OTHER_PAGE);
    expect(landing("/s/demo/no/about/us")).toBe(OTHER_PAGE);
  });

  it("is always short, and always one of the shapes or (other), for any path at all", () => {
    const shapes = /^(\/|\/[a-z]{2}|\/[a-z]{2}\/(p\/[^/]+|category\/[a-z0-9-]+|tag\/[a-z0-9-]+|blog\/[a-z0-9-]+|[a-z0-9-]+)|\(other\))$/u;
    for (const path of ["/s/demo/no/x/y/z", "/s/demo/no/a1b2c3d4-e5f6", "/no/p/x?y=z", "/se/....", "/s/demo/se/%00", "/s/demo/no/p/%E0%A4%A"]) {
      const place = placeOfPath(path, "demo", markets);
      if (place) expect(place.landing, path).toMatch(shapes);
    }
  });
});

describe("fromStoresOwnPage", () => {
  const platform = { requestHost: "kaizen.example", slug: "demo", ownHosts: [], storesOnPlatformHost: true };
  const own = { requestHost: "demo.shop.example", slug: "demo", ownHosts: ["demo.shop.example"], storesOnPlatformHost: false };

  it("takes a page of the store on Kaizen's host: the Referer is under /s/{store}", () => {
    expect(fromStoresOwnPage({ ...platform, origin: "https://kaizen.example", referer: "https://kaizen.example/s/demo/no/cart?x=1" })).toBe(true);
    expect(fromStoresOwnPage({ ...platform, origin: null, referer: "https://kaizen.example/s/demo" })).toBe(true);
  });

  it("refuses another store's page, or a request with no Referer, on Kaizen's host", () => {
    expect(fromStoresOwnPage({ ...platform, origin: "https://kaizen.example", referer: "https://kaizen.example/s/other/no" })).toBe(false);
    expect(fromStoresOwnPage({ ...platform, origin: "https://kaizen.example", referer: "https://kaizen.example/s/demo-two/no" })).toBe(false);
    expect(fromStoresOwnPage({ ...platform, origin: "https://kaizen.example", referer: "https://kaizen.example/admin/demo" })).toBe(false);
    expect(fromStoresOwnPage({ ...platform, origin: "https://kaizen.example", referer: null })).toBe(false);
  });

  it("takes the store's own host, and no other store's host", () => {
    expect(fromStoresOwnPage({ ...own, origin: "https://demo.shop.example", referer: "https://demo.shop.example/no/cart" })).toBe(true);
    expect(fromStoresOwnPage({ ...own, origin: "https://demo.shop.example", referer: null })).toBe(true);
    // A request to another store's host, with this store in the body.
    expect(
      fromStoresOwnPage({ ...own, requestHost: "other.shop.example", origin: "https://other.shop.example", referer: "https://other.shop.example/no" }),
    ).toBe(false);
  });

  it("refuses a request that is no page's: neither header, a header that is not an address, or another host", () => {
    expect(fromStoresOwnPage({ ...own, origin: null, referer: null })).toBe(false);
    expect(fromStoresOwnPage({ ...own, origin: "null", referer: "https://demo.shop.example/no" })).toBe(false);
    expect(fromStoresOwnPage({ ...own, origin: "https://evil.example", referer: "https://demo.shop.example/no" })).toBe(false);
    expect(fromStoresOwnPage({ ...own, origin: "https://demo.shop.example", referer: "https://evil.example/no" })).toBe(false);
    expect(fromStoresOwnPage({ ...own, origin: "javascript:alert(1)", referer: null })).toBe(false);
    expect(fromStoresOwnPage({ ...own, requestHost: null, origin: "https://demo.shop.example", referer: null })).toBe(false);
  });

  it("is not fooled by letter case in the host", () => {
    expect(fromStoresOwnPage({ ...own, requestHost: "Demo.Shop.Example", origin: "https://DEMO.shop.example", referer: null })).toBe(true);
  });
});

describe("the abuse bounds", () => {
  it("are numbers a shop's real traffic does not reach, and a script's does", () => {
    expect(NEW_VISITS_PER_STORE_DAY).toBeGreaterThanOrEqual(10_000);
    expect(NEW_VISITS_PER_ADDRESS_WINDOW).toBeGreaterThanOrEqual(20);
    expect(NEW_VISITS_PER_ADDRESS_WINDOW).toBeLessThan(NEW_VISITS_PER_STORE_DAY);
  });
});
