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

const { returnsReport, NOT_SEEN_RETURNS_NOTE, TOP_RETURNED_PRODUCTS } = await import("./analytics-returns-data");

/**
 * The Returns section (D153, docs/analytics.md "Returns") against a small hand-made shop. NOK minor units (the main currency) without VAT
 * unless a comment says otherwise; 1 EUR = 10 NOK, SEK has no rate; Europe/Oslo; the period is September 2026. VAT: 25 % on mugs and
 * lamps, 15 % on totes. Returns are written straight into the tables (triggers off, as the lifecycle rules are the foundation's tests'
 * business): what is under test here is the reading.
 *
 * Store A, September orders (each paid by a captured payment):
 *   M1..M40  one mug, 100.00 (8000 without VAT)       T1..T10  two totes, 115.00 (10000 without VAT)
 *   E1       one mug in EUR, 100.00 EUR (80000 NOK)    Q1       three lamps, 150.00 (12000 without VAT)
 *   S1       one mug in SEK (no rate)                  X1       a rented bike (a service) and a sign-up fee: no goods
 *   H1       a host's order, C1 a copied order, U1 an unpaid order, K1 two totes placed in August
 *
 * Returns (all created in September, "10:00 +02:00", a withdrawal's deadline is 14 days after it was made):
 *   W1 M1 mug, reason changed_mind, received 9-08, refunded 9-10 (10000, 8000 without VAT)
 *   W2 M2 mug, changed_mind, received 9-09, refunded 9-11          W3 M3 mug, too_small, refunded 9-09, never received
 *   W4 M4 mug, changed_mind, received 9-12, refunded 9-16          W5 T1 two totes, arrived_late, received 9-12, refunded 9-14 (11500)
 *   W6 M5 mug, changed_mind, made 9-01, received 9-20, refunded 9-22: after its deadline of 9-15
 *   W7 M6 mug, past its deadline and not refunded (overdue)        W8 M7 mug, deadline in the future
 *   W9 M8 mug, cancelled                                           W10 M9 mug, received 9-16, refunded outside Kaizen's Stripe 9-18
 *   W11 E1 mug in EUR, refunded 9-17 (10000 EUR-minor)             W12 S1 mug in SEK
 *   V1 M10 mug, too_small, requested                               V2 M11 mug, declined
 *   V3 M12 mug, defective, received 9-22, refunded 9-24            V4 T2 one of two totes, too_big, approved
 *   V5 K1 one tote of an August order, wrong_item, in transit      V6 Q1 one lamp, no reason, requested
 *   H1's and C1's returns, one with a refund and one overdue-looking: they never count anywhere.
 *
 * Store B: 35 September orders and no return at all. Store D: five orders and one return, with a window of 30 days.
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

let A: Store;
let B: Store;
let D: Store;
const variants: Record<string, Record<string, string>> = {};
const products: Record<string, string> = {};
let serial = 0;

type Line = { sku: string; qty: number; unit: number; rate: number; delivery?: "physical" | "service" };
const MUG = { sku: "DEMO-MUG-WHITE", rate: 0.25 } as const;
const TOTE = { sku: "DEMO-TOTE", rate: 0.15 } as const;
const LAMP = { sku: "DEMO-LAMP", rate: 0.25 } as const;
const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

type Placed = { orderId: string; paymentId: string; number: string; lineIds: string[] };

async function order(
  s: Store,
  o: { at: string; email: string; lines: Line[]; currency?: string; status?: string; host?: string; copied?: boolean; pay?: boolean },
): Promise<Placed> {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const lines = o.lines.map((l) => ({ ...l, total: l.unit * l.qty, tax: taxOf(l.unit * l.qty, l.rate) }));
  const total = lines.reduce((a, l) => a + l.total, 0);
  const tax = lines.reduce((a, l) => a + l.tax, 0);
  const number = `RT-${run}-${serial}`;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, host_id, copied_from)
    values (${s.id}::uuid, ${number}, 'NO', ${currency}, 'nb-NO', ${o.email}, ${o.status ?? "paid"},
      ${total}, 0, 0, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz, ${o.host ?? null}, null)
    returning id
  `);
  const lineIds: string[] = [];
  for (const l of lines) {
    const [line] = await db().execute<Row>(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, discount_minor, total_minor, tax_minor, tax_rate, tax_code, delivery)
      values (${s.id}::uuid, ${String(row.id)}::uuid, ${l.sku === "SIGNUP-FEE" ? null : variants[s.id][l.sku]}, ${l.sku}, ${l.sku}, ${l.qty}, ${l.unit}, 0,
        ${l.total}, ${l.tax}, ${l.rate}, 'txcd_99999999', ${l.delivery ?? "physical"}::commerce.delivery)
      returning id
    `);
    lineIds.push(String(line.id));
  }
  let paymentId = "";
  if (o.pay !== false) {
    const [payment] = await db().execute<Row>(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
      values (${s.id}::uuid, ${String(row.id)}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_returns', ${total}, ${currency}, 'captured'::commerce.payment_status)
      returning id
    `);
    paymentId = String(payment.id);
  }
  if (o.copied) {
    // A copied order is made by the store copy, whose rules refuse lines and returns on it: it is marked as copied once it is complete.
    await db().transaction(async (tx) => {
      await tx.execute(sql`set local session_replication_role = replica`);
      await tx.execute(sql`update commerce.orders set copied_from = ${crypto.randomUUID()}::uuid, number = ${`C-${run}-${serial}`} where id = ${String(row.id)}::uuid`);
    });
  }
  return { orderId: String(row.id), paymentId, number, lineIds };
}

const at = (day: string, hour = 10) => `2026-${day}T${String(hour).padStart(2, "0")}:00:00+02:00`;
const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();

type ReturnSpec = {
  kind: "withdrawal" | "return";
  status: "requested" | "approved" | "in_transit" | "received" | "closed" | "declined" | "cancelled";
  created: string;
  reason?: string;
  quantity?: number;
  received?: string;
  refunded?: { at: string; minor: number; outside?: boolean };
  /** An SQL timestamp for the refund deadline; a withdrawal's default is 14 days after it was made, a voluntary return has none. */
  deadline?: ReturnType<typeof sql>;
  /** Which of the order's lines (index) is returned. */
  line?: number;
};

/** A return and its line, as the database would hold them: written with the triggers off, in one transaction. */
async function makeReturn(s: Store, o: Placed, spec: ReturnSpec): Promise<string> {
  serial += 1;
  const id = crypto.randomUUID();
  const requestId = spec.kind === "withdrawal" ? crypto.randomUUID() : null;
  const number = `${o.number}-R${serial}`;
  const closed = spec.status === "closed";
  const approved = spec.status === "requested" || spec.status === "declined" ? null : spec.created;
  const closedAt = closed ? (spec.refunded?.at ?? spec.received ?? spec.created) : null;
  const deadline = spec.deadline ?? (spec.kind === "withdrawal" ? sql`${plusDays(spec.created, 14)}::timestamptz` : sql`null::timestamptz`);
  const outcome = spec.status === "declined" ? "declined" : spec.status === "cancelled" ? "cancelled" : closed ? (spec.refunded ? "refunded" : "no_refund") : null;
  await db().transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    if (requestId) {
      await tx.execute(sql`
        insert into commerce.withdrawal_requests (id, store_id, order_id, name, email, channel, locale, market_code, status, submitted_at, confirmed_at)
        values (${requestId}::uuid, ${s.id}::uuid, ${o.orderId}::uuid, 'Shopper', 'shopper@example.com', 'web', 'nb-NO', 'NO', 'confirmed',
          ${spec.created}::timestamptz, ${spec.created}::timestamptz)
      `);
    }
    await tx.execute(sql`
      insert into commerce.returns (id, store_id, order_id, withdrawal_request_id, status, created_at, kind, number, reason, approved_at, received_at, closed_at,
        outcome, refund_minor, refunded_at, refund_outside, refund_deadline)
      values (${id}::uuid, ${s.id}::uuid, ${o.orderId}::uuid, ${requestId}::uuid, ${spec.status}::commerce.return_status, ${spec.created}::timestamptz, ${spec.kind}, ${number},
        ${spec.reason ?? null}, ${approved}::timestamptz, ${spec.received ?? null}::timestamptz, ${closedAt}::timestamptz, ${outcome},
        ${spec.refunded?.minor ?? null}, ${spec.refunded?.at ?? null}::timestamptz, ${spec.refunded?.outside ?? false}, ${deadline})
    `);
    await tx.execute(sql`
      insert into commerce.return_lines (store_id, return_id, order_line_id, quantity)
      values (${s.id}::uuid, ${id}::uuid, ${o.lineIds[spec.line ?? 0]}::uuid, ${spec.quantity ?? 1})
    `);
  });
  return id;
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

const PERIOD = customPeriod("2026-09-01", "2026-09-30");
const LATER = new Date("2026-10-25T12:00:00Z");

beforeAll(async () => {
  const ids = { a: await makeStore(`ret-an-a-${run}`), b: await makeStore(`ret-an-b-${run}`), d: await makeStore(`ret-an-d-${run}`) };
  A = storeOf(ids.a, `ret-an-a-${run}`);
  B = storeOf(ids.b, `ret-an-b-${run}`);
  D = storeOf(ids.d, `ret-an-d-${run}`);
  for (const storeId of Object.values(ids)) {
    variants[storeId] = {};
    for (const row of await db().execute<Row>(sql`select sku, id, product_id from commerce.product_variants where store_id = ${storeId}::uuid`)) {
      variants[storeId][String(row.sku)] = String(row.id);
      if (storeId === ids.a) products[String(row.sku)] = String(row.product_id);
    }
  }

  // Store A's orders.
  const m: Placed[] = [];
  for (let i = 1; i <= 40; i++) m.push(await order(A, { at: at("09-02", 8 + (i % 8)), email: `m${i}@example.com`, lines: [{ ...MUG, qty: 1, unit: 10_000 }] }));
  const t: Placed[] = [];
  for (let i = 1; i <= 10; i++) t.push(await order(A, { at: at("09-03", 8 + i), email: `t${i}@example.com`, lines: [{ ...TOTE, qty: 2, unit: 5_750 }] }));
  const e1 = await order(A, { at: at("09-04"), email: "e1@example.com", currency: "EUR", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const q1 = await order(A, { at: at("09-05"), email: "q1@example.com", lines: [{ ...LAMP, qty: 3, unit: 5_000 }] });
  const s1 = await order(A, { at: at("09-06"), email: "s1@example.com", currency: "SEK", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await order(A, { at: at("09-07"), email: "x1@example.com", lines: [{ sku: "DEMO-SYKKEL", rate: 0.25, qty: 2, unit: 20_000, delivery: "service" }, { sku: "SIGNUP-FEE", rate: 0.25, qty: 1, unit: 5_000 }] });
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`host-returns-${run}@example.com`}, 'Host') returning id`);
  const [host] = await db().execute<Row>(sql`insert into commerce.hosts (store_id, account_id, name) values (${ids.a}::uuid, ${String(account.id)}::uuid, 'Host') returning id`);
  const h1 = await order(A, { at: at("09-08"), email: "h1@example.com", host: String(host.id), lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const c1 = await order(A, { at: at("09-09"), email: "c1@example.com", copied: true, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await order(A, { at: at("09-10"), email: "u1@example.com", status: "pending_payment", pay: false, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  const k1 = await order(A, { at: "2026-08-28T12:00:00+02:00", email: "k1@example.com", lines: [{ ...TOTE, qty: 2, unit: 5_750 }] });

  const withdrawal = (over: Omit<ReturnSpec, "kind">): ReturnSpec => ({ kind: "withdrawal", ...over });
  const voluntary = (over: Omit<ReturnSpec, "kind">): ReturnSpec => ({ kind: "return", ...over });

  await makeReturn(A, m[0], withdrawal({ status: "closed", created: at("09-05"), reason: "changed_mind", received: at("09-08"), refunded: { at: at("09-10"), minor: 10_000 } }));
  await makeReturn(A, m[1], withdrawal({ status: "closed", created: at("09-06"), reason: "changed_mind", received: at("09-09"), refunded: { at: at("09-11"), minor: 10_000 } }));
  await makeReturn(A, m[2], withdrawal({ status: "closed", created: at("09-07"), reason: "too_small", refunded: { at: at("09-09"), minor: 10_000 } }));
  await makeReturn(A, m[3], withdrawal({ status: "closed", created: at("09-08"), reason: "changed_mind", received: at("09-12"), refunded: { at: at("09-16"), minor: 10_000 } }));
  await makeReturn(A, t[0], withdrawal({ status: "closed", created: at("09-09"), reason: "arrived_late", quantity: 2, received: at("09-12"), refunded: { at: at("09-14"), minor: 11_500 } }));
  await makeReturn(A, m[4], withdrawal({ status: "closed", created: at("09-01"), reason: "changed_mind", received: at("09-20"), refunded: { at: at("09-22"), minor: 10_000 } }));
  await makeReturn(A, m[5], withdrawal({ status: "approved", created: at("09-10"), deadline: sql`now() - interval '3 days'` }));
  await makeReturn(A, m[6], withdrawal({ status: "approved", created: at("09-12"), deadline: sql`now() + interval '5 days'` }));
  await makeReturn(A, m[7], withdrawal({ status: "cancelled", created: at("09-13") }));
  await makeReturn(A, m[8], withdrawal({ status: "closed", created: at("09-14"), received: at("09-16"), refunded: { at: at("09-18"), minor: 10_000, outside: true } }));
  await makeReturn(A, e1, withdrawal({ status: "closed", created: at("09-15"), refunded: { at: at("09-17"), minor: 10_000 } }));
  await makeReturn(A, s1, withdrawal({ status: "approved", created: at("09-25"), deadline: sql`now() + interval '5 days'` }));
  await makeReturn(A, m[9], voluntary({ status: "requested", created: at("09-16"), reason: "too_small" }));
  await makeReturn(A, m[10], voluntary({ status: "declined", created: at("09-17"), reason: "changed_mind" }));
  await makeReturn(A, m[11], voluntary({ status: "closed", created: at("09-18"), reason: "defective", received: at("09-22"), refunded: { at: at("09-24"), minor: 10_000 } }));
  await makeReturn(A, t[1], voluntary({ status: "approved", created: at("09-19"), reason: "too_big" }));
  await makeReturn(A, k1, voluntary({ status: "in_transit", created: at("09-20"), reason: "wrong_item" }));
  await makeReturn(A, q1, voluntary({ status: "requested", created: at("09-21") }));
  await makeReturn(A, h1, withdrawal({ status: "closed", created: at("09-10"), reason: "other", received: at("09-12"), refunded: { at: at("09-13"), minor: 10_000 } }));
  await makeReturn(A, h1, withdrawal({ status: "approved", created: at("09-11"), deadline: sql`now() - interval '3 days'` }));
  await makeReturn(A, c1, voluntary({ status: "closed", created: at("09-11"), reason: "other", received: at("09-12"), refunded: { at: at("09-13"), minor: 10_000 } }));

  // Store B: orders and no return.
  for (let i = 1; i <= 35; i++) await order(B, { at: at("09-05", 8 + (i % 8)), email: `b${i}@example.com`, lines: [{ ...MUG, qty: 1, unit: 10_000 }] });

  // Store D: a few orders, one return, a window of 30 days.
  const dOrders: Placed[] = [];
  for (let i = 1; i <= 5; i++) dOrders.push(await order(D, { at: at("09-05", 8 + i), email: `d${i}@example.com`, lines: [{ ...MUG, qty: 1, unit: 10_000 }] }));
  await makeReturn(D, dOrders[0], withdrawal({ status: "closed", created: at("09-08"), received: at("09-10"), refunded: { at: at("09-12"), minor: 10_000 } }));
  await db().execute(sql`insert into commerce.return_settings (store_id, window_days) values (${ids.d}::uuid, 30)`);
});

afterAll(async () => {
  await closeDb();
});

describe("returnsReport: returns made", () => {
  it("counts returns that ask for goods back, by kind, and keeps declined and cancelled ones apart", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    expect(r.currency).toBe("NOK");
    expect(r.tracked).toBe(true);
    // Withdrawals W1-W8, W10, W11 (W9 is cancelled, W12 is in SEK); voluntary V1, V3, V4, V5, V6 (V2 is declined).
    expect(r.made).toEqual({ returns: 15, withdrawals: 10, voluntary: 5, units: 16, declined: 1, cancelled: 1 });
    expect(r.kinds.map((k) => [k.kind, k.returns, k.units, k.declined, k.cancelled])).toEqual([
      ["withdrawal", 10, 11, 0, 1],
      ["return", 5, 5, 1, 0],
    ]);
    expect(NOT_SEEN_RETURNS_NOTE).toMatch(/not included/);
    expect(r.notSeenNote).toBe(NOT_SEEN_RETURNS_NOTE);
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
  });

  it("leaves out hosts' orders and copied orders, and another store's returns", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    // Neither H1's nor C1's returns are in the counts, the money or the overdue figure.
    expect(r.made.returns).toBe(15);
    expect(r.overdue).toBe(1);
    const d = await returnsReport(D, PERIOD, LATER);
    expect(d.made.returns).toBe(1);
    const b = await returnsReport(B, PERIOD, LATER);
    expect(b.made.returns).toBe(0);
  });

  it("counts returns by the day they were made, so a return outside the period is not in it", async () => {
    const october = await returnsReport(A, customPeriod("2026-10-01", "2026-10-31"), LATER);
    expect(october.made.returns).toBe(0);
    expect(october.refunded.returns).toBe(0);
  });
});

describe("returnsReport: the rates", () => {
  it("rates the cohort of paid orders with goods, whenever their returns were made", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    // Orders with goods: M1-M40, T1-T10, E1, Q1 = 52 (S1 is in SEK, X1 has no goods, H1, C1 and U1 are not paid orders of the store, K1 is August).
    // Of them with a counting return: M1-M7, M9, M10, M12, E1, T1, T2, Q1 = 14.
    expect(r.cohort).toEqual({ orders: 52, unitsSold: 64, returnedOrders: 14, returnedUnits: 15 });
    expect(r.orderRate).toEqual({ value: 14 / 52, missing: null });
    expect(r.unitRate).toEqual({ value: 15 / 64, missing: null });
  });

  it("values what came back at what it was sold for without VAT, in the main currency", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    // Mugs: ten units on M orders at 8000 and one in EUR (8000 EUR-minor = 80000); totes 10000 + 5000; a lamp 4000.
    expect(r.returnedMinor).toBe(80_000 + 80_000 + 10_000 + 5_000 + 4_000);
  });

  it("counts an order in a currency with no rate as left out, and says which", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    // S1 (one order) and its return W12.
    expect(r.unconverted).toBe(2);
    expect(r.missingRates).toEqual(["SEK"]);
    expect(r.notes.join(" ")).toMatch(/SEK/);
  });

  it("shows what is missing, never a zero, for a store that has recorded no return", async () => {
    const r = await returnsReport(B, PERIOD, LATER);
    expect(r.tracked).toBe(false);
    expect(r.cohort.orders).toBe(35);
    expect(r.orderRate.value).toBeNull();
    expect(r.orderRate.missing).toContain("No return has been recorded in Kaizen yet");
    expect(r.unitRate.value).toBeNull();
    expect(r.timing.requestToRefund.medianDays).toBeNull();
    expect(r.timing.requestToRefund.missing).toBeTruthy();
    expect(r.made.returns).toBe(0);
    expect(r.overdue).toBe(0);
    expect(r.products).toEqual([]);
    expect(r.reasons.rows).toEqual([]);
  });

  it("gives no rate under the minimum volume, and says how many orders there were", async () => {
    const r = await returnsReport(D, PERIOD, LATER);
    expect(r.tracked).toBe(true);
    expect(r.cohort).toEqual({ orders: 5, unitsSold: 5, returnedOrders: 1, returnedUnits: 1 });
    expect(r.orderRate.value).toBeNull();
    expect(r.orderRate.missing).toContain("Only 5 orders");
    expect(r.unitRate.value).toBeNull();
    expect(r.unitRate.missing).toContain("Only 5 units");
  });

  it("says the rates are still rising while the period is inside the store's return window", async () => {
    expect((await returnsReport(A, PERIOD, LATER)).maturity).toBeNull();
    const soon = await returnsReport(A, PERIOD, new Date("2026-10-05T12:00:00Z"));
    expect(soon.windowDays).toBe(14);
    expect(soon.maturity).toContain("last 14 days");
    // A store with a longer window keeps saying so for longer.
    const long = await returnsReport(D, PERIOD, new Date("2026-10-20T12:00:00Z"));
    expect(long.windowDays).toBe(30);
    expect(long.maturity).toContain("last 30 days");
  });
});

describe("returnsReport: reasons", () => {
  it("lists the reasons by count, with no reason given last and shares from ten returns that have one", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    expect(r.reasons.total).toBe(15);
    expect(r.reasons.given).toBe(10);
    expect(r.reasons.sharesShown).toBe(true);
    expect(r.reasons.rows.map((x) => [x.reason, x.returns, x.units])).toEqual([
      ["changed_mind", 4, 4],
      ["too_small", 2, 2],
      ["arrived_late", 1, 2],
      ["defective", 1, 1],
      ["too_big", 1, 1],
      ["wrong_item", 1, 1],
      ["", 5, 5],
    ]);
    expect(r.reasons.rows[0].share).toBeCloseTo(0.4, 10);
    expect(r.reasons.rows.at(-1)!.share).toBeNull();
    // The declined return's and the cancelled one's reasons, and the SEK return's, are not here.
    expect(r.reasons.rows.reduce((a, x) => a + x.returns, 0)).toBe(r.made.returns);
  });

  it("shows only counts under the minimum", async () => {
    const d = await returnsReport(D, PERIOD, LATER);
    expect(d.reasons.total).toBe(1);
    expect(d.reasons.given).toBe(0);
    expect(d.reasons.sharesShown).toBe(false);
    expect(d.reasons.note).toContain("None of the returns");
  });
});

describe("returnsReport: refunds, times and what is overdue", () => {
  it("adds what was refunded in the period without VAT, outside Kaizen's Stripe included and counted apart", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    // W1 W2 W3 W4 W6 W10 and V3 at 8000, W5 10000, W11 80000.
    expect(r.refunded).toEqual({ minor: 7 * 8_000 + 10_000 + 80_000, returns: 9, outside: 1 });
    expect(r.kinds.map((k) => [k.kind, k.refunded, k.refundedMinor])).toEqual([
      ["withdrawal", 8, 6 * 8_000 + 10_000 + 80_000],
      ["return", 1, 8_000],
    ]);
  });

  it("measures the time from the request and from the goods arriving, as a median from five returns", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    // Request to refund: 5, 5, 2, 8, 5, 21, 4, 2 and 6 days.
    expect(r.timing.requestToRefund).toMatchObject({ n: 9, medianDays: 5, slowestDays: 21, missing: null });
    // Received to refund: W1 2, W2 2, W4 4, W5 2, W6 2, W10 2, V3 2 (W3 and W11 were refunded before the goods came or without them).
    expect(r.timing.receivedToRefund).toMatchObject({ n: 7, medianDays: 2, slowestDays: 4, missing: null });
    expect(r.timing.truncated).toBe(false);
  });

  it("counts withdrawals refunded after their deadline", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    expect(r.timing.afterDeadline).toEqual({ late: 1, of: 8 });
  });

  it("gives no typical time from too few returns", async () => {
    const d = await returnsReport(D, PERIOD, LATER);
    expect(d.refunded.returns).toBe(1);
    expect(d.timing.requestToRefund.n).toBe(1);
    expect(d.timing.requestToRefund.medianDays).toBeNull();
    expect(d.timing.requestToRefund.missing).toContain("Only 1 return");
  });

  it("counts the withdrawals past their deadline right now, as the queue does", async () => {
    expect((await returnsReport(A, PERIOD, LATER)).overdue).toBe(1);
    expect((await returnsReport(B, PERIOD, LATER)).overdue).toBe(0);
    // The queue's own condition, read directly.
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.returns r
      where r.store_id = ${A.id}::uuid and r.refund_deadline is not null and r.refund_deadline < now() and r.refund_minor is null
        and r.status::text in ('approved', 'in_transit', 'received', 'inspected')
    `);
    // The host's overdue-looking return is among them in the table, and not in the report.
    expect(Number(row.n)).toBe(2);
  });
});

describe("returnsReport: products", () => {
  it("lists the most returned products against what was sold of them in the same orders", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    expect(TOP_RETURNED_PRODUCTS).toBe(10);
    expect(r.productCount).toBe(3);
    expect(r.products.map((p) => [p.productId, p.sold, p.returnedUnits, p.returnedMinor])).toEqual([
      [products["DEMO-MUG-WHITE"], 41, 11, 10 * 8_000 + 80_000],
      [products["DEMO-TOTE"], 20, 3, 15_000],
      [products["DEMO-LAMP"], 3, 1, 4_000],
    ]);
    expect(r.products.reduce((a, p) => a + p.returnedMinor, 0)).toBe(r.returnedMinor);
    expect(r.products.reduce((a, p) => a + p.returnedUnits, 0)).toBe(r.cohort.returnedUnits);
    expect(r.products.every((p) => p.name.length > 0 && !/^[0-9a-f-]{36}$/.test(p.name))).toBe(true);
  });

  it("gives a product's rate only from twenty units sold, and says why not otherwise", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    expect(r.products[0].rate).toEqual({ value: 11 / 41, missing: null });
    // The totes sold exactly the minimum.
    expect(r.products[1].rate).toEqual({ value: 3 / 20, missing: null });
    expect(r.products[2].rate.value).toBeNull();
    expect(r.products[2].rate.missing).toContain("Only 3 units");
  });

  it("does not count units of an August order that was returned in September among the cohort's", async () => {
    const r = await returnsReport(A, PERIOD, LATER);
    // V5 returned a tote of K1 (placed in August): a return made in September, not a return of September's orders.
    expect(r.made.units).toBe(16);
    expect(r.cohort.returnedUnits).toBe(15);
  });
});
