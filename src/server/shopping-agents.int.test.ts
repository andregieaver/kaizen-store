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
const { agentEndpoint, agentProfileUrl, variantGid } = await import("@/lib/shopping-agents");
const { storeOfHost } = await import("@/lib/ab-routing");
const { storeDomain, storeFileUrl, storeHosts } = await import("@/lib/paths");
const { forgetStoreFacts, storeRequestAnswer } = await import("./redirect-resolve");

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

describe("where the profile is", () => {
  /** The store an address names and its route's path there, as the host routing reads it: `/s/{store}/…` on Kaizena Flow's host, `/…` on a store's own. */
  const named = (address: URL) => {
    const hostStore = storeOfHost(address.host, storeDomain(), storeHosts());
    if (hostStore) return { slug: hostStore, path: address.pathname, hostStore };
    const [, slug, path] = /^\/s\/([^/]+)(\/.*)$/.exec(address.pathname) ?? [];
    return { slug, path, hostStore: null };
  };

  it("is served at the address the store advertises, whether it sells in several countries or in one", async () => {
    const advertised = agentProfileUrl(store.slug);
    const address = new URL(advertised);
    const { slug, path, hostStore } = named(address);
    expect({ slug, path }).toEqual({ slug: store.slug, path: "/.well-known/ucp" });
    const md = await (await agentsRoute.GET(new Request("https://x/"), { params: Promise.resolve({ store: store.slug }) } as never)).text();
    expect(md).toContain(`- UCP profile: ${advertised}\n`);
    expect(md).toContain(`- The store in plain text: ${storeFileUrl(store.slug, "/llms.txt")}\n`);

    const served = async () => {
      // The proxy leaves the address to its route: a page's address would be served from the store's country (D181) or counted as missing.
      forgetStoreFacts(store.slug);
      expect(await storeRequestAnswer(address.pathname, "", hostStore, true, address.host)).toBeNull();
      const response = await profileRoute.GET(new Request(address), { params: Promise.resolve({ store: slug }) } as never);
      expect(response.status).toBe(200);
      expect(((await response.json()) as Answer).ucp.services["dev.ucp.shopping"][0].endpoint).toBe(agentEndpoint(store.slug));
    };
    await served();
    // Norway alone: its addresses have no country (D181).
    await db().execute(sql`update commerce.markets set active = false where store_id = ${store.storeId}::uuid and code = 'FI'`);
    try {
      await served();
    } finally {
      await db().execute(sql`update commerce.markets set active = true where store_id = ${store.storeId}::uuid and code = 'FI'`);
      forgetStoreFacts(store.slug);
    }
  });
});

describe("the endpoint's limits", () => {
  const ping = (id: number) => ({ jsonrpc: "2.0", id, method: "ping" });
  const ids = (count: number) => Array.from({ length: count }, (_, i) => i + 1);

  it("answers a batch of up to ten calls, and refuses a larger or an empty one whole, as the owner MCP does", async () => {
    const ten = await call(ids(10).map(ping));
    expect(ten.status).toBe(200);
    expect(ten.body.map((answer: Answer) => answer.id)).toEqual(ids(10));
    for (const batch of [ids(11).map(ping), []]) {
      const refused = await call(batch);
      expect(refused.status, `a batch of ${batch.length}`).toBe(400);
      expect(refused.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "A batch holds 1 to 10 calls." } });
    }
  });

  it("counts a body's bytes, not its characters", async () => {
    // 20,000 euro signs are 20,000 characters but 60,000 bytes: over the 50,000 a body may hold.
    const heavy = await call({ ...ping(1), params: { note: "€".repeat(20_000) } });
    expect(heavy.status).toBe(413);
    expect(heavy.body).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Too large." } });
    expect((await call({ ...ping(1), params: { note: "e".repeat(20_000) } })).status).toBe(200);
    // A body said to be larger is refused before it is read.
    expect((await call(ping(1), { "content-length": "50001" })).status).toBe(413);
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
    const s = (await getStore(store.slug))!;
    // The store's own day: around midnight UTC it is already tomorrow in Oslo.
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: s.timeZone }).format(new Date());
    const outcome = await runReport(s, { ...blankSpec(), metrics: ["orders"], dimensions: ["channel"], filters: [], period: { preset: "custom", from: today, to: today, compare: "none" } } as never, new Date());
    if (!outcome.ok) throw new Error(JSON.stringify(outcome.problems));
    expect(outcome.report.rows.find((r) => r.keys[0] === "ai_agent")?.values.orders).toBe(1);
  });
});
