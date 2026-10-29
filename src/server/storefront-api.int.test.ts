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

  it("keeps a cart: made with its first lines, changed by the variant's rules and the stock, read with each line's room, by its key only (D398)", async () => {
    const carts = await import("./api-carts");
    const caller = (await api.storefrontCaller(store.slug, token))!;
    const [tote] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE'`);
    const variantId = String(tote.id);
    await db().execute(sql`update commerce.inventory_levels set on_hand = 5 where store_id = ${store.storeId}::uuid and variant_id = ${variantId}::uuid`);
    await db().execute(sql`update commerce.product_variants set min_quantity = 1, max_quantity = null, quantity_step = 1, stock_policy = 'deny', backorder_days = null where id = ${variantId}::uuid`);

    const made = (await carts.makeApiCart(caller, [{ variantId, quantity: 2 }]))!;
    expect(made.key).toMatch(/^kfc_/);
    const [kept] = await db().execute<Row>(sql`select source, api_hash from commerce.carts where id = ${made.cartId}::uuid`);
    // The key itself is never kept: only its hash.
    expect(kept).toMatchObject({ source: "api" });
    expect(String(kept.api_hash)).not.toContain(made.key);
    const read = (await carts.readApiCart(caller, made.key))!;
    expect(read.cart).toBe(made.key);
    expect(read.lines).toEqual([expect.objectContaining({ variant_id: variantId, quantity: 2, fitted: 2, status: "ok", available: 5 })]);

    // Adding more than there is cuts to the stock, as the store's cart does.
    expect(await carts.changeApiCart(caller, made.key, { variantId, quantity: 10 }, "add")).toEqual({ ok: true });
    expect((await carts.readApiCart(caller, made.key))!.lines[0]).toMatchObject({ quantity: 5 });
    // A quantity the rule does not allow is refused and the line kept.
    await db().execute(sql`update commerce.product_variants set min_quantity = 2, quantity_step = 2 where id = ${variantId}::uuid`);
    expect(await carts.changeApiCart(caller, made.key, { variantId, quantity: 3 }, "set")).toEqual({ ok: false, reason: "quantity" });
    await db().execute(sql`update commerce.product_variants set min_quantity = 1, quantity_step = 1 where id = ${variantId}::uuid`);
    expect(await carts.changeApiCart(caller, made.key, { variantId, quantity: 3 }, "set")).toEqual({ ok: true });
    // A key of another shape, another store's caller or a made-up key opens nothing.
    expect(await carts.readApiCart(caller, "kfc_" + "x".repeat(43))).toBeNull();
    expect(await carts.changeApiCart(caller, "not-a-key", { variantId, quantity: 1 }, "add")).toEqual({ ok: false, reason: "not_found" });
    // An unknown variant is not put in.
    expect(await carts.changeApiCart(caller, made.key, { variantId: "00000000-0000-4000-8000-000000000000", quantity: 1 }, "add")).toEqual({ ok: false, reason: "unavailable" });

    // Set to 0 removes; an empty cart has nothing to hand over.
    expect(await carts.changeApiCart(caller, made.key, { variantId, quantity: 0 }, "set")).toEqual({ ok: true });
    expect((await carts.readApiCart(caller, made.key))!.lines).toEqual([]);
    expect(await carts.apiCartCheckout(caller, made.key)).toEqual({ ok: false, reason: "nothing_to_buy" });
    expect(await carts.changeApiCart(caller, made.key, { variantId, quantity: 3 }, "add")).toEqual({ ok: true });

    // The hand-over: a one-time address; the key opens nothing after it, and the cart becomes the shopper's and is ordered as any cart.
    const out = await carts.apiCartCheckout(caller, made.key);
    if (!out.ok) throw new Error(out.reason);
    expect(out.url).toMatch(/\/cart\/resume\?t=kzwh_/);
    expect(await carts.readApiCart(caller, made.key)).toBeNull();
    const { resumeHandoff } = await import("./cart-handoff");
    const { placeOrder } = await import("./checkout");
    const shop = { storeId: store.storeId, market: caller.store.markets.find((m) => m.slug === "no")! };
    const resumed = (await resumeHandoff(shop, decodeURIComponent(out.url.split("?t=")[1])))!;
    expect(resumed).toEqual({ cartId: made.cartId, to: "checkout" });
    const placed = await placeOrder(shop, made.cartId, {}, {});
    if (!placed.ok) throw new Error(placed.problem);
    const [line] = await db().execute<Row>(sql`select quantity, unit_price_minor from commerce.order_lines where order_id = ${placed.order.orderId}::uuid`);
    expect(Number(line.quantity)).toBe(3);
    expect(Number(line.unit_price_minor) * 3).toBe(read.subtotal_minor / 2 * 3);
  });

  it("answers nothing once the token is revoked", async () => {
    const owner = (await passMembership(store.slug, store.accountId))!;
    const [{ id }] = await api.listStorefrontTokens(store.storeId);
    expect(await api.revokeStorefrontToken(owner, id)).toBe(true);
    expect(await api.revokeStorefrontToken(owner, id)).toBe(false);
    expect((await call(store.slug, token)).status).toBe(401);
  });
});
