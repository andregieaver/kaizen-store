import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
}));

const { inventoryReport } = await import("./analytics-inventory-data");

/**
 * The Inventory page's figures (D152, docs/analytics.md) against a small hand-made shop, as of 30 September 2026 10:00 UTC
 * (12:00 in Oslo). Only goods with stock are listed: active variants, delivered physically, of products that are not archived.
 *
 *   variant        on hand            cost    sold (paid orders)                                          status
 *   MUG-WHITE      3 (+100 at a        30.00  2 (1 day ago), 5 (10 days), 10 (46 days)                    low: 17 in 90 days, 7 in 30, 2 in 7
 *                  closed location)
 *   MUG-BLACK      0                   20.00  3 (5 days); 7 over a year ago (not read)                    out
 *   NOTEBOOK-LINED 40                  none   4 (121 days ago)                                            dead, no cost
 *   TOTE           1                   10.00  1 (1 day), 4 (3 days, 1 went back in stock), 2 (2 days,     low: runs out in 2.4 days
 *                                              all went back), 1 (20 days)
 *   LAMP           20                  50.00  none, on offer for 29 days                                  ok
 *   DRAFT-1        4 (a draft)         none   none, on offer for 5 days                                   ok
 *   not listed: NOTEBOOK-DOTTED (inactive), ARCH-1 (archived product), the services
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const localization = localizationOf([], [{ currency: "NOK", rate: 10, roundTo: 1 }], [no]);
const storeOf = (id: string, slug: string) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization }) as unknown as Store;

const NOW = new Date("2026-09-30T10:00:00Z");

let store: Store;
let other: Store;
const variants: Record<string, string> = {};
let activeLocation: string;
let serial = 0;

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

async function skus(storeId: string) {
  const out: Record<string, string> = {};
  for (const row of await db().execute<Row>(sql`select sku, id from commerce.product_variants where store_id = ${storeId}::uuid`)) out[String(row.sku)] = String(row.id);
  return out;
}

/** An order of one variant: a paid one by default. */
async function sell(
  s: Store,
  o: { sku: string; qty: number; at: string; cost?: number | null; status?: string; payment?: "captured" | "pending" | null; host?: string | null; copied?: boolean; restocked?: { type: string; quantity: number } },
) {
  serial += 1;
  const total = 1_000 * o.qty;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, host_id, copied_from)
    values (${s.id}::uuid, ${`${o.copied ? "C" : "T"}-${run}-${serial}`}, 'NO', 'NOK', 'nb-NO', 'x@example.com', ${o.status ?? "paid"},
      ${total}, 0, 0, ${Math.round(total / 5)}, ${total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.host ?? null}, ${o.copied ? crypto.randomUUID() : null})
    returning id
  `);
  const orderId = String(order.id);
  const insertLine = (runner: Pick<ReturnType<typeof db>, "execute">) =>
    runner.execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor,
        total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${s.id}::uuid, ${orderId}::uuid, ${variants[o.sku]}::uuid, ${o.sku}, ${o.sku}, ${o.qty}, 1000, ${o.cost ?? null}, 0, ${total}, ${Math.round(total / 5)}, 0.25,
        'txcd_99999999', 'physical')
    `);
  if (o.copied) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
      await insertLine(tx);
    });
  } else {
    await insertLine(db());
    if (o.payment !== null) {
      await db().execute(sql`
        insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
        values (${s.id}::uuid, ${orderId}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_inventory', ${total}, 'NOK', ${o.payment ?? "captured"}::commerce.payment_status)
      `);
    }
  }
  if (o.restocked) {
    await db().execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${s.id}::uuid, ${orderId}::uuid, ${o.restocked.type}, ${JSON.stringify({ restocked: [{ sku: o.sku, quantity: o.restocked.quantity }] })}::jsonb, 'staff')
    `);
  }
}

const setStock = (storeId: string, sku: string, locationId: string, onHand: number) =>
  db().execute(sql`
    insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand) values (${storeId}::uuid, ${variants[sku]}::uuid, ${locationId}::uuid, ${onHand})
    on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand
  `);

const setVariant = (sku: string, cost: number | null, created: string) =>
  db().execute(sql`update commerce.product_variants set cost_minor = ${cost}, created_at = ${created}::timestamptz where id = ${variants[sku]}::uuid`);

beforeAll(async () => {
  const id = await makeStore(`invrep-${run}`);
  const otherId = await makeStore(`invrep-other-${run}`);
  store = storeOf(id, `invrep-${run}`);
  other = storeOf(otherId, `invrep-other-${run}`);
  Object.assign(variants, await skus(id));
  const [location] = await db().execute<Row>(sql`select id from commerce.inventory_locations where store_id = ${id}::uuid and active limit 1`);
  activeLocation = String(location.id);

  // A draft product and an archived one, each with a physical variant; a closed location with stock.
  for (const [handle, status, sku] of [
    ["draft-thing", "draft", "DRAFT-1"],
    ["archived-thing", "archived", "ARCH-1"],
  ] as const) {
    const [product] = await db().execute<Row>(sql`
      insert into commerce.products (store_id, handle, tax_code, status) values (${id}::uuid, ${handle}, 'txcd_99999999', 'draft') returning id
    `);
    const [variant] = await db().execute<Row>(sql`
      insert into commerce.product_variants (store_id, product_id, sku) values (${id}::uuid, ${String(product.id)}::uuid, ${sku}) returning id
    `);
    variants[sku] = String(variant.id);
    if (status === "archived") await db().execute(sql`update commerce.products set status = 'archived' where id = ${String(product.id)}::uuid`);
  }
  const [closed] = await db().execute<Row>(sql`
    insert into commerce.inventory_locations (store_id, name, country, active) values (${id}::uuid, 'Gammelt lager', 'NO', false) returning id
  `);
  await db().execute(sql`update commerce.product_variants set active = false where id = ${variants["DEMO-NOTEBOOK-DOTTED"]}::uuid`);
  // The demo thermos that keeps selling at zero (wave 3) is not one of the variants this report is about.
  await db().execute(sql`update commerce.product_variants set active = false where id = ${variants["DEMO-THERMOS"]}::uuid`);

  for (const [sku, onHand] of [
    ["DEMO-MUG-WHITE", 3],
    ["DEMO-MUG-BLACK", 0],
    ["DEMO-NOTEBOOK-LINED", 40],
    ["DEMO-NOTEBOOK-DOTTED", 7],
    ["DEMO-TOTE", 1],
    ["DEMO-LAMP", 20],
    ["DRAFT-1", 4],
    ["ARCH-1", 9],
  ] as const) {
    await setStock(id, sku, activeLocation, onHand);
  }
  await setStock(id, "DEMO-MUG-WHITE", String(closed.id), 100);
  // Two units held by a cart: on hand is on hand.
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${id}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.inventory_reservations (store_id, variant_id, location_id, quantity, cart_id, expires_at)
    values (${id}::uuid, ${variants["DEMO-MUG-WHITE"]}::uuid, ${activeLocation}::uuid, 2, ${String(cart.id)}::uuid, now() + interval '1 day')
  `);

  await setVariant("DEMO-MUG-WHITE", 3_000, "2026-01-01T10:00:00Z");
  await setVariant("DEMO-MUG-BLACK", 2_000, "2026-09-20T10:00:00Z");
  await setVariant("DEMO-NOTEBOOK-LINED", null, "2026-01-01T10:00:00Z");
  await setVariant("DEMO-TOTE", 1_000, "2026-01-01T10:00:00Z");
  await setVariant("DEMO-LAMP", 5_000, "2026-09-01T10:00:00Z");
  await setVariant("DRAFT-1", null, "2026-09-25T10:00:00Z");

  await sell(store, { sku: "DEMO-MUG-WHITE", qty: 2, at: "2026-09-29T10:00:00Z", cost: 3_000 });
  await sell(store, { sku: "DEMO-MUG-WHITE", qty: 5, at: "2026-09-20T10:00:00Z", cost: 3_000 });
  await sell(store, { sku: "DEMO-MUG-WHITE", qty: 10, at: "2026-08-15T10:00:00Z", cost: 3_000 });
  await sell(store, { sku: "DEMO-MUG-BLACK", qty: 3, at: "2026-09-25T10:00:00Z", cost: 2_000 });
  await sell(store, { sku: "DEMO-MUG-BLACK", qty: 7, at: "2025-01-01T10:00:00Z", cost: 2_000 });
  await sell(store, { sku: "DEMO-NOTEBOOK-LINED", qty: 4, at: "2026-06-01T10:00:00Z" });
  await sell(store, { sku: "DEMO-TOTE", qty: 1, at: "2026-09-29T10:00:00Z", cost: 1_000 });
  await sell(store, { sku: "DEMO-TOTE", qty: 4, at: "2026-09-27T10:00:00Z", cost: 1_000, restocked: { type: "order.refunded", quantity: 1 } });
  await sell(store, { sku: "DEMO-TOTE", qty: 2, at: "2026-09-28T10:00:00Z", cost: 1_000, restocked: { type: "order.restocked", quantity: 2 } });
  await sell(store, { sku: "DEMO-TOTE", qty: 1, at: "2026-09-10T10:00:00Z", cost: 1_000 });

  // Never counted: an unpaid order, a copied one, a host's, one placed after `now`.
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-inv-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  await sell(store, { sku: "DEMO-TOTE", qty: 50, at: "2026-09-29T11:00:00Z", status: "pending_payment", payment: "pending" });
  await sell(store, { sku: "DEMO-TOTE", qty: 60, at: "2026-09-29T11:00:00Z", copied: true });
  await sell(store, { sku: "DEMO-TOTE", qty: 70, at: "2026-09-29T11:00:00Z", host: String(host.id) });
  await sell(store, { sku: "DEMO-TOTE", qty: 80, at: "2026-10-01T10:00:00Z" });

  // Another store, with a good deal of stock: nothing of it may reach the first.
  const otherVariants = await skus(otherId);
  const [otherLocation] = await db().execute<Row>(sql`select id from commerce.inventory_locations where store_id = ${otherId}::uuid and active limit 1`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = 500 where variant_id = ${otherVariants["DEMO-LAMP"]}::uuid and location_id = ${String(otherLocation.id)}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

const byName = (report: Awaited<ReturnType<typeof inventoryReport>>) => new Map(report.rows.map((r) => [r.sku, r]));

describe("inventoryReport", () => {
  it("lists stocked goods only: active variants of products that are not archived, with their on hand in active locations", async () => {
    const report = await inventoryReport(store, NOW);
    expect(report.currency).toBe("NOK");
    expect(report.today).toBe("2026-09-30");
    expect(report.variants).toBe(6);
    expect(report.readTruncated).toBe(false);
    expect(report.rowsTruncated).toBe(false);
    expect([...byName(report).keys()].sort()).toEqual(["DEMO-LAMP", "DEMO-MUG-BLACK", "DEMO-MUG-WHITE", "DEMO-NOTEBOOK-LINED", "DEMO-TOTE", "DRAFT-1"]);
    const rows = byName(report);
    // 3 in the open location; the 100 in the closed one and the cart's two held units do not change it.
    expect(rows.get("DEMO-MUG-WHITE")!.onHand).toBe(3);
    expect(rows.get("DEMO-MUG-BLACK")!.onHand).toBe(0);
    expect(rows.get("DEMO-NOTEBOOK-LINED")!.onHand).toBe(40);
    expect(rows.get("DEMO-TOTE")!.onHand).toBe(1);
    expect(rows.get("DEMO-LAMP")!.onHand).toBe(20);
    expect(rows.get("DRAFT-1")!.onHand).toBe(4);
    expect(rows.get("DEMO-MUG-WHITE")).toMatchObject({ tracked: true, name: "Demo: Keramikkopp (white)", title: "Demo: Keramikkopp", handle: "demo-keramikkopp", options: ["white"], costMinor: 3_000 });
    // A product with no translation is named by its handle.
    expect(rows.get("DRAFT-1")).toMatchObject({ name: "draft-thing", costMinor: null });
  });

  it("counts units sold over 7, 30 and 90 days from paid orders, less what went back into stock", async () => {
    const rows = byName(await inventoryReport(store, NOW));
    // The white mug: 2 yesterday, 5 ten days ago, 10 forty-six days ago.
    expect(rows.get("DEMO-MUG-WHITE")).toMatchObject({ sold7: 2, sold30: 7, sold90: 17, soldPeriod: 7, lastSoldDaysAgo: 1, lastSoldAt: "2026-09-29T10:00:00.000Z" });
    // The tote: 1 + 4 (1 came back) + 2 (all came back) in the last week, 1 twenty days ago; the unpaid, copied, host's and later orders are no sales.
    expect(rows.get("DEMO-TOTE")).toMatchObject({ sold7: 4, sold30: 5, sold90: 5, lastSoldDaysAgo: 1 });
    // The black mug: 3 five days ago, so within the week too; 7 more over a year ago are not read.
    expect(rows.get("DEMO-MUG-BLACK")).toMatchObject({ sold7: 3, sold30: 3, sold90: 3, lastSoldDaysAgo: 5 });
    // Four notebooks on 1 June (noon in Oslo): 121 days before 30 September.
    expect(rows.get("DEMO-NOTEBOOK-LINED")).toMatchObject({ sold7: 0, sold30: 0, sold90: 0, lastSoldDaysAgo: 121 });
    // Never sold: no date, and the days it has been on offer.
    expect(rows.get("DEMO-LAMP")).toMatchObject({ sold30: 0, lastSoldDaysAgo: null, lastSoldAt: null, ageDays: 29 });
    expect(rows.get("DRAFT-1")).toMatchObject({ lastSoldDaysAgo: null, ageDays: 5 });
    expect(rows.get("DEMO-MUG-BLACK")!.ageDays).toBe(10);
  });

  it("works out days of stock, status and stock value for each variant", async () => {
    const rows = byName(await inventoryReport(store, NOW));
    // On hand / (0.6 x 7-day + 0.4 x 30-day units per day).
    expect(rows.get("DEMO-MUG-WHITE")!.daysOfStock).toBeCloseTo(3 / (0.6 * (2 / 7) + 0.4 * (7 / 30)), 10);
    expect(rows.get("DEMO-MUG-WHITE")!.daysOfStock).toBeCloseTo(11.33, 2);
    expect(rows.get("DEMO-TOTE")!.daysOfStock).toBeCloseTo(1 / (0.6 * (4 / 7) + 0.4 * (5 / 30)), 10);
    expect(rows.get("DEMO-TOTE")!.daysOfStock).toBeCloseTo(2.44, 2);
    // Nothing sold: no days of stock, never "forever".
    expect(rows.get("DEMO-LAMP")!.daysOfStock).toBeNull();
    expect(rows.get("DEMO-MUG-BLACK")!.daysOfStock).toBe(0);
    expect([...rows].map(([sku, r]) => [sku, r.status]).sort()).toEqual([
      ["DEMO-LAMP", "ok"],
      ["DEMO-MUG-BLACK", "out"],
      ["DEMO-MUG-WHITE", "low"],
      ["DEMO-NOTEBOOK-LINED", "dead"],
      ["DEMO-TOTE", "low"],
      ["DRAFT-1", "ok"],
    ]);
    // Stock value at cost: 3 x 30.00, 20 x 50.00; not for stock whose cost is unknown, and not for none left.
    expect(rows.get("DEMO-MUG-WHITE")!.valueMinor).toBe(9_000);
    expect(rows.get("DEMO-LAMP")!.valueMinor).toBe(100_000);
    expect(rows.get("DEMO-NOTEBOOK-LINED")!.valueMinor).toBeNull();
    expect(rows.get("DEMO-MUG-BLACK")!.valueMinor).toBeNull();
    // Sell-through of the last 30 days: 7 / (7 + 3).
    expect(rows.get("DEMO-MUG-WHITE")!.sellThrough).toBeCloseTo(0.7, 10);
    expect(rows.get("DEMO-LAMP")!.sellThrough).toBe(0);
  });

  it("gives the price without VAT in the main market, and nothing for a variant with no price", async () => {
    const rows = byName(await inventoryReport(store, NOW));
    // 899.00 with 25 % VAT, 249.00 likewise.
    expect(rows.get("DEMO-LAMP")!.priceExVatMinor).toBe(71_920);
    expect(rows.get("DEMO-MUG-BLACK")!.priceExVatMinor).toBe(19_920);
    expect(rows.get("DRAFT-1")!.priceExVatMinor).toBeNull();
  });

  it("totals the stock: value with its coverage, counts, dead stock, turnover and sell-through", async () => {
    const { totals } = await inventoryReport(store, NOW);
    expect(totals).toMatchObject({ variants: 6, out: 1, low: 2, ok: 2, dead: 1 });
    // 3 x 30.00 + 1 x 10.00 + 20 x 50.00; the notebooks (40) and the draft's four have no cost: counted apart, not valued at 0.
    expect(totals.value).toEqual({ valueMinor: 110_000, units: 68, unitsWithoutCost: 44, coverage: 24 / 68 });
    // The notebooks: 40 units, none of them with a cost to value.
    expect(totals.deadUnits).toBe(40);
    expect(totals.deadValueMinor).toBe(0);
    // COGS of 365 days, kept costs, net of restocks: mugs 17 x 30.00, black 3 x 20.00, totes (1 + 3 + 0 + 1) x 10.00; the notebooks' cost is unknown.
    expect(totals.cogs365Minor).toBe(51_000 + 6_000 + 5_000);
    // Of the 29 units sold in the year (17 + 3 + 5 + 4), 25 had a cost.
    expect(totals.cogs365Coverage).toBeCloseTo(25 / 29, 10);
    expect(totals.turnover).toBeCloseTo(62_000 / 110_000, 10);
    // 7 + 3 + 5 units in 30 days against 68 on hand.
    expect(totals.sold30).toBe(15);
    expect(totals.sellThrough30).toBeCloseTo(15 / 83, 10);
  });

  it("raises an alert for what sells and is gone or about to be, the gone first", async () => {
    const report = await inventoryReport(store, NOW);
    expect(report.alertsTotal).toBe(2);
    expect(report.alerts.map((a) => [a.row.sku, a.kind])).toEqual([
      ["DEMO-MUG-BLACK", "out"],
      ["DEMO-TOTE", "soon"],
    ]);
    expect(report.alerts[0].days).toBe(0);
    expect(report.alerts[1].days).toBeCloseTo(2.44, 2);
    // The white mug lasts 11 days: not within a week.
  });

  it("puts what needs a look first: out, then soonest to run out, dead stock, the rest", async () => {
    const report = await inventoryReport(store, NOW);
    expect(report.rows.map((r) => r.sku)).toEqual(["DEMO-MUG-BLACK", "DEMO-TOTE", "DEMO-MUG-WHITE", "DEMO-NOTEBOOK-LINED", "DEMO-LAMP", "DRAFT-1"]);
  });

  it("follows the clock: stock that stops selling becomes dead, and a sale older than a year is no date at all", async () => {
    // 15 January 2027: the mug and the tote were last sold 108 days ago, the lamp (29 days old on 30 September) has been on offer 136 days.
    const later = await inventoryReport(store, new Date("2027-01-15T10:00:00Z"));
    const rows = byName(later);
    expect(rows.get("DEMO-MUG-WHITE")).toMatchObject({ status: "dead", lastSoldDaysAgo: 108, sold7: 0, sold30: 0, sold90: 0 });
    expect(rows.get("DEMO-LAMP")!.status).toBe("dead");
    expect(rows.get("DEMO-MUG-BLACK")!.status).toBe("out");
    expect(later.totals).toMatchObject({ out: 1, dead: 5, low: 0, ok: 0 });
    // The tote's order after the first `now` (80 units on 1 October) is a sale by then; it counts for what it is.
    expect(rows.get("DEMO-TOTE")!.lastSoldDaysAgo).toBe(106);
    // A year and two days on, the last sale of the mug is outside what is read: no date, and still dead (it has long been on offer).
    const year = await inventoryReport(store, new Date("2027-10-01T10:00:00Z"));
    expect(byName(year).get("DEMO-MUG-WHITE")).toMatchObject({ lastSoldAt: null, lastSoldDaysAgo: null, status: "dead" });
    expect(year.alertsTotal).toBe(0);
  });

  it("never reaches another store, and a store with no stock has an empty page, not made-up figures", async () => {
    const mine = await inventoryReport(other, NOW);
    // The template's six stocked goods and the demo thermos that keeps selling at zero (wave 3).
    expect(mine.variants).toBe(7);
    const own = new Set(Object.values(await skus(other.id)));
    expect(mine.rows.every((r) => own.has(r.variantId))).toBe(true);
    expect(byName(mine).get("DEMO-LAMP")!.onHand).toBe(500);
    expect(mine.totals.sold30).toBe(0);
    expect(mine.totals.turnover).toBeNull();
    expect(mine.totals.cogs365Coverage).toBeNull();

    const emptyId = await makeStore(`invrep-empty-${run}`);
    await db().execute(sql`delete from commerce.inventory_levels where store_id = ${emptyId}::uuid`);
    await db().execute(sql`update commerce.product_variants set active = false where store_id = ${emptyId}::uuid`);
    const empty = await inventoryReport(storeOf(emptyId, `invrep-empty-${run}`), NOW);
    expect(empty.rows).toEqual([]);
    expect(empty.totals).toMatchObject({ variants: 0, out: 0, low: 0, dead: 0, ok: 0, turnover: null, sellThrough30: null });
    expect(empty.totals.value).toEqual({ valueMinor: 0, units: 0, unitsWithoutCost: 0, coverage: null });
    expect(empty.alerts).toEqual([]);
  });

  it("is plain data", async () => {
    const report = await inventoryReport(store, NOW);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
  });
});
