import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";

import { FORBIDDEN_ON_PAY_ROUTES, PAY_SEGMENTS, PAY_SOURCES, importsForbidden, isChangeLinkPath, isDocumentPath, isNoExtrasPath, isPayLinkPath, isPayPath } from "./pay-routes";

const PAY = [
  "/s/demo/no/cart",
  "/s/demo/no/checkout",
  "/s/demo/no/order/6f1c0b9e-1111-2222-3333-444444444444",
  "/s/demo/no/order/abc/terms/terms",
  "/s/demo/no-en/cart",
  "/s/demo/no-eur/checkout",
  "/s/demo/no-en-eur/order",
  "/s/demo/no~3fa9c1d2b_7b21aa90c/checkout",
  "/no/cart",
  "/no/checkout",
  "/se/order/abc",
  "/no-en/checkout",
  "/no~abc/order/123",
  "/s/demo/no/cart?utm=1",
  "/s/demo/no/cart/",
];
const NOT_PAY = [
  "/",
  "/s/demo",
  "/s/demo/no",
  "/s/demo/no/products",
  "/s/demo/no/cartoon",
  "/s/demo/no/account",
  "/s/demo/no/withdraw",
  "/s/cart",
  "/s/cart/no",
  "/cart",
  "/checkout",
  "/blog/cart",
  "/blog/order",
  "/admin/demo/orders",
  "/admin/cart",
  "/s/demo/n/cart",
  "/s/demo/nor/cart",
  "/api/cart",
  "/s/demo/no/product/cart",
];

describe("the pay routes (wave 1, 1e)", () => {
  it("are the cart, the checkout and the order", () => {
    expect(PAY_SEGMENTS).toEqual(["cart", "checkout", "order"]);
  });

  it.each(PAY)("%s is a pay route", (path) => {
    expect(isPayPath(path)).toBe(true);
  });

  it.each(NOT_PAY)("%s is not", (path) => {
    expect(isPayPath(path)).toBe(false);
  });

  it("is what the sources the policy is sent on match, both ways round", () => {
    const sources = PAY_SOURCES.map((source) => pathToRegexp(source));
    const matched = (path: string) => sources.some((re) => re.test(path.split("?")[0]));
    for (const path of PAY) expect([path, matched(path)]).toEqual([path, true]);
    for (const path of NOT_PAY) expect([path, matched(path)]).toEqual([path, false]);
  });
});

describe("what a pay route may not reach", () => {
  it("names the consent banner and manager, the owner's code, the chat widget, referral capture and the business popup", () => {
    for (const fragment of ["site-consent", "consent-manager", "store-custom-code", "custom-code", "site-chat", "chat-widget", "store-affiliate", "buyer"]) {
      expect(FORBIDDEN_ON_PAY_ROUTES.some((f) => f.includes(fragment))).toBe(true);
    }
  });

  it("finds a forbidden import by its specifier, with or without the alias", () => {
    expect(importsForbidden("@/components/consent/site-consent")).toBeTruthy();
    expect(importsForbidden("@/lib/custom-code")).toBeTruthy();
    expect(importsForbidden("../../components/site-chat")).toBeTruthy();
    expect(importsForbidden("@/components/store-layout")).toBeUndefined();
    expect(importsForbidden("@/lib/customer-tiers")).toBeUndefined();
  });

  it("names files that exist, so the list cannot silently go stale", async () => {
    const { existsSync } = await import("node:fs");
    const { join } = await import("node:path");
    for (const fragment of FORBIDDEN_ON_PAY_ROUTES) {
      const base = join(process.cwd(), "src", fragment);
      expect([fragment, [".ts", ".tsx"].some((ext) => existsSync(base + ext))]).toEqual([fragment, true]);
    }
  });
});

describe("what the pay route guard loads (a policy without eval)", () => {
  it("reaches no zod: the guard's imports are small modules, never affiliates.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const read = (file: string) => readFileSync(join(process.cwd(), "src", file), "utf8");
    for (const file of ["components/pay-route-guard.tsx", "lib/affiliate-address.ts", "lib/affiliate-memory.ts", "lib/pay-routes.ts"]) {
      const imports = [...read(file).matchAll(/from\s+["']([^"']+)["']/g)].map((m) => m[1]);
      expect([file, imports.filter((i) => i === "zod" || /(^|\/)affiliates$/.test(i))]).toEqual([file, []]);
    }
  });
});

describe("the hosted invoices and credit notes (D159)", () => {
  const TOKEN = "inv_" + "A".repeat(43);
  const DOCS = [
    `/s/demo/no/account/documents/${TOKEN}`,
    `/s/demo/no-en-eur/account/documents/${TOKEN}/pdf`,
    `/s/demo/se/account/documents/crn_${"b".repeat(43)}?print=1`,
    `/no/account/documents/${TOKEN}`,
    `/no~tok_1/account/documents/${TOKEN}/pdf`,
  ];
  const NOT_DOCS = [
    "/s/demo/no",
    "/s/demo/no/account",
    "/s/demo/no/account/documents",
    "/s/demo/no/account/orders/abc",
    "/s/demo/no/account/invoice/tok",
    "/s/demo/no/products/account/documents/x",
    "/account/documents/x",
    "/admin/demo/invoices/abc",
  ];

  it.each(DOCS)("%s draws none of the layout's extras", (path) => {
    expect(isDocumentPath(path)).toBe(true);
    expect(isNoExtrasPath(path)).toBe(true);
    // A document is not a pay route: no card, so no policy and no pay-route reload rules of their own.
    expect(isPayPath(path)).toBe(false);
  });

  it.each(NOT_DOCS)("%s is not one", (path) => {
    expect(isDocumentPath(path)).toBe(false);
  });

  it("the pay routes still draw none of them", () => {
    expect(isNoExtrasPath("/s/demo/no/cart")).toBe(true);
    expect(isNoExtrasPath("/s/demo/no/account")).toBe(false);
  });
});

describe("a draft order's pay link (wave 3, run 2, D173)", () => {
  const TOKEN = "A".repeat(43);
  const LINKS = [
    `/s/demo/no/account/pay/${TOKEN}`,
    `/s/demo/no-en-eur/account/pay/${TOKEN}?x=1`,
    `/no/account/pay/${TOKEN}`,
    `/no~tok_1/account/pay/${TOKEN}`,
  ];
  const NOT_LINKS = [
    "/s/demo/no/account/pay",
    "/s/demo/no/account/pay/",
    "/s/demo/no/account",
    "/s/demo/no/account/payments/x",
    "/s/demo/no/products/account/pay/x",
    "/account/pay/x",
    "/s/demo/no/pay/x",
    "/admin/demo/orders/drafts",
  ];

  it.each(LINKS)("%s draws none of the layout's extras and is not a pay route", (path) => {
    expect(isPayLinkPath(path)).toBe(true);
    expect(isNoExtrasPath(path)).toBe(true);
    // No card is typed here, so no policy of its own: the button hands the buyer to Stripe's page.
    expect(isPayPath(path)).toBe(false);
    expect(isDocumentPath(path)).toBe(false);
  });

  it.each(NOT_LINKS)("%s is not one", (path) => {
    expect(isPayLinkPath(path)).toBe(false);
  });
});

describe("a change's pay link (wave 3, run 3, D174)", () => {
  const TOKEN = "B".repeat(43);
  const LINKS = [
    `/s/demo/no/account/change/${TOKEN}`,
    `/s/demo/no-en-eur/account/change/${TOKEN}?x=1`,
    `/no/account/change/${TOKEN}`,
    `/se~tok_1/account/change/${TOKEN}#top`,
  ];
  const NOT_LINKS = [
    "/s/demo/no/account/change",
    "/s/demo/no/account/change/",
    "/s/demo/no/account",
    "/s/demo/no/account/changes/x",
    "/s/demo/no/products/account/change/x",
    "/account/change/x",
    "/s/demo/no/change/x",
    "/admin/demo/orders/x/edit",
  ];

  it.each(LINKS)("%s draws none of the layout's extras and is not a pay route", (path) => {
    expect(isChangeLinkPath(path)).toBe(true);
    expect(isNoExtrasPath(path)).toBe(true);
    // No card is typed here: the button hands the customer to Stripe's own page.
    expect(isPayPath(path)).toBe(false);
    expect(isPayLinkPath(path)).toBe(false);
    expect(isDocumentPath(path)).toBe(false);
  });

  it.each(NOT_LINKS)("%s is not one", (path) => {
    expect(isChangeLinkPath(path)).toBe(false);
  });

  it("a draft's pay link is not a change's", () => {
    expect(isChangeLinkPath(`/s/demo/no/account/pay/${TOKEN}`)).toBe(false);
  });
});
