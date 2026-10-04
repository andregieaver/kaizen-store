import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import type { AnalyticsSettings } from "@/lib/analytics-settings";
import { toRates } from "@/lib/currency";

import { customersReport } from "./analytics-customers-data";
import { periodTotals } from "./analytics-totals";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Analytics after a person is erased (wave 1g, D162, `docs/analytics.md`, "Erased customers"): an order whose personal data is restricted
 * (kept for the bookkeeping duty, with the person cut loose) or anonymised still counts in revenue, VAT, refunds and orders exactly as before,
 * but as its own anonymous customer: never joined to the person's other orders or to a later sign-up with the same address, never named in the
 * top-customers list, and never counted as nobody. A store with only such orders and a store with no orders at all give honest figures.
 */

const run = Date.now().toString(36);
const NOW = new Date();
const SETTINGS: AnalyticsSettings = { paymentFeeBps: 0, paymentFeeFixedMinor: 0, shippingCostMinor: 0, fixedCostsMonthlyMinor: 0, ltvLifespanYears: 3 };
const ALL = customPeriod("2019-01-01", "2026-12-31");
const SEPTEMBER = customPeriod("2026-09-01", "2026-09-30");

let store: Store;
let lone: Store;
const variants = new Map<string, string>();
const ids: Record<string, string> = {};

async function makeStore(slug: string): Promise<Store> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${slug}-${run}`}, 'Test', null) as id`);
  // Norway: bookkeeping is kept five years from the end of the calendar year of the sale (a store with no country keeps ten).
  await db().execute(sql`update commerce.stores set country = 'NO' where id = ${String(created.id)}::uuid`);
  const s = {
    id: String(created.id),
    slug: `${slug}-${run}`,
    timeZone: "Europe/Oslo",
    markets: [{ nativeCurrency: "NOK" }],
    localization: { locales: ["nb-NO"], currencies: [], rates: toRates([{ currency: "NOK", rate: 10, roundTo: 1 }]) },
  } as unknown as Store;
  const [v] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${s.id}::uuid limit 1`);
  variants.set(s.id, String(v.id));
  return s;
}

let n = 0;
/** A paid order of one line (VAT 25 % of the line's gross), its payment captured on the day the order was placed. */
async function order(s: Store, email: string, at: string, total: number, name = ""): Promise<string> {
  n += 1;
  const tax = Math.round(total - total / 1.25);
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at)
    values (${s.id}::uuid, ${`${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', ${total}, 0, 0, ${tax}, ${total}, ${JSON.stringify({ name })}::jsonb,
      ${JSON.stringify({ name, line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" })}::jsonb, ${at}::timestamptz)
    returning id
  `);
  const id = String(o.id);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, total_minor, tax_minor, tax_rate, tax_code)
    values (${s.id}::uuid, ${id}::uuid, ${variants.get(s.id)}::uuid, 'X', 'Thing', 1, ${total}, 1000, ${total}, ${tax}, 0.25, 'txcd_99999999')
  `);
  // The payment is last touched on the day of the sale, as it was then (the bookkeeping clock counts from it).
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, kaizen_fee_minor, currency, status, created_at, updated_at)
    values (${s.id}::uuid, ${id}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${total}, 0, 'NOK', 'captured', ${at}::timestamptz, ${at}::timestamptz)
  `);
  return id;
}

const erase = async (orderId: string, mode: "erasure" | "retention") => {
  const [row] = await db().execute<Row>(sql`select commerce.anonymise_order(${store.id}::uuid, ${orderId}::uuid, ${mode}) as r`);
  return String(row.r);
};

beforeAll(async () => {
  store = await makeStore("erased");
  lone = await makeStore("erased-lone");
  // An old sale (its bookkeeping period is over), and September's: Anna twice, Bjørn once.
  ids.old = await order(store, "old@example.com", "2019-03-01T10:00:00Z", 12_500, "Old Kunde");
  ids.a1 = await order(store, "anna@example.com", "2026-09-05T10:00:00Z", 10_000, "Anna A");
  ids.a2 = await order(store, "anna@example.com", "2026-09-10T10:00:00Z", 12_500, "Anna A");
  ids.b1 = await order(store, "bjorn@example.com", "2026-09-12T10:00:00Z", 5_000, "Bjørn B");
  // A refund of the second order, dated today.
  const [p] = await db().execute<Row>(sql`select id from commerce.payments where order_id = ${ids.a2}::uuid`);
  await db().execute(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
    values (${store.id}::uuid, ${String(p.id)}::uuid, 2500, 'test', ${`re_${run}`}, 'succeeded')
  `);
  ids.lone = await order(lone, "solo@example.com", "2026-09-05T10:00:00Z", 6_250, "Solo");
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const figures = async (s: Store, period = ALL) => {
  const { totals } = await periodTotals(s, period, { ...SETTINGS, updatedAt: null } as never);
  return { orders: totals.orders, revenue: totals.revenueMinor, vat: totals.vatMinor, refunds: totals.refundsMinor, newCustomers: totals.newCustomers, returning: totals.returningCustomers };
};

describe("analytics after an erasure (D162)", () => {
  it("has the plain figures first: four paid orders from three people before any erasure", async () => {
    // Revenue without VAT: 10 000 + 8 000 + 10 000 + 4 000; VAT 2 500 + 2 000 + 2 500 + 1 000; the refund of 2 500 with VAT is 2 000 without.
    expect(await figures(store)).toEqual({ orders: 4, revenue: 32_000, vat: 8_000, refunds: 2_000, newCustomers: 3, returning: 0 });
    // To date: the old customer, Anna and Bjørn.
    const r = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(r.customers).toBe(3);
    expect(r.topCustomers.map((c) => c.key)).toEqual(["anna@example.com", "bjorn@example.com"]);
  });

  it("restricts a sale inside its bookkeeping period: revenue, VAT and refunds are as they were, the order is its own anonymous customer", async () => {
    expect(await erase(ids.a2, "erasure")).toBe("restricted");
    const [row] = await db().execute<Row>(sql`select restricted_at, customer_id from commerce.orders where id = ${ids.a2}::uuid`);
    expect(row.restricted_at).not.toBeNull();
    // The same money; one more customer, because Anna's second order is no longer hers.
    expect(await figures(store)).toEqual({ orders: 4, revenue: 32_000, vat: 8_000, refunds: 2_000, newCustomers: 4, returning: 0 });
  });

  it("counts the restricted order as a customer of its own in the Customers report, and never names it", async () => {
    const r = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(r.customers).toBe(4);
    // The list names people: an order with no person is not in it, and no address of the erased order is left in the report.
    expect(r.topCustomers.map((c) => c.key)).toEqual(["anna@example.com", "bjorn@example.com"]);
    expect(r.topCustomers.some((c) => c.key.startsWith("order:"))).toBe(false);
    expect(JSON.stringify(r)).not.toContain("order:");
    // Period revenue of the three stays: 8 000 (Anna's first), 10 000 (the restricted one) and 4 000.
    const month = await figures(store, SEPTEMBER);
    // (The refund is dated today, in October: a refund counts in the period of its own date.)
    expect(month).toMatchObject({ orders: 3, revenue: 22_000, refunds: 0 });
  });

  it("anonymises a sale whose period is over: the same money, still one customer", async () => {
    const before = await figures(store);
    expect(await erase(ids.old, "retention")).toBe("anonymised");
    const [row] = await db().execute<Row>(sql`select email, anonymised_at from commerce.orders where id = ${ids.old}::uuid`);
    expect(row.email).toBe("[removed]");
    expect(await figures(store)).toEqual(before);
  });

  it("never joins an erased order to a later sign-up with the same address, nor two anonymised orders to each other", async () => {
    // Anna comes back and buys again with the same address: she is one customer (her first order and this), the restricted order stays apart.
    await order(store, "anna@example.com", "2026-09-20T10:00:00Z", 2_500, "Anna A");
    const r = await customersReport(store, SEPTEMBER, SETTINGS, NOW);
    expect(r.customers).toBe(4);
    const anna = r.topCustomers.find((c) => c.key === "anna@example.com");
    expect(anna).toMatchObject({ orders: 2, revenueMinor: 10_000 });
    // A second restricted order is a customer of its own too: two orders from the same person are two anonymous customers.
    const extra = await order(store, "bjorn@example.com", "2026-09-22T10:00:00Z", 3_125, "Bjørn B");
    expect(await erase(extra, "erasure")).toBe("restricted");
    expect((await customersReport(store, SEPTEMBER, SETTINGS, NOW)).customers).toBe(5);
  });

  it("is a store's own: another store's figures do not move, and a store with one restricted order is one anonymous customer, not none", async () => {
    expect(await figures(lone)).toMatchObject({ orders: 1, revenue: 5_000, newCustomers: 1 });
    const [row] = await db().execute<Row>(sql`select commerce.anonymise_order(${lone.id}::uuid, ${ids.lone}::uuid, 'erasure') as r`);
    expect(row.r).toBe("restricted");
    expect(await figures(lone)).toMatchObject({ orders: 1, revenue: 5_000, newCustomers: 1 });
    const r = await customersReport(lone, SEPTEMBER, SETTINGS, NOW);
    expect(r.customers).toBe(1);
    expect(r.topCustomers).toEqual([]);
  });
});
