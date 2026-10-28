import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { liveFigures, ACTIVE_MINUTES, CART_MINUTES } = await import("./analytics-live");

/**
 * The Live page's figures (wave 8 unit C, D347) on a store of their own, at 12:00 Oslo time on 2 October 2026. Money in NOK minor units
 * without VAT, 1 EUR = 10 NOK, SEK with no rate:
 *
 *   visits:  A (NO) seen 2 minutes ago, B (SE) 2 minutes ago, C (NO) 20 minutes ago, D yesterday's row
 *   orders today, paid:  125.00 NOK (VAT 25.00), 12.50 EUR (VAT 2.50) and 50.00 SEK
 *   carts:  one changed 5 minutes ago with a line, one changed 40 minutes ago, one with nothing in it
 *   checkouts:  an order waiting for payment placed 10 minutes ago, and one placed an hour ago
 */

const run = Date.now().toString(36);
const NOW = new Date("2026-10-02T10:00:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const localization = localizationOf(
  [],
  [
    { currency: "NOK", rate: 10, roundTo: 1 },
    { currency: "EUR", rate: 1, roundTo: 1 },
  ],
  [no],
);

let store: Store;
let quiet: Store;
let serial = 0;

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}
const storeOf = (id: string, slug: string, counting: boolean) =>
  ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization, visitCounting: counting }) as unknown as Store;

async function visit(day: string, visitor: string, market: string, seen: string) {
  await db().execute(sql`
    insert into commerce.visits (store_id, day, visitor, market_code, device, channel, landing_path, first_seen, last_seen)
    values (${store.id}::uuid, ${day}::date, ${visitor}, ${market}, 'mobile', 'direct', '/', ${seen}::timestamptz, ${seen}::timestamptz)`);
}

async function order(o: { currency: string; total: number; tax: number; at: string; paid: boolean }) {
  serial += 1;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor,
      total_minor, billing_address, shipping_address, placed_at, source, copied_from)
    values (${store.id}::uuid, ${`L-${run}-${serial}`}, 'NO', ${o.currency}, 'nb-NO', 'live@example.com', ${o.paid ? "paid" : "pending_payment"},
      ${o.total}, 0, 0, ${o.tax}, ${o.total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, 'checkout', null)
    returning id`);
  if (o.paid) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${store.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`pi_live_${run}_${serial}`}, 'acct_live', ${o.total}, ${o.currency}, 'captured')`);
  }
}

async function cart(changed: string, withLine: boolean) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, updated_at)
    values (${store.id}::uuid, 'NO', 'NOK', 'nb-NO', ${NOW.toISOString()}::timestamptz + interval '30 days', ${changed}::timestamptz) returning id`);
  if (withLine) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${store.id}::uuid, ${String(row.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${store.id}::uuid limit 1`);
  }
}

beforeAll(async () => {
  store = storeOf(await makeStore(`live-${run}`), `live-${run}`, true);
  quiet = storeOf(await makeStore(`live-quiet-${run}`), `live-quiet-${run}`, false);
  await visit("2026-10-02", "a".repeat(24), "NO", ago(2));
  await visit("2026-10-02", "b".repeat(24), "SE", ago(2));
  await visit("2026-10-02", "c".repeat(24), "NO", ago(ACTIVE_MINUTES * 4));
  await visit("2026-10-01", "d".repeat(24), "NO", ago(60 * 20));
  await order({ currency: "NOK", total: 12_500, tax: 2_500, at: ago(60), paid: true });
  await order({ currency: "EUR", total: 1_250, tax: 250, at: ago(90), paid: true });
  await order({ currency: "SEK", total: 5_000, tax: 1_000, at: ago(30), paid: true });
  await order({ currency: "NOK", total: 7_000, tax: 1_400, at: ago(10), paid: false });
  await order({ currency: "NOK", total: 7_000, tax: 1_400, at: ago(60), paid: false });
  await cart(ago(5), true);
  await cart(ago(CART_MINUTES + 10), true);
  await cart(ago(5), false);
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("liveFigures (D347)", () => {
  it("counts the visitors seen in the last minutes, by country, and today's visits", async () => {
    const live = await liveFigures(store, NOW);
    expect(live.today).toBe("2026-10-02");
    expect(live.counting).toBe(true);
    expect(live.visitorsNow).toBe(2);
    expect(live.byCountry).toEqual([
      { code: "NO", visitors: 1 },
      { code: "SE", visitors: 1 },
    ]);
    expect(live.visitsToday).toBe(3);
  });

  it("counts today's paid orders and their revenue without VAT in the main currency, a euro order converted and a currency with no rate left out and counted", async () => {
    const live = await liveFigures(store, NOW);
    expect(live.currency).toBe("NOK");
    // 100.00 NOK + 10.00 EUR (= 100.00 NOK); the SEK order is left out of the money and counted.
    expect(live.revenueTodayMinor).toBe(20_000);
    expect(live.unconverted).toBe(1);
    expect(live.missingCurrencies).toEqual(["SEK"]);
    // As Finance counts them (periodTotals()): an order in a currency with no rate is left out of the count too, and counted in `unconverted`.
    expect(live.ordersToday).toBe(2);
  });

  it("counts carts with something in them changed lately, and checkouts still open", async () => {
    const live = await liveFigures(store, NOW);
    expect(live.cartsInUse).toBe(1);
    expect(live.checkoutsInProgress).toBe(1);
  });

  it("gives no visitor figure, rather than zero, while visits are not counted", async () => {
    const live = await liveFigures(quiet, NOW);
    expect(live.counting).toBe(false);
    expect(live.visitorsNow).toBeNull();
    expect(live.visitsToday).toBeNull();
    expect(live.byCountry).toEqual([]);
    expect(live.ordersToday).toBe(0);
    expect(live.cartsInUse).toBe(0);
  });
});
