import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { buildHeatmap } from "@/lib/analytics-heatmap";
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

const { timeReport } = await import("./analytics-time-data");
const { periodTotals } = await import("./analytics-totals");

/**
 * Sales by weekday, hour and day (D152, docs/analytics.md) against a small hand-made shop. Money in NOK minor units (the main
 * currency) without VAT, EUR at 1 EUR = 10 NOK, SEK with no rate, Europe/Oslo (UTC+2 in September, UTC+1 from 25 October).
 * The period is Tuesday 1 to Monday 7 September; every sale is one line at 25 % VAT.
 *
 *   id   when                      what                                               revenue
 *   T1   Tue 09-01 09:15           1 line 125.00                                       100.00
 *   T2   Tue 09-01 09:45           125.00 less 25.00 discount                           80.00
 *   T3   Tue 09-01 21:05           EUR 12.50                                            10.00 EUR = 100.00
 *   T4   Wed 09-02 09:00           37.50 and 12.50 shipping                             40.00
 *   T9   Wed 09-02 14:00           100.00, cancelled but paid                           80.00
 *   T5   Fri 09-04 23:59           150.00                                              120.00
 *   T6   Sat 09-05 00:00           50.00                                                40.00
 *   T7   Sun 09-06 12:30           SEK (no rate): left out, counted
 *   T8   Mon 09-07 23:30           75.00                                                60.00
 *   host's, copied, unpaid, 09-08 00:30, another store's: never
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
let empty: Store;
let serial = 0;

const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

type Place = {
  currency?: string;
  at: string;
  email?: string;
  status?: string;
  unit: number;
  discount?: number;
  shipping?: number;
  payment?: { status?: string } | null;
  host?: string | null;
  copied?: boolean;
};

async function placeOrder(s: Store, o: Place) {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const discount = o.discount ?? 0;
  const shipping = o.shipping ?? 0;
  const lineTotal = o.unit - discount;
  const tax = taxOf(lineTotal, 0.25) + taxOf(shipping, 0.25);
  const total = o.unit + shipping - discount;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, host_id, copied_from)
    values (${s.id}::uuid, ${o.copied ? `C-${run}-${serial}` : `T-${run}-${serial}`}, 'NO', ${currency}, 'nb-NO', ${o.email ?? `t${serial}@example.com`},
      ${o.status ?? "paid"}, ${o.unit}, ${shipping}, ${discount}, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb,
      ${o.at}::timestamptz, ${o.host ?? null}, ${o.copied ? crypto.randomUUID() : null})
    returning id
  `);
  const insertLine = (runner: Pick<ReturnType<typeof db>, "execute">) =>
    runner.execute(sql`
      insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${s.id}::uuid, ${String(order.id)}::uuid, 'TIME', 'TIME', 1, ${o.unit}, ${discount}, ${lineTotal}, ${taxOf(lineTotal, 0.25)}, 0.25, 'txcd_99999999', 'physical')
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
      values (${s.id}::uuid, ${String(order.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_time', ${total}, ${currency}, ${o.payment?.status ?? "captured"}::commerce.payment_status)
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

const PERIOD = customPeriod("2026-09-01", "2026-09-07");

beforeAll(async () => {
  const id = await makeStore(`time-${run}`);
  const otherId = await makeStore(`time-other-${run}`);
  const emptyId = await makeStore(`time-empty-${run}`);
  store = storeOf(id, `time-${run}`);
  empty = storeOf(emptyId, `time-empty-${run}`);
  const other = storeOf(otherId, `time-other-${run}`);

  await placeOrder(store, { at: "2026-09-01T09:15:00+02:00", unit: 12_500 });
  await placeOrder(store, { at: "2026-09-01T09:45:00+02:00", unit: 12_500, discount: 2_500 });
  await placeOrder(store, { at: "2026-09-01T21:05:00+02:00", currency: "EUR", unit: 1_250 });
  await placeOrder(store, { at: "2026-09-02T09:00:00+02:00", unit: 3_750, shipping: 1_250 });
  await placeOrder(store, { at: "2026-09-02T14:00:00+02:00", status: "cancelled", unit: 10_000 });
  await placeOrder(store, { at: "2026-09-04T23:59:00+02:00", unit: 15_000 });
  await placeOrder(store, { at: "2026-09-05T00:00:00+02:00", unit: 5_000 });
  await placeOrder(store, { at: "2026-09-06T12:30:00+02:00", currency: "SEK", unit: 12_500 });
  await placeOrder(store, { at: "2026-09-07T23:30:00+02:00", unit: 7_500 });

  // Never counted.
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-time-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${id}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  await placeOrder(store, { at: "2026-09-03T13:00:00+02:00", host: String(host.id), unit: 100_000 });
  await placeOrder(store, { at: "2026-09-03T14:00:00+02:00", copied: true, unit: 100_000 });
  await placeOrder(store, { at: "2026-09-03T15:00:00+02:00", status: "pending_payment", payment: { status: "pending" }, unit: 100_000 });
  await placeOrder(store, { at: "2026-09-08T00:30:00+02:00", unit: 100_000 });
  await placeOrder(other, { at: "2026-09-02T10:00:00+02:00", unit: 100_000 });

  // The night clocks go back (2026-10-25): 02:30 comes twice, as 00:30Z and 01:30Z. Then 00:30 on the 26th, which is the next day.
  await placeOrder(store, { at: "2026-10-25T00:30:00Z", unit: 12_500 });
  await placeOrder(store, { at: "2026-10-25T01:30:00Z", unit: 6_250 });
  await placeOrder(store, { at: "2026-10-25T23:30:00Z", unit: 6_250 });
});

afterAll(async () => {
  await closeDb();
});

describe("timeReport: weekday and hour", () => {
  it("puts each paid order in its weekday and hour in the store's time zone, without VAT, in the main currency", async () => {
    const r = await timeReport(store, PERIOD);
    expect(r.currency).toBe("NOK");
    expect(r.rows).toEqual([
      { weekday: 1, hour: 23, orders: 1, revenueMinor: 6_000 },
      { weekday: 2, hour: 9, orders: 2, revenueMinor: 18_000 },
      { weekday: 2, hour: 21, orders: 1, revenueMinor: 10_000 },
      { weekday: 3, hour: 9, orders: 1, revenueMinor: 4_000 },
      { weekday: 3, hour: 14, orders: 1, revenueMinor: 8_000 },
      { weekday: 5, hour: 23, orders: 1, revenueMinor: 12_000 },
      // Friday 23:59 and Saturday 00:00 in Oslo are 21:59Z and 22:00Z, both Friday in UTC: the store's clock decides.
      { weekday: 6, hour: 0, orders: 1, revenueMinor: 4_000 },
    ]);
  });

  it("feeds buildHeatmap() and names the best weekday and hour", async () => {
    const r = await timeReport(store, PERIOD);
    expect(r.heatmap).toEqual(buildHeatmap(r.rows));
    expect(r.heatmap.total).toEqual({ orders: 8, revenueMinor: 62_000 });
    expect(r.heatmap.skipped).toBe(0);
    // Tuesday has three orders (28 000), and nine o'clock three (22 000).
    expect(r.bestWeekday).toEqual({ weekday: 2, orders: 3, revenueMinor: 28_000 });
    expect(r.bestHour).toEqual({ hour: 9, orders: 3, revenueMinor: 22_000 });
    expect(r.heatmap.peakByRevenue).toMatchObject({ weekday: 2, hour: 9, revenueMinor: 18_000 });
  });

  it("counts a cancelled-but-paid order, and leaves out host, copied, unpaid and later orders and another store's", async () => {
    const r = await timeReport(store, PERIOD);
    // T9 (cancelled, paid) is Wednesday 14:00; the four 1 000.00 orders and the other store's would have made 5 000.00 more.
    expect(r.heatmap.cells[2][14]).toEqual({ orders: 1, revenueMinor: 8_000 });
    expect(r.heatmap.total.revenueMinor).toBe(62_000);
  });

  it("is a full, empty matrix and no best times for a store with no sales", async () => {
    const r = await timeReport(empty, PERIOD);
    expect(r.rows).toEqual([]);
    expect(r.heatmap.cells).toHaveLength(7);
    expect(r.heatmap.cells[0]).toHaveLength(24);
    expect(r.bestWeekday).toBeNull();
    expect(r.bestHour).toBeNull();
    expect(r.bestDay).toBeNull();
    expect(r.totals).toEqual({ orders: 0, revenueMinor: 0, aovMinor: null });
    expect(r.daily).toHaveLength(7);
  });

  it("puts a repeated hour of the clock change in one cell, and an order after midnight on the next day", async () => {
    const r = await timeReport(store, customPeriod("2026-10-25", "2026-10-25"));
    // 02:30 twice on Sunday 25 October (one day of 25 hours); 00:30 on Monday the 26th is not in the period.
    expect(r.rows).toEqual([{ weekday: 7, hour: 2, orders: 2, revenueMinor: 15_000 }]);
    expect(r.daily).toEqual([{ day: "2026-10-25", weekday: 7, orders: 2, revenueMinor: 15_000 }]);
    const next = await timeReport(store, customPeriod("2026-10-26", "2026-10-26"));
    expect(next.rows).toEqual([{ weekday: 1, hour: 0, orders: 1, revenueMinor: 5_000 }]);
  });
});

describe("timeReport: days", () => {
  it("has every day of the period, with zeros where nothing sold, and the period's weekdays", async () => {
    const r = await timeReport(store, PERIOD);
    expect(r.daily).toEqual([
      { day: "2026-09-01", weekday: 2, orders: 3, revenueMinor: 28_000 },
      { day: "2026-09-02", weekday: 3, orders: 2, revenueMinor: 12_000 },
      { day: "2026-09-03", weekday: 4, orders: 0, revenueMinor: 0 },
      { day: "2026-09-04", weekday: 5, orders: 1, revenueMinor: 12_000 },
      { day: "2026-09-05", weekday: 6, orders: 1, revenueMinor: 4_000 },
      // The SEK order of the 6th is left out.
      { day: "2026-09-06", weekday: 7, orders: 0, revenueMinor: 0 },
      // 23:30 on the last day is in the period.
      { day: "2026-09-07", weekday: 1, orders: 1, revenueMinor: 6_000 },
    ]);
    expect(r.weekdayDays).toEqual([1, 1, 1, 1, 1, 1, 1]);
    expect(r.bestDay).toEqual({ day: "2026-09-01", weekday: 2, orders: 3, revenueMinor: 28_000 });
  });

  it("counts the weekdays a longer period holds", async () => {
    const r = await timeReport(store, customPeriod("2026-09-01", "2026-09-10"));
    // Tuesday 1st to Thursday 10th: Tuesday, Wednesday and Thursday twice.
    expect(r.weekdayDays).toEqual([1, 2, 2, 2, 1, 1, 1]);
    expect(r.daily).toHaveLength(10);
  });

  it("adds up to the heatmap, and agrees with the overview's totals", async () => {
    const r = await timeReport(store, PERIOD);
    expect(r.totals).toEqual({ orders: 8, revenueMinor: 62_000, aovMinor: 7_750 });
    expect(r.totals.revenueMinor).toBe(r.heatmap.total.revenueMinor);
    expect(r.totals.orders).toBe(r.heatmap.total.orders);
    const { totals } = await periodTotals(store, PERIOD);
    expect(r.totals.orders).toBe(totals.orders);
    expect(r.totals.revenueMinor).toBe(totals.revenueMinor);
    expect(r.daily.reduce((s, p) => s + p.revenueMinor, 0)).toBe(totals.revenueMinor);
  });

  it("counts what it left out for want of a rate", async () => {
    const r = await timeReport(store, PERIOD);
    expect(r.unconverted).toBe(1);
    expect(r.missingCurrencies).toEqual(["SEK"]);
  });
});
