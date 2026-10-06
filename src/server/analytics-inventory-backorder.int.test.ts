import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { inventoryReport } = await import("./analytics-inventory-data");
const { inventoryCounts } = await import("./inventory");

/**
 * Negative stock, backorders and the owner's own warning level in the Inventory analysis (wave 3, D172, docs/analytics.md "On hand",
 * "Owed", "Warning level"). One shop made by hand, as of 30 September 2026 10:00 UTC:
 *
 *   DEMO-THERMOS  keeps selling, on hand -3 over the active locations; owed: 3 on a paid order, 2 on one that is paid and not sent,
 *                 4 on a sent one (owes nothing), 5 on a copied one (never counted) -> 5 owed, out, on backorder
 *   DEMO-LAMP     20 on hand, own warning level 25 -> at or below its level
 *   DEMO-TOTE     5 on hand, own warning level 5 -> at its level (the level itself counts)
 *   DEMO-MUG-WHITE 0 on hand, stops at zero, own level 2 -> out and at or below its level
 *   DEMO-MUG-BLACK 8 on hand, no level -> neither
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const localization = localizationOf([], [{ currency: "NOK", rate: 10, roundTo: 1 }], [no]);
const storeOf = (id: string, slug: string) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization }) as unknown as Store;
const NOW = new Date("2026-09-30T10:00:00Z");

let store: Store;
const variants: Record<string, string> = {};
let location: string;
let serial = 0;

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

/** A paid order of one variant with units on backorder, in the status given (`paid` is not sent, `fulfilled` is sent). */
async function backordered(sku: string, quantity: number, owed: number, o: { status?: string; copied?: boolean; at?: string } = {}) {
  serial += 1;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at, copied_from)
    values (${store.id}::uuid, ${`${o.copied ? "C" : "T"}-${run}-${serial}`}, 'NO', 'NOK', 'nb-NO', 'x@example.com', ${o.status ?? "paid"}, ${1_000 * quantity}, 0, 0,
      ${200 * quantity}, ${1_000 * quantity}, '{}'::jsonb, '{}'::jsonb, ${o.at ?? "2026-09-28T10:00:00Z"}::timestamptz, ${o.copied ? crypto.randomUUID() : null})
    returning id
  `);
  const insertLine = (runner: Pick<ReturnType<typeof db>, "execute">) =>
    runner.execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate,
        tax_code, delivery, backorder_quantity, backorder_days)
      values (${store.id}::uuid, ${String(order.id)}::uuid, ${variants[sku]}::uuid, ${sku}, ${sku}, ${quantity}, 1000, 0, ${1_000 * quantity}, ${200 * quantity}, 0.25,
        'txcd_99999999', 'physical', ${owed}, 7)
    `);
  if (o.copied) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
      await insertLine(tx);
    });
    return;
  }
  await insertLine(db());
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${store.id}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_backorder', ${1_000 * quantity}, 'NOK', 'captured')
  `);
}

const setStock = (sku: string, onHand: number, where = location) =>
  db().execute(sql`
    insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${store.id}::uuid, ${variants[sku]}::uuid, ${where}::uuid, ${onHand})
    on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand
  `);

const setLevel = (sku: string, threshold: number | null) =>
  db().execute(sql`update commerce.product_variants set low_stock_threshold = ${threshold} where id = ${variants[sku]}::uuid`);

beforeAll(async () => {
  const slug = `invbo-${run}`;
  const id = await makeStore(slug);
  store = storeOf(id, slug);
  for (const row of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${id}::uuid`)) variants[String(row.sku)] = String(row.id);
  const [place] = await db().execute<Row>(sql`select id from commerce.inventory_locations where store_id = ${id}::uuid and active limit 1`);
  location = String(place.id);
  // Only the five variants of this scenario are stocked.
  await db().execute(sql`
    update commerce.product_variants set active = false
    where store_id = ${id}::uuid and sku not in ('DEMO-THERMOS', 'DEMO-LAMP', 'DEMO-TOTE', 'DEMO-MUG-WHITE', 'DEMO-MUG-BLACK')
  `);
  await setStock("DEMO-THERMOS", -3);
  await setStock("DEMO-LAMP", 20);
  await setStock("DEMO-TOTE", 5);
  await setStock("DEMO-MUG-WHITE", 0);
  await setStock("DEMO-MUG-BLACK", 8);
  // A closed location with stock must not lift a variant that is owed.
  const [closed] = await db().execute<Row>(sql`
    insert into commerce.inventory_locations (store_id, name, country, active) values (${id}::uuid, 'Gammelt lager', 'NO', false) returning id
  `);
  await setStock("DEMO-THERMOS", 50, String(closed.id));
  await setLevel("DEMO-LAMP", 25);
  await setLevel("DEMO-TOTE", 5);
  await setLevel("DEMO-MUG-WHITE", 2);

  await backordered("DEMO-THERMOS", 3, 3);
  await backordered("DEMO-THERMOS", 4, 2);
  await backordered("DEMO-THERMOS", 4, 4, { status: "fulfilled" });
  await backordered("DEMO-THERMOS", 5, 5, { copied: true });
});

afterAll(async () => {
  await closeDb();
});

const rows = async (at = NOW) => new Map((await inventoryReport(store, at)).rows.map((r) => [r.sku, r]));

describe("the Inventory analysis with backorders (D172)", () => {
  it("shows a variant owed to customers as out, on backorder, with the units owed, and never as a negative value", async () => {
    const thermos = (await rows()).get("DEMO-THERMOS")!;
    // -3 over the active location; the closed location's 50 are not for sale and do not lift it.
    expect(thermos).toMatchObject({ onHand: -3, stockPolicy: "continue", status: "out", onBackorder: true, owed: 5, valueMinor: null });
  });

  it("owes only what paid orders that are not sent wait for: not a sent order, not a copied one", async () => {
    const report = await inventoryReport(store, NOW);
    expect(report.totals.owedUnits).toBe(5);
    expect(report.totals.onBackorder).toBe(1);
  });

  it("holds the owed units equal to the admin's own Inventory page, and the variants at their level likewise", async () => {
    const report = await inventoryReport(store, NOW);
    const page = await inventoryCounts(store.id);
    expect(report.totals.owedUnits).toBe(page.owed);
    expect(report.totals.belowLevel).toBe(page.low);
  });

  it("counts a variant at or below its own level, the level itself included, out ones too", async () => {
    const map = await rows();
    expect(map.get("DEMO-LAMP")).toMatchObject({ lowStockThreshold: 25, status: "low" });
    expect(map.get("DEMO-TOTE")).toMatchObject({ lowStockThreshold: 5, status: "low" });
    // Out comes before low: nothing is on hand, and it also is at its level.
    expect(map.get("DEMO-MUG-WHITE")).toMatchObject({ lowStockThreshold: 2, status: "out", onBackorder: false });
    expect(map.get("DEMO-MUG-BLACK")).toMatchObject({ lowStockThreshold: null, status: "ok" });
    const { totals } = await inventoryReport(store, NOW);
    expect(totals.belowLevel).toBe(2 + 1);
  });

  it("counts a negative figure as nothing in the stock value, the units and the totals, never as a debt that lowers them", async () => {
    const { totals } = await inventoryReport(store, NOW);
    // 20 + 5 + 8 units on hand; the thermos and the mug at zero add none.
    expect(totals.value.units).toBe(33);
    expect(totals.deadUnits).toBe(0);
  });

  it("is plain data, and a store that never backorders shows none of it", async () => {
    const report = await inventoryReport(store, NOW);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    await db().execute(sql`update commerce.product_variants set active = false where id = ${variants["DEMO-THERMOS"]}::uuid`);
    const without = await inventoryReport(store, NOW);
    expect(without.totals).toMatchObject({ owedUnits: 0, onBackorder: 0 });
    await db().execute(sql`update commerce.product_variants set active = true where id = ${variants["DEMO-THERMOS"]}::uuid`);
  });

  it("an alert for a variant that sells on backorder says so", async () => {
    // Sold 3 or more in 30 days: the three orders in September are the thermos's sales.
    const report = await inventoryReport(store, NOW);
    const alert = report.alerts.find((a) => a.row.sku === "DEMO-THERMOS");
    expect(alert).toMatchObject({ kind: "out", days: 0 });
    expect(alert!.row.owed).toBe(5);
  });
});
