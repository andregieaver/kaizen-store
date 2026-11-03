import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { shopifyEnv } from "./env";
import {
  SHOPIFY_API_VERSION,
  SHOPIFY_SCOPES,
  missingScopes,
  openShopifyState,
  queryHmacOk,
  readShopInput,
  scopesFor,
  sealShopifyState,
  shopFromHtml,
  shopFromMeta,
  shopifyAuthorizeUrl,
  tokenDue,
  webhookHmacOk,
} from "./shopify";

const SECRET = "shpss_test_secret";

describe("the shop from what the owner typed", () => {
  it.each([
    ["myshop", { shop: "myshop.myshopify.com" }],
    ["MyShop.myshopify.com", { shop: "myshop.myshopify.com" }],
    ["https://myshop.myshopify.com/products/x", { shop: "myshop.myshopify.com" }],
    ["https://admin.shopify.com/store/my-shop/products", { shop: "my-shop.myshopify.com" }],
    ["myshop.com", { host: "myshop.com" }],
    ["https://www.myshop.no/collections/all", { host: "www.myshop.no" }],
    ["", null],
    ["my shop", null],
    ["https://admin.shopify.com/settings", null],
    ["ftp://myshop.com", null],
    ["myshop.myshopify.com.attacker.example", { host: "myshop.myshopify.com.attacker.example" }],
  ])("%s", (raw, expected) => {
    expect(readShopInput(raw)).toEqual(expected);
  });

  it("reads the shop's own name from its /meta.json or its page, and nothing that is not one", () => {
    expect(shopFromMeta(JSON.stringify({ name: "Allbirds", myshopify_domain: "weareallbirds.myshopify.com" }))).toBe("weareallbirds.myshopify.com");
    expect(shopFromMeta(JSON.stringify({ myshopify_domain: "evil.example" }))).toBeNull();
    expect(shopFromMeta("<html>")).toBeNull();
    expect(shopFromHtml('<script>Shopify.shop = "weareallbirds.myshopify.com";</script>')).toBe("weareallbirds.myshopify.com");
    expect(shopFromHtml("<html>no shop here</html>")).toBeNull();
  });
});

describe("Shopify's checks", () => {
  it("accepts the callback's HMAC over the sorted query, and nothing altered", () => {
    const params = new URLSearchParams({ shop: "myshop.myshopify.com", code: "abc", timestamp: "1700000000", state: "nonce" });
    const message = "code=abc&shop=myshop.myshopify.com&state=nonce&timestamp=1700000000";
    params.set("hmac", createHmac("sha256", SECRET).update(message).digest("hex"));
    expect(queryHmacOk(params, SECRET)).toBe(true);
    expect(queryHmacOk(params, "another secret")).toBe(false);
    const altered = new URLSearchParams(params);
    altered.set("shop", "other.myshopify.com");
    expect(queryHmacOk(altered, SECRET)).toBe(false);
    const without = new URLSearchParams(params);
    without.delete("hmac");
    expect(queryHmacOk(without, SECRET)).toBe(false);
  });

  it("accepts a webhook's HMAC over its raw body, in base64, and nothing else", () => {
    const body = JSON.stringify({ shop_domain: "myshop.myshopify.com" });
    const header = createHmac("sha256", SECRET).update(body).digest("base64");
    expect(webhookHmacOk(body, header, SECRET)).toBe(true);
    expect(webhookHmacOk(`${body} `, header, SECRET)).toBe(false);
    expect(webhookHmacOk(body, null, SECRET)).toBe(false);
  });
});

describe("the state", () => {
  const key = Buffer.alloc(32, 3);
  const value = { state: "a".repeat(43), store: "my-store", account: "123e4567-e89b-12d3-a456-426614174000", shop: "myshop.myshopify.com" };

  it("opens what this server sealed, within its time, and nothing altered or late", () => {
    const sealed = sealShopifyState(key, value, 1_000);
    expect(openShopifyState(key, sealed, 2_000)).toEqual({ ...value, expires: 1_000 + 15 * 60_000 });
    expect(openShopifyState(key, sealed, 1_000 + 15 * 60_000)).toBeNull();
    expect(openShopifyState(Buffer.alloc(32, 4), sealed, 2_000)).toBeNull();
    const [body, sig] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...value, shop: "evil.myshopify.com", expires: 1_000 + 15 * 60_000 })).toString("base64url");
    expect(openShopifyState(key, `${forged}.${sig}`, 2_000)).toBeNull();
    expect(openShopifyState(key, body, 2_000)).toBeNull();
    expect(openShopifyState(key, undefined, 2_000)).toBeNull();
  });
});

describe("what the app asks for", () => {
  it("is read only, asks all orders only once approved, and names what the shop held back", () => {
    expect(SHOPIFY_SCOPES.every((s) => s.startsWith("read_"))).toBe(true);
    expect(scopesFor(false)).not.toContain("read_all_orders");
    expect(scopesFor(true)).toContain("read_all_orders");
    expect(missingScopes(["read_products", "read_orders", "read_themes"], "read_products,write_orders")).toEqual(["read_themes"]);
  });

  it("sends the owner to the shop's own approval page with the scopes, the redirect address and the state", () => {
    const url = new URL(shopifyAuthorizeUrl({ shop: "myshop.myshopify.com", clientId: "abc123def456ghi789", scopes: ["read_products", "read_orders"], redirectUri: "https://kaizenaflow.com/api/shopify/callback", state: "nonce" }));
    expect(url.origin).toBe("https://myshop.myshopify.com");
    expect(url.pathname).toBe("/admin/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "abc123def456ghi789", scope: "read_products,read_orders", redirect_uri: "https://kaizenaflow.com/api/shopify/callback", state: "nonce" });
  });

  it("refreshes a token a minute before its end, and never one that does not end", () => {
    expect(tokenDue(new Date(100_000), 30_000)).toBe(false);
    expect(tokenDue(new Date(100_000), 40_000)).toBe(true);
    expect(tokenDue(null, 40_000)).toBe(false);
  });

  it("is configured only with both the id and the secret", () => {
    expect(shopifyEnv({})).toBeNull();
    expect(shopifyEnv({ SHOPIFY_CLIENT_ID: "abc123def456ghi789" })).toBeNull();
    expect(shopifyEnv({ SHOPIFY_CLIENT_ID: "abc123def456ghi789", SHOPIFY_CLIENT_SECRET: "s", SHOPIFY_ALL_ORDERS: "1" })).toEqual({ clientId: "abc123def456ghi789", clientSecret: "s", allOrders: true });
    expect(() => shopifyEnv({ SHOPIFY_CLIENT_ID: "not a client id!", SHOPIFY_CLIENT_SECRET: "s" })).toThrow(/SHOPIFY_CLIENT_ID/);
  });
});

describe("the app's configuration file", () => {
  const toml = readFileSync(join(process.cwd(), "shopify/shopify.app.toml"), "utf8");

  it("asks for exactly the scopes the server asks for, read only", () => {
    const scopes = /^scopes\s*=\s*"([^"]*)"/m.exec(toml)?.[1].split(",");
    expect(scopes).toEqual([...SHOPIFY_SCOPES]);
  });

  it("uses the server's API version, its callback and its webhooks with the privacy topics", () => {
    expect(toml).toContain(`api_version = "${SHOPIFY_API_VERSION}"`);
    expect(toml).toContain('redirect_urls = ["https://kaizenaflow.com/api/shopify/callback"]');
    expect(toml).toContain('topics = ["app/uninstalled"]');
    expect(toml).toContain('compliance_topics = ["customers/data_request", "customers/redact", "shop/redact"]');
    expect(toml).toContain('uri = "https://kaizenaflow.com/api/shopify/webhooks"');
  });
});
