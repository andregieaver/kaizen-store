import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// The cart page's read finds its cart by the cookie: the one cart this file reads that way.
const browser = vi.hoisted(() => ({ cartId: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => (browser.cartId ? { value: browser.cartId } : undefined), getAll: () => [], set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { inventoryPage, inventoryCounts } = await import("./inventory");
const { variantStockOf } = await import("./catalog");
const { placeOrder } = await import("./checkout");
const { getCart } = await import("./cart");
const support = await import("./inventory-test-support");
const { cartOf, newStore, no } = support;

type Row = Record<string, unknown>;

/**
 * A guard for the speed of the stock reads and of checkout on a large catalogue (wave 3, D172, `docs/wave-3-inventory.md` 6): one store with 5 000
 * variants at 3 locations and 3 000 movements, made by set-based SQL and NOT analysed afterwards on purpose. A planner that knows nothing of the
 * tables is when a read that leans on its estimates turns into a nested loop over the whole catalogue. The bound is generous, a few times what a
 * read takes here, so that only a plan that has gone quadratic breaks it.
 *
 * The order (and the cart page's read, which has the same shape) failed it now and then until D370: after other tests had made many small
 * stores, the statistics gave this store one variant and one product, and with the store's id a filter of both the planner scanned every
 * variant once per product (past a minute). Whether it did hung on when autovacuum had last analysed the tables, hence "flaky". Both reads
 * now take the cart's lines first (`cartLinesFirst()` in `cart.ts`). To see the old failure on demand: switch autovacuum off for the
 * `commerce` tables, run another integration file, then this one.
 *
 * Since D383 the criterion for the reads whose SQL this file can name is the PLAN, not the clock: `rowsRead()` runs the query under
 * `EXPLAIN (ANALYZE, FORMAT JSON)` and adds up the rows every scan of the catalogue's tables read (rows given plus rows a filter removed,
 * times the scan's loops), which is the same on a busy server as on an idle one. The bound is reading those tables twice over
 * (`linearBound()`): a planner with no statistics may well scan a table once, which stays linear, while a nested loop over the
 * catalogue reads it once per variant, thousands of times more. The reads behind a function (the Inventory page, the cart, placing an order) keep a wall-time backstop of ten
 * seconds: before D370 the failure took more than a minute.
 *
 * The stock of 200 variants failed it once more after the catalogue was analysed (CI run 780: 190,400 rows): `available_stock` grouped every
 * store's active reservations and the planner could do so once per variant. The view now sums each level's own (D408).
 */
const VARIANTS = 5_000;
const BOUND_MS = 10_000;
const CATALOGUE = new Set(["product_variants", "products", "inventory_levels", "inventory_locations", "inventory_reservations"]);

type PlanNode = { "Relation Name"?: string; "Actual Rows"?: number; "Actual Loops"?: number; "Rows Removed by Filter"?: number; Plans?: PlanNode[] };

/** The rows a query's scans of the catalogue's tables read, from its executed plan; the query runs and its result is thrown away. */
async function rowsRead(query: ReturnType<typeof sql>): Promise<number> {
  const [row] = await db().execute<Row>(sql`explain (analyze, format json) ${query}`);
  const plan = (Object.values(row)[0] as { Plan: PlanNode }[])[0].Plan;
  const walk = (node: PlanNode): number =>
    (node["Relation Name"] && CATALOGUE.has(node["Relation Name"]) ? ((node["Actual Rows"] ?? 0) + (node["Rows Removed by Filter"] ?? 0)) * (node["Actual Loops"] ?? 1) : 0) +
    (node.Plans ?? []).reduce((sum, child) => sum + walk(child), 0);
  return walk(plan);
}

/** Twice every row of the catalogue's tables, every store's: what a plan that is linear in the catalogue stays under. */
async function linearBound(): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select (select count(*) from commerce.product_variants) + (select count(*) from commerce.products) + (select count(*) from commerce.inventory_levels)
      + (select count(*) from commerce.inventory_locations) + (select count(*) from commerce.inventory_reservations) as n
  `);
  return 2 * Number(row.n);
}

let store: Awaited<ReturnType<typeof newStore>>;
let ids: string[] = [];
let ordered: string[] = [];

beforeAll(async () => {
  store = await newStore("perf");
  const sid = store.storeId;
  await db().transaction(async (tx) => {
    try {
      await tx.execute(sql`set local session_replication_role = replica`);
    } catch {
      // Not allowed for this role: the rows go in through the triggers, only slower.
    }
    await tx.execute(sql`create temp table perf_p on commit drop as select i, gen_random_uuid() as id from generate_series(1, ${VARIANTS / 2}::int) i`);
    await tx.execute(sql`
      insert into commerce.products (id, store_id, handle, status, tax_code, delivery, kind)
      select id, ${sid}::uuid, 'perf-' || i, 'active', 'txcd_99999999', 'physical', 'goods' from perf_p
    `);
    await tx.execute(sql`insert into commerce.product_translations (store_id, product_id, locale, title) select ${sid}::uuid, id, 'nb-NO', 'Produkt ' || i from perf_p`);
    await tx.execute(sql`
      insert into commerce.product_variants (store_id, product_id, sku, active, delivery, stock_policy, backorder_days, low_stock_threshold, options)
      select ${sid}::uuid, p.id, 'PERF-' || p.i || '-' || n, true, 'physical', case when (p.i + n) % 7 = 0 then 'continue' else 'deny' end,
             case when (p.i + n) % 7 = 0 then 5 end, case when (p.i + n) % 3 = 0 then 10 end, jsonb_build_object('Size', 'S' || n)
      from perf_p p cross join generate_series(1, 2) n
    `);
    await tx.execute(sql`
      insert into commerce.inventory_locations (store_id, name, country, priority)
      values (${sid}::uuid, 'Perf B', 'NO', 10), (${sid}::uuid, 'Perf C', 'SE', 20)
    `);
    await tx.execute(sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
      select ${sid}::uuid, v.id, l.id, ((hashtext(v.sku || l.name)::bigint & 255) % 40)::int
      from commerce.product_variants v join commerce.inventory_locations l on l.store_id = v.store_id and l.active
      where v.store_id = ${sid}::uuid and v.sku like 'PERF-%'
    `);
    await tx.execute(sql`
      insert into commerce.inventory_movements (store_id, variant_id, location_id, delta, on_hand_after, reason, source, created_at)
      select ${sid}::uuid, l.variant_id, l.location_id, 1, l.on_hand, 'correction', 'system', now() - (n || ' hours')::interval
      from (select * from commerce.inventory_levels where store_id = ${sid}::uuid order by variant_id limit 1000) l cross join generate_series(1, 3) n
    `);
  });
  // Statistics for the rows just loaded, as autovacuum keeps them in production: without them the plan depended on whether autovacuum had
  // come by yet, and a nested loop over stale counts read the levels once per variant (CI #762).
  await db().execute(sql`analyze commerce.products, commerce.product_variants, commerce.inventory_levels, commerce.inventory_locations, commerce.inventory_reservations`);
  const rows = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${sid}::uuid and sku like 'PERF-%' order by sku limit 200`);
  ids = rows.map((r) => String(r.id));
  // 20 variants a shopper can buy: priced, in stock somewhere, in the kinds checkout draws (a few that keep selling).
  const buyable = await db().execute<Row>(sql`
    select v.id, v.sku from commerce.product_variants v
    where v.store_id = ${sid}::uuid and v.sku like 'PERF-%' and (select sum(on_hand) from commerce.inventory_levels l where l.variant_id = v.id) >= 5
    order by v.sku limit 20
  `);
  ordered = buyable.map((r) => String(r.sku));
  for (const r of buyable) await db().execute(sql`select commerce.set_price(${String(r.id)}::uuid, 'NO', 19900)`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

async function timed<T>(work: () => Promise<T>): Promise<{ ms: number; value: T }> {
  const start = performance.now();
  const value = await work();
  return { ms: performance.now() - start, value };
}

describe("the stock reads and checkout stay fast on a large catalogue", () => {
  it("has made the catalogue", async () => {
    const [n] = await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_levels where store_id = ${store.storeId}::uuid`);
    expect(Number(n.n)).toBeGreaterThanOrEqual(VARIANTS * 3);
  });

  it("the Inventory page: a first page, a search, a status filter and the counts", { timeout: 60_000 }, async () => {
    const shop = { id: store.storeId, localization: store.member.store.localization };
    for (const filter of [{}, { search: "Produkt 40" }, { status: "low" as const }, { status: "out" as const }, { limit: 200 }]) {
      const { ms, value } = await timed(() => inventoryPage(shop, filter));
      expect(value.rows.length).toBeGreaterThan(0);
      expect(ms, JSON.stringify(filter)).toBeLessThan(BOUND_MS);
    }
    const counts = await timed(() => inventoryCounts(store.storeId));
    expect(counts.ms).toBeLessThan(BOUND_MS);
  });

  it("the stock of 200 variants, as the cart and the product pages ask", async () => {
    const { ms, value } = await timed(() => variantStockOf(db(), store.storeId, ids));
    expect(value.size).toBe(200);
    expect(ms).toBeLessThan(BOUND_MS);
    // The same read by its plan: linear in the catalogue, never the catalogue once per variant.
    const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
    const read = await rowsRead(sql`select * from commerce.variant_availability va where va.store_id = ${store.storeId}::uuid and va.variant_id in (${list})`);
    expect(read).toBeLessThan(await linearBound());
  });

  it("the level rows a 20-line order locks, by their plan", async () => {
    const variants = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = any(${`{${ordered.join(",")}}`}::text[])`);
    const list = sql.join(variants.map((v) => sql`${String(v.id)}::uuid`), sql`, `);
    const read = await rowsRead(sql`
      select l.variant_id, l.location_id, l.on_hand from commerce.inventory_levels l
      where l.store_id = ${store.storeId}::uuid and l.variant_id in (${list}) order by l.variant_id, l.location_id
    `);
    expect(read).toBeLessThan(await linearBound());
  });

  it("a 20-line cart, as the cart page reads it", { timeout: 60_000 }, async () => {
    expect(ordered).toHaveLength(20);
    browser.cartId = await cartOf(store.storeId, ordered.map((sku) => [sku, 1] as [string, number]), no);
    const { ms, value } = await timed(() => getCart({ storeId: store.storeId, market: no }, { customerId: null }));
    expect(value.lines).toHaveLength(20);
    expect(ms).toBeLessThan(BOUND_MS);
  });

  it("a 20-line order is placed, routing and holding every line", { timeout: 60_000 }, async () => {
    expect(ordered).toHaveLength(20);
    const cart = await cartOf(store.storeId, ordered.map((sku) => [sku, 2] as [string, number]), no);
    const { ms, value } = await timed(() => placeOrder({ storeId: store.storeId, market: no }, cart, {}));
    expect(value.ok, value.ok ? "" : value.problem).toBe(true);
    expect(ms).toBeLessThan(BOUND_MS);
  });
});
