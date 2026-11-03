import { randomUUID } from "node:crypto";

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
    const w = await makeApiToken(store.member, { name: "Catalogue", scopes: ["products:write"] });
    const p = await makeApiToken(store.member, { name: "Publisher", scopes: ["products:write", "products:publish"] });
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
    const renamed = await call("PATCH", `categories/${id}`, writer, { name: "Mugs and cups" });
    expect(renamed.body.data).toMatchObject({ name: "Mugs and cups", slug: category.body.data.slug });
    const placed = await call("POST", `categories/${id}/products`, writer, { product_id: draftId });
    expect(placed.status).toBe(201);
    expect(placed.body.data).toEqual({ term_id: id, product_id: draftId, placed: true });
    expect((await call("GET", `categories/${id}`, readOnly)).body.data.products).toBe(1);
    expect((await call("DELETE", `categories/${id}/products/${draftId}`, writer)).body.data.placed).toBe(false);
    expect((await call("GET", `categories/${id}`, readOnly)).body.data.products).toBe(0);
    expect((await call("DELETE", `categories/${child.body.data.id}`, writer)).body.data).toEqual({ id: child.body.data.id, deleted: true });
    expect((await call("GET", `categories/${child.body.data.id}`, readOnly)).status).toBe(404);

    const tag = await call("POST", "tags", writer, { name: `Gift ${Date.now()}` });
    expect(tag.status).toBe(201);
    const tagId = tag.body.data.id as string;
    expect((await call("GET", "tags", readOnly)).body.data.map((t: Answer) => t.id)).toContain(tagId);
    expect((await call("GET", `tags/${tagId}`, readOnly)).body.data.kind).toBe("tag");
    expect((await call("PATCH", `tags/${tagId}`, writer, { slug: `gift-${Date.now()}` })).status).toBe(200);
    expect((await call("POST", `tags/${tagId}/products`, writer, { product_id: draftId })).status).toBe(201);
    expect((await call("DELETE", `tags/${tagId}/products/${draftId}`, writer)).status).toBe(200);
    expect((await call("DELETE", `tags/${tagId}`, writer)).status).toBe(200);
    // A category of the tags, or of another store, is not found.
    expect((await call("GET", `tags/${id}`, readOnly)).status).toBe(404);
    const [theirs] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, name, slug) values (${other.storeId}::uuid, 'product', 'category', 'Theirs', ${`theirs-${Date.now()}`}) returning id
    `);
    expect((await call("GET", `categories/${String(theirs.id)}`, readOnly)).status).toBe(404);
    expect((await call("POST", `categories/${String(theirs.id)}/products`, writer, { product_id: draftId })).status).toBe(404);
    expect((await call("DELETE", `categories/${id}`, writer)).status).toBe(200);
    // Every change in the token's name.
    const audit = await db().execute<Row>(sql`
      select action from commerce.audit_log where store_id = ${store.storeId}::uuid and details ->> 'token' = 'Catalogue' and action like 'integration.api_%' order by created_at
    `);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["integration.api_category_created", "integration.api_product_placed", "integration.api_product_unplaced", "integration.api_tag_deleted"]));
  });

  it("takes a picture through a one-time upload, checks it as the library does, and puts it in a product's gallery", async () => {
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "#c33" } }).png().toBuffer();
    expect((await call("POST", "media/uploads", writer, { content_type: "image/gif", size_bytes: 10 })).status).toBe(422);
    const started = await call("POST", "media/uploads", writer, { content_type: "image/png", size_bytes: png.byteLength });
    expect(started.status).toBe(201);
    expect(started.body.data.upload_url).toContain("api-uploads");
    const uploadId = started.body.data.upload_id as string;
    // Nothing sent yet: refused, and the upload can still be used.
    expect((await call("POST", "media", writer, { upload_id: uploadId })).status).toBe(422);
    await storage.upload("imports", `${store.storeId}/api-uploads/${uploadId}`, new TextEncoder().encode("not a picture"), "image/png");
    expect((await call("POST", "media", writer, { upload_id: uploadId })).body.error.message).toContain("JPEG, PNG, WebP or AVIF");
    await storage.upload("imports", `${store.storeId}/api-uploads/${uploadId}`, new Uint8Array(png), "image/png");
    // Another token's upload is not this one's.
    expect((await call("POST", "media", publisher, { upload_id: uploadId })).status).toBe(404);
    const kept = await call("POST", "media", writer, { upload_id: uploadId, file_name: "red.png", alt: "A red square" });
    expect(kept.status).toBe(201);
    expect(kept.body.data).toMatchObject({ kind: "image", content_type: "image/webp", width: 64, height: 48, alt: "A red square", file_name: "red.webp" });
    expect((await call("POST", "media", writer, { upload_id: uploadId })).status).toBe(409);
    expect(storage.files.has(`imports/${store.storeId}/api-uploads/${uploadId}`)).toBe(false);
    const mediaId = kept.body.data.id as string;
    expect((await call("GET", "media?kind=image", readOnly)).body.data.map((m: Answer) => m.id)).toContain(mediaId);

    const before = (await call("GET", `products/${draftId}/media`, readOnly)).body.data as Answer[];
    const added = await call("POST", `products/${draftId}/media`, writer, { media_id: mediaId });
    expect(added.status).toBe(201);
    expect(added.body.data.at(-1)).toMatchObject({ media_id: mediaId, kind: "image", alt: "A red square" });
    expect((await call("POST", `products/${draftId}/media`, writer, { media_id: mediaId })).status).toBe(409);
    const second = await call("POST", "media/uploads", writer, { content_type: "image/png", size_bytes: png.byteLength });
    await storage.upload("imports", `${store.storeId}/api-uploads/${second.body.data.upload_id}`, new Uint8Array(png), "image/png");
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
    const set = await call("POST", `price-lists/${list.id}/prices`, writer, { rows: [{ sku: SKU, currency: "NOK", amount_minor: 12_900 }, { sku: SKU, currency: "EUR", amount_minor: 1_190 }] });
    expect(set.body.data).toEqual({ set: 2, removed: 0 });
    const prices = await call("GET", `price-lists/${list.id}/prices?limit=1`, readOnly);
    expect(prices.body.data).toHaveLength(1);
    const rest = await call("GET", `price-lists/${list.id}/prices?after=${prices.body.next}`, readOnly);
    expect([...prices.body.data, ...rest.body.data].map((p: Answer) => `${p.currency} ${p.amount_minor}`).sort()).toEqual(["EUR 1190", "NOK 12900"]);
    expect((await call("POST", `price-lists/${list.id}/prices`, writer, { rows: [{ sku: SKU, currency: "USD", amount_minor: 100 }] })).status).toBe(422);
    expect((await call("POST", `price-lists/${list.id}/prices`, writer, { rows: [{ sku: SKU, currency: "EUR", amount_minor: null }] })).body.data).toEqual({ set: 0, removed: 1 });
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
