import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }) }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const { getStore } = await import("./stores");
const knowledge = await import("./knowledge");
const { siteFactsTool } = await import("./chat-agent");
const { searchProducts } = await import("./search");
const { getProduct } = await import("./catalog");

type Row = Record<string, unknown>;
type Store = import("./stores").Store;

/**
 * Two stores, each with a product and a knowledge document that only it holds (PSI AST-08): the shopper chat of one store, through the
 * very functions its tools call (`search_content` and `store_info` by `siteFactsTool()`, `search_products` by `searchProducts()`,
 * `get_product` by `getProduct()`), finds its own and never the other's, whatever the visitor asks for.
 */

const run = Date.now().toString(36);
type Side = { id: string; slug: string; account: string; store: Store; marker: string; handle: string };
let a: Side;
let b: Side;

async function side(label: string, marker: string): Promise<Side> {
  const slug = `iso-${label}-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${`Store ${label}`}, null) as id`);
  const id = String(created.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${id}::uuid`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${slug}@example.com`}`);
  // One of the demo products becomes this store's own, by a word no other store uses. Goods, chosen by handle: the demo products share one
  // creation time, and an appointment, stay or rental is left out of search while its feature is off, so an arbitrary pick made this flaky.
  const [product] = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${id}::uuid and status = 'active' and kind = 'goods' order by created_at, handle limit 1`);
  await db().execute(sql`update commerce.product_translations set title = ${`${marker} lampe`} where product_id = ${String(product.id)}::uuid`);
  const saved = await knowledge.saveDocument({ id: String(owner.id), email: `${slug}@example.com` } as never, id, null, {
    title: `Om ${marker}`,
    content: `${marker} er vår egen ordning: du kan returnere innen 60 dager.`,
  });
  if (!saved.ok) throw new Error("the document was not kept");
  return { id, slug, account: String(owner.id), store: (await getStore(slug))!, marker, handle: String(product.handle) };
}

const marketOf = (s: Side) => s.store.markets.find((m) => m.code === "NO") ?? s.store.markets[0];
const siteOf = (s: Side) => ({ kind: "store" as const, store: s.store, market: marketOf(s) });

beforeAll(async () => {
  a = await side("a", `Fjordlys${run}`);
  b = await side("b", `Nordglans${run}`);
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("the shopper chat of one store, beside another", () => {
  it("finds its own knowledge and never the other store's", async () => {
    const own = JSON.parse(await siteFactsTool(siteOf(a), "search_content", { query: a.marker }));
    expect(own.passages.map((p: { title: string }) => p.title)).toContain(`Om ${a.marker}`);
    const other = JSON.parse(await siteFactsTool(siteOf(a), "search_content", { query: b.marker }));
    expect(other.passages ?? []).toEqual([]);
    expect(JSON.stringify(other)).not.toContain(b.marker);
    // And the other way round.
    expect(JSON.stringify(await siteFactsTool(siteOf(b), "search_content", { query: a.marker }))).not.toContain(a.marker);
  });

  it("finds its own products and never the other store's, by search or by the other's address", async () => {
    const shopA = { storeId: a.id, market: marketOf(a) };
    const own = await searchProducts(shopA, a.marker, null, null, 6);
    expect(own.products.map((p) => p.handle)).toContain(a.handle);
    const other = await searchProducts(shopA, b.marker, null, null, 6);
    expect(other.products.filter((p) => p.title.includes(b.marker))).toEqual([]);
    // Asked for by the other store's handle, it gives this store's own product of that handle (both began with the same demo
    // catalogue), or nothing; never the other store's.
    const byHandle = await getProduct(a.id, marketOf(a), b.handle);
    expect(byHandle === null || !JSON.stringify(byHandle).includes(b.marker)).toBe(true);
    expect(JSON.stringify(await getProduct(a.id, marketOf(a), a.handle))).toContain(a.marker);
  });

  it("tells its own store's facts only", async () => {
    const info = await siteFactsTool(siteOf(a), "store_info", {});
    expect(info).not.toContain(b.slug);
    expect(info).not.toContain("Store b");
  });
});
