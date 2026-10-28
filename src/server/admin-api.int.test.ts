import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const route = await import("@/app/api/admin/v1/[...path]/route");
const { makeApiToken, revokeApiToken } = await import("./api-tokens");
const { newStore, place, pay, variantId, mainLocation, movementsOf } = await import("./inventory-test-support");

/**
 * The Admin API (wave 9 unit B, D355): a token reaches its own store only and its scopes only; reads carry money as minor units in each
 * market's own currency (euro for Finland); writes go through the screens' functions (a draft made by the editor's save, stock with source
 * `api`, a parcel with tracking by `markSent()`), each audited with the token's name; a live product and publishing stay the owner's.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let full: string;
let readOnly: string;
const SKU = "DEMO-MUG-WHITE";
const FI_PRICE = 2_490;
const fi = toMarket({ code: "FI", currency: "EUR", defaultLocale: "en-GB" });

async function call(method: "GET" | "POST" | "PATCH" | "DELETE", path: string, token: string | null, body?: unknown): Promise<{ status: number; body: Answer }> {
  const handler = route[method];
  const url = new URL(`https://kaizenaflow.example/api/admin/v1/${path}`);
  const response = await handler(
    new Request(url, {
      method,
      headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json" } : {},
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ path: url.pathname.replace("/api/admin/v1/", "").split("/").filter(Boolean) }) } as never,
  );
  return { status: response.status, body: (await response.json()) as Answer };
}

beforeAll(async () => {
  store = await newStore("api");
  other = await newStore("apio");
  await db().execute(sql`
    update commerce.stores set features = array(select distinct unnest(features || array['countries']::text[])) where id = ${store.storeId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values (${store.storeId}::uuid, 'FI', 'EUR', 'en-GB', array['en-GB'], true)
  `);
  await db().execute(sql`select commerce.set_price(${await variantId(store.storeId, SKU)}::uuid, 'FI', ${FI_PRICE}, now())`);
  await db().execute(sql`insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor) values (${store.storeId}::uuid, 'FI', 'EUR', 590)`);
  const made = await makeApiToken(store.member, { name: "Warehouse", scopes: ["products:write", "inventory:write", "orders:write", "customers:write", "discounts:write"] });
  const read = await makeApiToken(store.member, { name: "Reports", scopes: ["products:read"] });
  if (!made.ok || !read.ok) throw new Error("no token");
  full = made.token;
  readOnly = read.token;
}, 180_000);

afterAll(async () => {
  await closeDb();
});

describe("tokens and scopes", () => {
  it("refuses no token, a made-up one, a route outside the scopes and another store's ids", async () => {
    expect((await call("GET", "products", null)).status).toBe(401);
    expect((await call("GET", "products", `kf_${"x".repeat(43)}`)).status).toBe(401);
    const scoped = await call("GET", "orders", readOnly);
    expect(scoped.status).toBe(403);
    expect(scoped.body.error.message).toContain("orders:read");
    const [theirs] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${other.storeId}::uuid limit 1`);
    expect((await call("GET", `products/${String(theirs.id)}`, full)).status).toBe(404);
    expect((await call("GET", "webhooks", full)).status).toBe(404);
  });

  it("keeps only the token's hash, and a revoked token is refused at once", async () => {
    const made = await makeApiToken(store.member, { name: "Short-lived", scopes: ["discounts:read"] });
    if (!made.ok) throw new Error(made.problem);
    const [row] = await db().execute<Row>(sql`select token_hash, prefix from commerce.api_tokens where id = ${made.id}::uuid`);
    expect(String(row.token_hash)).not.toContain(made.token);
    expect(made.token.startsWith(String(row.prefix))).toBe(true);
    expect((await call("GET", "discounts", made.token)).status).toBe(200);
    await revokeApiToken(store.member, made.id);
    expect((await call("GET", "discounts", made.token)).status).toBe(401);
  });
});

describe("products", () => {
  it("lists products with every market's price in its own currency, in pages", async () => {
    const first = await call("GET", "products?limit=2", readOnly);
    expect(first.status).toBe(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.next).toEqual(expect.any(String));
    const second = await call("GET", `products?limit=2&after=${first.body.next}`, readOnly);
    expect(second.body.data.map((p: Answer) => p.id)).not.toContain(first.body.data[0].id);
    const [mug] = await db().execute<Row>(sql`select product_id from commerce.product_variants where id = ${await variantId(store.storeId, SKU)}::uuid`);
    const one = await call("GET", `products/${String(mug.product_id)}`, readOnly);
    const variant = one.body.data.variants.find((v: Answer) => v.sku === SKU);
    expect(variant.prices).toEqual(expect.arrayContaining([{ market: "FI", currency: "EUR", amount_minor: FI_PRICE }, expect.objectContaining({ market: "NO", currency: "NOK" })]));
  });

  it("makes a draft through the editor's save, changes only drafts and never publishes", async () => {
    const made = await call("POST", "products", full, { title: "API mug", prices: { NO: "199" }, stock: 3, variants: [{ sku: `API-${Date.now()}` }] });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ title: "API mug", status: "draft" });
    const id = made.body.data.id;
    const changed = await call("PATCH", `products/${id}`, full, { title: "API mug, blue" });
    expect(changed.body.data.title).toBe("API mug, blue");
    expect((await call("PATCH", `products/${id}`, full, { status: "active" })).body.error.code).toBe("gated");
    const [live] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.storeId}::uuid and status = 'active' limit 1`);
    const refused = await call("PATCH", `products/${String(live.id)}`, full, { title: "Changed from outside" });
    expect(refused.status).toBe(403);
    const audit = await db().execute<Row>(sql`
      select action, details ->> 'token' as token from commerce.audit_log where store_id = ${store.storeId}::uuid and action like 'integration.api_product%' order by created_at
    `);
    expect(audit.map((a) => a.action)).toEqual(["integration.api_product_created", "integration.api_product_updated"]);
    expect(audit.every((a) => a.token === "Warehouse")).toBe(true);
    expect((await call("POST", "products", readOnly, { title: "No" })).status).toBe(403);
  });
});

describe("stock", () => {
  it("adjusts and sets levels as the Inventory page does, recorded with source api, and never overwrites a level that moved", async () => {
    const variant = await variantId(store.storeId, SKU);
    const location = await mainLocation(store.storeId);
    const before = (await call("GET", `inventory/levels?variant_id=${variant}`, full)).body.data.find((l: Answer) => l.location_id === location).on_hand as number;
    const adjusted = await call("POST", "inventory/adjust", full, { rows: [{ variant_id: variant, location_id: location, delta: 5 }] });
    expect(adjusted.body.data).toMatchObject({ written: 1, conflicts: 0 });
    const set = await call("POST", "inventory/set", full, { rows: [{ variant_id: variant, location_id: location, on_hand: 40, compare: before }] });
    expect(set.body.data.rows[0]).toMatchObject({ outcome: "conflict", before: before + 5 });
    // A warehouse names the variant by its SKU.
    const counted = await call("POST", "inventory/set", full, { rows: [{ sku: SKU, location_id: location, on_hand: 40, compare: before + 5 }] });
    expect(counted.body.data.rows[0]).toMatchObject({ outcome: "written", after: 40 });
    const movements = await movementsOf(store.storeId, SKU);
    expect(movements.slice(-2).map((m) => m.source)).toEqual(["api", "api"]);
    expect((await call("GET", "inventory/locations", full)).body.data.map((l: Answer) => l.id)).toContain(location);
    expect((await call("POST", "inventory/adjust", full, { rows: [{ sku: "NO-SUCH-SKU", location_id: location, delta: 1 }] })).status).toBe(422);
  });
});

describe("orders, as a warehouse uses them", () => {
  it("reads paid orders to send in their own currency and records a parcel with tracking", async () => {
    const order = await place(store.storeId, [[SKU, 2]], fi);
    await pay(store.storeId, order, store.account);
    const listed = await call("GET", "orders?unfulfilled=true", full);
    const mine = listed.body.data.find((o: Answer) => o.id === order.orderId);
    expect(mine).toMatchObject({ currency: "EUR", total_minor: order.totalMinor, status: "paid" });
    expect(mine.lines[0]).toMatchObject({ sku: SKU, quantity: 2, to_send: 2, unit_price_minor: FI_PRICE });
    const sent = await call("POST", `orders/${order.orderId}/fulfillments`, full, { carrier: "posten", tracking_number: "TRACK123" });
    expect(sent.status).toBe(201);
    expect(sent.body.data.status).toBe("fulfilled");
    expect(sent.body.data.shipments[0]).toMatchObject({ tracking_number: "TRACK123" });
    // The customer is told of the parcel as the admin's Send does.
    const [told] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'order.sent'`);
    expect(told.n).toBe(1);
    expect((await call("POST", `orders/${order.orderId}/fulfillments`, full, { carrier: "posten", notify: false })).status).toBe(409);
    const after = await call("GET", "orders?unfulfilled=true", full);
    expect(after.body.data.map((o: Answer) => o.id)).not.toContain(order.orderId);
  });
});

describe("customers and discounts", () => {
  it("tags a customer by id and makes a discount code through the admin's own form", async () => {
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, ${`api-${Date.now()}@example.com`}, 'Kari') returning id
    `);
    const id = String(customer.id);
    expect((await call("POST", `customers/${id}/tags`, full, { tag: "Wholesale" })).status).toBe(201);
    expect((await call("GET", `customers/${id}`, full)).body.data.tags).toEqual(["Wholesale"]);
    expect((await call("DELETE", `customers/${id}/tags/Wholesale`, full)).status).toBe(200);
    const code = `API${Date.now()}`;
    const made = await call("POST", "discounts", full, { code, kind: "percent", percent: 15 });
    expect(made.status).toBe(201);
    expect((await call("GET", "discounts", full)).body.data.map((d: Answer) => d.code)).toContain(code);
    expect((await call("POST", "discounts", full, { code: "", kind: "percent" })).status).toBe(422);
  });
});
