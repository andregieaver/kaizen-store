import { randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ADMIN_API_BY_NAME, routeOf, SEND_CARRIERS } from "@/lib/admin-api-routes";
import { ADMIN_RATE } from "@/lib/admin-openapi";
import { STOREFRONT_RATE } from "@/lib/storefront-api";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
// Store credit's gift card codes are kept only as keyed hashes (D300).
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
// Kaizena Flow's Stripe client, faked: nothing here reaches Stripe (a refund over the API is store credit, which asks no provider).
vi.mock("./stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./stripe")>()),
  platformStripe: () => ({
    checkout: { sessions: { retrieve: async () => null, list: async () => ({ data: [] }), expire: async () => ({}) } },
    refunds: { create: async () => null, retrieve: async () => null },
    // A subscription on the store's account, as Stripe answers a change (D29): it keeps what it is told.
    subscriptions: {
      update: async (id: string, params: Record<string, unknown>) => ({
        id,
        status: "active",
        metadata: {},
        trial_end: null,
        ended_at: null,
        cancel_at: null,
        cancel_at_period_end: params.cancel_at_period_end === true,
        pause_collection: params.pause_collection && params.pause_collection !== "" ? params.pause_collection : null,
        items: { data: [{ current_period_end: Math.floor(Date.now() / 1000) + 20 * 86_400 }] },
      }),
      cancel: async (id: string) => ({ id, status: "canceled", metadata: {}, trial_end: null, ended_at: Math.floor(Date.now() / 1000), cancel_at: null, cancel_at_period_end: false, pause_collection: null, items: { data: [] } }),
    },
  }),
  // Kaizena Flow's test keys are set, so a store in Stripe's test mode takes payments (a draft's pay link can be made).
  platformModes: () => ["test"],
}));
// An endpoint's host is taken as public (the address guard's DNS lookup is the endpoints' own tests').
vi.mock("./replicate-fetch", async (importOriginal) => ({ ...(await importOriginal<typeof import("./replicate-fetch")>()), hostProblem: async () => null }));
// The private buckets and the public picture bucket, in memory (D440: an upload's file, and the library's pictures).
const buckets = vi.hoisted(() => ({ storage: null as unknown }));
vi.mock("./data-job-store", async (importOriginal) => ({ ...(await importOriginal<typeof import("./data-job-store")>()), dataStorage: () => buckets.storage }));
vi.mock("./media", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./media")>()),
  uploadProductImage: async (storeId: string) => {
    const name = `${storeId}/${randomUUID()}`;
    return { ok: true, url: `https://cdn.test/${name}.webp`, thumbnailUrl: `https://cdn.test/${name}-480.webp`, stored: { bucket: "product-media", path: `${name}.webp`, thumbnailPath: `${name}-480.webp` } };
  },
}));

const route = await import("@/app/api/admin/v1/[...path]/route");
const { makeApiToken, revokeApiToken } = await import("./api-tokens");
const { CARRIERS } = await import("./order-admin");
const { BUDGETS } = await import("./request-budget");
const { newStore, place, pay, variantId, mainLocation, movementsOf } = await import("./inventory-test-support");
const { fakeStorage } = await import("./data-test-support");
const { savePriceList } = await import("./price-lists");
const { crc32 } = await import("node:zlib");
const storage = fakeStorage();
buckets.storage = storage;

/**
 * The Admin API (wave 9 unit B, D355): a token reaches its own store only and its scopes only; reads carry money as minor units in each
 * market's own currency (euro for Finland); writes go through the screens' functions (a draft made by the editor's save, stock with source
 * `api`, a parcel with tracking by `markSent()`), each audited with the token's name; a live product and publishing stay the owner's.
 *
 * Every answer of a success is parsed with its operation's `response` in `ADMIN_API` (D438), so the published contract is what is sent.
 */

let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;
let full: string;
let readOnly: string;
const SKU = "DEMO-MUG-WHITE";
const FI_PRICE = 2_490;
const fi = toMarket({ code: "FI", currency: "EUR", defaultLocale: "en-GB" });

async function call(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  token: string | null,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; body: Answer; headers: Headers }> {
  const handler = route[method];
  const url = new URL(`https://kaizenaflow.example/api/admin/v1/${path}`);
  const response = await handler(
    new Request(url, {
      method,
      headers: token ? { authorization: `Bearer ${token}`, "content-type": "application/json", ...extra } : {},
      ...(body !== undefined && { body: JSON.stringify(body) }),
    }),
    { params: Promise.resolve({ path: url.pathname.replace("/api/admin/v1/", "").split("/").filter(Boolean) }) } as never,
  );
  const answer = (await response.json()) as Answer;
  // The contract (D438): a success is exactly what its operation's response schema describes.
  if (response.status < 300) {
    const op = routeOf(method, url.pathname.replace("/api/admin/v1/", "").split("/").filter(Boolean));
    if (!op) throw new Error(`${method} ${path} answered ${response.status} without an operation`);
    const checked = ADMIN_API_BY_NAME[op.name].response.safeParse(answer);
    if (!checked.success) throw new Error(`${op.name}'s answer is not its contract: ${checked.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
    parsed.add(op.name);
  }
  return { status: response.status, body: answer, headers: response.headers };
}

/** The operations whose answers were parsed: at the end, every operation's. */
const parsed = new Set<string>();

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

describe("the contract (D438)", () => {
  it("names the carriers a parcel may have and the budget the document states", () => {
    expect([...SEND_CARRIERS]).toEqual(CARRIERS.map((c) => c.id));
    expect({ perToken: BUDGETS.api.visitor, perStore: BUDGETS.api.store }).toEqual(ADMIN_RATE);
    expect({ perToken: BUDGETS.storefront.visitor, perStore: BUDGETS.storefront.store }).toEqual(STOREFRONT_RATE);
  });
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
    expect((await call("GET", "nothing-here", full)).status).toBe(404);
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

describe("checkout rules and questions (D399)", () => {
  it("lists, makes, switches, changes and deletes them through the Shipping page's writers, with the checkout scopes only", async () => {
    const made = await makeApiToken(store.member, { name: "Checkout app", scopes: ["checkout:write"] });
    if (!made.ok) throw new Error(made.problem);
    const token = made.token;
    expect((await call("GET", "checkout/rules", readOnly)).status).toBe(403);
    expect((await call("GET", "checkout/rules", token)).body.data).toEqual([]);

    const rule = await call("POST", "checkout/rules", token, { name: "Flat first", effect: { kind: "order_delivery", options: ["flat"] } });
    expect(rule.status).toBe(201);
    const id = rule.body.data.id as string;
    // A rule naming an option the store does not have is refused, as on the page.
    expect((await call("POST", "checkout/rules", token, { name: "Nope", effect: { kind: "order_delivery", options: ["method:00000000-0000-4000-8000-000000000000"] } })).status).toBe(422);
    // A new rule is saved off; `enabled` alone switches it.
    expect((await call("GET", "checkout/rules", token)).body.data).toEqual([expect.objectContaining({ id, enabled: false, effect: { kind: "order_delivery", options: ["flat"] } })]);
    expect((await call("PATCH", `checkout/rules/${id}`, token, { enabled: true })).status).toBe(200);
    expect((await call("PATCH", `checkout/rules/${id}`, token, { name: "Hide flat", effect: { kind: "hide_shipping", options: ["flat"] } })).status).toBe(200);
    const [kept] = (await call("GET", "checkout/rules", token)).body.data;
    expect(kept).toMatchObject({ name: "Hide flat", enabled: true, effect: { kind: "hide_shipping" } });
    expect((await call("PATCH", "checkout/rules/00000000-0000-4000-8000-000000000000", token, { enabled: true })).status).toBe(404);

    const field = await call("POST", "checkout/fields", token, { kind: "text", label: { text: "Door code" } });
    expect(field.status).toBe(201);
    const fieldId = field.body.data.id as string;
    expect((await call("PATCH", `checkout/fields/${fieldId}`, token, { enabled: false })).status).toBe(200);
    expect((await call("GET", "checkout/fields", token)).body.data).toEqual([expect.objectContaining({ id: fieldId, enabled: false, kind: "text" })]);

    expect((await call("DELETE", `checkout/rules/${id}`, token)).body.data).toEqual({ id, deleted: true });
    expect((await call("DELETE", `checkout/fields/${fieldId}`, token)).status).toBe(200);
    expect((await call("DELETE", `checkout/fields/${fieldId}`, token)).status).toBe(404);
    const audit = await db().execute<Row>(sql`
      select action from commerce.audit_log where store_id = ${store.storeId}::uuid and action like 'integration.api_checkout%' order by created_at
    `);
    expect(audit.map((a) => a.action)).toEqual([
      "integration.api_checkout_rule_made",
      "integration.api_checkout_rule_changed",
      "integration.api_checkout_rule_changed",
      "integration.api_checkout_field_made",
      "integration.api_checkout_field_changed",
      "integration.api_checkout_rule_deleted",
      "integration.api_checkout_field_deleted",
    ]);
  });
});

describe("a POST with an Idempotency-Key (PSI DATA-03)", () => {
  it("is done once: the same request again gets the first answer, another request under the key is refused", async () => {
    const sku = `IDEM-${Date.now()}`;
    const input = { title: "Once mug", prices: { NO: "149" }, stock: 1, variants: [{ sku }] };
    const key = { "idempotency-key": `create-${sku}` };
    const first = await call("POST", "products", full, input, key);
    expect(first.status).toBe(201);
    const again = await call("POST", "products", full, input, key);
    expect(again.status).toBe(201);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body.data.id).toBe(first.body.data.id);
    const [made] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${sku}`);
    expect(made.n).toBe(1);
    const other = await call("POST", "products", full, { ...input, title: "Another" }, key);
    expect(other.status).toBe(422);
    expect(other.body.error.message).toContain("used for another request");
    // Without a key, a POST is done each time it is sent, as before.
    expect((await call("POST", "products", full, { ...input, variants: [{ sku: `${sku}-B` }] })).status).toBe(201);
  });
});

describe("bodies read with the registry's zod (D438)", () => {
  it("tells a caller what is wrong in the API's words before a screen's checks, and takes what it took before", async () => {
    const percent = await call("POST", "discounts", full, { code: `TXT${Date.now()}`, kind: "percent", percent: "15" });
    expect(percent.status).toBe(422);
    expect(percent.body.error.message).toMatch(/^percent: /);
    // The screen's own checks still run after the API's: a code of the wrong shape is the form's refusal.
    const shape = await call("POST", "discounts", full, { code: "a b", kind: "percent" });
    expect(shape.status).toBe(422);
    expect(shape.body.error.message).toContain("Use 3–40 letters");
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name) values (${store.storeId}::uuid, ${`body-${Date.now()}@example.com`}, 'Ola') returning id
    `);
    const tagless = await call("POST", `customers/${String(customer.id)}/tags`, full, {});
    expect(tagless.status).toBe(422);
    expect(tagless.body.error.message).toMatch(/^tag: /);
    const made = await makeApiToken(store.member, { name: "Rules", scopes: ["checkout:write"] });
    if (!made.ok) throw new Error(made.problem);
    const rule = await call("POST", "checkout/rules", made.token, { name: "Flat", effect: { kind: "order_delivery", options: ["flat"] } });
    const switched = await call("PATCH", `checkout/rules/${rule.body.data.id}`, made.token, { enabled: "yes" });
    expect(switched.status).toBe(422);
    expect(switched.body.error.message).toMatch(/^enabled: /);
    expect((await call("PATCH", `checkout/rules/${rule.body.data.id}`, made.token, { enabled: true })).status).toBe(200);
    expect((await call("DELETE", `checkout/rules/${rule.body.data.id}`, made.token)).status).toBe(200);
  });
});

describe("the catalogue (D440 C1)", () => {
  let writer: string;
  let publisher: string;
  let draftId: string;

  beforeAll(async () => {
    const w = await makeApiToken(store.member, { name: "Catalogue", scopes: ["products:write", "products:manage"] });
    const p = await makeApiToken(store.member, { name: "Publisher", scopes: ["products:write", "products:manage", "products:publish"] });
    if (!w.ok || !p.ok) throw new Error("no token");
    writer = w.token;
    publisher = p.token;
    const made = await call("POST", "products", writer, { title: "Catalogue mug", prices: { NO: "149", FI: "14,90" }, stock: 2, variants: [{ sku: `CAT-${Date.now()}` }] });
    draftId = made.body.data.id;
  });

  it("makes, reads, changes and deletes categories and tags, and puts a draft in and out of them", async () => {
    const category = await call("POST", "categories", writer, { name: `Mugs ${Date.now()}` });
    expect(category.status).toBe(201);
    const id = category.body.data.id as string;
    expect(category.body.data).toMatchObject({ kind: "category", parent_id: null, products: 0, filled_by_rules: false });
    const child = await call("POST", "categories", writer, { name: `Big mugs ${Date.now()}`, parent_id: id });
    expect(child.body.data.parent_id).toBe(id);
    expect((await call("POST", "categories", writer, { name: "" })).status).toBe(422);
    const listed = await call("GET", "categories?limit=100", readOnly);
    expect(listed.body.data.map((t: Answer) => t.id)).toEqual(expect.arrayContaining([id, child.body.data.id]));
    expect((await call("GET", `categories/${id}`, readOnly)).body.data.id).toBe(id);
    // Renaming or deleting a category changes what shoppers see: the power `products:publish` (`update_category` asks the owner's yes).
    const unrenamed = await call("PATCH", `categories/${id}`, writer, { name: "Mugs and cups" });
    expect(unrenamed.status).toBe(403);
    expect(unrenamed.body.error.message).toContain("products:publish");
    const renamed = await call("PATCH", `categories/${id}`, publisher, { name: "Mugs and cups" });
    expect(renamed.body.data).toMatchObject({ name: "Mugs and cups", slug: category.body.data.slug });
    const placed = await call("POST", `categories/${id}/products`, writer, { product_id: draftId });
    expect(placed.status).toBe(201);
    expect(placed.body.data).toEqual({ term_id: id, product_id: draftId, placed: true });
    expect((await call("GET", `categories/${id}`, readOnly)).body.data.products).toBe(1);
    expect((await call("DELETE", `categories/${id}/products/${draftId}`, writer)).body.data.placed).toBe(false);
    expect((await call("GET", `categories/${id}`, readOnly)).body.data.products).toBe(0);
    expect((await call("DELETE", `categories/${child.body.data.id}`, writer)).status).toBe(403);
    expect((await call("DELETE", `categories/${child.body.data.id}`, publisher)).body.data).toEqual({ id: child.body.data.id, deleted: true });
    expect((await call("GET", `categories/${child.body.data.id}`, readOnly)).status).toBe(404);

    const tag = await call("POST", "tags", writer, { name: `Gift ${Date.now()}` });
    expect(tag.status).toBe(201);
    const tagId = tag.body.data.id as string;
    expect((await call("GET", "tags", readOnly)).body.data.map((t: Answer) => t.id)).toContain(tagId);
    expect((await call("GET", `tags/${tagId}`, readOnly)).body.data.kind).toBe("tag");
    expect((await call("PATCH", `tags/${tagId}`, writer, { slug: `gift-${Date.now()}` })).status).toBe(403);
    expect((await call("PATCH", `tags/${tagId}`, publisher, { slug: `gift-${Date.now()}` })).status).toBe(200);
    expect((await call("POST", `tags/${tagId}/products`, writer, { product_id: draftId })).status).toBe(201);
    expect((await call("DELETE", `tags/${tagId}/products/${draftId}`, writer)).status).toBe(200);
    expect((await call("DELETE", `tags/${tagId}`, publisher)).status).toBe(200);
    // A category of the tags, or of another store, is not found.
    expect((await call("GET", `tags/${id}`, readOnly)).status).toBe(404);
    const [theirs] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, name, slug) values (${other.storeId}::uuid, 'product', 'category', 'Theirs', ${`theirs-${Date.now()}`}) returning id
    `);
    expect((await call("GET", `categories/${String(theirs.id)}`, readOnly)).status).toBe(404);
    expect((await call("POST", `categories/${String(theirs.id)}/products`, writer, { product_id: draftId })).status).toBe(404);
    expect((await call("DELETE", `categories/${id}`, publisher)).status).toBe(200);
    // Every change in the token's name.
    const audit = await db().execute<Row>(sql`
      select action from commerce.audit_log where store_id = ${store.storeId}::uuid and details ->> 'token' = 'Catalogue' and action like 'integration.api_%' order by created_at
    `);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["integration.api_category_created", "integration.api_product_placed", "integration.api_product_unplaced", "integration.api_tag_created"]));
  });

  it("takes a picture through a one-time upload, checks it as the library does, and puts it in a product's gallery", async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } }).png().toBuffer();
    expect((await call("POST", "media/uploads", writer, { content_type: "image/gif", size_bytes: 10 })).status).toBe(422);
    const started = await call("POST", "media/uploads", writer, { content_type: "image/png", size_bytes: png.byteLength });
    expect(started.status).toBe(201);
    // In a bucket of its own, which takes pictures only (D440 review), not the product file's `imports`.
    expect(started.body.data.upload_url).toContain("/upload/api-uploads/");
    const uploadId = started.body.data.upload_id as string;
    // Nothing sent yet: refused, and the upload can still be used.
    expect((await call("POST", "media", writer, { upload_id: uploadId })).status).toBe(422);
    await storage.upload("api-uploads", `${store.storeId}/api-uploads/${uploadId}`, new TextEncoder().encode("not a picture"), "image/png");
    expect((await call("POST", "media", writer, { upload_id: uploadId })).body.error.message).toContain("JPEG, PNG, WebP or AVIF");
    await storage.upload("api-uploads", `${store.storeId}/api-uploads/${uploadId}`, new Uint8Array(png), "image/png");
    // Another token's upload is not this one's.
    expect((await call("POST", "media", publisher, { upload_id: uploadId })).status).toBe(404);
    const kept = await call("POST", "media", writer, { upload_id: uploadId, file_name: "red.png", alt: "A red square" });
    expect(kept.status).toBe(201);
    expect(kept.body.data).toMatchObject({ kind: "image", content_type: "image/webp", width: 64, height: 48, alt: "A red square", file_name: "red.webp" });
    expect((await call("POST", "media", writer, { upload_id: uploadId })).status).toBe(409);
    expect(storage.files.has(`api-uploads/${store.storeId}/api-uploads/${uploadId}`)).toBe(false);
    const mediaId = kept.body.data.id as string;
    expect((await call("GET", "media?kind=image", readOnly)).body.data.map((m: Answer) => m.id)).toContain(mediaId);
    // A picture whose header claims more than 50 million pixels is refused before it is decoded (D440 review).
    const huge = Buffer.from(png);
    huge.writeUInt32BE(10_000, 16);
    huge.writeUInt32BE(8_000, 20);
    huge.writeUInt32BE(crc32(huge.subarray(12, 29)), 29);
    const big = await call("POST", "media/uploads", writer, { content_type: "image/png", size_bytes: huge.byteLength });
    await storage.upload("api-uploads", `${store.storeId}/api-uploads/${big.body.data.upload_id}`, new Uint8Array(huge), "image/png");
    const tooBig = await call("POST", "media", writer, { upload_id: big.body.data.upload_id });
    expect(tooBig.status).toBe(422);
    expect(tooBig.body.error.message).toContain("50 million pixels");
    // The upload address is answered once: a replay of the request answers none.
    const once = { "idempotency-key": `upload-${Date.now()}` };
    const first = await call("POST", "media/uploads", writer, { content_type: "image/png", size_bytes: 100 }, once);
    expect(first.body.data.upload_url).toEqual(expect.any(String));
    const again = await call("POST", "media/uploads", writer, { content_type: "image/png", size_bytes: 100 }, once);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(again.body.data).toMatchObject({ upload_id: first.body.data.upload_id, upload_url: null });

    const before = (await call("GET", `products/${draftId}/media`, readOnly)).body.data as Answer[];
    const added = await call("POST", `products/${draftId}/media`, writer, { media_id: mediaId });
    expect(added.status).toBe(201);
    expect(added.body.data.at(-1)).toMatchObject({ media_id: mediaId, kind: "image", alt: "A red square" });
    expect((await call("POST", `products/${draftId}/media`, writer, { media_id: mediaId })).status).toBe(409);
    const second = await call("POST", "media/uploads", writer, { content_type: "image/png", size_bytes: png.byteLength });
    await storage.upload("api-uploads", `${store.storeId}/api-uploads/${second.body.data.upload_id}`, new Uint8Array(png), "image/png");
    const other2 = (await call("POST", "media", writer, { upload_id: second.body.data.upload_id })).body.data.id as string;
    await call("POST", `products/${draftId}/media`, writer, { media_id: other2 });
    const ids = (await call("GET", `products/${draftId}/media`, readOnly)).body.data.filter((m: Answer) => m.kind === "image").map((m: Answer) => m.media_id);
    const reordered = await call("PATCH", `products/${draftId}/media`, writer, { media_ids: [...ids].reverse() });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.filter((m: Answer) => m.kind === "image").map((m: Answer) => m.media_id)).toEqual([...ids].reverse());
    expect((await call("PATCH", `products/${draftId}/media`, writer, { media_ids: [mediaId] })).status).toBe(ids.length === 1 ? 200 : 422);
    const removed = await call("DELETE", `products/${draftId}/media/${mediaId}`, writer);
    expect(removed.body.data.map((m: Answer) => m.media_id)).not.toContain(mediaId);
    expect(removed.body.data.length).toBe(before.length + 1);
    expect((await call("DELETE", `products/${draftId}/media/${mediaId}`, writer)).status).toBe(404);
  });

  it("changes a product on the site, and publishes or archives one, only with products:publish", async () => {
    const [live] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.storeId}::uuid and status = 'active' order by created_at limit 1`);
    const liveId = String(live.id);
    const tag = await call("POST", "tags", writer, { name: `Live ${Date.now()}` });
    const refused = await call("POST", `tags/${tag.body.data.id}/products`, writer, { product_id: liveId });
    expect(refused.status).toBe(403);
    expect(refused.body.error.code).toBe("gated");
    expect((await call("POST", `tags/${tag.body.data.id}/products`, publisher, { product_id: liveId })).status).toBe(201);
    expect((await call("PATCH", `products/${liveId}`, writer, { excerpt: "Changed from outside" })).body.error.code).toBe("gated");
    expect((await call("PATCH", `products/${liveId}`, publisher, { excerpt: "Changed from outside" })).status).toBe(200);
    expect((await call("PATCH", `products/${liveId}`, publisher, { status: "draft" })).body.error.code).toBe("gated");

    // Publishing is its own scope: products:write alone is refused before anything runs.
    const scoped = await call("POST", `products/${draftId}/publish`, writer, {});
    expect(scoped.status).toBe(403);
    expect(scoped.body.error.message).toContain("products:publish");
    const published = await call("POST", `products/${draftId}/publish`, publisher, {});
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe("active");
    expect((await call("POST", `products/${draftId}/unpublish`, publisher)).body.data.status).toBe("draft");
    expect((await call("POST", `products/${draftId}/archive`, publisher, {})).body.data.status).toBe("archived");
    expect((await call("POST", `products/${draftId}/archive`, publisher, {})).status).toBe(409);
    expect((await call("POST", `products/${draftId}/publish`, publisher, {})).status).toBe(422);
    expect((await call("POST", `products/${draftId}/unarchive`, publisher, {})).body.data.status).toBe("draft");
    expect((await call("POST", `products/${draftId}/unarchive`, publisher, {})).status).toBe(409);
    const audit = await db().execute<Row>(sql`
      select action from commerce.audit_log where store_id = ${store.storeId}::uuid and details ->> 'token' = 'Publisher' and action like 'integration.api_product_%' order by created_at
    `);
    expect(audit.map((a) => a.action)).toEqual(
      expect.arrayContaining(["integration.api_product_published", "integration.api_product_unpublished", "integration.api_product_archived", "integration.api_product_unarchived"]),
    );
  });

  it("sets a price list's fixed prices in minor units through its page's writer", async () => {
    const list = await savePriceList(store.member, null, { name: `Wholesale ${Date.now()}`, percent: null, active: true });
    if (!list.ok || !list.id) throw new Error("no list");
    expect((await call("GET", "price-lists", readOnly)).body.data.map((l: Answer) => l.id)).toContain(list.id);
    // Prices shoppers are charged: the power `products:publish` (`set_price_list_prices` asks the owner's yes).
    expect((await call("POST", `price-lists/${list.id}/prices`, writer, { rows: [{ sku: SKU, currency: "NOK", amount_minor: 12_900 }] })).status).toBe(403);
    const set = await call("POST", `price-lists/${list.id}/prices`, publisher, { rows: [{ sku: SKU, currency: "NOK", amount_minor: 12_900 }, { sku: SKU, currency: "EUR", amount_minor: 1_190 }] });
    expect(set.body.data).toEqual({ set: 2, removed: 0 });
    const prices = await call("GET", `price-lists/${list.id}/prices?limit=1`, readOnly);
    expect(prices.body.data).toHaveLength(1);
    const rest = await call("GET", `price-lists/${list.id}/prices?after=${prices.body.next}`, readOnly);
    expect([...prices.body.data, ...rest.body.data].map((p: Answer) => `${p.currency} ${p.amount_minor}`).sort()).toEqual(["EUR 1190", "NOK 12900"]);
    expect((await call("POST", `price-lists/${list.id}/prices`, publisher, { rows: [{ sku: SKU, currency: "USD", amount_minor: 100 }] })).status).toBe(422);
    expect((await call("POST", `price-lists/${list.id}/prices`, publisher, { rows: [{ sku: SKU, currency: "EUR", amount_minor: null }] })).body.data).toEqual({ set: 0, removed: 1 });
    const theirs = await savePriceList(other.member, null, { name: "Theirs", percent: 10, active: true });
    expect((await call("GET", `price-lists/${theirs.ok && theirs.id}/prices`, readOnly)).status).toBe(404);
    // Behind the online shop (D178): switched off, the price lists answer feature_off.
    await db().execute(sql`update commerce.stores set features = array_remove(features, 'shop') where id = ${store.storeId}::uuid`);
    try {
      const off = await call("GET", "price-lists", readOnly);
      expect(off.status).toBe(403);
      expect(off.body.error.code).toBe("feature_off");
    } finally {
      await db().execute(sql`update commerce.stores set features = array(select distinct unnest(features || array['shop']::text[])) where id = ${store.storeId}::uuid`);
    }
  });

  it("pages stock levels by variant and location, so two levels moved at the same moment are both listed", async () => {
    const variant = await variantId(store.storeId, SKU);
    const [second] = await db().execute<Row>(sql`
      insert into commerce.inventory_locations (store_id, name, country, priority) values (${store.storeId}::uuid, ${`Back room ${Date.now()}`}, 'NO', 9) returning id
    `);
    const at = "2099-01-01T00:00:00Z";
    await db().execute(sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
      values (${store.storeId}::uuid, ${variant}::uuid, ${String(second.id)}::uuid, 3)
      on conflict do nothing
    `);
    await db().execute(sql`update commerce.inventory_levels set updated_at = ${at}::timestamptz where store_id = ${store.storeId}::uuid and variant_id = ${variant}::uuid`);
    const page1 = await call("GET", `inventory/levels?variant_id=${variant}&limit=1`, full);
    expect(page1.body.data).toHaveLength(1);
    expect(page1.body.next).toEqual(expect.any(String));
    const page2 = await call("GET", `inventory/levels?variant_id=${variant}&limit=1&after=${page1.body.next}`, full);
    expect(page2.body.data).toHaveLength(1);
    const levels = await db().execute<Row>(sql`select location_id from commerce.inventory_levels where store_id = ${store.storeId}::uuid and variant_id = ${variant}::uuid`);
    expect([page1.body.data[0].location_id, page2.body.data[0].location_id].sort()).toEqual(levels.map((l) => String(l.location_id)).sort().slice(0, 2));
    await db().execute(sql`update commerce.inventory_levels set updated_at = now() where store_id = ${store.storeId}::uuid and variant_id = ${variant}::uuid`);
    // Stock moved there is kept in its history: the place is switched off, never deleted.
    await db().execute(sql`update commerce.inventory_locations set active = false where id = ${String(second.id)}::uuid`);
  });

  it("lists what changed after a time, and refuses one that is not a time", async () => {
    const later = new Date(Date.now() + 60_000).toISOString();
    const checkout = await makeApiToken(store.member, { name: "Checkout reader", scopes: ["checkout:read"] });
    if (!checkout.ok) throw new Error(checkout.problem);
    const lists: [string, string][] = [
      ...["products", "orders", "customers", "discounts", "inventory/levels", "categories", "tags", "media", "price-lists"].map((l) => [l, full] as [string, string]),
      ["checkout/rules", checkout.token],
      ["checkout/fields", checkout.token],
    ];
    for (const [list, token] of lists) {
      const answer = await call("GET", `${list}?updated_after=${encodeURIComponent(later)}`, token);
      expect(answer.status, list).toBe(200);
      expect(answer.body.data, list).toEqual([]);
    }
    const earlier = new Date(Date.now() - 24 * 3_600_000).toISOString();
    expect((await call("GET", `products?updated_after=${encodeURIComponent(earlier)}`, full)).body.data.length).toBeGreaterThan(0);
    expect((await call("GET", "products?updated_after=yesterday", full)).status).toBe(422);
    const orders = await call("GET", "orders?limit=1", full);
    expect(orders.body.data[0].updated_at).toEqual(expect.any(String));
  });

  it("refuses a change in a store that is not open, naming the permission, and lets it read what happened", async () => {
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${store.storeId}::uuid`);
    try {
      const refused = await call("POST", "categories", writer, { name: "While closed" });
      expect(refused.status).toBe(403);
      expect(refused.body.error.message).toContain("products:write");
      expect((await call("GET", "orders?limit=1", full)).status).toBe(200);
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${store.storeId}::uuid`);
    }
  });
});

describe("orders (D440 C2)", () => {
  let clerk: string;
  let sender: string;
  const address = { name: "Kari Nordmann", line1: "Storgata 1", postal_code: "0155", city: "Oslo", country: "NO" };

  beforeAll(async () => {
    const made = await makeApiToken(store.member, { name: "Clerk", scopes: ["orders:write", "orders:manage", "customers:read"] });
    const sends = await makeApiToken(store.member, { name: "Sender", scopes: ["orders:manage", "orders:send", "orders:refund"] });
    if (!made.ok || !sends.ok) throw new Error("no token");
    clerk = made.token;
    sender = sends.token;
    // Stripe on in test mode, so a draft's pay link can be made (as the drafts' own tests do).
    await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${store.storeId}::uuid`);
  });

  it("makes, prices, sends and lists a draft order through the draft editor's own functions", async () => {
    const made = await call("POST", "drafts", clerk, { email: "kari@example.com", shipping_address: address, lines: [{ sku: SKU, quantity: 2 }], internal_note: "From the ERP" });
    expect(made.status).toBe(201);
    const draft = made.body.data;
    expect(draft).toMatchObject({ status: "open", source: "staff", market: "NO", currency: "NOK", internal_note: "From the ERP", quote: null });
    expect(draft.lines).toEqual([expect.objectContaining({ sku: SKU, quantity: 2, custom_price: false })]);
    expect(draft.total_minor).toEqual(expect.any(Number));
    // Prices by SKU (D437), as the AI manager types them: the line takes it, nothing else changes.
    const priced = await call("PATCH", `drafts/${draft.id}`, clerk, { version: draft.version, prices: [{ sku: SKU, unit_price_minor: 15_000 }] });
    expect(priced.status).toBe(200);
    expect(priced.body.data.lines[0]).toMatchObject({ unit_price_minor: 15_000, custom_price: true });
    expect((await call("PATCH", `drafts/${draft.id}`, clerk, { version: draft.version, note_to_buyer: "Old" })).status).toBe(409);
    expect((await call("PATCH", `drafts/${draft.id}`, clerk, { prices: [{ sku: "NO-SUCH", unit_price_minor: 1 }] })).status).toBe(422);
    const lines = await call("PATCH", `drafts/${draft.id}`, clerk, {
      lines: [{ id: priced.body.data.lines[0].id, quantity: 3 }],
      discount: { kind: "percent", percent: 10, label: "Loyal" },
      shipping: { kind: "free" },
    });
    expect(lines.body.data.lines[0]).toMatchObject({ quantity: 3, unit_price_minor: 15_000 });
    expect(lines.body.data.discount).toMatchObject({ kind: "percent", percent: 10, label: "Loyal" });
    expect(lines.body.data.shipping).toEqual({ kind: "free", amount_minor: null });
    expect((await call("GET", `drafts/${draft.id}`, readOnly)).status).toBe(403);
    expect((await call("GET", "drafts?status=open", clerk)).body.data.map((d: Answer) => d.id)).toContain(draft.id);
    expect((await call("GET", `drafts/${draft.id}`, clerk)).body.data).toMatchObject({ id: draft.id, blocking: [] });

    // Sending emails the customer: the power `orders:send` (`send_draft_order` asks the owner's yes).
    const unsent = await call("POST", `drafts/${draft.id}/send`, clerk, { create_link: true });
    expect(unsent.status).toBe(403);
    expect(unsent.body.error.message).toContain("orders:send");
    const sent = await call("POST", `drafts/${draft.id}/send`, sender, { create_link: true });
    expect(sent.status).toBe(200);
    expect(sent.body.data).toMatchObject({ link: expect.stringContaining("/account/pay/"), emailed: null });
    expect(sent.body.data.draft.status).toBe("sent");
    expect((await call("POST", `drafts/${draft.id}/send`, sender, {})).status).toBe(409);
    // The order it made waits for payment: cancelled here, its draft follows.
    const order = sent.body.data.order_id as string;
    expect((await call("GET", `orders/${order}`, clerk)).body.data.status).toBe("pending_payment");
    expect((await call("POST", `orders/${order}/cancel`, clerk, { reason: "Changed their mind" })).body.error.message).toContain("orders:refund");
    expect((await call("POST", `orders/${order}/cancel`, sender, { reason: "Changed their mind" })).body.data).toEqual({ id: order, status: "cancelled" });
    expect((await call("GET", `orders/${order}`, clerk)).body.data.status).toBe("cancelled");
    expect((await call("POST", `orders/${order}/cancel`, sender, {})).status).toBe(409);
    const audit = await db().execute<Row>(sql`
      select action from commerce.audit_log where store_id = ${store.storeId}::uuid and details ->> 'token' = 'Clerk' and action like 'integration.api_%' order by created_at
    `);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["integration.api_draft_created", "integration.api_draft_changed"]));
    const sentAudit = await db().execute<Row>(sql`
      select action from commerce.audit_log where store_id = ${store.storeId}::uuid and details ->> 'token' = 'Sender' and action like 'integration.api_%' order by created_at
    `);
    expect(sentAudit.map((a) => a.action)).toEqual(expect.arrayContaining(["integration.api_draft_sent", "integration.api_order_cancelled"]));
  });

  it("declines a shopper's request for a quote with a reply, and lists requests alone", async () => {
    const made = await call("POST", "drafts", clerk, { email: "asker@example.com", lines: [{ sku: SKU, quantity: 1 }] });
    await db().execute(sql`update commerce.draft_orders set source = 'quote' where id = ${made.body.data.id}::uuid`);
    const quotes = await call("GET", "drafts?quotes=true", clerk);
    expect(quotes.body.data.map((d: Answer) => d.id)).toContain(made.body.data.id);
    expect(quotes.body.data.every((d: Answer) => d.source === "quote")).toBe(true);
    expect((await call("POST", `drafts/${made.body.data.id}/decline`, clerk, { reply: "No" })).status).toBe(403);
    expect((await call("POST", `drafts/${made.body.data.id}/decline`, sender, { reply: "" })).status).toBe(422);
    const declined = await call("POST", `drafts/${made.body.data.id}/decline`, sender, { reply: "We do not make that size, sorry." });
    expect(declined.status).toBe(200);
    expect(declined.body.data.quote).toBe("declined");
    expect((await call("POST", `drafts/${made.body.data.id}/decline`, sender, { reply: "Again" })).status).toBe(409);
    const staffs = await call("POST", "drafts", clerk, {});
    expect((await call("POST", `drafts/${staffs.body.data.id}/decline`, sender, { reply: "No" })).status).toBe(409);
    // Another store's draft is not found; with the online shop off, drafts answer feature_off.
    const { createDraft } = await import("./draft-orders");
    const theirs = await createDraft(other.storeId, { accountId: other.accountId, kind: "staff" });
    if (!theirs.ok) throw new Error(theirs.problem);
    expect((await call("GET", `drafts/${theirs.draft.id}`, clerk)).status).toBe(404);
    expect((await call("PATCH", `drafts/${theirs.draft.id}`, clerk, { internal_note: "Mine now" })).status).toBe(404);
    await db().execute(sql`update commerce.stores set features = array_remove(features, 'shop') where id = ${store.storeId}::uuid`);
    try {
      expect((await call("GET", "drafts", clerk)).body.error.code).toBe("feature_off");
    } finally {
      await db().execute(sql`update commerce.stores set features = array(select distinct unnest(features || array['shop']::text[])) where id = ${store.storeId}::uuid`);
    }
  });

  it("refunds only with orders:refund, through the admin's own refund, and never answers a store credit's code", async () => {
    const fx = await import("./invoice-test-fixture");
    const seller = await fx.makeStore("apirefund", { rates: true });
    const owner = await fx.ownerOf(seller);
    const paid = await fx.paidOrder(seller, [[SKU, 2]]);
    const writer = await makeApiToken(owner, { name: "Writer", scopes: ["orders:write"] });
    const refunder = await makeApiToken(owner, { name: "Refunds", scopes: ["orders:read", "orders:refund"] });
    if (!writer.ok || !refunder.ok) throw new Error("no token");
    const scoped = await call("POST", `orders/${paid.orderId}/refunds`, writer.token, { amount_minor: 1000, to_store_credit: true });
    expect(scoped.status).toBe(403);
    expect(scoped.body.error.message).toContain("orders:refund");
    const refunded = await call("POST", `orders/${paid.orderId}/refunds`, refunder.token, { amount_minor: 1000, reason: "Goodwill", to_store_credit: true });
    expect(refunded.status).toBe(201);
    expect(refunded.body.data).toMatchObject({ amount_minor: 1000, store_credit: { amount_minor: 1000 } });
    expect(JSON.stringify(refunded.body)).not.toMatch(/"code"/);
    const list = await call("GET", `orders/${paid.orderId}/refunds`, refunder.token);
    expect(list.body.data).toEqual([expect.objectContaining({ amount_minor: 1000, kind: "store_credit", status: "succeeded", currency: "NOK" })]);
    expect((await call("POST", `orders/${paid.orderId}/refunds`, refunder.token, { amount_minor: 10_000_000, to_store_credit: true })).status).toBe(422);
    // A paid order is not cancelled here: it is refunded. Cancelling is a power beside refunding (`orders:refund`), never a plain write.
    expect((await call("POST", `orders/${paid.orderId}/cancel`, writer.token, {})).status).toBe(403);
    expect((await call("POST", `orders/${paid.orderId}/cancel`, refunder.token, {})).status).toBe(409);
    expect((await call("GET", `orders/${paid.orderId}/refunds`, full)).status).toBe(404);
  });

  it("never answers one order's request with another's under the same Idempotency-Key and body (D440 review)", async () => {
    const a = await place(store.storeId, [[SKU, 1]]);
    const b = await place(store.storeId, [[SKU, 1]]);
    const key = { "idempotency-key": `note-${Date.now()}` };
    const body = { note: "Ring the bell" };
    expect((await call("POST", `orders/${a.orderId}/notes`, clerk, body, key)).status).toBe(201);
    // The same key and body on another order is another request: refused, never the first one's answer.
    const other = await call("POST", `orders/${b.orderId}/notes`, clerk, body, key);
    expect(other.headers.get("idempotent-replayed")).toBeNull();
    expect(other.status).toBe(422);
    expect(other.body.error.message).toContain("used for another request");
    expect((await call("POST", `orders/${b.orderId}/notes`, clerk, body, { "idempotency-key": `note-b-${Date.now()}` })).status).toBe(201);
    expect((await call("GET", `orders/${b.orderId}/notes`, clerk)).body.data.map((n: Answer) => n.note)).toEqual(["Ring the bell"]);
    expect((await call("GET", `orders/${a.orderId}/notes`, clerk)).body.data.map((n: Answer) => n.note)).toEqual(["Ring the bell"]);
  });

  it("notes and tags an order, and moves a return through its steps as the returns page does", async () => {
    const order = await place(store.storeId, [[SKU, 2]]);
    await pay(store.storeId, order, store.account);
    const noted = await call("POST", `orders/${order.orderId}/notes`, clerk, { note: "Gift wrap, please" });
    expect(noted.status).toBe(201);
    expect(noted.body.data).toMatchObject({ note: "Gift wrap, please", by: "API: Clerk" });
    expect((await call("GET", `orders/${order.orderId}/notes`, clerk)).body.data.map((n: Answer) => n.note)).toEqual(["Gift wrap, please"]);
    expect((await call("POST", `orders/${order.orderId}/notes`, clerk, { note: "" })).status).toBe(422);
    expect((await call("POST", `orders/${order.orderId}/tags`, clerk, { tag: "Priority" })).body.data.tags).toEqual(["Priority"]);
    expect((await call("GET", `orders/${order.orderId}`, clerk)).body.data.tags).toEqual(["Priority"]);
    expect((await call("DELETE", `orders/${order.orderId}/tags/priority`, clerk)).body.data.tags).toEqual([]);
    expect((await call("DELETE", `orders/${order.orderId}/tags/priority`, clerk)).status).toBe(404);

    const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${order.orderId}::uuid order by id limit 1`);
    const makeReturn = async (n: number) => {
      const [made] = await db().execute<Row>(sql`
        insert into commerce.returns (store_id, order_id, kind, number, status) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'return', ${`${order.number}-R${n}`}, 'requested') returning id
      `);
      await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity) values (${store.storeId}::uuid, ${String(made.id)}::uuid, ${String(line.id)}::uuid, 1)`);
      return String(made.id);
    };
    const first = await makeReturn(1);
    const listed = await call("GET", "returns?status=requested", clerk);
    expect(listed.body.data.map((r: Answer) => r.id)).toContain(first);
    const got = await call("GET", `returns/${first}`, clerk);
    expect(got.body.data).toMatchObject({ kind: "return", status: "requested", order_id: order.orderId, lines: [expect.objectContaining({ quantity: 1, decision: "accept" })] });
    // Deciding and receiving a return emails the customer: the power `orders:send` (`approve_return` asks the owner's yes).
    expect((await call("POST", `returns/${first}/approve`, clerk, { note: "OK" })).body.error.message).toContain("orders:send");
    expect((await call("POST", `returns/${first}/receive`, sender, {})).status).toBe(409);
    expect((await call("POST", `returns/${first}/approve`, sender, { note: "OK" })).body.data.status).toBe("approved");
    expect((await call("POST", `returns/${first}/receive`, sender, {})).body.data.status).toBe("received");
    const second = await makeReturn(2);
    expect((await call("POST", `returns/${second}/decline`, sender, { reason: "" })).status).toBe(422);
    expect((await call("POST", `returns/${second}/decline`, sender, { reason: "Used" })).body.data.status).toBe("declined");
    expect((await call("GET", `returns/${second}`, readOnly)).status).toBe(403);
    const [theirs] = await db().execute<Row>(sql`select id from commerce.returns where store_id <> ${store.storeId}::uuid limit 1`);
    if (theirs) expect((await call("GET", `returns/${String(theirs.id)}`, clerk)).status).toBe(404);
    expect((await call("GET", "returns/00000000-0000-4000-8000-000000000000", clerk)).status).toBe(404);
  });
});

describe("customers and marketing (D440 C3)", () => {
  let marketer: string;

  beforeAll(async () => {
    const made = await makeApiToken(store.member, {
      name: "Marketing",
      scopes: ["customers:write", "customers:manage", "discounts:write", "discounts:publish", "gift_cards:write", "orders:write", "orders:send"],
    });
    if (!made.ok) throw new Error(made.problem);
    marketer = made.token;
    await db().execute(sql`update commerce.stores set features = array(select distinct unnest(features || array['gift_cards', 'subscriptions', 'bonus']::text[])) where id = ${store.storeId}::uuid`);
  });

  it("adds, changes and finds customers by email through the customer page's writers", async () => {
    const email = `c3-${Date.now()}@example.com`;
    const made = await call("POST", "customers", marketer, { email, name: "Ola Nordmann", address: { line1: "Storgata 2", postal_code: "0155", city: "Oslo", country: "NO" } });
    expect(made.status).toBe(201);
    expect(made.body.data).toMatchObject({ email, name: "Ola Nordmann", email_verified: false });
    expect((await call("POST", "customers", marketer, { email })).status).toBe(409);
    expect((await call("POST", "customers", marketer, { email: "not an email" })).status).toBe(422);
    const found = await call("GET", `customers?email=${encodeURIComponent(email.toUpperCase())}`, marketer);
    expect(found.body.data.map((c: Answer) => c.id)).toEqual([made.body.data.id]);
    const changed = await call("PATCH", `customers/${made.body.data.id}`, marketer, { phone: "+47 412 34 567" });
    expect(changed.body.data).toMatchObject({ phone: "+47 412 34 567", name: "Ola Nordmann", email });
    expect((await call("PATCH", `customers/${made.body.data.id}`, marketer, { address: { line1: "Only a line", postal_code: "", city: "", country: "NO" } })).status).toBe(422);
    // The email is what the customer signs in with (D32): changing it is a power of its own; the same email in another case is no change.
    const moved = await call("PATCH", `customers/${made.body.data.id}`, marketer, { email: `taken-over-${Date.now()}@example.com` });
    expect(moved.status).toBe(403);
    expect(moved.body.error).toMatchObject({ code: "gated", message: expect.stringContaining("customers:email") });
    expect((await call("PATCH", `customers/${made.body.data.id}`, marketer, { email: email.toUpperCase(), name: "Ola N." })).status).toBe(200);
    const emailer = await makeApiToken(store.member, { name: "Emails", scopes: ["customers:manage", "customers:email"] });
    if (!emailer.ok) throw new Error(emailer.problem);
    const newEmail = `c3-new-${Date.now()}@example.com`;
    expect((await call("PATCH", `customers/${made.body.data.id}`, emailer.token, { email: newEmail })).body.data.email).toBe(newEmail);
    const [theirs] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${other.storeId}::uuid, ${`their-${Date.now()}@example.com`}, 'X') returning id`);
    expect((await call("PATCH", `customers/${String(theirs.id)}`, marketer, { name: "Mine" })).status).toBe(404);
    expect((await call("GET", `customers/${made.body.data.id}/loyalty`, marketer)).body.data).toMatchObject({ customer_id: made.body.data.id, available_minor: 0 });
    expect((await call("GET", `customers/${made.body.data.id}/store-credit`, marketer)).body.data).toEqual({ customer_id: made.body.data.id, cards: [], balances: [] });
  });

  it("reads segments with how many they hold, never who", async () => {
    const [segment] = await db().execute<Row>(sql`
      insert into commerce.segments (store_id, title, rules) values (${store.storeId}::uuid, ${`Everyone ${Date.now()}`}, '{"match": "all", "conditions": []}') returning id
    `);
    const listed = await call("GET", "segments", marketer);
    expect(listed.body.data.map((s: Answer) => s.id)).toContain(String(segment.id));
    const one = await call("GET", `segments/${String(segment.id)}`, marketer);
    expect(one.body.data.people).toEqual(expect.any(Number));
    expect(JSON.stringify(one.body)).not.toContain("@example.com");
    expect((await call("GET", "segments/00000000-0000-4000-8000-000000000000", marketer)).status).toBe(404);
  });

  it("changes a discount code and switches it off through the admin's own form, keeping what it reaches", async () => {
    const code = `C3${Date.now()}`;
    const made = await call("POST", "discounts", marketer, { code, kind: "percent", percent: 10 });
    const id = made.body.data.id as string;
    const changed = await call("PATCH", `discounts/${id}`, marketer, { percent: 20, usage_limit: 50 });
    expect(changed.body.data).toMatchObject({ code, percent: 20, usage_limit: 50, active: true, applies_to: "everything" });
    expect((await call("PATCH", `discounts/${id}`, marketer, { code: "a b" })).status).toBe(422);
    const off = await call("POST", `discounts/${id}/disable`, marketer, {});
    expect(off.body.data.active).toBe(false);
    expect((await call("GET", `discounts/${id}`, full)).body.data).toMatchObject({ id, active: false, percent: 20 });
    expect((await call("PATCH", `discounts/${id}`, readOnly, { percent: 5 })).status).toBe(403);
  });

  it("issues a gift card with gift_cards:write, answers its code once and never again, and deactivates it", async () => {
    const key = { "idempotency-key": `card-${Date.now()}` };
    const issued = await call("POST", "gift-cards", marketer, { currency: "NOK", amount_minor: 50_000 }, key);
    expect(issued.status).toBe(201);
    expect(issued.body.data).toMatchObject({ currency: "NOK", initial_minor: 50_000, balance_minor: 50_000, source: "staff", code: expect.any(String) });
    const code = issued.body.data.code as string;
    const replay = await call("POST", "gift-cards", marketer, { currency: "NOK", amount_minor: 50_000 }, key);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");
    expect(replay.body.data.code).toBeNull();
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.api_idempotency_keys where body::text like ${`%${code}%`}`);
    expect(kept.n).toBe(0);
    const id = issued.body.data.id as string;
    const listed = await call("GET", "gift-cards?state=active", marketer);
    expect(listed.body.data.map((c: Answer) => c.id)).toContain(id);
    expect(JSON.stringify(listed.body)).not.toContain(code);
    expect((await call("GET", `gift-cards/${id}`, marketer)).body.data).not.toHaveProperty("code");
    expect((await call("POST", "gift-cards", marketer, { currency: "USD", amount_minor: 100 })).status).toBe(422);
    expect((await call("POST", `gift-cards/${id}/disable`, marketer, { reason: "Lost" })).body.data.state).toBe("deactivated");
    expect((await call("POST", `gift-cards/${id}/disable`, marketer, {})).status).toBe(409);
    expect((await call("GET", "gift-cards", full)).status).toBe(403);
    await db().execute(sql`update commerce.stores set features = array_remove(features, 'gift_cards') where id = ${store.storeId}::uuid`);
    try {
      expect((await call("GET", "gift-cards", marketer)).body.error.code).toBe("feature_off");
    } finally {
      await db().execute(sql`update commerce.stores set features = array(select distinct unnest(features || array['gift_cards']::text[])) where id = ${store.storeId}::uuid`);
    }
  });

  it("reads, pauses and cancels a subscription as the subscription page does", async () => {
    const run = Date.now().toString(36);
    const order = await place(store.storeId, [[SKU, 1]]);
    const [made] = await db().execute<Row>(sql`
      insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, interval, interval_count, subtotal_minor, shipping_minor,
        total_minor, tax_minor, first_order_id, manage_token, current_period_end, provider, provider_reference, provider_account)
      values (${store.storeId}::uuid, ${`S-${run}`}, 'active', 'NO', 'NOK', 'nb-NO', 'sub@example.com', 'month', 1, 19900, 0, 19900, 3980, ${order.orderId}::uuid,
        ${`manage-${run}`}, now() + interval '20 days', 'stripe', ${`sub_api_${run}`}, ${store.account})
      returning id
    `);
    const id = String(made.id);
    const listed = await call("GET", "subscriptions?status=active", marketer);
    expect(listed.body.data.map((s: Answer) => s.id)).toContain(id);
    const got = await call("GET", `subscriptions/${id}`, marketer);
    expect(got.body.data).toMatchObject({ id, status: "active", total_per_renewal_minor: 19900, every: { interval: "month", count: 1 } });
    expect(JSON.stringify(got.body)).not.toContain(`manage-${run}`);
    const paused = await call("POST", `subscriptions/${id}/pause`, marketer, { periods: 1 });
    expect(paused.status).toBe(200);
    expect(paused.body.data.status).toBe("paused");
    const cancelled = await call("POST", `subscriptions/${id}/cancel`, marketer, { at: "now" });
    expect(cancelled.body.data.status).toBe("cancelled");
    expect((await call("POST", `subscriptions/${id}/cancel`, marketer, {})).status).toBe(409);
    expect((await call("GET", "subscriptions/00000000-0000-4000-8000-000000000000", marketer)).status).toBe(404);
  });

  it("reads a customer's store credit from a refund, never its code", async () => {
    const fx = await import("./invoice-test-fixture");
    const seller = await fx.makeStore("apicredit", { rates: true });
    const email = `credit-${Date.now()}@example.com`;
    const paid = await fx.paidOrder(seller, [[SKU, 1]], { email });
    const token = await makeApiToken(await fx.ownerOf(seller), { name: "Credit", scopes: ["orders:refund", "customers:manage"] });
    if (!token.ok) throw new Error(token.problem);
    const refunded = await call("POST", `orders/${paid.orderId}/refunds`, token.token, { amount_minor: 2_000, to_store_credit: true });
    expect(refunded.status).toBe(201);
    const customer = await call("POST", "customers", token.token, { email });
    const credit = await call("GET", `customers/${customer.body.data.id}/store-credit`, token.token);
    expect(credit.body.data.cards).toEqual([expect.objectContaining({ source: "refund", initial_minor: 2_000, balance_minor: 2_000 })]);
    expect(credit.body.data.balances).toEqual([{ currency: "NOK", amount_minor: 2_000 }]);
    expect((await call("GET", `customers/${customer.body.data.id}/loyalty`, token.token)).body.error.code).toBe("feature_off");
  });
});

describe("content, the store and operations (D440 C4)", () => {
  let editor: string;
  const run = Date.now().toString(36);

  beforeAll(async () => {
    const made = await makeApiToken(store.member, {
      name: "Editor",
      scopes: ["content:write", "content:publish", "settings:read", "reports:read", "webhooks:write", "products:manage", "products:publish"],
    });
    if (!made.ok) throw new Error(made.problem);
    editor = made.token;
  });

  it("writes drafts of pages and articles through the editor's save, and publishes only with content:publish", async () => {
    const { newPageContent } = await import("@/lib/page-content");
    const writer = await makeApiToken(store.member, { name: "Writer", scopes: ["content:write"] });
    if (!writer.ok) throw new Error(writer.problem);
    for (const [plural, kind] of [
      ["pages", "page"],
      ["articles", "article"],
    ] as const) {
      const made = await call("POST", plural, writer.token, { draft: { ...newPageContent(), title: `API ${kind}`, slug: `api-${kind}-${run}`, rows: [] } });
      expect(made.status, plural).toBe(201);
      expect(made.body.data).toMatchObject({ title: `API ${kind}`, state: "draft", published_at: null });
      const id = made.body.data.id as string;
      const draft = { ...made.body.data.draft, title: `API ${kind}, changed` };
      expect((await call("PATCH", `${plural}/${id}`, writer.token, { draft })).body.data.title).toBe(`API ${kind}, changed`);
      expect((await call("PATCH", `${plural}/${id}`, writer.token, { draft: { ...draft, slug: "Not A Slug!" } })).status).toBe(422);
      // Global parts change every page using them, published ones too: over the API a draft never carries them (D440 review).
      const global = await call("PATCH", `${plural}/${id}`, writer.token, { draft: { ...draft, globalEdits: ["5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d"] } });
      expect(global.status).toBe(422);
      expect(global.body.error.message).toContain("globalEdits");
      expect((await call("POST", plural, writer.token, { draft: { ...draft, slug: `api-${kind}-g-${run}`, globalEdits: [] } })).status).toBe(422);
      expect((await call("GET", `${plural}/${id}`, writer.token)).body.data.draft.title).toBe(`API ${kind}, changed`);
      expect((await call("GET", plural, writer.token)).body.data.map((p: Answer) => p.id)).toContain(id);
      const scoped = await call("POST", `${plural}/${id}/publish`, writer.token, {});
      expect(scoped.status).toBe(403);
      expect(scoped.body.error.message).toContain("content:publish");
      const published = await call("POST", `${plural}/${id}/publish`, editor, {});
      expect(published.status, JSON.stringify(published.body)).toBe(200);
      expect(published.body.data).toMatchObject({ state: "published", published_at: expect.any(String) });
    }
    const audit = await db().execute<Row>(sql`
      select action from commerce.audit_log where store_id = ${store.storeId}::uuid and details ->> 'token' in ('Writer', 'Editor') and action like 'integration.api_%' order by created_at
    `);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["integration.api_page_created", "integration.api_page_published", "integration.api_article_draft_saved"]));

    // A page never published moves with its draft, and the pages under it with it: one of those on the site takes content:publish.
    const parent = await call("POST", "pages", writer.token, { draft: { ...newPageContent(), title: "Parent", slug: `api-parent-${run}`, rows: [] } });
    const child = await call("POST", "pages", writer.token, { draft: { ...newPageContent(), title: "Child", slug: `api-parent-${run}/child`, rows: [] } });
    expect(child.status, JSON.stringify(child.body)).toBe(201);
    expect((await call("POST", `pages/${child.body.data.id}/publish`, editor, {})).status).toBe(200);
    const moving = { ...parent.body.data.draft, slug: `api-moved-${run}` };
    const refused = await call("PATCH", `pages/${parent.body.data.id}`, writer.token, { draft: moving });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({ code: "gated", message: expect.stringContaining("content:publish") });
    expect((await call("GET", `pages/${child.body.data.id}`, writer.token)).body.data.slug).toBe(`api-parent-${run}/child`);
    expect((await call("PATCH", `pages/${parent.body.data.id}`, writer.token, { draft: { ...parent.body.data.draft, title: "Parent, renamed" } })).status).toBe(200);
    expect((await call("PATCH", `pages/${parent.body.data.id}`, editor, { draft: moving })).status).toBe(200);
    expect((await call("GET", `pages/${child.body.data.id}`, writer.token)).body.data.slug).toBe(`api-moved-${run}/child`);
  });

  it("writes and publishes a content entry, checked by its type's fields", async () => {
    const { saveContentType } = await import("./content-types");
    const title = { id: "f_apititle001", name: "name", label: "Name", type: "text", access: "public", width: 100 } as const;
    const type = await saveContentType({ accountId: store.accountId, owner: store.storeId }, { name: "Team", slug: `team-${run}`, fields: [title], titleField: title.id, summaryField: null, pictureField: null, hasPages: false });
    if (!type.ok || !type.id) throw new Error("no type");
    expect((await call("GET", "content-types", editor)).body.data.map((t: Answer) => t.id)).toContain(type.id);
    const locale = (await call("GET", "settings", editor)).body.data.languages[0] as string;
    const made = await call("POST", `content-types/${type.id}/entries`, editor, { slug: "kari", fields: { values: {}, translations: { [locale]: { [title.id]: "Kari" } } } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.data).toMatchObject({ slug: "kari", state: "draft" });
    const id = made.body.data.id as string;
    expect((await call("PATCH", `content-entries/${id}`, editor, { fields: { values: {}, translations: { [locale]: { [title.id]: "Kari N." } } } })).status).toBe(200);
    expect((await call("GET", `content-types/${type.id}/entries`, editor)).body.data.map((e: Answer) => e.id)).toEqual([id]);
    expect((await call("POST", `content-entries/${id}/publish`, editor, {})).body.data.state).toBe("published");
    expect((await call("GET", `content-entries/${id}`, editor)).body.data.state).toBe("published");
    // A published entry's address changes on the site at once: content:publish (D440 review); its draft's words do not need it.
    const writer = await makeApiToken(store.member, { name: "Entry writer", scopes: ["content:write"] });
    if (!writer.ok) throw new Error(writer.problem);
    const moved = await call("PATCH", `content-entries/${id}`, writer.token, { slug: "kari-n" });
    expect(moved.status).toBe(403);
    expect(moved.body.error.message).toContain("content:publish");
    expect((await call("GET", `content-entries/${id}`, editor)).body.data.slug).toBe("kari");
    expect((await call("PATCH", `content-entries/${id}`, writer.token, { slug: "kari", fields: { values: {}, translations: { [locale]: { [title.id]: "Kari Nordmann" } } } })).status).toBe(200);
    expect((await call("PATCH", `content-entries/${id}`, editor, { slug: "kari-n" })).body.data.slug).toBe("kari-n");
    expect((await call("GET", "content-types/00000000-0000-4000-8000-000000000000/entries", editor)).status).toBe(404);
  });

  it("reads the store's menus and settings, and runs a saved report", async () => {
    const [menu] = await db().execute<Row>(sql`insert into commerce.menus (store_id, name, items) values (${store.storeId}::uuid, ${`API ${run}`}, '[]') returning id`);
    expect((await call("GET", "menus", editor)).body.data.map((m: Answer) => m.id)).toContain(String(menu.id));
    expect((await call("GET", `menus/${String(menu.id)}`, editor)).body.data).toMatchObject({ name: `API ${run}`, items: [] });
    const settings = await call("GET", "settings", editor);
    expect(settings.body.data).toMatchObject({ slug: store.slug, markets: expect.arrayContaining([expect.objectContaining({ code: "NO", currency: "NOK" })]) });
    expect(settings.body.data.shipping.rates).toEqual(expect.arrayContaining([expect.objectContaining({ market: "FI", currency: "EUR", amount_minor: 590 })]));
    const { saveReport } = await import("./saved-reports");
    const { READY_REPORTS } = await import("@/lib/report-catalogue");
    const saved = await saveReport(store.storeId, store.accountId, { title: `Sales ${run}`, spec: READY_REPORTS.sales_by_variant });
    if (!saved.ok) throw new Error(saved.reason);
    const reports = await call("GET", "reports", editor);
    expect(reports.body.data).toEqual(expect.arrayContaining([expect.objectContaining({ id: saved.id, runs: true })]));
    const ran = await call("GET", `reports/${saved.id}/run`, editor);
    expect(ran.status, JSON.stringify(ran.body)).toBe(200);
    expect(ran.body.data).toMatchObject({ report_id: saved.id, columns: expect.any(Array), rows: expect.any(Array) });
    expect((await call("GET", "reports/00000000-0000-4000-8000-000000000000/run", editor)).status).toBe(404);
    expect((await call("GET", "settings", full)).status).toBe(403);
  });

  it("adds, changes, lists and removes the owner's webhook endpoints, the secret answered once, and sends a delivery again", async () => {
    const key = { "idempotency-key": `hook-${run}` };
    const made = await call("POST", "webhooks", editor, { name: "Warehouse", url: "https://hooks.example.com/kaizena", topics: ["order.created", "inventory.updated"] }, key);
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.data.secret).toMatch(/^whsec_/);
    expect(made.body.data).toMatchObject({ name: "Warehouse", enabled: true, topics: ["order.created", "inventory.updated"] });
    const replay = await call("POST", "webhooks", editor, { name: "Warehouse", url: "https://hooks.example.com/kaizena", topics: ["order.created", "inventory.updated"] }, key);
    expect(replay.body.data.secret).toBeNull();
    const id = made.body.data.id as string;
    expect((await call("POST", "webhooks", editor, { name: "Bad", url: "http://hooks.example.com/x", topics: ["order.created"] })).status).toBe(422);
    expect((await call("POST", "webhooks", editor, { name: "Bad", url: "https://hooks.example.com/x", topics: ["nonsense"] })).status).toBe(422);
    expect((await call("GET", "webhooks", editor)).body.data.map((e: Answer) => e.id)).toContain(id);
    expect(JSON.stringify((await call("GET", "webhooks", editor)).body)).not.toContain("kaizena");
    const changed = await call("PATCH", `webhooks/${id}`, editor, { topics: ["refund.created"], enabled: false });
    expect(changed.body.data).toMatchObject({ topics: ["refund.created"], enabled: false });
    await db().execute(sql`
      insert into commerce.integration_deliveries (store_id, provider, event, endpoint_id, status, payload) values (${store.storeId}::uuid, 'webhook', 'refund.created', ${id}::uuid, 'failed', '{}')
    `);
    const deliveries = await call("GET", `webhooks/${id}/deliveries`, editor);
    expect(deliveries.body.data).toEqual([expect.objectContaining({ topic: "refund.created", status: "failed" })]);
    const delivery = deliveries.body.data[0].id as string;
    expect((await call("POST", `webhooks/${id}/deliveries/${delivery}/resend`, editor, {})).status).toBe(409);
    await call("PATCH", `webhooks/${id}`, editor, { enabled: true });
    expect((await call("POST", `webhooks/${id}/deliveries/${delivery}/resend`, editor, {})).body.data).toEqual({ queued: true });
    expect((await call("GET", `webhooks/${id}/deliveries?limit=10`, editor)).body.data).toHaveLength(2);
    // A delivery about a person who was erased is never sent again (D440 review).
    await db().execute(sql`update commerce.integration_deliveries set erased_at = now(), payload = null where id = ${delivery}::uuid`);
    const erased = await call("POST", `webhooks/${id}/deliveries/${delivery}/resend`, editor, {});
    expect(erased.status).toBe(409);
    expect(erased.body.error.message).toContain("erased");
    expect((await call("DELETE", `webhooks/${id}`, editor)).body.data).toEqual({ id, deleted: true });
    expect((await call("DELETE", `webhooks/${id}`, editor)).status).toBe(404);
    expect((await call("GET", "webhooks", full)).status).toBe(403);
  });

  it("imports what shoppers see only with products:publish: the check counts it, the apply refuses it, drafts import as before", async () => {
    const importer = await makeApiToken(store.member, { name: "Importer", scopes: ["products:manage"] });
    if (!importer.ok) throw new Error(importer.problem);
    const { runJob } = await import("./data-jobs");
    const check = async (token: string, csv: string) => {
      const started = await call("POST", "jobs/product-imports", token, { file_name: "products.csv" });
      const upload = started.body.data.upload_id as string;
      await storage.upload("imports", `${store.storeId}/${upload}/products.csv`, new TextEncoder().encode(csv), "text/csv");
      const checked = await call("POST", `jobs/product-imports/${upload}/check`, token, { file_name: "products.csv" });
      expect(checked.status, JSON.stringify(checked.body)).toBe(201);
      await runJob(checked.body.data.id, { storage, schedule: () => undefined, budgetMs: 60_000 });
      return (await call("GET", `jobs/${checked.body.data.id}`, token)).body.data as Answer;
    };
    // A product's titles in every language it has: the file's title column is the store's main language's.
    const titleOf = async (id: string) => (await db().execute<Row>(sql`select title from commerce.product_translations where product_id = ${id}::uuid`)).map((r) => String(r.title));
    const [live] = await db().execute<Row>(sql`
      select p.id, p.handle, v.sku from commerce.products p join commerce.product_variants v on v.product_id = p.id
      where p.store_id = ${store.storeId}::uuid and p.status = 'active' and v.sku is not null order by p.created_at, v.created_at limit 1
    `);

    // A product on the site changed by the file: the check is of drafts only, so it is refused there and counted; the apply is refused
    // with how many, and the import closed so the next file can come.
    const liveFile = `handle,title,sku\n${String(live.handle)},Changed by a file ${run},${String(live.sku)}\n`;
    const onSite = await check(importer.token, liveFile);
    expect(onSite).toMatchObject({ status: "checked", counts: { dry: { toUpdate: 0, withProblems: 1, onShop: 1 } } });
    const refused = await call("POST", `jobs/${onSite.id}/apply`, importer.token, {});
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({ code: "gated", message: expect.stringContaining("1 product") });
    expect(refused.body.error.message).toContain("products:publish");
    expect((await call("GET", `jobs/${onSite.id}`, importer.token)).body.data.status).toBe("cancelled");
    expect(await titleOf(String(live.id))).not.toContain(`Changed by a file ${run}`);
    // With the power, the same file is checked as it is and applied.
    const published = await check(editor, liveFile);
    expect(published.counts).toMatchObject({ dry: { toUpdate: 1, onShop: 1 } });
    expect((await call("POST", `jobs/${published.id}/apply`, editor, {})).status).toBe(200);
    await runJob(published.id as string, { storage, schedule: () => undefined, budgetMs: 60_000 });
    expect(await titleOf(String(live.id))).toContain(`Changed by a file ${run}`);

    // Drafts only: applied with products:manage alone.
    const made = await call("POST", "products", full, { title: "Import draft", prices: { NO: "99" }, stock: 1, variants: [{ sku: `IMP-${run}` }] });
    const [draft] = await db().execute<Row>(sql`select handle from commerce.products where id = ${made.body.data.id}::uuid`);
    const draftFile = `handle,title,sku\n${String(draft.handle)},Retitled ${run},IMP-${run}\n`;
    // An import checked by a token with the power (or in the admin) is not a check of drafts only: checked again, with this token.
    const theirs = await check(editor, draftFile);
    const notMine = await call("POST", `jobs/${theirs.id}/apply`, importer.token, {});
    expect(notMine.status).toBe(403);
    expect(notMine.body.error.message).toContain("Check it again");
    expect((await call("GET", `jobs/${theirs.id}`, editor)).body.data.status).toBe("checked");
    const { cancelJob } = await import("./data-jobs");
    await cancelJob(store.member, theirs.id as string);
    const drafts = await check(importer.token, draftFile);
    expect(drafts.counts).toMatchObject({ dry: { toUpdate: 1, onShop: 0 } });
    expect((await call("POST", `jobs/${drafts.id}/apply`, importer.token, {})).status).toBe(200);
    await runJob(drafts.id as string, { storage, schedule: () => undefined, budgetMs: 60_000 });
    expect(await titleOf(made.body.data.id)).toContain(`Retitled ${run}`);

    // A draft that went on the site between the check and the apply is left as it is: the apply plans it again, of drafts only.
    await db().execute(sql`update commerce.products set status = 'draft' where id = ${String(live.id)}::uuid`);
    const raced = await check(importer.token, `handle,title,sku\n${String(live.handle)},Raced ${run},${String(live.sku)}\n`);
    expect(raced.counts).toMatchObject({ dry: { toUpdate: 1, onShop: 0 } });
    await db().execute(sql`update commerce.products set status = 'active' where id = ${String(live.id)}::uuid`);
    expect((await call("POST", `jobs/${raced.id}/apply`, importer.token, {})).status).toBe(200);
    await runJob(raced.id as string, { storage, schedule: () => undefined, budgetMs: 60_000 });
    expect(await titleOf(String(live.id))).not.toContain(`Raced ${run}`);
    const [item] = await db().execute<Row>(sql`select outcome, messages from commerce.data_job_items where job_id = ${raced.id as string}::uuid and kind = 'product'`);
    expect(item.outcome).toBe("skipped");
    expect(JSON.stringify(item.messages)).toContain("product.on_site");
    const [still] = await db().execute<Row>(sql`select status from commerce.products where id = ${String(live.id)}::uuid`);
    expect(still.status).toBe("active");

    // The product file's upload address is answered once, as a picture's is.
    const once = { "idempotency-key": `import-${run}` };
    const first = await call("POST", "jobs/product-imports", importer.token, { file_name: "again.csv" }, once);
    expect(first.body.data.upload_url).toEqual(expect.any(String));
    const again = await call("POST", "jobs/product-imports", importer.token, { file_name: "again.csv" }, once);
    expect(again.body.data).toMatchObject({ upload_id: first.body.data.upload_id, upload_url: null });
  });

  it("exports and imports the product file as jobs of the Data page", async () => {
    const exported = await call("POST", "jobs/product-exports", editor, {});
    expect(exported.status, JSON.stringify(exported.body)).toBe(201);
    expect(exported.body.data.file?.csv ?? "").toContain(SKU);
    const csv = (exported.body.data.file.csv as string).split("\n").slice(0, 2).join("\n");
    const started = await call("POST", "jobs/product-imports", editor, { file_name: "products.csv" });
    expect(started.status).toBe(201);
    const upload = started.body.data.upload_id as string;
    await storage.upload("imports", `${store.storeId}/${upload}/products.csv`, new TextEncoder().encode(csv), "text/csv");
    const checked = await call("POST", `jobs/product-imports/${upload}/check`, editor, { file_name: "products.csv" });
    expect(checked.status, JSON.stringify(checked.body)).toBe(201);
    expect(["checking", "checked"]).toContain(checked.body.data.status);
    const { runJob } = await import("./data-jobs");
    await runJob(checked.body.data.id, { storage, schedule: () => undefined, budgetMs: 60_000 });
    const polled = await call("GET", `jobs/${checked.body.data.id}`, editor);
    expect(polled.body.data).toMatchObject({ kind: "product_import", status: "checked" });
    const applied = await call("POST", `jobs/${checked.body.data.id}/apply`, editor, {});
    expect([200, 409]).toContain(applied.status);
    const download = await call("GET", `jobs/${checked.body.data.id}/download`, editor);
    expect(download.body.data.parts).toEqual([]);
    expect((await call("POST", "jobs/product-imports/00000000-0000-4000-8000-000000000000/check", editor, { file_name: "products.csv" })).status).toBe(422);
    expect((await call("GET", "jobs/00000000-0000-4000-8000-000000000000", editor)).status).toBe(404);
  });
});

describe("a token made before D440 (D440 review)", () => {
  it("calls what it could call then, and nothing D440 added beyond reading its own areas", async () => {
    // `full` holds the five writes of D355: products, inventory, orders, customers and discounts.
    const order = await place(store.storeId, [[SKU, 1]]);
    const [customer] = await db().execute<Row>(sql`select id from commerce.customers where store_id = ${store.storeId}::uuid limit 1`);
    const [discount] = await db().execute<Row>(sql`select id from commerce.discount_codes where store_id = ${store.storeId}::uuid limit 1`);
    const refusals: [string, "POST" | "PATCH", string, unknown][] = [
      ["products:manage", "POST", "categories", { name: "Old token" }],
      ["products:manage", "POST", "media/uploads", { content_type: "image/png", size_bytes: 10 }],
      ["products:manage", "POST", "jobs/product-imports", { file_name: "products.csv" }],
      ["orders:manage", "POST", "drafts", {}],
      ["orders:manage", "POST", `orders/${order.orderId}/notes`, { note: "Old token" }],
      ["orders:refund", "POST", `orders/${order.orderId}/cancel`, {}],
      ["customers:manage", "POST", "customers", { email: `old-${Date.now()}@example.com` }],
      ["customers:manage", "PATCH", `customers/${String(customer.id)}`, { name: "Old token" }],
      ["discounts:publish", "PATCH", `discounts/${String(discount.id)}`, { percent: 50 }],
    ];
    for (const [scope, method, path, body] of refusals) {
      const answer = await call(method, path, full, body);
      expect(answer.status, path).toBe(403);
      expect(answer.body.error.message, path).toContain(scope);
    }
    // What it could do then, it still does; what D440 added to its areas it may read.
    expect((await call("POST", `orders/${order.orderId}/fulfillments`, full, {})).status).not.toBe(403);
    expect((await call("GET", "categories", full)).status).toBe(200);
    expect((await call("GET", `orders/${order.orderId}/notes`, full)).status).toBe(200);
  });
});

describe("every operation's answer (D438)", () => {
  it("is parsed with its contract, the documents and orders of another store included", async () => {
    const order = await place(store.storeId, [[SKU, 1]], fi);
    await pay(store.storeId, order, store.account);
    expect((await call("GET", `orders/${order.orderId}`, full)).status).toBe(200);
    expect((await call("GET", "customers?limit=2", full)).status).toBe(200);
    // An invoice and a credit note as UBL need a seller with its details: the invoices' own fixture makes one.
    const fx = await import("./invoice-test-fixture");
    const seller = await fx.makeStore("apiubl");
    const paid = await fx.paidOrder(seller, [[SKU, 2]]);
    const invoice = (await fx.invoiceOf(seller.storeId, paid.orderId))!;
    await db().execute(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
      select p.store_id, p.id, 1000, 'Skadet', ${`re_api_${paid.orderId.slice(0, 8)}`}, 'succeeded' from commerce.payments p
      where p.store_id = ${seller.storeId}::uuid and p.order_id = ${paid.orderId}::uuid and p.status = 'captured' limit 1
    `);
    const [note] = await fx.notesOf(seller.storeId, paid.orderId);
    const reader = await makeApiToken(await fx.ownerOf(seller), { name: "Accounts", scopes: ["orders:read"] });
    if (!reader.ok) throw new Error(reader.problem);
    const ubl = await call("GET", `invoices/${invoice.id}/ubl`, reader.token);
    expect(ubl.status).toBe(200);
    expect(ubl.body.data.xml).toContain(invoice.documentNumber);
    expect((await call("GET", `credit-notes/${note.id}/ubl`, reader.token)).status).toBe(200);
    expect([...parsed].sort()).toEqual(Object.keys(ADMIN_API_BY_NAME).sort());
  });
});
