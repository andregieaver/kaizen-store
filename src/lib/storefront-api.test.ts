import { describe, expect, it } from "vitest";

import { cartBody, cartQuantityBody, isHandle, looksLikeApiCartKey, looksLikeStorefrontToken, newCartBody, productsQuery, STOREFRONT_ROUTES, storefrontOpenApi } from "./storefront-api";

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

describe("kept carts and the contract (D398)", () => {
  it("knows a cart's key by its shape and reads a new cart and a line's quantity", () => {
    expect(looksLikeApiCartKey(`kfc_${"a".repeat(43)}`)).toBe(true);
    expect(looksLikeApiCartKey(`kfs_${"a".repeat(43)}`)).toBe(false);
    expect(looksLikeApiCartKey("kfc_short")).toBe(false);
    expect(newCartBody.parse({})).toEqual({ lines: [] });
    expect(cartQuantityBody.safeParse({ quantity: 0 }).success).toBe(true);
    expect(cartQuantityBody.safeParse({ quantity: -1 }).success).toBe(false);
  });

  it("publishes every route in an OpenAPI document made from the routes, with the token as its security", () => {
    const doc = storefrontOpenApi("https://example.com/api/storefront/v1");
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.version).toBe("v1");
    const listed = Object.entries(doc.paths).flatMap(([path, ops]) =>
      Object.keys(ops)
        .filter((k) => k !== "parameters")
        .map((method) => `${method.toUpperCase()} ${path.replace(/^\/\{store\}/, "")}`),
    );
    expect(listed.sort()).toEqual(STOREFRONT_ROUTES.map((r) => `${r.method} ${r.path}`).sort());
    expect((doc.paths["/{store}/carts/{cart}/lines/{variantId}"] as { parameters: { name: string }[] }).parameters.map((p) => p.name)).toEqual(["store", "cart", "variantId"]);
    expect(doc.components.securitySchemes.storefrontToken).toEqual({ type: "apiKey", in: "header", name: "X-Storefront-Token" });
  });
});
