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

const { subscriptionsReport, NOT_TRACKED, MIN_CHURN_BASE } = await import("./analytics-subscriptions-data");

/**
 * The subscriptions figures (D152, docs/analytics.md) against a small hand-made set of subscriptions. NOK is the main currency, EUR
 * is 1 EUR = 10 NOK, SEK has no rate; Europe/Oslo. "Now" is 15 September 2026. A renewal's value without VAT, and its month:
 *
 *   S1   NOK every month   200.00 (160.00)  = 16000   created 06-10  active
 *   S2   NOK every week     50.00 ( 40.00)  = 4000 x 52/12 = 17333   created 07-01  active
 *   S3   NOK every year   1200.00 (960.00)  = 96000 / 12 = 8000      created 2025-12-01  active
 *   S4   NOK every 2 months 300.00 (240.00) = 24000 / 2 = 12000      created 05-01  past due
 *   S5   NOK every month   125.00 (100.00)  = 10000   created 04-01  paused
 *   S6   NOK every month   200.00           = 16000   created 03-01  ended 09-10 (193 days)
 *   S7   NOK every month    50.00           = 4000    created 08-15  ended 08-20 (5 days)
 *   S8   NOK every month   200.00           = 16000   created 09-03  active
 *   S9   EUR every month    25.00 (20.00)   = 2000 EUR-minor = 20000 NOK   created 09-05  active
 *   S10  EUR every month    25.00           = 20000   created 09-06  ended 09-12 (6 days): new and gone in the same period
 *   S15  NOK every month   100.00 (80.00)   = 8000    created 09-08  active, in a free trial until 09-20
 *   S16  NOK every month    50.00           = 4000    created 02-01  active, set to end at the period's end
 *   S11  SEK, active: no rate, left out and counted.   S12 waiting for first payment, S13 never started: not subscriptions that started.
 *   S14  cancelled with no end date: left out and said.
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

const NOW = new Date("2026-09-15T12:00:00Z");
let store: Store;
let empty: Store;
let other: Store;
let serial = 0;

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

type OrderOptions = { at: string; currency?: string; total: number; tax: number; status?: string; paid?: boolean; subscription?: string };

/** An order with one line (no variant) and its payment. */
async function order(s: Store, o: OrderOptions): Promise<string> {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, subscription_id)
    values (${s.id}::uuid, ${`SB-${run}-${serial}`}, 'NO', ${currency}, 'nb-NO', ${`sub${serial}@example.com`}, ${o.status ?? "paid"},
      ${o.total}, 0, 0, ${o.tax}, ${o.total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.subscription ?? null})
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
    values (${s.id}::uuid, ${String(row.id)}::uuid, null, 'SUB', 'Subscription', 1, ${o.total}, 0, ${o.total}, ${o.tax}, 0.25, 'txcd_99999999', 'physical'::commerce.delivery)
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${s.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_subs', ${o.total}, ${currency},
      ${o.paid === false ? "pending" : "captured"}::commerce.payment_status)
  `);
  return String(row.id);
}

type Sub = {
  created: string;
  total: number;
  tax: number;
  interval?: "week" | "month" | "year";
  count?: number;
  currency?: string;
  status?: string;
  cancelledAt?: string;
  trialEndsAt?: string;
  endsAtPeriodEnd?: boolean;
  /** The first order's state: placed with the subscription, paid unless said. */
  firstPaid?: boolean;
};

/** A subscription with its first order (which is placed on the day it was created). Returns the subscription's id and its first order's. */
async function subscription(s: Store, p: Sub): Promise<{ id: string; first: string }> {
  serial += 1;
  const currency = p.currency ?? "NOK";
  const first = await order(s, { at: p.created, currency, total: p.total, tax: p.tax, paid: p.firstPaid, status: p.firstPaid === false ? "pending_payment" : "paid" });
  const [row] = await db().execute<Row>(sql`
    insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, interval, interval_count, subtotal_minor, shipping_minor,
      total_minor, tax_minor, first_order_id, provider_reference, manage_token, created_at, cancelled_at, trial_ends_at, cancel_at_period_end)
    values (${s.id}::uuid, ${`SUB-${run}-${serial}`}, ${p.status ?? "active"}::commerce.subscription_status, 'NO', ${currency}, 'nb-NO', 'sub@example.com',
      ${p.interval ?? "month"}::commerce.plan_interval, ${p.count ?? 1}, ${p.total}, 0, ${p.total}, ${p.tax}, ${first}::uuid, ${`sub_${run}_${serial}`}, ${`tok-${run}-${serial}`},
      ${p.created}::timestamptz, ${p.cancelledAt ?? null}::timestamptz, ${p.trialEndsAt ?? null}::timestamptz, ${p.endsAtPeriodEnd ?? false})
    returning id
  `);
  await db().execute(sql`update commerce.orders set subscription_id = ${String(row.id)}::uuid where id = ${first}::uuid`);
  return { id: String(row.id), first };
}

const SEPTEMBER = customPeriod("2026-09-01", "2026-09-30");
const AUGUST = customPeriod("2026-08-01", "2026-08-31");

beforeAll(async () => {
  const id = await makeStore(`subs-${run}`);
  store = storeOf(id, `subs-${run}`);
  empty = storeOf(await makeStore(`subs-empty-${run}`), `subs-empty-${run}`);
  other = storeOf(await makeStore(`subs-other-${run}`), `subs-other-${run}`);

  const s1 = await subscription(store, { created: "2026-06-10T12:00:00Z", total: 20_000, tax: 4_000 });
  const s2 = await subscription(store, { created: "2026-07-01T12:00:00Z", total: 5_000, tax: 1_000, interval: "week" });
  await subscription(store, { created: "2025-12-01T12:00:00Z", total: 120_000, tax: 24_000, interval: "year" });
  await subscription(store, { created: "2026-05-01T12:00:00Z", total: 30_000, tax: 6_000, count: 2, status: "past_due" });
  await subscription(store, { created: "2026-04-01T12:00:00Z", total: 12_500, tax: 2_500, status: "paused" });
  await subscription(store, { created: "2026-03-01T00:00:00Z", total: 20_000, tax: 4_000, status: "cancelled", cancelledAt: "2026-09-10T00:00:00Z" });
  await subscription(store, { created: "2026-08-15T00:00:00Z", total: 5_000, tax: 1_000, status: "cancelled", cancelledAt: "2026-08-20T00:00:00Z" });
  await subscription(store, { created: "2026-09-03T12:00:00Z", total: 20_000, tax: 4_000 });
  const s9 = await subscription(store, { created: "2026-09-05T12:00:00Z", total: 2_500, tax: 500, currency: "EUR" });
  await subscription(store, { created: "2026-09-06T00:00:00Z", total: 2_500, tax: 500, currency: "EUR", status: "cancelled", cancelledAt: "2026-09-12T00:00:00Z" });
  await subscription(store, { created: "2026-09-08T12:00:00Z", total: 10_000, tax: 2_000, trialEndsAt: "2026-09-20T12:00:00Z" });
  const s16 = await subscription(store, { created: "2026-02-01T12:00:00Z", total: 5_000, tax: 1_000, endsAtPeriodEnd: true });
  const s11 = await subscription(store, { created: "2026-06-01T12:00:00Z", total: 10_000, tax: 2_000, currency: "SEK" });
  await subscription(store, { created: "2026-09-02T12:00:00Z", total: 20_000, tax: 4_000, status: "pending", firstPaid: false });
  await subscription(store, { created: "2026-09-02T13:00:00Z", total: 20_000, tax: 4_000, status: "expired", firstPaid: false });
  await subscription(store, { created: "2026-02-01T00:00:00Z", total: 20_000, tax: 4_000, status: "cancelled" });

  // Renewals: S1 in August and in September, S2 twice in September, S16 once, a Swedish one, one not paid.
  await order(store, { at: "2026-08-10T12:00:00Z", total: 20_000, tax: 4_000, subscription: s1.id });
  await order(store, { at: "2026-09-10T12:00:00Z", total: 20_000, tax: 4_000, subscription: s1.id });
  await order(store, { at: "2026-09-02T12:00:00Z", total: 5_000, tax: 1_000, subscription: s2.id });
  await order(store, { at: "2026-09-09T12:00:00Z", total: 5_000, tax: 1_000, subscription: s2.id });
  await order(store, { at: "2026-09-05T12:00:00Z", total: 5_000, tax: 1_000, subscription: s16.id });
  await order(store, { at: "2026-09-12T12:00:00Z", total: 10_000, tax: 2_000, subscription: s11.id, currency: "SEK" });
  await order(store, { at: "2026-09-11T12:00:00Z", total: 2_500, tax: 500, subscription: s9.id, currency: "EUR", status: "pending_payment", paid: false });

  // Another store's subscription in the same days: nothing of it may reach the first store.
  await subscription(other, { created: "2026-06-01T12:00:00Z", total: 20_000, tax: 4_000 });
});

afterAll(async () => {
  await closeDb();
});

describe("subscriptionsReport: the snapshot", () => {
  it("values active and past-due subscriptions per month, without VAT, in the main currency", async () => {
    const r = await subscriptionsReport(store, SEPTEMBER, NOW);
    expect(r.currency).toBe("NOK");
    expect(r.today).toBe("2026-09-15");
    // S1 16000 + S2 17333 + S3 8000 + S4 12000 + S8 16000 + S9 20000 + S15 8000 + S16 4000. Not S5 (paused), S6, S7, S10 (ended).
    expect(r.active).toEqual({ count: 8, mrrMinor: 101_333, arrMinor: 1_215_996 });
    expect(r.pastDue).toEqual({ count: 1, mrrMinor: 12_000, snapshot: true });
    expect(r.trialing).toEqual({ count: 1, mrrMinor: 8_000 });
    expect(r.paused).toEqual({ count: 1, mrrMinor: 10_000 });
    expect(r.cancelling).toEqual({ count: 1, mrrMinor: 4_000 });
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("leaves out what never started, what has no rate and what has no end date, and says so", async () => {
    const r = await subscriptionsReport(store, SEPTEMBER, NOW);
    expect(r.unconverted).toEqual({ subscriptions: 1, orders: 1 });
    expect(r.missingRates).toEqual(["SEK"]);
    expect(r.notes.join(" ")).toMatch(/SEK/);
    expect(r.notes.join(" ")).toMatch(/no end date/);
    // Waiting for first payment and never started are in no figure: S12, S13.
    expect(r.activeAtStart.count + r.new.count).toBeLessThan(12);
  });
});

describe("subscriptionsReport: the period's movements", () => {
  it("counts new and ended subscriptions, churn and what each was worth", async () => {
    const r = await subscriptionsReport(store, SEPTEMBER, NOW);
    // Active at 1 September: S1, S2, S3, S4, S5 (paused today, no history), S6, S16 = 7, worth 83333.
    expect(r.activeAtStart).toEqual({ count: 7, mrrMinor: 83_333 });
    // New: S8, S9, S10, S15.
    expect(r.new).toEqual({ count: 4, mrrMinor: 64_000 });
    // Ended in the period: S6 (it was active at the start) and S10 (it began in the period).
    expect(r.cancelled).toEqual({ count: 2, mrrMinor: 36_000, fromStart: 1 });
    // Churn is S6 alone (1 of the 7 at the start, 16000 of 83333): S10 began and ended inside September, so it was never in the base.
    expect(r.churn.rate).toBeCloseTo(1 / 7, 10);
    expect(r.churn.revenueRate).toBeCloseTo(16_000 / 83_333, 10);
    // 7 at the start is under the minimum for a rate to be trusted: flagged, never hidden.
    expect(MIN_CHURN_BASE).toBeGreaterThan(7);
    expect(r.churn.lowVolume).toBe(true);
  });

  it("reconciles start + new - churned with the end, and puts the rest in other, said plainly", async () => {
    const m = (await subscriptionsReport(store, SEPTEMBER, NOW)).movements;
    // The period reaches today, so the end is today's MRR: 101333. 83333 + 64000 - 36000 = 111333; the 10000 left is S5, paused now.
    expect(m).toMatchObject({ start: 83_333, new: 64_000, churned: 36_000, end: 101_333, netNew: 28_000, otherMinor: -10_000, reconciles: false });
    expect(m.start + m.new - m.churned + m.otherMinor).toBe(m.end);
    expect(m.growth).toBeCloseTo((101_333 - 83_333) / 83_333, 10);
    // What cannot be known is null, never zero.
    expect([m.expansion, m.contraction, m.reactivation]).toEqual([null, null, null]);
    const report = await subscriptionsReport(store, SEPTEMBER, NOW);
    expect(report.activeAtEnd).toEqual({ count: 8, mrrMinor: 101_333, basis: "now" });
    expect(report.notTracked.map((n) => n.key)).toEqual(["expansion", "contraction", "reactivation", "history"]);
    expect(report.notTracked).toEqual(NOT_TRACKED);
    expect(report.notes.join(" ")).toMatch(/paused/);
  });

  it("reconciles exactly for a period that is over, from the same rule at both ends", async () => {
    const r = await subscriptionsReport(store, AUGUST, NOW);
    // Active at 1 August: S1, S2, S3, S4, S5, S6, S16 = 83333; S7 begins and ends in August; the end (1 September) is the same set.
    expect(r.activeAtStart).toEqual({ count: 7, mrrMinor: 83_333 });
    expect(r.new).toEqual({ count: 1, mrrMinor: 4_000 });
    expect(r.cancelled).toEqual({ count: 1, mrrMinor: 4_000, fromStart: 0 });
    expect(r.activeAtEnd).toEqual({ count: 7, mrrMinor: 83_333, basis: "periodEnd" });
    expect(r.movements).toMatchObject({ start: 83_333, new: 4_000, churned: 4_000, end: 83_333, otherMinor: 0, reconciles: true });
    // S7 began and ended in August: it churned out of the bridge but was not in the base, so nobody churned from the 7 at the start.
    expect(r.churn.rate).toBe(0);
    expect(r.churn.revenueRate).toBe(0);
    // The headline is still today's.
    expect(r.active.mrrMinor).toBe(101_333);
  });
});

describe("subscriptionsReport: revenue and duration", () => {
  it("adds up the period's renewals apart from the orders subscriptions started with", async () => {
    const r = await subscriptionsReport(store, SEPTEMBER, NOW);
    // Renewals: S1 16000, S2 4000 twice, S16 4000 = 28000 over 4; not the Swedish one (no rate), nor the unpaid one, nor August's.
    expect(r.renewals).toEqual({ orders: 4, revenueMinor: 28_000, aovMinor: 7_000 });
    // First orders paid in September: S8 16000, S9 and S10 (2000 EUR-minor each = 20000), S15 8000. Not S12's (unpaid).
    expect(r.firstOrders).toEqual({ orders: 4, revenueMinor: 64_000 });
    expect(r.aovMinor).toBe(11_500);
    expect(r.aovMinor! * 8).toBe(r.renewals.revenueMinor + r.firstOrders.revenueMinor);
  });

  it("gives how long ended subscriptions lasted, over all of them and over those that ended in the period", async () => {
    const r = await subscriptionsReport(store, SEPTEMBER, NOW);
    // S6 193 days, S7 5, S10 6: all 68 days; in September S6 and S10: 99.5 days. S14 has no end date.
    expect(r.duration).toEqual({ endedInPeriod: 2, avgDaysInPeriod: 99.5, endedTotal: 3, avgDaysTotal: 68 });
  });
});

describe("subscriptionsReport: the edges", () => {
  it("says nothing it cannot know for a store with no subscriptions, never a made-up zero rate", async () => {
    const r = await subscriptionsReport(empty, SEPTEMBER, NOW);
    expect(r.active).toEqual({ count: 0, mrrMinor: 0, arrMinor: 0 });
    expect(r.churn).toEqual({ rate: null, revenueRate: null, lowVolume: true });
    expect(r.movements.growth).toBeNull();
    expect(r.movements.reconciles).toBe(true);
    expect(r.aovMinor).toBeNull();
    expect(r.renewals.aovMinor).toBeNull();
    expect(r.duration).toEqual({ endedInPeriod: 0, avgDaysInPeriod: null, endedTotal: 0, avgDaysTotal: null });
    expect(r.notes).toEqual([]);
  });

  it("never reaches another store's subscriptions", async () => {
    const mine = await subscriptionsReport(other, SEPTEMBER, NOW);
    expect(mine.active).toEqual({ count: 1, mrrMinor: 16_000, arrMinor: 192_000 });
    expect(mine.new.count).toBe(0);
    expect((await subscriptionsReport(store, SEPTEMBER, NOW)).active.count).toBe(8);
  });

  it("counts an ending in the store's own days: the period's last instant is still in it", async () => {
    // S6 ended 10 September 00:00 UTC = 02:00 in Oslo: the 10th. A period of that day alone has it; the day before does not.
    expect((await subscriptionsReport(store, customPeriod("2026-09-10", "2026-09-10"), NOW)).cancelled.count).toBe(1);
    expect((await subscriptionsReport(store, customPeriod("2026-09-09", "2026-09-09"), NOW)).cancelled.count).toBe(0);
  });
});
