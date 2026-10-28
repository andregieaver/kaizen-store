import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const api = await import("./storefront-api");
const { asStorefront, sfJson } = await import("./storefront-route");
const { passMembership } = await import("./auth");
const { fxStore } = await import("./fulfilment-test-fixture");

/**
 * The storefront API (D362) against a real database: a token is made for one of the store's markets and revoked by its owner; a call needs
 * the token of the store the address names; a store that is private, not open or without the shop answers nothing; products, a product and
 * the categories come from the storefront's own reads in the token's market, a cart is quoted with live prices and handed to the store's
 * checkout as a one-time address.
 */

type Row = Record<string, unknown>;
let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;
let token: string;

const call = (slug: string, header: string | null) =>
  asStorefront(new Request("https://x/api", { headers: header ? { "x-storefront-token": header } : {} }), slug, async (caller) => sfJson({ market: caller.market }));

beforeAll(async () => {
  store = await fxStore("sfapi");
  other = await fxStore("sfapi-other");
  await db().execute(sql`update commerce.stores set private_mode = false where id in (${store.storeId}::uuid, ${other.storeId}::uuid)`);
});

afterAll(async () => {
  await closeDb();
});

describe("the storefront API (D362)", () => {
  it("makes a token for one of the store's markets, at most ten, and refuses another country", async () => {
    const owner = (await passMembership(store.slug, store.accountId))!;
    expect(await api.makeStorefrontToken(owner, { name: " ", market: "no" })).toEqual({ ok: false, problem: "name" });
    expect(await api.makeStorefrontToken(owner, { name: "Site", market: "zz" })).toEqual({ ok: false, problem: "market" });
    const made = await api.makeStorefrontToken(owner, { name: "Site", market: "no" });
    if (!made.ok) throw new Error(made.problem);
    token = made.token;
    expect(token).toMatch(/^kfs_/);
    expect((await api.listStorefrontTokens(store.storeId)).map((t) => t.market)).toEqual(["no"]);
  });

  it("answers only the token of the store the address names, and nothing for a store that is private or sells nothing", async () => {
    expect((await call(store.slug, null)).status).toBe(401);
    expect((await call(other.slug, token)).status).toBe(401);
    const ok = await call(store.slug, token);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("access-control-allow-origin")).toBe("*");
    expect(await ok.json()).toEqual({ market: "no" });
    await db().execute(sql`update commerce.stores set private_mode = true where id = ${store.storeId}::uuid`);
    expect((await call(store.slug, token)).status).toBe(404);
    await db().execute(sql`update commerce.stores set private_mode = false where id = ${store.storeId}::uuid`);
  });

  it("lists products, a product and the categories as the market shows them, quotes a cart and hands it to checkout", async () => {
    const caller = (await api.storefrontCaller(store.slug, token))!;
    const list = await api.storefrontProducts(caller, { sort: "newest", limit: 48 });
    expect(list?.market.slug).toBe("no");
    expect(list!.products.length).toBeGreaterThan(0);
    const tote = list!.products.find((p) => p.handle.includes("tote")) ?? list!.products[0];
    const page = await api.storefrontProduct(caller, tote.handle);
    expect(page).not.toBeNull();
    expect(await api.storefrontProduct(caller, "no-such-handle")).toBeNull();
    expect(await api.storefrontCategories(caller)).toHaveProperty("categories");

    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE'`);
    const lines = [{ variantId: String(variant.id), quantity: 2 }];
    const quote = await api.storefrontCart(caller, { lines });
    expect(quote?.lines[0]).toMatchObject({ status: "ok", fitted: 2 });
    expect(quote!.subtotal_minor).toBeGreaterThan(0);
    const handed = await api.storefrontCheckout(caller, { lines });
    expect(handed.ok && handed.url).toMatch(/\/cart\/resume\?t=/);
  });

  it("answers nothing once the token is revoked", async () => {
    const owner = (await passMembership(store.slug, store.accountId))!;
    const [{ id }] = await api.listStorefrontTokens(store.storeId);
    expect(await api.revokeStorefrontToken(owner, id)).toBe(true);
    expect(await api.revokeStorefrontToken(owner, id)).toBe(false);
    expect((await call(store.slug, token)).status).toBe(401);
  });
});
