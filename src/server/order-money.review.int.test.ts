import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseOrderListParams } from "@/lib/order-list";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { listOrdersPage, loadOrderListContext } = await import("./order-list");
const { newPlainStore, seedOrder } = await import("./order-ops-fixture");

/**
 * Money review of wave 3 run 2: the Orders list sorts by `orders.total_minor` alone, so a store that sells in more than one currency (every store with a euro view, D109, or with markets in Norway, Sweden
 * and Denmark) gets a "Highest total" order that is not by value: 400.00 DKK (about 53 EUR) is listed after 500.00 NOK (about 43 EUR) because 50,000 minor units are more than 40,000.
 */
afterAll(async () => {
  await closeDb();
});

describe("money review: the order list's total sort across currencies", () => {
  it("puts the order that is worth more first when two orders are in different currencies", async () => {
    const store = await newPlainStore("money-sort");
    await db().execute(sql`
      insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
      values (${store.storeId}::uuid, 'EUR', 1, 1, 0), (${store.storeId}::uuid, 'NOK', 11.5, 1, 1), (${store.storeId}::uuid, 'DKK', 7.46, 1, 2) on conflict do nothing
    `);
    const nok = await seedOrder(store, { market: "NO", totalMinor: 50_000, status: "paid", captured: true });
    const dkk = await seedOrder(store, { market: "DK", totalMinor: 40_000, status: "paid", captured: true });
    const context = await loadOrderListContext(store.storeId);
    const page = await listOrdersPage(store.storeId, parseOrderListParams({ sort: "total_desc" }), context);
    const order = page.rows.map((r) => r.id);
    // 400 DKK = 53.6 EUR, 500 NOK = 43.5 EUR: the Danish order is the higher total.
    expect(order.indexOf(dkk.id)).toBeLessThan(order.indexOf(nok.id));
  });

  it("pages through both directions of the total sort across currencies without losing or repeating an order, and a store with one currency sorts by the stored total", async () => {
    const store = await newPlainStore("money-sort-pages");
    await db().execute(sql`
      insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
      values (${store.storeId}::uuid, 'EUR', 1, 1, 0), (${store.storeId}::uuid, 'NOK', 11.5, 1, 1), (${store.storeId}::uuid, 'DKK', 7.46, 1, 2) on conflict do nothing
    `);
    const made: { id: string; eur: number }[] = [];
    for (let i = 0; i < 9; i += 1) {
      const nok = await seedOrder(store, { market: "NO", totalMinor: 10_000 + i * 7_300, status: "paid", captured: true });
      const dkk = await seedOrder(store, { market: "DK", totalMinor: 10_000 + i * 6_100, status: "paid", captured: true });
      made.push({ id: nok.id, eur: (10_000 + i * 7_300) / 100 / 11.5 }, { id: dkk.id, eur: (10_000 + i * 6_100) / 100 / 7.46 });
    }
    const context = await loadOrderListContext(store.storeId);
    for (const sort of ["total_desc", "total_asc"] as const) {
      const seen: string[] = [];
      let after: string | null = null;
      for (let guard = 0; guard < 10; guard += 1) {
        const page = await listOrdersPage(store.storeId, parseOrderListParams({ sort, ...(after ? { after } : {}) }), context, 5);
        seen.push(...page.rows.map((r) => r.id));
        if (!page.nextCursor) break;
        after = page.nextCursor;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toHaveLength(made.length);
      const order = [...made].sort((a, b) => (sort === "total_desc" ? b.eur - a.eur : a.eur - b.eur)).map((m) => m.id);
      // Equal in value to the hundredth of a euro may swap by id; the order is otherwise by value.
      const value = new Map(made.map((m) => [m.id, Math.round(m.eur * 100)]));
      expect(seen.map((id) => value.get(id))).toEqual(order.map((id) => value.get(id)));
    }
    // One currency: the stored total itself (the factors are empty, so the index is used).
    const single = await newPlainStore("money-sort-single");
    const a = await seedOrder(single, { market: "NO", totalMinor: 30_000, status: "paid", captured: true });
    const b = await seedOrder(single, { market: "NO", totalMinor: 90_000, status: "paid", captured: true });
    const singleContext = await loadOrderListContext(single.storeId);
    expect(singleContext.totalFactors).toEqual([]);
    const sorted = await listOrdersPage(single.storeId, parseOrderListParams({ sort: "total_desc" }), singleContext);
    expect(sorted.rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });
});
