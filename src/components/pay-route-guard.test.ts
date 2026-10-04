import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { holdAffiliateCode } from "@/lib/affiliate-memory";

import { PayDocumentWatcher, PayRouteGuard, forgetPaths, mustReload, notePath, reloadAddress } from "./pay-route-guard";

vi.mock("next/navigation", () => ({ usePathname: () => "/s/demo/no" }));

/**
 * The cart, checkout and order are entered by a full page load (wave 1, 1e, `docs/pci.md`): a document that has been on a page of the
 * store that is not one of them reloads when a pay page is drawn in it, and one that has not never does (so it cannot loop).
 */
describe("the pay route guard", () => {
  beforeEach(() => forgetPaths());

  it("leaves a document that began on a pay route alone, and one that moves between pay routes", () => {
    for (const path of ["/s/demo/no/cart", "/s/demo/no/checkout", "/s/demo/no/order/abc?session_id=1", "/no/cart"]) {
      expect(notePath(path), path).toBe(false);
    }
    expect(mustReload()).toBe(false);
  });

  it("reloads a pay page drawn in a document that has been on any other page of the store", () => {
    notePath("/s/demo/no");
    expect(mustReload()).toBe(true);
    // And stays so: back on the cart after the product page, the extras have already been drawn into this document.
    forgetPaths();
    notePath("/s/demo/no/cart");
    notePath("/s/demo/no/p/lampe");
    notePath("/s/demo/no/cart");
    expect(mustReload()).toBe(true);
  });

  it("counts the store's own host, the language and currency in the address, and a test's token", () => {
    expect(notePath("/no-en-eur/cart")).toBe(false);
    expect(notePath("/no~abc_def/checkout")).toBe(false);
    expect(notePath("/no/products")).toBe(true);
  });

  it("draws nothing itself", () => {
    expect(renderToString(createElement(PayRouteGuard))).toBe("");
    expect(renderToString(createElement(PayDocumentWatcher))).toBe("");
  });

  it("carries a referral code held only in the page's memory across the reload, never one for another store or one the address already has", () => {
    const origin = "https://shop.test";
    holdAffiliateCode("demo", null);
    expect(reloadAddress("https://shop.test/s/demo/no/cart", origin, "demo")).toBe("https://shop.test/s/demo/no/cart");
    holdAffiliateCode("demo", "abc234");
    expect(reloadAddress("https://shop.test/s/demo/no/cart", origin, "demo")).toBe("/s/demo/no/cart?ref=abc234");
    expect(reloadAddress("https://shop.test/s/demo/no/checkout?x=1", origin, "demo")).toBe("/s/demo/no/checkout?x=1&ref=abc234");
    expect(reloadAddress("https://shop.test/s/demo/no/cart?ref=zzz999", origin, "demo")).toBe("https://shop.test/s/demo/no/cart?ref=zzz999");
    expect(reloadAddress("https://shop.test/s/other/no/cart", origin, "other")).toBe("https://shop.test/s/other/no/cart");
    expect(reloadAddress("https://shop.test/s/demo/no/cart", origin, null)).toBe("https://shop.test/s/demo/no/cart");
    holdAffiliateCode("demo", null);
  });
});
