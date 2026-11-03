import { describe, expect, it } from "vitest";

import { figureOf, figureText, shopReport, type ShopAnswers } from "./shopify-report";

const full: ShopAnswers = {
  shop: { name: "Nordic Wool", currencyCode: "NOK", taxesIncluded: true, primaryDomain: { host: "nordicwool.no" }, billingAddress: { countryCodeV2: "NO" } },
  productsCount: { count: 312, precision: "EXACT" },
  productVariantsCount: { count: 1204, precision: "EXACT" },
  collectionsCount: { count: 41, precision: "EXACT" },
  pagesCount: { count: 18, precision: "EXACT" },
  blogs: { nodes: [{ articlesCount: { count: 40, precision: "EXACT" } }, { articlesCount: { count: 12, precision: "EXACT" } }] },
  urlRedirectsCount: { count: 610, precision: "EXACT" },
  customersCount: { count: 2180, precision: "EXACT" },
  subscribers: { totalCount: 1340 },
  ordersCount: { count: 10000, precision: "AT_LEAST" },
  giftCardsCount: { count: 3, precision: "EXACT" },
  discountNodesCount: { count: 6, precision: "EXACT" },
  markets: {
    nodes: [
      { name: "Norway", regions: { nodes: [{ code: "NO" }] }, currencySettings: { baseCurrency: { currencyCode: "NOK" } } },
      { name: "Nordics", regions: { nodes: [{ code: "SE" }, { code: "DK" }, {}] }, currencySettings: { baseCurrency: { currencyCode: "SEK" } } },
    ],
  },
  variants: { nodes: [{ price: "299.00", compareAtPrice: "399.00" }, { price: "199.00", compareAtPrice: null }, { price: "99.00", compareAtPrice: "99.00" }] },
};

describe("the report of a Shopify shop", () => {
  it("counts what the shop holds, with a lower bound where Shopify gave one, and blog posts across its blogs", () => {
    const r = shopReport(full, { missingScopes: [], allOrders: true });
    expect([r.name, r.currency, r.taxesIncluded]).toEqual(["Nordic Wool", "NOK", true]);
    expect([r.products, r.collections, r.pages, r.blogs, r.articles]).toEqual([
      { n: 312, atLeast: false },
      { n: 41, atLeast: false },
      { n: 18, atLeast: false },
      { n: 2, atLeast: false },
      { n: 52, atLeast: false },
    ]);
    expect([r.customers, r.subscribers, r.orders, r.giftCardsWithMoney]).toEqual([
      { n: 2180, atLeast: false },
      { n: 1340, atLeast: false },
      { n: 10000, atLeast: true },
      { n: 3, atLeast: false },
    ]);
  });

  it("answers from the shop's own settings: its countries from its markets and the currencies beside its own", () => {
    const r = shopReport(full, { missingScopes: [], allOrders: true });
    expect([r.countries, r.currencies]).toEqual([["DK", "NO", "SE"], ["SEK"]]);
    const noMarkets = shopReport({ ...full, markets: null }, { missingScopes: [], allOrders: true });
    expect(noMarkets.countries).toEqual(["NO"]);
  });

  it("says at most three things good to know, the weightiest first", () => {
    expect(shopReport(full, { missingScopes: [], allOrders: true }).goodToKnow).toEqual(["compare_at", "gift_card_codes"]);
    expect(shopReport({ ...full, shop: { ...full.shop, taxesIncluded: false } }, { missingScopes: ["read_customers"], allOrders: false }).goodToKnow).toEqual([
      "prices_without_vat",
      "compare_at",
      "gift_card_codes",
    ]);
    expect(shopReport({ ...full, variants: null, giftCardsCount: { count: 0 } }, { missingScopes: [], allOrders: false }).goodToKnow).toEqual(["orders_60_days"]);
  });

  it("never turns a missing answer into 0, and says when customers could not be read", () => {
    const r = shopReport({ shop: full.shop }, { missingScopes: ["read_customers"], allOrders: true });
    expect([r.products, r.customers, r.subscribers, r.articles, r.blogs]).toEqual([null, null, null, null, null]);
    expect(r.goodToKnow).toEqual(["customers_hidden"]);
    expect(shopReport({ shop: { ...full.shop, taxesIncluded: "yes" } }, { missingScopes: [], allOrders: true }).taxesIncluded).toBeNull();
    expect(figureOf({ count: -1 })).toBeNull();
    expect(figureOf({ count: "12" })).toBeNull();
  });

  it("writes a figure with its lower bound, and a dash for one that is unknown", () => {
    expect(figureText({ n: 10000, atLeast: true }, "en-GB")).toBe("10,000+");
    expect(figureText({ n: 1340, atLeast: false }, "en-GB")).toBe("1,340");
    expect(figureText(null, "en-GB")).toBe("–");
  });
});
