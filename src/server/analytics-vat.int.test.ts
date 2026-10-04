import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { periodTotals } = await import("./analytics-totals");
const { discountsReport } = await import("./analytics-discounts-data");
const { productsReport } = await import("./analytics-products-data");

/**
 * The analytics against orders whose VAT was not charged (D157, docs/analytics.md). The same sale to a business with a valid VAT
 * number in another EU country, with the VAT taken off (reverse charge), is the same sale: the same revenue without VAT, goods
 * before discounts, discounts and shipping income as the sale with VAT, and a VAT of 0 instead of its VAT. The VAT not charged is
 * never a discount. Money in NOK minor units; Europe/Oslo.
 *
 *   A  1 mug 100.00 (25 %) and 49.00 shipping           with VAT: total 149.00, VAT 29.80      reverse: total 119.20, relief 29.80
 *   B  1 mug 100.00 and 49.00 shipping, a code takes all the shipping off
 *                                                       with VAT: total 100.00, VAT 20.00      reverse: total 80.00, relief 20.00
 *   C  2 mugs 100.00 less 20.00 (a group's discount)     with VAT: total 180.00, VAT 36.00      reverse: total 144.00, relief 36.00
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const localization = localizationOf([], [{ currency: "NOK", rate: 10, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]);
const storeOf = (id: string, slug: string) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization }) as unknown as Store;
const PERIOD = customPeriod("2026-09-01", "2026-09-07");

let withVat: Store;
let reverse: Store;
const variants: Record<string, string> = {};
let serial = 0;
const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

type Sale = { at: string; qty: number; unit: number; discount?: number; shipping?: number; shippingDiscount?: number };

async function sale(s: Store, o: Sale, reverseCharge: boolean) {
  serial += 1;
  const shipping = o.shipping ?? 0;
  const shippingDiscount = o.shippingDiscount ?? 0;
  const lineDiscount = o.discount ?? 0;
  const lineTotal = o.unit * o.qty - lineDiscount;
  const lineTax = taxOf(lineTotal, 0.25);
  const shipTax = taxOf(shipping - shippingDiscount, 0.25);
  // With reverse charge the VAT is part of the discount, and the lines and the total are net.
  const lineRelief = reverseCharge ? lineTax : 0;
  const shipRelief = reverseCharge ? shipTax : 0;
  const relief = lineRelief + shipRelief;
  const subtotal = o.unit * o.qty;
  const discount = lineDiscount + shippingDiscount + relief;
  const total = subtotal + shipping - discount;
  const tax = reverseCharge ? 0 : lineTax + shipTax;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, vat_kind, vat_relief_minor, shipping_tax_rate)
    values (${s.id}::uuid, ${`V-${run}-${serial}`}, 'NO', 'NOK', 'nb-NO', ${`v${serial}@example.com`}, 'paid', ${subtotal}, ${shipping}, ${discount}, ${tax}, ${total},
      '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${reverseCharge ? "reverse_charge" : "standard"}, ${relief}, 0.25)
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, member_discount_minor,
      total_minor, tax_minor, tax_rate, tax_code, delivery, vat_relief_minor)
    values (${s.id}::uuid, ${String(order.id)}::uuid, ${variants[s.id]}, 'DEMO-MUG-WHITE', 'Mug', ${o.qty}, ${o.unit}, ${lineDiscount + lineRelief}, ${lineDiscount},
      ${lineTotal - lineRelief}, ${reverseCharge ? 0 : lineTax}, 0.25, 'txcd_99999999', 'physical'::commerce.delivery, ${lineRelief})
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${s.id}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_vat', ${total}, 'NOK', 'captured'::commerce.payment_status)
  `);
}

async function makeStore(slug: string): Promise<Store> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  const id = String(created.id);
  const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${id}::uuid and sku = 'DEMO-MUG-WHITE'`);
  variants[id] = String(variant.id);
  return storeOf(id, slug);
}

const sales: Sale[] = [
  { at: "2026-09-02T10:00:00+02:00", qty: 1, unit: 10_000, shipping: 4_900 },
  { at: "2026-09-03T10:00:00+02:00", qty: 1, unit: 10_000, shipping: 4_900, shippingDiscount: 4_900 },
  { at: "2026-09-04T10:00:00+02:00", qty: 2, unit: 10_000, discount: 2_000 },
];

beforeAll(async () => {
  withVat = await makeStore(`avat-a-${run}`);
  reverse = await makeStore(`avat-b-${run}`);
  for (const s of sales) {
    await sale(withVat, s, false);
    await sale(reverse, s, true);
  }
});

afterAll(async () => {
  await closeDb();
});

describe("analytics of orders whose VAT was not charged", () => {
  it("counts the same revenue, goods, discounts and shipping income without VAT as the sale with VAT, and a VAT of 0", async () => {
    const a = (await periodTotals(withVat, PERIOD)).totals;
    const b = (await periodTotals(reverse, PERIOD)).totals;
    expect(b.orders).toBe(a.orders);
    // 80.00 + 39.20 + 80.00 + 0 + 128.00 = revenue without VAT, the same either way.
    expect(a.revenueMinor).toBe(8_000 + 3_920 + 8_000 + 0 + 14_400);
    expect(b.revenueMinor).toBe(a.revenueMinor);
    expect(b.grossSalesMinor).toBe(a.grossSalesMinor);
    expect(b.discountsMinor).toBe(a.discountsMinor);
    expect(b.shippingMinor).toBe(a.shippingMinor);
    expect(b.units).toBe(a.units);
    // The VAT the shoppers paid, and the VAT of the sales that carried none.
    expect(a.vatMinor).toBe(2_980 + 2_000 + 3_600);
    expect(b.vatMinor).toBe(0);
    // The identity of the document holds for both.
    expect(b.grossSalesMinor - b.discountsMinor + b.shippingMinor).toBe(b.revenueMinor);
    // What was paid: the total with VAT, and the same less the VAT not charged.
    const [paid] = await db().execute<Row>(sql`select sum(total_minor)::int as total from commerce.orders where store_id = ${reverse.id}::uuid`);
    expect(Number(paid.total) + 2_980 + 2_000 + 3_600).toBe(14_900 + 10_000 + 18_000);
  });

  it("never counts the VAT not charged as a discount", async () => {
    const a = await discountsReport(withVat, PERIOD);
    const b = await discountsReport(reverse, PERIOD);
    // Only the code on order B (free shipping) and the group's discount on C are discounts, in either shop.
    expect(b.summary.discountedOrders).toBe(a.summary.discountedOrders);
    expect(b.breakdown.totalMinor).toBe(a.breakdown.totalMinor);
    expect(b.breakdown.kinds.map((k) => [k.kind, k.discountMinor])).toEqual(a.breakdown.kinds.map((k) => [k.kind, k.discountMinor]));
  });

  it("gives a product the same revenue and shipping, with VAT or without", async () => {
    const a = await productsReport(withVat, PERIOD);
    const b = await productsReport(reverse, PERIOD);
    expect(a.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(b.rows.map((r) => r.revenueMinor))).toBe(JSON.stringify(a.rows.map((r) => r.revenueMinor)));
  });
});
