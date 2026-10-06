import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { inventoryPage, inventoryCounts } = await import("./inventory");
const { variantStockOf } = await import("./catalog");
const { placeOrder } = await import("./checkout");
const support = await import("./inventory-test-support");
const { cartOf, newStore, no } = support;

type Row = Record<string, unknown>;

/**
 * A guard for the speed of the stock reads and of checkout on a large catalogue (wave 3, D172, `docs/wave-3-inventory.md` 6): one store with 5 000
 * variants at 3 locations and 3 000 movements, made by set-based SQL and NOT analysed afterwards on purpose. A planner that knows nothing of the
 * tables is when a read that leans on its estimates turns into a nested loop over the whole catalogue. The bound is generous, a few times what a
 * read takes here, so that only a plan that has gone quadratic breaks it.
 */
const VARIANTS = 5_000;
const BOUND_MS = 3_000;

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
  });

  it("a 20-line order is placed, routing and holding every line", { timeout: 60_000 }, async () => {
    expect(ordered).toHaveLength(20);
    const cart = await cartOf(store.storeId, ordered.map((sku) => [sku, 2] as [string, number]), no);
    const { ms, value } = await timed(() => placeOrder({ storeId: store.storeId, market: no }, cart, {}));
    expect(value.ok, value.ok ? "" : value.problem).toBe(true);
    expect(ms).toBeLessThan(BOUND_MS);
  });
});
