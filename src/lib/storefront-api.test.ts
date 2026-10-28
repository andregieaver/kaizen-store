import { describe, expect, it } from "vitest";

import { cartBody, isHandle, looksLikeStorefrontToken, productsQuery, STOREFRONT_ROUTES } from "./storefront-api";

describe("the storefront API's requests (D362)", () => {
  it("knows a storefront token by its shape", () => {
    expect(looksLikeStorefrontToken(`kfs_${"a".repeat(40)}`)).toBe(true);
    expect(looksLikeStorefrontToken(`kf_${"a".repeat(40)}`)).toBe(false);
    expect(looksLikeStorefrontToken("kfs_short")).toBe(false);
  });

  it("reads a product listing's query with defaults and bounds", () => {
    expect(productsQuery.parse({})).toEqual({ sort: "newest", limit: 12 });
    expect(productsQuery.safeParse({ limit: "49" }).success).toBe(false);
    expect(productsQuery.safeParse({ category: "not-an-id" }).success).toBe(false);
    expect(productsQuery.parse({ sort: "priceLow", limit: "3" })).toEqual({ sort: "priceLow", limit: 3 });
  });

  it("reads a cart of variants and whole quantities, at most 50 lines", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(cartBody.safeParse({ lines: [{ variantId: id, quantity: 2 }] }).success).toBe(true);
    expect(cartBody.safeParse({ lines: [] }).success).toBe(false);
    expect(cartBody.safeParse({ lines: [{ variantId: id, quantity: 0 }] }).success).toBe(false);
    expect(cartBody.safeParse({ lines: Array.from({ length: 51 }, () => ({ variantId: id, quantity: 1 })) }).success).toBe(false);
  });

  it("takes a product's handle and lists its routes", () => {
    expect(isHandle("blue-mug")).toBe(true);
    expect(isHandle("../admin")).toBe(false);
    expect(STOREFRONT_ROUTES.map((r) => `${r.method} ${r.path}`)).toContain("POST /checkout");
  });
});
