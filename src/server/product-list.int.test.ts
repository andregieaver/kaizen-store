import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { adminProductCounts, adminProductPage, listAdminProducts, productIdsOf } = await import("./product-list");
const { matchingProductIds } = await import("./bulk-edit");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;
type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;

/**
 * The products list a page at a time (code review 1.13, D834): 160 products made in one statement (one moment for all, so only the order's
 * last keys keep a page's edge): 1 to 120 on sale, 121 to 150 drafts, 151 to 160 archived; 1 to 10 downloads (no stock kept), 11 to 15 sold
 * out, 16 to 20 with two left, the rest with fifty.
 */
const run = Date.now().toString(36);
let store: Store;
let rival: Store;

async function makeStore(slug: string): Promise<Store> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Pia Pager', 'Pager') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${`Pager ${run}`}, null)`);
  const made = (await getStore(slug))!;
  // A new store's demo products (D600) are put aside, as the setup's *Archive the demo products* does: the lists here are the test's own.
  await db().execute(sql`update commerce.products set status = 'archived' where store_id = ${made.id}::uuid and handle like 'demo-%'`);
  return made;
}

const item = (i: number) => `item-${String(i).padStart(3, "0")}`;

beforeAll(async () => {
  store = await makeStore(`plist-${run}`);
  rival = await makeStore(`plist-rival-${run}`);
  // A list's rows, not a shop: products on sale without the pictures, prices and maker publishing asks for (the rule's own test is elsewhere).
  await db().transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`
    with made as (
      insert into commerce.products (store_id, handle, tax_code, kind, status)
      select ${store.id}::uuid, 'item-' || lpad(i::text, 3, '0'), 'txcd_99999999', 'goods',
        (case when i <= 120 then 'active' when i <= 150 then 'draft' else 'archived' end)::commerce.product_status
      from generate_series(1, 160) i
      returning id, handle
    )
    insert into commerce.product_variants (store_id, product_id, sku, delivery)
    select ${store.id}::uuid, id, upper(replace(handle, 'item', 'sku')), (case when substr(handle, 6)::int <= 10 then 'digital' else 'physical' end)::commerce.delivery
    from made
  `);
  });
  await db().execute(sql`
    insert into commerce.product_translations (store_id, product_id, locale, title)
    select p.store_id, p.id, 'nb-NO', 'Item ' || substr(p.handle, 6) from commerce.products p where p.store_id = ${store.id}::uuid and p.handle like 'item-%'
  `);
  const [location] = await db().execute<Row>(sql`
    insert into commerce.inventory_locations (store_id, name, country) values (${store.id}::uuid, 'Lager', 'NO') returning id
  `);
  await db().execute(sql`
    insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
    select ${store.id}::uuid, v.id, ${String(location.id)}::uuid,
      case when substr(p.handle, 6)::int <= 15 then 0 when substr(p.handle, 6)::int <= 20 then 2 else 50 end
    from commerce.product_variants v join commerce.products p on p.id = v.product_id
    where p.store_id = ${store.id}::uuid and p.handle like 'item-%' and v.delivery = 'physical'
  `);
  // One of the rival's own, which no list of this store shows.
  await db().execute(sql`insert into commerce.products (store_id, handle, tax_code, kind) values (${rival.id}::uuid, 'item-140', 'txcd_99999999', 'goods')`);
});

afterAll(async () => {
  await closeDb();
});

describe("a page of a store's products (D834)", () => {
  it("shows a hundred, says how many there are in all, and the next page holds the rest, none lost or repeated", async () => {
    const first = await adminProductPage(store, { offset: 0 });
    const second = await adminProductPage(store, { offset: 100 });
    expect([first.rows.length, first.total, second.rows.length, second.total]).toEqual([100, 150, 50, 150]);
    const handles = [...first.rows, ...second.rows].map((p) => p.handle);
    expect(new Set(handles).size).toBe(150);
    expect(handles).not.toContain(item(151));
    // In All, what costs sales first: the sold out, then the drafts, then the rest; each group by the handle when changed at one moment.
    expect(handles.slice(0, 5)).toEqual([11, 12, 13, 14, 15].map(item));
    expect(handles.slice(5, 35)).toEqual(Array.from({ length: 30 }, (_, i) => item(121 + i)));
    expect(handles.slice(35, 38)).toEqual([1, 2, 3].map(item));
    expect(first.rows[0]).toMatchObject({ title: "Item 011", status: "active", variants: 1, stock: 0, digitalVariants: 0 });
    expect(first.rows.find((p) => p.handle === item(1))).toMatchObject({ digitalVariants: 1, stock: 0 });
    expect((await adminProductPage(store, { offset: 200 })).rows).toEqual([]);
  });

  it("counts what each view and the search find, not the whole store", async () => {
    const view = async (show: "active" | "draft" | "stock" | "archived", offset = 0) => adminProductPage(store, { show, offset });
    expect([(await view("active")).total, (await view("active", 100)).rows.length]).toEqual([120, 20]);
    expect((await view("draft")).rows.map((p) => p.status)).toEqual(Array(30).fill("draft"));
    expect((await view("stock")).rows.map((p) => p.handle)).toEqual(Array.from({ length: 10 }, (_, i) => item(11 + i)));
    expect((await view("archived")).total).toBe(20);
    const searched = await adminProductPage(store, { q: "ITEM-14" });
    expect(searched.rows.map((p) => p.handle).sort()).toEqual(Array.from({ length: 10 }, (_, i) => item(140 + i)));
    expect(searched.total).toBe(10);
    expect((await adminProductPage(store, { q: "sku-005" })).rows.map((p) => p.handle)).toEqual([item(5)]);
    expect((await adminProductPage(store, { q: "Item 012", show: "stock" })).rows.map((p) => p.handle)).toEqual([item(12)]);
    expect(await adminProductPage(store, { q: "100%" })).toEqual({ rows: [], total: 0 });
    expect((await adminProductPage(rival, { q: "item-140" })).rows.map((p) => p.handle)).toEqual(["item-140"]);
  });

  it("gives each view's figure over the current products, whatever the search", async () => {
    expect(await adminProductCounts(store.id)).toEqual({ all: 150, active: 120, draft: 30, stock: 10, soldOut: 5 });
    expect(await adminProductCounts(rival.id)).toEqual({ all: 1, active: 0, draft: 1, stock: 1, soldOut: 1 });
  });

  it("chooses for a bulk action what the list shows on all its pages, in its order", async () => {
    const drafts = await productIdsOf(store.id, { show: "draft" }, 500);
    expect(drafts.ids).toEqual((await adminProductPage(store, { show: "draft" })).rows.map((p) => p.id));
    const all = await matchingProductIds(store.id, {});
    expect(all.total).toBe(150);
    expect(all.ids).toEqual([...(await adminProductPage(store, {})).rows, ...(await adminProductPage(store, { offset: 100 })).rows].map((p) => p.id));
    expect((await matchingProductIds(store.id, { show: "stock", q: "item-01" })).total).toBe(9);
  });

  it("still lists every product for the AI's tool, most recently changed first", async () => {
    const every = await listAdminProducts(store);
    expect(every).toHaveLength(150);
    expect(every[0].handle).toBe(item(1));
    expect((await listAdminProducts(store, { archived: true })).map((p) => p.handle).filter((h) => h.startsWith("item-")).sort()).toEqual(Array.from({ length: 10 }, (_, i) => item(151 + i)));
  });
});
