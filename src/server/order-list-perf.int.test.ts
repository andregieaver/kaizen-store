import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseOrderListParams } from "@/lib/order-list";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { listOrdersPage, loadOrderListContext, selectAllMatching } = await import("./order-list");
const { newPlainStore } = await import("./order-ops-fixture");

type Row = Record<string, unknown>;
type Store = Awaited<ReturnType<typeof newPlainStore>>;

/**
 * The order list stays fast for a store with thousands of orders (wave 3, run 2, D173, `docs/wave-3-orders.md` 3.5 and 6.1, L5): 5,000 orders in one store, numbered from the real sequence,
 * answer the first page, a search by number, by email, by product, a filtered page, the count and a "select all matching" inside a generous bound, and the indexes the search and the sort need exist.
 * The bounds are for catching a plan that scans per order, not a benchmark: a busy or long-lived database is slower than a fresh one.
 */

const ORDERS = 5_000;
const BOUND_MS = 4_000;
let store: Store;

beforeAll(async () => {
  store = await newPlainStore("list-perf");
  await db().execute(sql`
    insert into commerce.orders (
      store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at
    )
    select ${store.storeId}::uuid, s.prefix || commerce.next_document_number(${store.storeId}::uuid, 'order')::text,
      'NO', 'NOK', 'nb-NO', 'customer' || g || '@example.com',
      (case when g % 10 = 0 then 'fulfilled' when g % 17 = 0 then 'cancelled' else 'paid' end)::commerce.order_status,
      10000, 0, 0, 2000, 10000,
      jsonb_build_object('name', 'Person ' || g), jsonb_build_object('name', 'Person ' || g || ' Nordmann', 'line1', 'Storgata 1', 'postalCode', '0155', 'city', 'Oslo'),
      now() - (g || ' minutes')::interval
    from generate_series(1, ${ORDERS}) g, commerce.document_series s
    where s.store_id = ${store.storeId}::uuid and s.series = 'order'
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, withdrawal_exclusion, delivery)
    select o.store_id, o.id, 'SKU-' || (row_number() over (order by o.placed_at) % 50), 'Product number ' || (row_number() over (order by o.placed_at) % 50), 1, 10000, 0, 10000, 2000, 0.25, 'txcd_99999999', 'none', 'physical'
    from commerce.orders o where o.store_id = ${store.storeId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    select o.store_id, o.id, 'stripe', 'cs_perf_' || o.id, ${store.account}, 10000, 'NOK', 'captured'
    from commerce.orders o where o.store_id = ${store.storeId}::uuid and o.status <> 'cancelled'
  `);
  await db().execute(sql`analyze commerce.orders`);
  await db().execute(sql`analyze commerce.order_lines`);
}, 240_000);

afterAll(async () => {
  await closeDb();
});

async function timed<T>(run: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await run();
  return { value, ms: performance.now() - started };
}

describe("5,000 orders in one store", () => {
  it("answers the first page, a page deep in the list, and the count", async () => {
    const context = await loadOrderListContext(store.storeId);
    const first = await timed(() => listOrdersPage(store.storeId, parseOrderListParams({}), context));
    expect(first.value.rows).toHaveLength(50);
    const [expected] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid and status <> 'cancelled'`);
    expect(first.value.count).toBe(expected.n);
    expect(first.ms).toBeLessThan(BOUND_MS);
    // Walking to the page after the first is as fast: a keyset, not an offset.
    const next = await timed(() => listOrdersPage(store.storeId, parseOrderListParams({ after: first.value.nextCursor ?? "" }), context));
    expect(next.value.rows).toHaveLength(50);
    expect(next.ms).toBeLessThan(BOUND_MS);
    const sorted = await timed(() => listOrdersPage(store.storeId, parseOrderListParams({ sort: "total_asc" }), context));
    expect(sorted.value.rows).toHaveLength(50);
    expect(sorted.ms).toBeLessThan(BOUND_MS);
  });

  it("finds an order by number, by email, by a person's name and by a product, each inside the bound", async () => {
    const context = await loadOrderListContext(store.storeId);
    const [one] = await db().execute<Row>(sql`select number from commerce.orders where store_id = ${store.storeId}::uuid order by placed_at desc offset 2500 limit 1`);
    const byNumber = await timed(() => listOrdersPage(store.storeId, parseOrderListParams({ q: String(one.number) }), context));
    expect(byNumber.value.rows.map((r) => r.number)).toContain(String(one.number));
    const byEmail = await timed(() => listOrdersPage(store.storeId, parseOrderListParams({ q: "customer4321@example.com" }), context));
    expect(byEmail.value.rows).toHaveLength(1);
    const byName = await timed(() => listOrdersPage(store.storeId, parseOrderListParams({ q: "Person 777 Nordmann" }), context));
    expect(byName.value.rows.map((r) => r.email)).toContain("customer777@example.com");
    const byProduct = await timed(() => listOrdersPage(store.storeId, parseOrderListParams({ q: "Product number 7" }), context));
    expect(byProduct.value.rows.length).toBeGreaterThan(0);
    for (const t of [byNumber, byEmail, byName, byProduct]) expect(t.ms).toBeLessThan(BOUND_MS);
  });

  it("answers a filtered page and selects everything that matches, each inside the bound", async () => {
    const context = await loadOrderListContext(store.storeId);
    const filtered = await timed(() => listOrdersPage(store.storeId, parseOrderListParams({ pay: "paid", ship: "to_send", range: "30d" }), context));
    expect(filtered.value.rows.length).toBeGreaterThan(0);
    expect(filtered.ms).toBeLessThan(BOUND_MS);
    const matching = await timed(() => selectAllMatching(store.storeId, parseOrderListParams({ status: "fulfilled" }), context, 1_000));
    expect(matching.value.over).toBe(false);
    expect(matching.value.ids).toHaveLength(Math.floor(ORDERS / 10));
    expect(matching.ms).toBeLessThan(BOUND_MS);
    const tooMany = await selectAllMatching(store.storeId, parseOrderListParams({}), context, 250);
    expect(tooMany.over).toBe(true);
  });

  it("has the indexes the search and the sort need", async () => {
    const rows = await db().execute<Row>(sql`select indexname from pg_indexes where schemaname = 'commerce' and tablename in ('orders', 'order_lines', 'shipments', 'order_tags', 'draft_orders')`);
    const names = rows.map((r) => String(r.indexname));
    for (const wanted of ["orders_search_email_idx", "orders_search_ship_name_idx", "orders_search_bill_name_idx", "order_lines_search_title_idx", "order_lines_search_sku_idx", "orders_list_placed_idx", "orders_list_total_idx", "shipments_tracking_idx"]) {
      expect(names, wanted).toContain(wanted);
    }
  });
});
