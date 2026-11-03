import { createHmac } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { openShopifyState } from "@/lib/shopify";
import { parseKey } from "@/lib/secret-box";

import { auditActions, redirectFixture, type RedirectFixture } from "./redirect-test-support";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
const SECRET = "shpss_test_secret_for_kaizen";
process.env.SHOPIFY_CLIENT_ID = "kaizentestclient0001";
process.env.SHOPIFY_CLIENT_SECRET = SECRET;

const shopify = await import("./shopify-connect");

type Row = Record<string, unknown>;

/**
 * Connecting the Shopify shop a store moves from (D445 step 2): the owner's press finds the shop and seals the state; Shopify's return is
 * checked (state, HMAC, shop, the same owner) before the code is exchanged and the tokens kept encrypted; an expiring token is refreshed
 * under the row's lock, and a refused refresh disconnects; disconnecting revokes at Shopify and drops the tokens; Shopify's webhooks are
 * refused without its HMAC, and uninstalling or redacting the shop drops or deletes the connection. Shopify is a stand-in `fetch`.
 */

let f: RedirectFixture;
const SHOP = "kaizen-test.myshopify.com";
const key = () => parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;

type Call = { url: string; method: string; body: string; token: string | null };
const calls: Call[] = [];
let tokenAnswer: { status: number; body: Row } = { status: 200, body: {} };

const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = String(input);
  const headers = new Headers(init?.headers);
  calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? ""), token: headers.get("x-shopify-access-token") });
  if (url.endsWith("/admin/oauth/access_token")) return new Response(JSON.stringify(tokenAnswer.body), { status: tokenAnswer.status, headers: { "content-type": "application/json" } });
  if (url.includes("/graphql.json")) {
    const query = String(JSON.parse(String(init?.body)).query);
    const data = query.includes("KaizenShop")
      ? { shop: { name: "Kaizen Test", myshopifyDomain: SHOP, primaryDomain: { host: "www.kaizen-test.example" } } }
      : { shop: { currencyCode: "NOK" }, productsCount: { count: 312 }, customersCount: { count: 2180 }, ordersCount: { count: 940 } };
    return new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  }
  if (url.endsWith("/admin/api_permissions/current.json")) return new Response(null, { status: 200 });
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const signedQuery = (values: Record<string, string>): URLSearchParams => {
  const params = new URLSearchParams(values);
  const message = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  params.set("hmac", createHmac("sha256", SECRET).update(message).digest("hex"));
  return params;
};

const row = async (storeId = f.fx.storeId): Promise<Row | undefined> =>
  (await db().execute<Row>(sql`select * from commerce.shop_moves where store_id = ${storeId}::uuid and source = 'shopify'`))[0];

async function connect(fx: RedirectFixture, now = Date.now()): Promise<string> {
  const start = await shopify.startShopifyConnect(fx.owner, SHOP, { now });
  if (!start.ok) throw new Error(start.problem);
  const state = openShopifyState(key(), start.cookie, now)!;
  tokenAnswer = { status: 200, body: { access_token: "shpca_access_1", scope: "read_products,read_orders", expires_in: 3600, refresh_token: "shprt_refresh_1", refresh_token_expires_in: 7776000 } };
  return shopify.finishShopifyConnect(signedQuery({ code: "the-code", shop: SHOP, state: state.state, timestamp: "1700000000" }), start.cookie, { fetch: fakeFetch, now, owner: async () => fx.owner });
}

beforeAll(async () => {
  f = await redirectFixture("shopify-connect");
});

afterAll(async () => {
  await closeDb();
});

describe("finding the shop and starting", () => {
  it("finds the shop from its own address through /meta.json, else its page", async () => {
    const open = async (url: string) =>
      url.endsWith("/meta.json")
        ? { ok: true as const, url, status: 200, contentType: "application/json", bytes: new TextEncoder().encode(JSON.stringify({ myshopify_domain: SHOP })) }
        : { ok: false as const, problem: "no", status: 404 };
    expect(await shopify.findShopifyShop("www.kaizen-test.example", { open })).toEqual({ ok: true, shop: SHOP });
    const none = async (url: string) => ({ ok: true as const, url, status: 200, contentType: "text/html", bytes: new TextEncoder().encode("<html>a shop elsewhere</html>") });
    expect(await shopify.findShopifyShop("elsewhere.example", { open: none })).toEqual({ ok: false, problem: "not_shopify" });
    expect(await shopify.findShopifyShop("not an address")).toEqual({ ok: false, problem: "address" });
  });

  it("is the owner's alone, and seals the store, the account and the shop with a fresh nonce", async () => {
    expect(await shopify.startShopifyConnect(f.reader, SHOP)).toEqual({ ok: false, problem: "forbidden" });
    const start = await shopify.startShopifyConnect(f.owner, "kaizen-test");
    if (!start.ok) throw new Error("not started");
    const state = openShopifyState(key(), start.cookie)!;
    expect([state.store, state.account, state.shop]).toEqual([f.owner.store.slug, f.owner.account.id, SHOP]);
    const url = new URL(start.url);
    expect([url.host, url.searchParams.get("state"), url.searchParams.get("client_id")]).toEqual([SHOP, state.state, "kaizentestclient0001"]);
    expect(url.searchParams.get("scope")).not.toContain("write_");
  });
});

describe("Shopify's return", () => {
  it("connects: the code exchanged with expiring=1, the shop read, the tokens kept encrypted, audited", async () => {
    calls.length = 0;
    expect(await connect(f)).toBe(`/admin/${f.owner.store.slug}/settings/moving?shopify=connected`);
    const exchange = calls.find((c) => c.url === `https://${SHOP}/admin/oauth/access_token`)!;
    expect(Object.fromEntries(new URLSearchParams(exchange.body))).toEqual({ client_id: "kaizentestclient0001", client_secret: SECRET, code: "the-code", expiring: "1" });
    const r = (await row())!;
    expect([r.status, r.shop_domain, r.shop_name, r.primary_domain, r.scopes]).toEqual(["connected", SHOP, "Kaizen Test", "www.kaizen-test.example", "read_products,read_orders"]);
    expect(String(r.access_token)).not.toContain("shpca_access_1");
    expect(String(r.refresh_token)).not.toContain("shprt_refresh_1");
    expect((await auditActions(f.fx.storeId, "integration.shopify")).map((a) => [a.action, a.area, (a.details as Row).shop])).toEqual([["integration.shopify_connected", "settings", SHOP]]);
    const view = (await shopify.shopifyConnection(f.owner))!;
    expect([view.shop, view.name, view.primaryDomain]).toEqual([SHOP, "Kaizen Test", "www.kaizen-test.example"]);
    expect(view.missing).toContain("read_customers");
    expect(await shopify.shopifyConnection(f.reader)).toBeNull();
  });

  it("refuses an altered HMAC, another shop, another account, a stale cookie; says when the owner declined", async () => {
    const fx = await redirectFixture("shopify-refuse");
    const start = await shopify.startShopifyConnect(fx.owner, SHOP);
    if (!start.ok) throw new Error("not started");
    const state = openShopifyState(key(), start.cookie)!.state;
    const back = (o: string) => `/admin/${fx.owner.store.slug}/settings/moving?shopify=${o}`;
    const deps = { fetch: fakeFetch, owner: async () => fx.owner };
    const altered = signedQuery({ code: "c", shop: SHOP, state, timestamp: "1" });
    altered.set("code", "other");
    expect(await shopify.finishShopifyConnect(altered, start.cookie, deps)).toBe(back("failed"));
    expect(await shopify.finishShopifyConnect(signedQuery({ code: "c", shop: "other.myshopify.com", state, timestamp: "1" }), start.cookie, deps)).toBe(back("failed"));
    expect(await shopify.finishShopifyConnect(signedQuery({ code: "c", shop: SHOP, state: "x".repeat(43), timestamp: "1" }), start.cookie, deps)).toBe(back("failed"));
    expect(await shopify.finishShopifyConnect(signedQuery({ code: "c", shop: SHOP, state, timestamp: "1" }), start.cookie, { ...deps, owner: async () => f.owner })).toBe(back("failed"));
    expect(await shopify.finishShopifyConnect(signedQuery({ error: "access_denied", shop: SHOP, state, timestamp: "1" }), start.cookie, deps)).toBe(back("declined"));
    expect(await shopify.finishShopifyConnect(signedQuery({ code: "c", shop: SHOP, state, timestamp: "1" }), "not-a-cookie", deps)).toBe("/admin");
    expect(await row(fx.fx.storeId)).toBeUndefined();
  });
});

describe("using the connection", () => {
  it("calls Shopify with the token, and counts what the shop holds", async () => {
    calls.length = 0;
    expect(await shopify.shopifyCounts(f.owner, { fetch: fakeFetch })).toEqual({ products: 312, customers: 2180, orders: 940, currency: "NOK" });
    expect(calls.at(-1)?.token).toBe("shpca_access_1");
  });

  it("refreshes an expiring token a minute early and keeps the new pair; a refused refresh disconnects", async () => {
    const later = Date.now() + 3600_000;
    tokenAnswer = { status: 200, body: { access_token: "shpca_access_2", expires_in: 3600, refresh_token: "shprt_refresh_2", refresh_token_expires_in: 7776000 } };
    calls.length = 0;
    expect(await shopify.shopifyAccess(f.fx.storeId, { fetch: fakeFetch, now: later })).toEqual({ shop: SHOP, token: "shpca_access_2" });
    expect(Object.fromEntries(new URLSearchParams(calls[0].body))).toMatchObject({ grant_type: "refresh_token", refresh_token: "shprt_refresh_1" });
    expect(await shopify.shopifyAccess(f.fx.storeId, { fetch: fakeFetch, now: later + 60_000 })).toEqual({ shop: SHOP, token: "shpca_access_2" });
    tokenAnswer = { status: 401, body: { error: "invalid_request" } };
    expect(await shopify.shopifyAccess(f.fx.storeId, { fetch: fakeFetch, now: later + 2 * 3600_000 })).toBeNull();
    const r = (await row())!;
    expect([r.status, r.access_token, r.refresh_token]).toEqual(["disconnected", null, null]);
  });

  it("disconnects on the owner's word: revoked at Shopify, the tokens dropped here, audited", async () => {
    await connect(f);
    calls.length = 0;
    expect(await shopify.disconnectShopify(f.reader)).toEqual({ ok: false });
    expect(await shopify.disconnectShopify(f.owner, { fetch: fakeFetch })).toEqual({ ok: true });
    expect(calls.map((c) => [c.method, c.url])).toContainEqual(["DELETE", `https://${SHOP}/admin/api_permissions/current.json`]);
    expect((await row())!.status).toBe("disconnected");
    expect((await auditActions(f.fx.storeId, "integration.shopify")).map((a) => a.action).at(-1)).toBe("integration.shopify_disconnected");
    expect(await shopify.shopifyConnection(f.owner)).toBeNull();
  });
});

describe("Shopify's webhooks", () => {
  const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("base64");

  it("refuses a body without Shopify's HMAC (401), and drops then deletes on uninstall and shop/redact", async () => {
    await connect(f);
    const body = JSON.stringify({ shop_domain: SHOP });
    expect(await shopify.handleShopifyWebhook(body, { hmac: "bad", topic: "app/uninstalled", shop: SHOP })).toBe(401);
    expect((await row())!.status).toBe("connected");
    expect(await shopify.handleShopifyWebhook(body, { hmac: sign(body), topic: "app/uninstalled", shop: SHOP })).toBe(200);
    expect((await row())!.status).toBe("disconnected");
    expect(await shopify.handleShopifyWebhook(body, { hmac: sign(body), topic: "customers/data_request", shop: SHOP })).toBe(200);
    expect(await shopify.handleShopifyWebhook(body, { hmac: sign(body), topic: "shop/redact", shop: SHOP })).toBe(200);
    expect(await row()).toBeUndefined();
  });
});
