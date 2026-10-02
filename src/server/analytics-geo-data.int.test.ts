import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
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

const { geoReport, CITY_LIMIT, CITY_READ_CAP } = await import("./analytics-geo-data");
const { periodTotals } = await import("./analytics-totals");

/**
 * Sales by country and city (D152, docs/analytics.md) against a small hand-made shop. Money in NOK minor units (the main
 * currency) without VAT, EUR at 1 EUR = 10 NOK, SEK with no rate, Europe/Oslo (UTC+2 in September). The period is 1-7 September.
 * Every sale is one line at 25 % VAT; revenue is what is left after VAT, discounts and with shipping income.
 *
 *   id   day        market  paid in  city (country)                 revenue   who
 *   G1   09-01      NO      NOK      " Oslo " (NO)                    100.00   Anna, an account
 *   G2   09-02      NO      NOK      "oslo" (NO), 50.00 discount      160.00   Bjorn
 *   G3   09-02      NO      NOK      "Oslo" (NO), 50.00 shipping       90.00   Bjorn again
 *   G4   09-03      NO      NOK      Bergen (NO)                      300.00   Cecilie
 *   G5   09-03      SE      EUR      Stockholm (SE)                    10.00 EUR = 100.00   David
 *   G6   09-04      DK      EUR      København (DK)                    20.00 EUR = 200.00   Erik
 *   G7   09-05      NO      NOK      none (a digital order)            50.00   Fiona
 *   G8   09-05      NO      NOK      Bergen (NO), cancelled but paid  100.00   Anna again
 *   G9   09-06      DK      NOK      Aarhus (DK)                      150.00   Erik again
 *   G10  09-07 23:30 NO     NOK      Tromsø (NO)                       50.00   Gina
 *   G11  09-06      NO      NOK      Stockholm (SE), bought in Norway 100.00   Hans
 *   G12  09-04      NO      NOK      Bergen (NO)                       50.00   Ida, first bought 08-20 (before the period)
 *   G13  09-04      SE      SEK      Stockholm (SE)                   no rate: left out, counted   Sven
 *   host's, copied, unpaid, after the period, another store's: never
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const localization = localizationOf(
  [],
  [
    { currency: "NOK", rate: 10, roundTo: 1 },
    { currency: "EUR", rate: 1, roundTo: 1 },
  ],
  [no],
);
const storeOf = (id: string, slug: string) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization }) as unknown as Store;

let store: Store;
let manyCities: Store;
let empty: Store;
let serial = 0;

const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

type Place = {
  currency?: string;
  market?: string;
  at: string;
  email: string;
  customerId?: string | null;
  status?: string;
  unit: number;
  discount?: number;
  shipping?: number;
  address?: Record<string, unknown>;
  payment?: { status?: string } | null;
  host?: string | null;
  copied?: boolean;
};

/** One order with one physical line at 25 % VAT, no cost known, and a captured payment. */
async function placeOrder(s: Store, o: Place) {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const discount = o.discount ?? 0;
  const shipping = o.shipping ?? 0;
  const lineTotal = o.unit - discount;
  const tax = taxOf(lineTotal, 0.25) + taxOf(shipping, 0.25);
  const total = o.unit + shipping - discount;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, host_id, copied_from)
    values (${s.id}::uuid, ${o.copied ? `C-${run}-${serial}` : `T-${run}-${serial}`}, ${o.market ?? "NO"}, ${currency}, 'nb-NO', ${o.email}, ${o.customerId ?? null}::uuid,
      ${o.status ?? "paid"}, ${o.unit}, ${shipping}, ${discount}, ${tax}, ${total}, '{}'::jsonb, ${JSON.stringify(o.address ?? {})}::jsonb,
      ${o.at}::timestamptz, ${o.host ?? null}, ${o.copied ? crypto.randomUUID() : null})
    returning id
  `);
  const insertLine = (runner: Pick<ReturnType<typeof db>, "execute">) =>
    runner.execute(sql`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${s.id}::uuid, ${String(order.id)}::uuid, 'GEO', 'GEO', 1, ${o.unit}, ${discount}, ${lineTotal}, ${taxOf(lineTotal, 0.25)}, 0.25, 'txcd_99999999', 'physical')
    `);
  if (o.copied) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
      await insertLine(tx);
    });
  } else {
    await insertLine(db());
  }
  if (o.payment !== null && !o.copied) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${s.id}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_geo', ${total}, ${currency}, ${o.payment?.status ?? "captured"}::commerce.payment_status)
    `);
  }
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

const addr = (city: string, country: string) => ({ name: "A Shopper", line1: "Gate 1", postalCode: "0155", city, country });
const PERIOD = customPeriod("2026-09-01", "2026-09-07");

beforeAll(async () => {
  const id = await makeStore(`geo-${run}`);
  const otherId = await makeStore(`geo-other-${run}`);
  const manyId = await makeStore(`geo-many-${run}`);
  const emptyId = await makeStore(`geo-empty-${run}`);
  store = storeOf(id, `geo-${run}`);
  manyCities = storeOf(manyId, `geo-many-${run}`);
  empty = storeOf(emptyId, `geo-empty-${run}`);
  const other = storeOf(otherId, `geo-other-${run}`);

  // Anna has an account (her orders follow it); Ida bought before the period.
  const [anna] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name, email_verified_at) values (${id}::uuid, 'anna@example.com', 'Anna', now()) returning id`);
  const annaId = String(anna.id);

  await placeOrder(store, { at: "2026-08-20T10:00:00+02:00", email: "ida@example.com", unit: 6_250, address: addr("Bergen", "NO") });

  await placeOrder(store, { at: "2026-09-01T12:00:00+02:00", email: "", customerId: annaId, unit: 12_500, address: addr(" Oslo ", "NO") });
  await placeOrder(store, { at: "2026-09-02T10:00:00+02:00", email: "bjorn@example.com", unit: 25_000, discount: 5_000, address: addr("oslo", "NO") });
  await placeOrder(store, { at: "2026-09-02T15:00:00+02:00", email: "Bjorn@Example.com", unit: 6_250, shipping: 5_000, address: addr("Oslo", "NO") });
  await placeOrder(store, { at: "2026-09-03T10:00:00+02:00", email: "cecilie@example.com", unit: 37_500, address: addr("Bergen", "NO") });
  await placeOrder(store, { at: "2026-09-03T12:00:00+02:00", email: "david@example.com", market: "SE", currency: "EUR", unit: 1_250, address: addr("Stockholm", "SE") });
  await placeOrder(store, { at: "2026-09-04T09:00:00+02:00", email: "erik@example.com", market: "DK", currency: "EUR", unit: 2_500, address: addr("København", "DK") });
  await placeOrder(store, { at: "2026-09-04T11:00:00+02:00", email: "ida@example.com", unit: 6_250, address: addr("Bergen", "NO") });
  await placeOrder(store, { at: "2026-09-04T12:00:00+02:00", email: "sven@example.com", market: "SE", currency: "SEK", unit: 12_500, address: addr("Stockholm", "SE") });
  await placeOrder(store, { at: "2026-09-05T09:00:00+02:00", email: "fiona@example.com", unit: 6_250 });
  await placeOrder(store, { at: "2026-09-05T10:00:00+02:00", email: "", customerId: annaId, status: "cancelled", unit: 12_500, address: addr("Bergen", "NO") });
  await placeOrder(store, { at: "2026-09-06T10:00:00+02:00", email: "erik@example.com", market: "DK", unit: 18_750, address: addr("Aarhus", "DK") });
  await placeOrder(store, { at: "2026-09-06T14:00:00+02:00", email: "hans@example.com", unit: 12_500, address: addr("Stockholm", "SE") });
  await placeOrder(store, { at: "2026-09-07T23:30:00+02:00", email: "gina@example.com", unit: 6_250, address: addr("Tromsø", "NO") });

  // Never counted: a host's order, a copied order, an unpaid one, one just after the period, another store's.
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-geo-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  await placeOrder(store, { at: "2026-09-03T13:00:00+02:00", email: "host-guest@example.com", host: String(host.id), unit: 100_000, address: addr("Oslo", "NO") });
  await placeOrder(store, { at: "2026-09-03T14:00:00+02:00", email: "copied@example.com", copied: true, unit: 100_000, address: addr("Oslo", "NO") });
  await placeOrder(store, { at: "2026-09-03T15:00:00+02:00", email: "pia@example.com", status: "pending_payment", payment: { status: "pending" }, unit: 100_000, address: addr("Oslo", "NO") });
  await placeOrder(store, { at: "2026-09-08T00:30:00+02:00", email: "late@example.com", unit: 100_000, address: addr("Oslo", "NO") });
  await placeOrder(other, { at: "2026-09-02T10:00:00+02:00", email: "elsewhere@example.com", unit: 100_000, address: addr("Oslo", "NO") });

  // A store with 520 cities, set-based: city i sold for i x 1.00, in one order.
  await db().execute(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at)
    select ${manyId}::uuid, 'M-' || ${run} || '-' || i, 'NO', 'NOK', 'nb-NO', 'm' || i || '@example.com', 'paid', i * 100, 0, 0, 0, i * 100, '{}'::jsonb,
      jsonb_build_object('city', 'City ' || lpad(i::text, 4, '0'), 'country', 'NO'), '2026-09-03T10:00:00+02:00'::timestamptz
    from generate_series(1, ${CITY_READ_CAP + 20}) as i
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    select store_id, id, 'stripe', 'pi_' || number, 'acct_geo', total_minor, 'NOK', 'captured' from commerce.orders where store_id = ${manyId}::uuid
  `);
});

afterAll(async () => {
  await closeDb();
});

describe("geoReport: countries", () => {
  it("adds up paid orders by market, without VAT, in the main currency, ranked by revenue", async () => {
    const r = await geoReport(store, PERIOD);
    expect(r.currency).toBe("NOK");
    expect(r.period).toEqual({ from: "2026-09-01", to: "2026-09-08", days: 7 });
    // Norway: G1 100.00 + G2 160.00 + G3 90.00 + G4 300.00 + G7 50.00 + G8 100.00 + G10 50.00 + G11 100.00 + G12 50.00 = 1 000.00 in nine orders.
    // Denmark: G6 20.00 EUR = 200.00, G9 150.00 = 350.00 in two. Sweden: G5 10.00 EUR = 100.00 in one (G13 has no rate).
    expect(r.countries.map((c) => [c.code, c.name, c.orders, c.revenueMinor])).toEqual([
      ["NO", "Norway", 9, 100_000],
      ["DK", "Denmark", 2, 35_000],
      ["SE", "Sweden", 1, 10_000],
    ]);
    expect(r.countries.map((c) => c.aovMinor)).toEqual([11_111, 17_500, 10_000]);
    expect(r.countries.map((c) => c.shareOfRevenue)).toEqual([100_000 / 145_000, 35_000 / 145_000, 10_000 / 145_000]);
    expect(r.totals).toEqual({ orders: 12, revenueMinor: 145_000, aovMinor: 12_083, newCustomers: 8 });
  });

  it("counts a new customer in the market of their first paid order, and as many as the overview does", async () => {
    const r = await geoReport(store, PERIOD);
    // Anna (an account), Bjorn (his two orders are one customer, whatever the spelling), Cecilie, Fiona, Gina, Hans in Norway; David in
    // Sweden; Erik in Denmark. Ida bought on 08-20 and Anna and Erik's second orders are not new; Sven's only order has no rate.
    expect(r.countries.map((c) => [c.code, c.newCustomers])).toEqual([
      ["NO", 6],
      ["DK", 1],
      ["SE", 1],
    ]);
    const { totals } = await periodTotals(store, PERIOD);
    expect(r.totals.newCustomers).toBe(totals.newCustomers);
    expect(r.totals.orders).toBe(totals.orders);
    expect(r.totals.revenueMinor).toBe(totals.revenueMinor);
  });

  it("leaves conversion to the traffic report and counts what it left out for want of a rate", async () => {
    const r = await geoReport(store, PERIOD);
    expect(r.countries.every((c) => c.sessions === null && c.conversion === null)).toBe(true);
    // G13 (SEK) is left out of every figure and counted.
    expect(r.unconverted).toBe(1);
    expect(r.missingCurrencies).toEqual(["SEK"]);
  });

  it("ignores host, copied, unpaid and later orders, and another store's", async () => {
    const r = await geoReport(store, PERIOD);
    // Each of those four was 1 000.00 in Oslo: none of it is there.
    const oslo = r.cities.find((c) => c.key === "NO|oslo")!;
    expect(oslo.revenueMinor).toBe(35_000);
    expect(r.totals.revenueMinor).toBe(145_000);
  });

  it("is empty, not an error, for a store with no sales", async () => {
    const r = await geoReport(empty, PERIOD);
    expect(r.countries).toEqual([]);
    expect(r.cities).toEqual([]);
    expect(r.totals).toEqual({ orders: 0, revenueMinor: 0, aovMinor: null, newCustomers: 0 });
    expect(r.noAddress).toMatchObject({ orders: 0, revenueMinor: 0, shareOfRevenue: null });
  });
});

describe("geoReport: cities", () => {
  it("groups by country and the city's lower-cased, trimmed name, shows the commonest spelling, and ranks by revenue", async () => {
    const r = await geoReport(store, PERIOD);
    // Oslo: " Oslo ", "oslo", "Oslo" are one city of three orders, written "Oslo" most often. Bergen: G4, G8 (cancelled but paid) and G12.
    // Stockholm: G5 (EUR, bought in Sweden) and G11 (bought in Norway) are one city of two orders. København and Stockholm tie at 200.00:
    // the one with more orders comes first.
    expect(r.cities.map((c) => [c.key, c.city, c.country, c.countryName, c.orders, c.revenueMinor])).toEqual([
      ["NO|bergen", "Bergen", "NO", "Norway", 3, 45_000],
      ["NO|oslo", "Oslo", "NO", "Norway", 3, 35_000],
      ["SE|stockholm", "Stockholm", "SE", "Sweden", 2, 20_000],
      ["DK|københavn", "København", "DK", "Denmark", 1, 20_000],
      ["DK|aarhus", "Aarhus", "DK", "Denmark", 1, 15_000],
      ["NO|tromsø", "Tromsø", "NO", "Norway", 1, 5_000],
    ]);
    expect(r.cities.map((c) => c.aovMinor)).toEqual([15_000, 11_667, 10_000, 20_000, 15_000, 5_000]);
  });

  it("counts orders with no address under 'No address', and the parts add up to the whole", async () => {
    const r = await geoReport(store, PERIOD);
    expect(r.noAddress).toEqual({ label: "No address", orders: 1, revenueMinor: 5_000, shareOfRevenue: 5_000 / 145_000 });
    expect(r.otherCities).toEqual({ cities: 0, orders: 0, revenueMinor: 0 });
    const cityRevenue = r.cities.reduce((s, c) => s + c.revenueMinor, 0);
    const cityOrders = r.cities.reduce((s, c) => s + c.orders, 0);
    expect(cityRevenue + r.otherCities.revenueMinor + r.noAddress.revenueMinor).toBe(r.totals.revenueMinor);
    expect(cityOrders + r.otherCities.orders + r.noAddress.orders).toBe(r.totals.orders);
  });

  it("shows the best fifteen and says what is in the rest, even when more cities than are read exist", async () => {
    const r = await geoReport(manyCities, PERIOD);
    const total = CITY_READ_CAP + 20;
    expect(r.cities).toHaveLength(CITY_LIMIT);
    // The best is the last city, 520.00; each city is its own, so the order and the revenue run down by 1.00.
    expect(r.cities[0]).toMatchObject({ city: `City 0${total}`, orders: 1, revenueMinor: total * 100 });
    expect(r.cities[CITY_LIMIT - 1].revenueMinor).toBe((total - CITY_LIMIT + 1) * 100);
    expect(r.totals.orders).toBe(total);
    expect(r.truncated).toBe(true);
    // Read: the best 500 cities, so 485 are in the rest by name; but the orders and revenue of the rest come from the whole.
    expect(r.otherCities.cities).toBe(CITY_READ_CAP - CITY_LIMIT);
    expect(r.otherCities.orders).toBe(total - CITY_LIMIT);
    const topRevenue = r.cities.reduce((s, c) => s + c.revenueMinor, 0);
    expect(r.otherCities.revenueMinor).toBe(r.totals.revenueMinor - topRevenue);
    expect(r.noAddress.orders).toBe(0);
  });

  it("is not truncated when every city was read", async () => {
    expect((await geoReport(store, PERIOD)).truncated).toBe(false);
  });
});
