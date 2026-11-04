import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";
import { depsWith, fakeStorage, membersOf, runToEnd } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";
import type { Fetched } from "./replicate-fetch";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");

const connect = await import("./woocommerce-connect");
const copy = await import("./shopify-copy");
const undo = await import("./shopify-undo");
const { copyDone, copyReady } = await import("@/lib/shopify-copy");

type Row = Record<string, unknown>;

/**
 * Moving from WooCommerce, step 1 (D446) end to end against a stand-in WordPress site and the real imports: *Connect WooCommerce* finds
 * the site by its REST root, WooCommerce posts a read-only key with the sealed note, and the key is kept; *Copy my shop* reads products
 * (with their variations), customers, orders, coupons and reviews a page at a time, each as the file Shopify's export makes, into the imports' dry
 * runs; *Bring it over* saves them through the imports and the discount writer; *Undo this copy* takes them back.
 */

let fx: Fixture;
let owner: Membership;
const storage = fakeStorage();
const data = depsWith(storage);
const KEY = `ck_${"1".repeat(40)}`;
const SECRET = `cs_${"2".repeat(40)}`;
let email = "";
/** The calls the stand-in site saw, as `path?query`, and whether each carried the key. */
const seen: { path: string; key: boolean }[] = [];

const products = () => [
  {
    id: 11,
    type: "simple",
    slug: "woo-wool-hat",
    name: "Wool hat",
    status: "publish",
    description: "<p>Warm</p>",
    price: "299.00",
    sku: "WOO-HAT-1",
    manage_stock: true,
    stock_quantity: 5,
    virtual: false,
    weight: "0.2",
    tags: [],
    categories: [{ id: 3, name: "Hats" }],
    images: [],
    attributes: [],
  },
  {
    id: 12,
    type: "variable",
    slug: "woo-scarf",
    name: "Scarf",
    status: "publish",
    description: "<p>Long</p>",
    tags: [],
    categories: [{ id: 3, name: "Hats" }],
    images: [],
    attributes: [{ name: "Colour", variation: true, options: ["Red", "Blue"] }],
  },
  { id: 13, type: "grouped", slug: "woo-set", name: "Set", status: "publish" },
];
const variations = [
  { id: 120, sku: "WOO-SCARF-R", price: "199.00", manage_stock: true, stock_quantity: 2, menu_order: 1, attributes: [{ name: "Colour", option: "Red" }], virtual: false, weight: "" },
  { id: 121, sku: "WOO-SCARF-B", price: "199.00", manage_stock: true, stock_quantity: 4, menu_order: 2, attributes: [{ name: "Colour", option: "Blue" }], virtual: false, weight: "" },
];
const order = (id: number, status: string) => ({
  id,
  number: String(2000 + id),
  status,
  currency: "NOK",
  date_created_gmt: "2026-10-01T09:30:00",
  date_modified_gmt: "2026-10-01T09:30:00",
  total: "299.00",
  total_tax: "59.80",
  shipping_total: "0.00",
  discount_total: "0.00",
  billing: { first_name: "Kari", last_name: "Nordmann", email, address_1: "Storgata 1", city: "Oslo", postcode: "0150", country: "NO" },
  shipping: {},
  coupon_lines: [],
  line_items: [{ name: "Wool hat", sku: "WOO-HAT-1", quantity: 1, subtotal: "299.00" }],
});

const answer = (body: unknown, headers: Record<string, string> = {}): Fetched => ({
  ok: true,
  url: "https://woo.example/",
  status: 200,
  contentType: "application/json",
  bytes: new TextEncoder().encode(JSON.stringify(body)),
  headers,
});
const list = (items: unknown[]) => answer(items, { "x-wp-total": String(items.length), "x-wp-totalpages": "1" });

/** The stand-in WordPress site with WooCommerce: its REST root open to all, its shop only with the key (Basic, or in the query). */
async function open(raw: string, headers?: Record<string, string>): Promise<Fetched> {
  const url = new URL(raw);
  if (url.host !== "woo.example") return { ok: false, problem: "The site could not be reached." };
  const route = url.pathname.replace(/^\/wp-json\//, "").replace(/\/$/, "");
  const key = headers?.Authorization === `Basic ${Buffer.from(`${KEY}:${SECRET}`).toString("base64")}` || (url.searchParams.get("consumer_key") === KEY && url.searchParams.get("consumer_secret") === SECRET);
  seen.push({ path: `${route}?${url.searchParams}`, key });
  if (url.pathname === "/wp-json/") return answer({ name: "Kari's Woo", url: "https://woo.example", namespaces: ["wp/v2", "wc/v3"] });
  if (!key) return { ok: false, problem: "The site answered 401.", status: 401 };
  const page = Number(url.searchParams.get("page") ?? "1");
  const include = url.searchParams.get("include");
  switch (route) {
    case "wc/v3/settings/general/woocommerce_currency":
      return answer({ id: "woocommerce_currency", value: "NOK" });
    case "wc/v3/settings/tax/woocommerce_prices_include_tax":
      return answer({ id: "woocommerce_prices_include_tax", value: "yes" });
    case "wc/v3/settings/products/woocommerce_weight_unit":
      return answer({ id: "woocommerce_weight_unit", value: "kg" });
    case "wc/v3/products":
      if (include) return list(products().filter((p) => include.split(",").includes(String(p.id))).map((p) => ({ id: p.id, slug: p.slug })));
      return list(page === 1 ? products() : []);
    case "wc/v3/products/12/variations":
      return list(page === 1 ? variations : []);
    case "wc/v3/products/reviews":
      return list(
        page === 1
          ? [
              { id: 1, product_id: 11, status: "approved", reviewer: "Ola N.", rating: 5, review: "<p>Warm &amp; soft.</p>", date_created_gmt: "2026-09-01T10:00:00", verified: true },
              { id: 2, product_id: 12, status: "hold", reviewer: "Kari", rating: 3, review: "<p>Fine.</p>", date_created_gmt: "2026-09-02T10:00:00", verified: false },
              { id: 3, product_id: 11, status: "spam", reviewer: "Spam", rating: 5, review: "buy now", date_created_gmt: "2026-09-03T10:00:00" },
            ]
          : [],
      );
    case "wc/v3/products/categories":
      return list([{ id: 3, name: "Hats" }]);
    case "wc/v3/customers":
      return list(page === 1 ? [{ id: 5, email, first_name: "Kari", last_name: "Nordmann", billing: { address_1: "Storgata 1", city: "Oslo", postcode: "0150", country: "NO" }, shipping: {} }] : []);
    case "wc/v3/orders":
      return list(page === 1 ? [order(1, "completed"), order(2, "pending")] : []);
    case "wc/v3/coupons":
      return list(
        page === 1
          ? [
              { code: "WOOHATS", discount_type: "percent", amount: "15", product_ids: [11], product_categories: [], excluded_product_ids: [], excluded_product_categories: [], email_restrictions: [], free_shipping: false, date_expires_gmt: null },
              { code: "EACHONE", discount_type: "fixed_product", amount: "10", product_ids: [], product_categories: [], excluded_product_ids: [], excluded_product_categories: [], email_restrictions: [], free_shipping: false },
            ]
          : [],
      );
    default:
      return { ok: false, problem: "The site answered 404.", status: 404 };
  }
}

const deps = { open, data };

async function settle(member: Membership, max = 20): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const state = await copy.advanceCopy(member, deps);
    for (const f of Object.values(state?.feeds ?? {})) if (f.job && (f.stage === "checking" || f.stage === "applying")) await runToEnd(f.job, data);
    const after = await copy.advanceCopy(member, deps);
    if (after && Object.values(after.feeds).every((f) => !["waiting", "reading", "checking", "applying"].includes(f.stage)) && (!after.apply || copyDone(after))) return;
  }
}

/** The sealed note in WooCommerce's authorize address, as WooCommerce would post it back. */
const noteOf = (url: string): string => new URL(url).searchParams.get("user_id") ?? "";

beforeAll(async () => {
  fx = await makeStore("woo-copy");
  ({ owner } = await membersOf(fx));
  email = `kari-${fx.slug}@example.com`;
  await db().execute(sql`delete from commerce.shipping_rates where store_id = ${fx.storeId}::uuid`);
  await db().execute(sql`update commerce.markets set active = (code = 'NO') where store_id = ${fx.storeId}::uuid`);
  // Reviews switched on, as the review import needs (step 1b).
  await db().execute(sql`update commerce.stores set features = array_append(features, 'reviews') where id = ${fx.storeId}::uuid and not ('reviews' = any(features))`);
  ({ owner } = await membersOf(fx));
});

afterAll(async () => {
  await closeDb();
});

describe("moving from WooCommerce, step 1", () => {
  it("finds the site by its REST root, and says when it is not WooCommerce", async () => {
    expect(await connect.findWooShop("https://woo.example/", { open })).toEqual({ ok: true, site: { host: "woo.example", path: "" }, root: "wp-json", name: "Kari's Woo" });
    expect(await connect.findWooShop("not an address", { open })).toEqual({ ok: false, problem: "address" });
    expect(await connect.findWooShop("elsewhere.example", { open })).toEqual({ ok: false, problem: "unreachable" });
    const plain = async (raw: string) => (raw.includes("/wp-json/") ? { ok: false as const, problem: "404", status: 404 } : answer({ name: "Blog", namespaces: ["wp/v2"] }));
    expect(await connect.findWooShop("woo.example", { open: plain })).toEqual({ ok: false, problem: "not_woocommerce" });
  });

  it("keeps a read-only key WooCommerce posts with this owner's sealed note, and nothing else", async () => {
    const started = await connect.startWooConnect(owner, "woo.example", { open });
    if (!started.ok) throw new Error(started.problem);
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe("https://woo.example/wc-auth/v1/authorize");
    expect(url.searchParams.get("scope")).toBe("read");
    const note = noteOf(started.url);
    // A key that can write, an altered note, or a key the site does not know: nothing kept.
    expect(await connect.finishWooConnect({ consumer_key: KEY, consumer_secret: SECRET, key_permissions: "read_write", user_id: note }, { open })).toBe(400);
    expect(await connect.finishWooConnect({ consumer_key: KEY, consumer_secret: SECRET, key_permissions: "read", user_id: `${note}x` }, { open })).toBe(400);
    expect(await connect.finishWooConnect({ consumer_key: `ck_${"9".repeat(40)}`, consumer_secret: SECRET, key_permissions: "read", user_id: note }, { open })).toBe(400);
    expect(await connect.wooConnection(owner)).toBeNull();
    expect(await connect.finishWooConnect({ consumer_key: KEY, consumer_secret: SECRET, key_permissions: "read", user_id: note }, { open })).toBe(200);
    expect(await connect.wooConnection(owner)).toMatchObject({ site: "woo.example", name: "Kari's Woo" });
    // Kept encrypted: the key is nowhere in the row as written.
    const [row] = await db().execute<Row>(sql`select access_token, scopes, primary_domain from commerce.shop_moves where store_id = ${fx.storeId}::uuid and source = 'woocommerce'`);
    expect(String(row.access_token)).not.toContain(KEY);
    expect([row.scopes, row.primary_domain]).toEqual(["read", "woo.example"]);
    // A store moves from one shop at a time: Shopify is refused while WooCommerce is connected.
    const shopify = await import("./shopify-connect");
    process.env.SHOPIFY_CLIENT_ID = "kaizentestclient0001";
    process.env.SHOPIFY_CLIENT_SECRET = "shpss_test_secret_for_kaizen";
    expect(await shopify.startShopifyConnect(owner, "kari.myshopify.com")).toEqual({ ok: false, problem: "other_shop" });
  });

  it("reads products with their variations, customers, orders and coupons into the imports' dry runs, and saves nothing yet", async () => {
    expect(await copy.copySource(owner)).toBe("woocommerce");
    seen.length = 0;
    // The owner's one question is asked first (D446 4.5): no copy starts without it.
    expect(await copy.startCopy(owner)).toEqual({ ok: false });
    expect(await copy.startCopy(owner, { wordpress: "keep" })).toEqual({ ok: true });
    await settle(owner);
    const view = (await copy.copyView(owner))!;
    const stages = Object.fromEntries(Object.entries(view.state.feeds).map(([k, v]) => [k, [v.stage, v.count]]));
    expect(stages).toMatchObject({
      products: ["checked", 2],
      collections: ["checked", 1],
      customers: ["checked", 1],
      orders: ["checked", 1],
      discounts: ["checked", 2],
      reviews: ["checked", 2],
      pages: ["empty", 0],
      redirects: ["empty", 0],
      subscribers: ["empty", 0],
      gift_cards: ["empty", 0],
    });
    expect(copyReady(view.state)).toBe(true);
    expect(view.jobs.products?.inputName).toBe("woocommerce-products.csv");
    // WooCommerce's own answers on VAT and currency.
    expect(view.jobs.products?.options).toMatchObject({ pricesIncludeVat: true, priceMarket: "NO" });
    // Every call the copy made to the shop carried the key.
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.filter((s) => !s.key)).toEqual([]);
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle like 'woo-%'`);
    expect(n).toBe(0);
  });

  it("brings them over through the imports and the discount writer, the order tied to its customer by email", async () => {
    expect(await copy.bringItOver(owner)).toEqual({ ok: true });
    await settle(owner);
    const view = (await copy.copyView(owner))!;
    expect(copyDone(view.state)).toBe(true);
    expect(view.state.feeds.discounts).toMatchObject({ stage: "done", made: 1, refused: 1 });
    const variants = await db().execute<Row>(sql`
      select p.handle, v.sku from commerce.products p join commerce.product_variants v on v.product_id = p.id
       where p.store_id = ${fx.storeId}::uuid and p.handle like 'woo-%' order by v.sku`);
    expect(variants.map((r) => [r.handle, r.sku])).toEqual([
      ["woo-wool-hat", "WOO-HAT-1"],
      ["woo-scarf", "WOO-SCARF-B"],
      ["woo-scarf", "WOO-SCARF-R"],
    ]);
    // The grouped product stays on WooCommerce: its products come on their own.
    const [grouped] = await db().execute<Row>(sql`select 1 as x from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'woo-set'`);
    expect(grouped).toBeUndefined();
    const [category] = await db().execute<Row>(sql`
      select (select count(*)::int from commerce.product_terms pt join commerce.products p on p.id = pt.product_id where pt.term_id = t.id and p.handle like 'woo-%') as n
      from commerce.terms t where t.store_id = ${fx.storeId}::uuid and t.kind = 'category' and t.name = 'Hats'`);
    expect(category?.n).toBe(2);
    const [customer] = await db().execute<Row>(sql`select id from commerce.customers where store_id = ${fx.storeId}::uuid and lower(email) = ${email}`);
    expect(customer).toBeDefined();
    const orders = await db().execute<Row>(sql`select number, customer_id from commerce.orders where store_id = ${fx.storeId}::uuid and copied_from is not null`);
    // The paid order only; the one never paid for stays on WooCommerce.
    expect(orders.map((o) => [o.number, o.customer_id])).toEqual([["C-2001", customer.id]]);
    const [code] = await db().execute<Row>(sql`select code, active from commerce.discount_codes where store_id = ${fx.storeId}::uuid and code = 'WOOHATS'`);
    expect([code?.code, code?.active]).toEqual(["WOOHATS", false]);
    // Reviews through the review import: the one shown on WooCommerce published, the one waiting there waiting, never verified here; spam left.
    const reviews = await db().execute<Row>(sql`
      select p.handle, r.source, r.status, r.author_name, r.rating, r.body, r.imported_from, r.written_on::text as written_on, r.order_id
        from commerce.product_reviews r join commerce.products p on p.id = r.product_id
       where r.store_id = ${fx.storeId}::uuid order by r.author_name`);
    expect(reviews).toEqual([
      { handle: "woo-scarf", source: "import", status: "pending", author_name: "Kari", rating: 3, body: "Fine.", imported_from: "WooCommerce", written_on: "2026-09-02", order_id: null },
      { handle: "woo-wool-hat", source: "import", status: "published", author_name: "Ola N.", rating: 5, body: "Warm & soft.", imported_from: "WooCommerce", written_on: "2026-09-01", order_id: null },
    ]);
    expect(view.state.feeds.reviews).toMatchObject({ stage: "done", made: 2, refused: 0 });
  });

  it("takes the copy back with Undo this copy, and forgets the key on Disconnect", async () => {
    const before = await undo.undoView(owner);
    expect(before?.allowed).toBe(true);
    const result = await undo.undoCopy(owner);
    expect(result).toMatchObject({ ok: true });
    const [{ live }] = await db().execute<Row>(sql`select count(*)::int as live from commerce.products where store_id = ${fx.storeId}::uuid and handle like 'woo-%' and status <> 'archived'`);
    expect(live).toBe(0);
    const [{ orders }] = await db().execute<Row>(sql`select count(*)::int as orders from commerce.orders where store_id = ${fx.storeId}::uuid and copied_from is not null`);
    expect(orders).toBe(0);
    const [{ reviews }] = await db().execute<Row>(sql`select count(*)::int as reviews from commerce.product_reviews where store_id = ${fx.storeId}::uuid`);
    expect(reviews).toBe(0);
    // The copy starts afresh; the connection stays until the owner disconnects.
    expect((await copy.copyView(owner))?.state.startedAt).toBeNull();
    expect(await connect.disconnectWoo(owner)).toEqual({ ok: true });
    expect(await connect.wooConnection(owner)).toBeNull();
    const [row] = await db().execute<Row>(sql`select status, access_token from commerce.shop_moves where store_id = ${fx.storeId}::uuid and source = 'woocommerce'`);
    expect([row.status, row.access_token]).toEqual(["disconnected", null]);
  });
});
