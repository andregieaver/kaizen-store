import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret, parseKey } from "@/lib/secret-box";

import type { Membership } from "./auth";
import { depsWith, fakeStorage, membersOf, runToEnd } from "./data-test-support";
import { makeStore, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
process.env.SETTINGS_ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.SHOPIFY_CLIENT_ID = "kaizentestclient0001";
process.env.SHOPIFY_CLIENT_SECRET = "shpss_test_secret_for_kaizen";

const copy = await import("./shopify-copy");
const { copyDone, copyReady } = await import("@/lib/shopify-copy");

type Row = Record<string, unknown>;

/**
 * *Copy my shop* (D445 step 4) end to end against a stand-in Shopify and the real imports: the shop is read one bulk operation at a time,
 * each read becomes Shopify's own file and the import's dry run, nothing is saved until *Bring it over*, then the imports save products,
 * customers, past orders (tied to the customer by email) and redirects in that order, through their own writers. A feed Shopify refuses
 * says so and the rest goes on; a second tick while one holds the lease does nothing.
 */

let fx: Fixture;
let owner: Membership;
const SHOP = "kaizen-copy.myshopify.com";
const storage = fakeStorage();
const data = depsWith(storage);
let email = "";

const lines = (...objects: object[]) => objects.map((o) => JSON.stringify(o)).join("\n");

const files = (): Record<string, string> => ({
  products: lines(
    { id: "gid://shopify/Product/1", handle: "copied-wool-hat", title: "Wool hat", descriptionHtml: "<p>Warm</p>", tags: ["wool"], status: "ACTIVE", isGiftCard: false, seo: {}, options: [{ name: "Size", position: 1 }] },
    { id: "gid://shopify/ProductVariant/11", sku: "COPY-HAT-S", price: "299.00", compareAtPrice: null, inventoryQuantity: 5, position: 1, selectedOptions: [{ name: "Size", value: "S" }], image: null, inventoryItem: { requiresShipping: true, unitCost: null, measurement: { weight: { value: 200, unit: "GRAMS" } } }, __parentId: "gid://shopify/Product/1" },
  ),
  customers: lines({ id: "gid://shopify/Customer/5", firstName: "Kari", lastName: "Nordmann", tags: [], defaultEmailAddress: { emailAddress: email }, defaultPhoneNumber: null, defaultAddress: { address1: "Gata 1", city: "Oslo", zip: "0150", countryCodeV2: "NO" } }),
  orders: lines(
    { id: "gid://shopify/Order/9", name: "#1001", email, createdAt: "2026-10-01T10:00:00Z", cancelledAt: null, currencyCode: "NOK", displayFinancialStatus: "PAID", displayFulfillmentStatus: "FULFILLED", discountCodes: [], subtotalPriceSet: { shopMoney: { amount: "299.0" } }, totalShippingPriceSet: { shopMoney: { amount: "0.0" } }, totalTaxSet: { shopMoney: { amount: "59.8" } }, totalDiscountsSet: { shopMoney: { amount: "0.0" } }, totalPriceSet: { shopMoney: { amount: "299.0" } }, billingAddress: null, shippingAddress: null },
    { name: "Wool hat - S", sku: "COPY-HAT-S", quantity: 1, originalUnitPriceSet: { shopMoney: { amount: "299.0" } }, __parentId: "gid://shopify/Order/9" },
  ),
  redirects: lines({ id: "gid://shopify/UrlRedirect/3", path: "/pages/old-about", target: "/pages/about" }),
  collections: lines({ id: "gid://shopify/Collection/1", handle: "hats", title: "Hats" }, { handle: "copied-wool-hat", __parentId: "gid://shopify/Collection/1" }),
  pages: lines({ id: "gid://shopify/Page/1", handle: "our-story", title: "Our story", body: "<h1>Since 1990</h1><p>We knit <strong>by hand</strong>.</p><img src='x.jpg'>", isPublished: true }),
  articles: lines({ id: "gid://shopify/Article/1", handle: "winter-is-here", title: "Winter is here", body: "<p>Time for hats.</p>", isPublished: true, author: { name: "Kari" }, blog: { handle: "news", title: "News" } }),
});

let refuse = new Set<string>();
const started: string[] = [];

/** Shopify: a bulk read per query (its feed told by the query's first connection), finished at the first poll; the shop's currency and VAT. */
const shopify = (async (_input: string | URL | Request, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body)) as { query: string; variables?: Record<string, string> };
  const reply = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200, headers: { "content-type": "application/json" } });
  if (body.query.includes("KaizenCopyShop")) return reply({ shop: { currencyCode: "NOK", taxesIncluded: true } });
  if (body.query.includes("KaizenBulkRun")) {
    const q = body.variables?.query ?? "";
    const feed = /urlRedirects/.test(q) ? "redirects" : /\{ orders/.test(q) ? "orders" : /\{ customers/.test(q) ? "customers" : /\{ collections/.test(q) ? "collections" : /\{ pages/.test(q) ? "pages" : /\{ articles/.test(q) ? "articles" : "products";
    if (refuse.has(feed)) return reply({ bulkOperationRunQuery: { bulkOperation: null, userErrors: [{ field: null, message: "Access denied for customers field." }] } });
    started.push(feed);
    return reply({ bulkOperationRunQuery: { bulkOperation: { id: `gid://shopify/BulkOperation/${started.length}`, status: "CREATED" }, userErrors: [] } });
  }
  if (body.query.includes("KaizenMenus"))
    return reply({ menus: { nodes: [{ handle: "main-menu", title: "Copied main menu", items: [{ title: "Hats", type: "COLLECTION", url: "/collections/hats", items: [] }, { title: "Our story", type: "PAGE", url: "/pages/our-story", items: [] }, { title: "News", type: "BLOG", url: "/blogs/news", items: [] }] }] } });
  if (body.query.includes("KaizenBulkPoll")) {
    const n = Number(String(body.variables?.id).split("/").pop());
    return reply({ node: { status: "COMPLETED", errorCode: null, url: `https://bulk.example/${started[n - 1]}` } });
  }
  return new Response("not found", { status: 404 });
}) as typeof fetch;

const deps = { fetch: shopify, data, download: async (url: string) => ({ ok: true as const, text: files()[url.split("/").pop()!] ?? "" }) };

/** Ticks until nothing moves on its own, running every import job the ticks started (as the five-minute job would). */
async function settle(member: Membership, max = 20): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    const state = await copy.advanceCopy(member, deps);
    for (const f of Object.values(state?.feeds ?? {})) if (f.job && (f.stage === "checking" || f.stage === "applying")) await runToEnd(f.job, data);
    const after = await copy.advanceCopy(member, deps);
    if (after && Object.values(after.feeds).every((f) => !["waiting", "reading", "checking", "applying"].includes(f.stage)) && (!after.apply || copyDone(after))) return;
  }
}

const stateRow = async () => (await db().execute<Row>(sql`select copy from commerce.shop_moves where store_id = ${fx.storeId}::uuid`))[0]?.copy as Row;

beforeAll(async () => {
  fx = await makeStore("shopify-copy");
  ({ owner } = await membersOf(fx));
  email = `kari-${fx.slug}@example.com`;
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
  await db().execute(sql`
    insert into commerce.shop_moves (store_id, source, shop_domain, shop_name, status, scopes, access_token, connected_by, connected_at)
    values (${fx.storeId}::uuid, 'shopify', ${SHOP}, 'Kaizen Copy', 'connected', 'read_products', ${encryptSecret("shpca_copy", key)}, ${owner.account.id}::uuid, now())
  `);
});

afterAll(async () => {
  await closeDb();
});

describe("copying a Shopify shop", () => {
  it("reads one feed at a time into the imports' dry runs, and saves nothing before Bring it over", async () => {
    expect(await copy.startCopy(owner)).toEqual({ ok: true });
    await settle(owner);
    expect(started).toEqual(["products", "collections", "customers", "orders", "pages", "articles", "redirects"]);
    const view = (await copy.copyView(owner))!;
    expect(Object.fromEntries(Object.entries(view.state.feeds).map(([k, v]) => [k, [v.stage, v.count]]))).toEqual({
      products: ["checked", 1],
      collections: ["checked", 1],
      customers: ["checked", 1],
      orders: ["checked", 1],
      pages: ["checked", 1],
      articles: ["checked", 1],
      menus: ["checked", 1],
      redirects: ["checked", 1],
    });
    expect(copyReady(view.state)).toBe(true);
    expect(view.jobs.products?.inputName).toBe("shopify-products.csv");
    expect(view.jobs.products?.options).toMatchObject({ pricesIncludeVat: true, priceMarket: "NO", redirects: true });
    const [{ n }] = await db().execute<Row>(sql`select count(*)::int as n from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'copied-wool-hat'`);
    expect(n).toBe(0);
  });

  it("brings everything over in order, through the imports, the order tied to its customer by email", async () => {
    expect(await copy.bringItOver(owner)).toEqual({ ok: true });
    await settle(owner);
    const view = (await copy.copyView(owner))!;
    expect(Object.values(view.state.feeds).map((f) => f.stage)).toEqual(["done", "done", "done", "done", "done", "done", "done", "done"]);
    expect(copyDone(view.state)).toBe(true);
    const [product] = await db().execute<Row>(sql`select handle from commerce.products where store_id = ${fx.storeId}::uuid and handle = 'copied-wool-hat'`);
    expect(product?.handle).toBe("copied-wool-hat");
    const [customer] = await db().execute<Row>(sql`select id from commerce.customers where store_id = ${fx.storeId}::uuid and lower(email) = ${email}`);
    expect(customer).toBeDefined();
    const [order] = await db().execute<Row>(sql`select number, customer_id, copied_from from commerce.orders where store_id = ${fx.storeId}::uuid and number = 'C-1001'`);
    expect([order?.number, order?.customer_id, order?.copied_from === null]).toEqual(["C-1001", customer.id, false]);
    const [redirect] = await db().execute<Row>(sql`select target from commerce.redirects where store_id = ${fx.storeId}::uuid and source = '/pages/old-about'`);
    expect(redirect?.target).toBe("/pages/about");
    const [productRedirect] = await db().execute<Row>(sql`select 1 as x from commerce.redirects where store_id = ${fx.storeId}::uuid and source = '/products/copied-wool-hat'`);
    expect(productRedirect).toBeDefined();
    // The collection is a category with its product in it, through the product import.
    const [category] = await db().execute<Row>(sql`
      select t.slug, (select count(*)::int from commerce.product_terms pt join commerce.products p on p.id = pt.product_id where pt.term_id = t.id and p.handle = 'copied-wool-hat') as n
      from commerce.terms t where t.store_id = ${fx.storeId}::uuid and t.kind = 'category' and t.name = 'Hats'
    `);
    expect([category?.slug, category?.n]).toEqual(["hats", 1]);
    // The page and the post through the page editor's writer, their HTML as its rich text; the post in the main blog with its author.
    const [page] = await db().execute<Row>(sql`select published -> 'rows' as rows, published_at from commerce.pages where store_id = ${fx.storeId}::uuid and type = 'page' and slug = 'our-story'`);
    expect(page?.published_at).not.toBeNull();
    const blockDoc = (page!.rows as Row[])[0] as { columns: { blocks: { doc: unknown }[] }[] };
    expect(blockDoc.columns[0].blocks[0].doc).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Since 1990" }] },
        { type: "paragraph", content: [{ type: "text", text: "We knit " }, { type: "text", text: "by hand", marks: [{ type: "bold" }] }, { type: "text", text: "." }] },
      ],
    });
    const [post] = await db().execute<Row>(sql`select published ->> 'author' as author, published ->> 'blogId' as blog from commerce.pages where store_id = ${fx.storeId}::uuid and type = 'article' and slug = 'winter-is-here'`);
    expect([post?.author, post?.blog ?? null]).toEqual(["Kari", null]);
    // The menu through the menu editor's writer, linked to the category, the page and the blog.
    const [menu] = await db().execute<Row>(sql`select items from commerce.menus where store_id = ${fx.storeId}::uuid and name = 'Copied main menu'`);
    expect((menu!.items as Row[]).map((i) => i.link)).toEqual([{ kind: "category", slug: "hats" }, { kind: "page", slug: "our-story" }, { kind: "blog" }]);
  });

  it("says when Shopify refuses a feed and goes on with the rest; a tick while another holds the lease changes nothing", async () => {
    refuse = new Set(["customers"]);
    started.length = 0;
    expect(await copy.startCopy(owner)).toEqual({ ok: true });
    await db().execute(sql`update commerce.shop_moves set copy = jsonb_set(copy, '{lease}', to_jsonb((now() + interval '1 minute')::text)) where store_id = ${fx.storeId}::uuid`);
    const held = await copy.advanceCopy(owner, deps);
    expect(held?.feeds.products.stage).toBe("waiting");
    expect(started).toEqual([]);
    await db().execute(sql`update commerce.shop_moves set copy = copy - 'lease' where store_id = ${fx.storeId}::uuid`);
    await settle(owner);
    const view = (await copy.copyView(owner))!;
    expect([view.state.feeds.customers.stage, view.state.feeds.customers.problem]).toEqual(["failed", "shopify_refused"]);
    expect(view.state.feeds.orders.stage).toBe("checked");
    // A second copy finds the page, the post and the menu already here and does not make them again.
    expect((await stateRow()).lease).toBeUndefined();
    // Start again: the unapplied products import of this copy is cancelled, so a new one can be opened.
    const before = (await copy.copyView(owner))!.state.feeds.products.job!;
    refuse = new Set();
    expect(await copy.startCopy(owner)).toEqual({ ok: true });
    const [{ status }] = await db().execute<Row>(sql`select status from commerce.data_jobs where id = ${before}::uuid`);
    expect(status).toBe("cancelled");
    await settle(owner);
    expect((await copy.copyView(owner))!.state.feeds.products.stage).toBe("checked");
  });

  it("is the owner's alone", async () => {
    const { admin } = await membersOf(fx);
    expect(await copy.startCopy(admin)).toEqual({ ok: false });
    expect(await copy.advanceCopy(admin, deps)).toBeNull();
    expect(await copy.copyView(admin)).toBeNull();
  });
});
