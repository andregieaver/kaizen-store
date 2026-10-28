import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const route = await import("@/app/api/ucp/[store]/mcp/route");
const profileRoute = await import("@/app/s/[store]/.well-known/ucp/route");
const agentsRoute = await import("@/app/s/[store]/agents.md/route");
const { setShoppingAgents } = await import("./shopping-agent-settings");
const { newStore, place, pay, variantId } = await import("./inventory-test-support");
const { runReport } = await import("./report-query");
const { getStore } = await import("./stores");
const { blankSpec } = await import("@/lib/report-catalogue");
const { variantGid } = await import("@/lib/shopping-agents");

type Row = Record<string, unknown>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * Shopping agents (wave 8 unit I, D353): the store's MCP endpoint and UCP profile answer only while it serves agents; prices are the
 * storefront's with VAT (in euro for Finland); a cart is handed to the store's checkout and nothing is ordered; an order from an agent's cart
 * counts in the AI agents' channel.
 */

let store: Awaited<ReturnType<typeof newStore>>;
const FI_PRICE = 1_990;
const SKU = "DEMO-MUG-WHITE";

const call = async (body: unknown, headers: Record<string, string> = {}) => {
  const response = await route.POST(
    new Request("https://kaizenaflow.example/api/ucp/x/mcp", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": "203.0.113.7", ...headers } }),
    { params: Promise.resolve({ store: store.slug }) } as never,
  );
  return { status: response.status, body: (await response.json()) as Answer };
};
const tool = async (name: string, args: Record<string, unknown>) => (await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } })).body.result;

beforeAll(async () => {
  store = await newStore("agents");
  // Selling in more than one country is a feature of its own (D178): Finland is offered only with it on.
  await db().execute(sql`
    update commerce.stores set status = 'active', private_mode = false, locales = array['nb-NO', 'en-GB'],
      features = array(select distinct unnest(features || array['countries']::text[]))
    where id = ${store.storeId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values (${store.storeId}::uuid, 'FI', 'EUR', 'en-GB', array['en-GB'], true)
  `);
  await db().execute(sql`select commerce.set_price(${await variantId(store.storeId, SKU)}::uuid, 'FI', ${FI_PRICE}, now())`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("the store's switch", () => {
  it("answers nothing while the store does not serve shopping agents", async () => {
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(404);
    expect((await profileRoute.GET(new Request("https://x/"), { params: Promise.resolve({ store: store.slug }) } as never)).status).toBe(404);
    const md = await (await agentsRoute.GET(new Request("https://x/"), { params: Promise.resolve({ store: store.slug }) } as never)).text();
    expect(md).toContain("does not take requests from shopping agents");
  });

  it("serves the profile, agents.md and the tools once switched on, and stops again for a private store or one that shuts AI assistants out", async () => {
    expect(await setShoppingAgents(store.storeId, store.accountId, true)).toBe(true);
    const profile = (await (await profileRoute.GET(new Request("https://x/"), { params: Promise.resolve({ store: store.slug }) } as never)).json()) as Answer;
    expect(profile.ucp.services["dev.ucp.shopping"][0].endpoint).toContain(`/api/ucp/${store.slug}/mcp`);
    const md = await (await agentsRoute.GET(new Request("https://x/"), { params: Promise.resolve({ store: store.slug }) } as never)).text();
    expect(md).toContain(`/api/ucp/${store.slug}/mcp`);
    const listed = await call({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(listed.body.result.tools.map((t: Answer) => t.name)).toEqual(["search_catalog", "lookup_catalog", "get_product", "create_cart"]);

    await db().execute(sql`update commerce.stores set private_mode = true where id = ${store.storeId}::uuid`);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(404);
    await db().execute(sql`update commerce.stores set private_mode = false, seo = jsonb_set(coalesce(seo, '{}'::jsonb), '{aiAssistants}', 'false') where id = ${store.storeId}::uuid`);
    expect((await call({ jsonrpc: "2.0", id: 1, method: "tools/list" })).status).toBe(404);
    await db().execute(sql`update commerce.stores set seo = jsonb_set(seo, '{aiAssistants}', 'true') where id = ${store.storeId}::uuid`);
  });
});

describe("the catalog tools", () => {
  it("finds products with the storefront's prices with VAT, in the country's own currency", async () => {
    const found = await tool("search_catalog", { catalog: { query: "" } });
    expect(found.structuredContent.ucp.version).toBe("2026-08-25");
    expect(found.structuredContent.products.length).toBeGreaterThan(0);
    const [price] = await db().execute<Row>(sql`
      select cp.amount_minor::int as amount from commerce.current_prices cp where cp.variant_id = ${await variantId(store.storeId, SKU)}::uuid and cp.market_code = 'NO'
    `);
    const mug = await tool("get_product", { catalog: { id: variantGid(await variantId(store.storeId, SKU)) } });
    if (!mug.structuredContent) throw new Error(JSON.stringify(mug));
    const variant = mug.structuredContent.product.variants.find((v: Answer) => v.sku === SKU);
    expect(variant.price).toEqual({ amount: Number(price.amount), currency: "NOK" });
    expect(variant.availability).toEqual({ available: expect.any(Boolean) });
    const fi = await tool("get_product", { catalog: { id: variantGid(await variantId(store.storeId, SKU)), context: { address_country: "FI" } } });
    expect(fi.structuredContent.product.variants.find((v: Answer) => v.sku === SKU).price).toEqual({ amount: FI_PRICE, currency: "EUR" });
    const elsewhere = await tool("search_catalog", { catalog: { query: "", context: { address_country: "US" } } });
    expect(elsewhere.isError).toBe(true);
    const looked = await tool("lookup_catalog", { catalog: { ids: [mug.structuredContent.product.id] } });
    expect(looked.structuredContent.products.map((p: Answer) => p.id)).toEqual([mug.structuredContent.product.id]);
  });

  it("hands a cart to the store's checkout, marked as an agent's, and orders nothing", async () => {
    const [before] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    const cart = await tool("create_cart", { cart: { line_items: [{ item: { id: variantGid(await variantId(store.storeId, SKU)) }, quantity: 2 }] } });
    const answer = cart.structuredContent;
    expect(answer.continue_url).toMatch(/\/cart\/resume\?t=/);
    expect(answer.line_items[0].quantity).toBe(2);
    expect(answer.currency).toBe("NOK");
    const [row] = await db().execute<Row>(sql`select source, handoff_hash is not null as handed from commerce.carts where id = ${answer.id}::uuid`);
    expect(row).toMatchObject({ source: "agent", handed: true });
    const [after] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`);
    expect(after.n).toBe(before.n);
    expect((await tool("create_cart", { cart: { line_items: [] } })).isError).toBe(true);
  });
});

describe("attribution", () => {
  it("counts an order from an agent's cart in the AI agents' channel", async () => {
    const order = await place(store.storeId, [[SKU, 1]]);
    await db().execute(sql`update commerce.carts set source = 'agent' where id = (select cart_id from commerce.orders where id = ${order.orderId}::uuid)`);
    await pay(store.storeId, order, store.account);
    const today = new Date().toISOString().slice(0, 10);
    const s = (await getStore(store.slug))!;
    const outcome = await runReport(s, { ...blankSpec(), metrics: ["orders"], dimensions: ["channel"], filters: [], period: { preset: "custom", from: today, to: today, compare: "none" } } as never, new Date());
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.problems));
    expect(outcome.report.rows.find((r) => r.keys[0] === "ai_agent")?.values.orders).toBe(1);
  });
});
