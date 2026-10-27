import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";
import { blankSpec, READY_KEYS, READY_REPORTS, type ReportSpec } from "@/lib/report-catalogue";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const { runReport, REST_KEY, OTHER_KEY, NONE_KEY } = await import("./report-query");
const { saveReport, listSavedReports, getSavedReport, deleteReport, SAVED_REPORTS_MAX } = await import("./saved-reports");
const { reportLabels } = await import("./report-labels");
const { reportCsv } = await import("./report-export");
const { periodTotals } = await import("./analytics-totals");
const { productsReport } = await import("./analytics-products-data");

/**
 * The report layer (wave 8 unit A, D345) against a small hand-made shop, held to the analytics pages' own figures: whatever a report cuts,
 * its net sales add up to the Overview's revenue, a cut by product to the Products page's, and money in euro is converted in code while a
 * currency with no rate is left out and counted. Money in NOK minor units (the main currency) without VAT, EUR at 1 EUR = 10 NOK, SEK with
 * no rate, Europe/Oslo. The period is 1-7 September 2026; the comparison the seven days before.
 *
 *   day    who   what
 *   08-27  a     1 mug 50.00                                      previous period; refunded 25.00 on 09-03
 *   09-01  c     1 mug 100.00 (cost 30.00), code SUMMER            new customer
 *   09-02  d     2 mugs 200.00 less 20.00, 1 tote 57.50, 49.00 shipping
 *   09-03  c     EUR: 1 mug 100.00 less 10.00, 12.50 shipping       returning customer, converted
 *   09-04  g     SEK: 1 mug 100.00                                 left out, counted
 *   09-05  i     a sign-up fee 50.00 (no variant)                  "other" line
 *   09-06  a     3 totes 172.50 (cost 10.00 each), refunded 57.50 on 09-07   returning (first order 08-27)
 *   copied, host and unpaid orders: never
 */

const run = Date.now().toString(36);
const NOW = new Date("2026-10-01T12:00:00Z");
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
let other: Store;
const variants: Record<string, Record<string, string>> = {};
const products: Record<string, string> = {};
let category = "";
let serial = 0;

type Sku = "DEMO-MUG-WHITE" | "DEMO-TOTE" | "SIGNUP-FEE";
type Line = { sku: Sku; qty: number; unit: number; discount?: number; rate: number; cost?: number | null; delivery?: "physical" | "service" };
const taxOf = (amount: number, rate: number) => amount - Math.round(amount / (1 + rate));

async function placeOrder(
  s: Store,
  o: { currency?: string; market?: string; at: string; email: string; lines: Line[]; shipping?: number; code?: string; copied?: boolean; unpaid?: boolean },
): Promise<{ orderId: string; paymentId: string | null }> {
  serial += 1;
  const currency = o.currency ?? "NOK";
  const lines = o.lines.map((l) => {
    const total = l.unit * l.qty - (l.discount ?? 0);
    return { ...l, total, tax: taxOf(total, l.rate) };
  });
  const shipping = o.shipping ?? 0;
  const subtotal = lines.reduce((sum, l) => sum + l.unit * l.qty, 0);
  const discount = lines.reduce((sum, l) => sum + (l.discount ?? 0), 0);
  const tax = lines.reduce((sum, l) => sum + l.tax, 0) + taxOf(shipping, 0.25);
  const total = subtotal + shipping - discount;
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor,
      discount_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at, copied_from, discount_code)
    values (${s.id}::uuid, ${o.copied ? `C-${run}-${serial}` : `R-${run}-${serial}`}, ${o.market ?? "NO"}, ${currency}, 'nb-NO', ${o.email},
      ${o.unpaid ? "pending_payment" : "paid"}, ${subtotal}, ${shipping}, ${discount}, ${tax}, ${total}, '{}'::jsonb, '{}'::jsonb,
      ${o.at}::timestamptz, ${o.copied ? crypto.randomUUID() : null}, ${o.code ?? null})
    returning id
  `);
  const orderId = String(order.id);
  const insertLines = async (runner: Pick<ReturnType<typeof db>, "execute">) => {
    for (const l of lines) {
      await runner.execute(sql`
        insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, unit_cost_minor, discount_minor,
          total_minor, tax_minor, tax_rate, tax_code, delivery)
        values (${s.id}::uuid, ${orderId}::uuid, ${l.sku === "SIGNUP-FEE" ? null : variants[s.id][l.sku]}, ${l.sku}, ${l.sku}, ${l.qty}, ${l.unit}, ${l.cost ?? null},
          ${l.discount ?? 0}, ${l.total}, ${l.tax}, ${l.rate}, 'txcd_99999999', ${l.delivery ?? "physical"}::commerce.delivery)
      `);
    }
  };
  if (o.copied) {
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('commerce.copying', 'on', true)`);
      await insertLines(tx);
    });
    return { orderId, paymentId: null };
  }
  await insertLines(db());
  const [payment] = await db().execute<Row>(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${s.id}::uuid, ${orderId}::uuid, 'stripe', ${`pi_${run}_${serial}`}, 'acct_reports', ${total}, ${currency},
      ${o.unpaid ? "pending" : "captured"}::commerce.payment_status)
    returning id
  `);
  return { orderId, paymentId: String(payment.id) };
}

async function refund(s: Store, paymentId: string, amount: number, at: string) {
  serial += 1;
  await db().execute(sql`
    insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, created_at)
    values (${s.id}::uuid, ${paymentId}::uuid, ${amount}, 'test', ${`re_${run}_${serial}`}, 'succeeded', ${at}::timestamptz)
  `);
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

const PERIOD = customPeriod("2026-09-01", "2026-09-07");
const MUG = { sku: "DEMO-MUG-WHITE", rate: 0.25 } as const;
const TOTE = { sku: "DEMO-TOTE", rate: 0.15 } as const;

const spec = (o: Partial<ReportSpec>): ReportSpec => ({
  ...blankSpec(),
  dimensions: [],
  filters: [],
  period: { preset: "custom", from: "2026-09-01", to: "2026-09-07", compare: "previous" },
  ...o,
});

async function report(o: Partial<ReportSpec>, s: Store = store) {
  const outcome = await runReport(s, spec(o), NOW);
  if (!outcome.ok) throw new Error(JSON.stringify(outcome.problems));
  return outcome.report;
}

const sumOf = (rows: { values: Record<string, number | null | undefined> }[], metric: string) => rows.reduce((t, r) => t + (r.values[metric] ?? 0), 0);

beforeAll(async () => {
  const id = await makeStore(`reports-${run}`);
  const otherId = await makeStore(`reports-other-${run}`);
  store = storeOf(id, `reports-${run}`);
  other = storeOf(otherId, `reports-other-${run}`);
  for (const storeId of [id, otherId]) {
    variants[storeId] = {};
    for (const row of await db().execute<Row>(sql`select sku, id, product_id from commerce.product_variants where store_id = ${storeId}::uuid`)) {
      variants[storeId][String(row.sku)] = String(row.id);
      if (storeId === id) products[String(row.sku)] = String(row.product_id);
    }
  }
  // A category holding the mug only.
  const [term] = await db().execute<Row>(sql`
    insert into commerce.terms (store_id, content_type, kind, name, slug) values (${id}::uuid, 'product', 'category', 'Cups', ${`cups-${run}`}) returning id`);
  category = String(term.id);
  await db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) values (${id}::uuid, ${products["DEMO-MUG-WHITE"]}::uuid, ${category}::uuid)`);

  const a = await placeOrder(store, { at: "2026-08-27T12:00:00+02:00", email: "a@example.com", lines: [{ ...MUG, qty: 1, unit: 5_000 }] });
  await refund(store, a.paymentId!, 2_500, "2026-09-03T10:00:00+02:00");
  await placeOrder(store, { at: "2026-09-01T12:00:00+02:00", email: "c@example.com", code: "SUMMER", lines: [{ ...MUG, qty: 1, unit: 10_000, cost: 3_000 }] });
  await placeOrder(store, {
    at: "2026-09-02T10:00:00+02:00",
    email: "d@example.com",
    shipping: 4_900,
    lines: [
      { ...MUG, qty: 2, unit: 10_000, discount: 2_000 },
      { ...TOTE, qty: 1, unit: 5_750 },
    ],
  });
  await placeOrder(store, { currency: "EUR", at: "2026-09-03T12:00:00+02:00", email: "C@example.com", shipping: 1_250, lines: [{ ...MUG, qty: 1, unit: 10_000, discount: 1_000 }] });
  await placeOrder(store, { currency: "SEK", at: "2026-09-04T12:00:00+02:00", email: "g@example.com", lines: [{ ...MUG, qty: 1, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-05T09:00:00+02:00", email: "i@example.com", lines: [{ sku: "SIGNUP-FEE", qty: 1, unit: 5_000, rate: 0.25, delivery: "service" }] });
  const t = await placeOrder(store, { at: "2026-09-06T11:00:00+02:00", email: "a@example.com", lines: [{ ...TOTE, qty: 3, unit: 5_750, cost: 1_000 }] });
  await refund(store, t.paymentId!, 5_750, "2026-09-07T15:00:00+02:00");
  // Never counted.
  await placeOrder(store, { at: "2026-09-03T14:00:00+02:00", email: "copied@example.com", copied: true, lines: [{ ...MUG, qty: 3, unit: 10_000 }] });
  await placeOrder(store, { at: "2026-09-03T15:00:00+02:00", email: "unpaid@example.com", unpaid: true, lines: [{ ...MUG, qty: 2, unit: 10_000 }] });
  // Another store's sale in the same days.
  await placeOrder(other, { at: "2026-09-02T10:00:00+02:00", email: "elsewhere@example.com", lines: [{ ...TOTE, qty: 9, unit: 5_750 }] });
}, 180_000);

afterAll(async () => {
  await closeDb();
});

describe("the totals", () => {
  it("are the Overview's: revenue, orders, refunds, VAT and customers, with the currency with no rate left out and counted", async () => {
    const r = await report({ metrics: ["net_sales", "orders", "refunds", "vat", "customers", "aov"] });
    const units = await report({ metrics: ["units"] });
    const { totals, unconverted, missingCurrencies } = await periodTotals(store, PERIOD);
    expect(r.period.from).toBe(PERIOD.from);
    expect(r.period.to).toBe(PERIOD.to);
    expect(r.currency).toBe("NOK");
    expect(r.totals.values.net_sales).toBe(totals.revenueMinor);
    expect(r.totals.values.orders).toBe(totals.orders);
    expect(r.totals.values.refunds).toBe(totals.refundsMinor);
    expect(r.totals.values.vat).toBe(totals.vatMinor);
    expect(units.totals.values.units).toBe(totals.units);
    expect(r.totals.values.aov).toBe(Math.round(totals.revenueMinor / totals.orders));
    // c@ and C@ are one customer: a, c, d and i.
    expect(r.totals.values.customers).toBe(4);
    expect(r.unconverted).toBe(unconverted);
    expect(r.missingCurrencies).toEqual(missingCurrencies);
    expect(r.missingCurrencies).toEqual(["SEK"]);
  });

  it("compare with the previous period", async () => {
    const r = await report({ metrics: ["net_sales", "orders"] });
    expect(r.comparison?.from).toBe("2026-08-25");
    expect(r.totals.previous?.orders).toBe(1);
    expect(r.totals.previous?.net_sales).toBe(4_000);
  });
});

describe("cut by a line dimension", () => {
  it("by product adds up to the period with a row for what is in no line, and agrees with the Products page", async () => {
    const r = await report({ metrics: ["net_sales", "units", "orders"], dimensions: ["product"] });
    const total = r.totals.values.net_sales!;
    expect(sumOf(r.rows, "net_sales")).toBe(total);
    const restRow = r.rows.find((row) => row.rest)!;
    expect(restRow.keys).toEqual([REST_KEY]);
    // The shipping of the 09-02 order (39.20 without VAT) and of the euro order (10.00 EUR = 100.00 NOK without VAT).
    expect(restRow.values.net_sales).toBe(3_920 + 10_000);
    const products0 = await productsReport(store, PERIOD, null);
    const mugRow = r.rows.find((row) => row.keys[0] === products["DEMO-MUG-WHITE"])!;
    const mugPage = products0.rows.find((row) => row.productId === products["DEMO-MUG-WHITE"])!;
    expect(mugRow.values.net_sales).toBe(mugPage.revenueMinor);
    expect(mugRow.values.units).toBe(mugPage.units);
    expect(r.rows.find((row) => row.keys[0] === OTHER_KEY)?.values.net_sales).toBe(4_000);
    // Orders that bought it do not add up across products; the total is the period's orders.
    expect(r.columns.find((c) => c.metric === "orders")?.addsUp).toBe(false);
    expect(r.totals.values.orders).toBe(5);
  });

  it("by variant and by category; a product outside every category is its own row, and categories have no rest row", async () => {
    const byVariant = await report({ metrics: ["net_sales"], dimensions: ["variant"] });
    expect(sumOf(byVariant.rows, "net_sales")).toBe(byVariant.totals.values.net_sales);
    const byCategory = await report({ metrics: ["net_sales", "units"], dimensions: ["category"] });
    expect(byCategory.rows.some((row) => row.rest)).toBe(false);
    expect(byCategory.linesOnly).toBe(true);
    const cups = byCategory.rows.find((row) => row.keys[0] === category)!;
    const mug = byVariant.rows.find((row) => row.keys[0] === variants[store.id]["DEMO-MUG-WHITE"])!;
    expect(cups.values.net_sales).toBe(mug.values.net_sales);
    expect(byCategory.rows.find((row) => row.keys[0] === NONE_KEY)?.values.units).toBe(4);
  });

  it("filtered by a product counts that product's lines only", async () => {
    const r = await report({ metrics: ["net_sales", "orders"], filters: [{ dimension: "product", values: [products["DEMO-TOTE"]] }] });
    // 57.50 / 1.15 = 50.00, and 172.50 / 1.15 = 150.00.
    expect(r.totals.values.net_sales).toBe(20_000);
    expect(r.totals.values.orders).toBe(2);
  });

  it("works out gross profit from the lines whose cost is known, with how much it covers", async () => {
    const r = await report({ metrics: ["gross_profit"], dimensions: ["product"] });
    const tote = r.rows.find((row) => row.keys[0] === products["DEMO-TOTE"])!;
    // Tote: 200.00 of sales, 150.00 of it with a cost of 30.00: covered 75 %, so the cost is scaled to 40.00.
    expect(tote.coverage).toBeCloseTo(0.75, 5);
    expect(tote.values.gross_profit).toBe(20_000 - 4_000);
  });
});

describe("cut by an order dimension", () => {
  it("by currency converts euro in code and adds up", async () => {
    const r = await report({ metrics: ["net_sales", "orders"], dimensions: ["currency"] });
    expect(sumOf(r.rows, "net_sales")).toBe(r.totals.values.net_sales);
    // 90.00 + 12.50 EUR without VAT (72.00 + 10.00) = 82.00 EUR = 820.00 NOK.
    expect(r.rows.find((row) => row.keys[0] === "EUR")?.values.net_sales).toBe(82_000);
    expect(r.rows.some((row) => row.keys[0] === "SEK")).toBe(false);
  });

  it("by type of customer, by code (with a row for none) and by payment method", async () => {
    const types = await report({ metrics: ["orders", "customers"], dimensions: ["customer_type"] });
    expect(Object.fromEntries(types.rows.map((row) => [row.keys[0], row.values.orders]))).toEqual({ new: 3, returning: 2 });
    const codes = await report({ metrics: ["orders"], dimensions: ["discount_code"] });
    expect(Object.fromEntries(codes.rows.map((row) => [row.keys[0], row.values.orders]))).toEqual({ summer: 1, [NONE_KEY]: 4 });
    const methods = await report({ metrics: ["net_sales", "refunds"], dimensions: ["payment_method"] });
    expect(methods.rows.map((row) => row.keys[0])).toEqual(["unknown"]);
    expect(methods.rows[0].values.refunds).toBe(methods.totals.values.refunds);
  });

  it("by day, refunds by their own day", async () => {
    const r = await report({ metrics: ["net_sales", "refunds"], dimensions: ["day"] });
    expect(r.rows.map((row) => row.keys[0])).toEqual(["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-05", "2026-09-06", "2026-09-07"]);
    expect(r.rows.find((row) => row.keys[0] === "2026-09-07")?.values.refunds).toBe(5_000);
    expect(sumOf(r.rows, "refunds")).toBe(r.totals.values.refunds);
  });
});

describe("the catalogue's rules", () => {
  it("refuse a cut the catalogue does not allow, and run every ready report", async () => {
    const refused = await runReport(store, spec({ metrics: ["refunds"], dimensions: ["product"] }), NOW);
    expect(refused).toMatchObject({ ok: false, problems: [{ kind: "refunds_by", dimension: "product" }] });
    for (const key of READY_KEYS) {
      const outcome = await runReport(store, { ...READY_REPORTS[key], period: spec({}).period }, NOW);
      expect(outcome.ok, key).toBe(true);
    }
  });

  it("never read another store's orders", async () => {
    const r = await report({ metrics: ["net_sales", "orders"], dimensions: ["product"] }, other);
    expect(r.totals.values.orders).toBe(1);
    expect(r.rows.find((row) => row.keys[0] === products["DEMO-TOTE"])).toBeUndefined();
  });
});

describe("saved reports", () => {
  it("keep a name and a spec for their store only, check the spec on save and on read, and refuse past the limit", async () => {
    const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${store.id}::uuid limit 1`);
    const account = String(owner.account_id);
    const spec0 = READY_REPORTS.sales_by_variant;
    expect(await saveReport(store.id, account, { title: "  ", spec: spec0 })).toEqual({ ok: false, reason: "title" });
    expect(await saveReport(store.id, account, { title: "Refunds by product", spec: { ...spec0, metrics: ["refunds"], dimensions: ["product"] } })).toMatchObject({
      ok: false,
      reason: "spec",
      problems: [{ kind: "refunds_by", dimension: "product" }],
    });
    expect(await saveReport(store.id, account, { title: "Bad", spec: { metrics: ["drop table"] } })).toEqual({ ok: false, reason: "spec" });

    const saved = await saveReport(store.id, account, { title: "Variants", spec: spec0 });
    expect(saved).toMatchObject({ ok: true });
    const id = (saved as { id: string }).id;
    expect((await listSavedReports(store.id)).map((r) => r.title)).toEqual(["Variants"]);
    expect(await getSavedReport(store.id, id)).toMatchObject({ title: "Variants", spec: spec0, problems: [] });
    // Another store cannot read, change or delete it.
    expect(await getSavedReport(other.id, id)).toBeNull();
    expect(await saveReport(other.id, account, { title: "Mine", spec: spec0 }, id)).toEqual({ ok: false, reason: "gone" });
    expect(await deleteReport(other.id, account, id)).toBe(false);
    // Changed over itself.
    expect(await saveReport(store.id, account, { title: "Variants, 7 days", spec: { ...spec0, period: { preset: "7d", compare: "none" } } }, id)).toEqual({ ok: true, id });
    expect((await getSavedReport(store.id, id))?.spec?.period.preset).toBe("7d");
    // A spec stored before the catalogue changed is read back with what is wrong, never thrown away.
    await db().execute(sql`update commerce.saved_reports set spec = jsonb_set(spec, '{dimensions}', '["product", "day", "month"]') where id = ${id}::uuid`);
    expect((await getSavedReport(store.id, id))?.spec).toBeNull();

    const audited = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.id}::uuid and action like 'analytics.report_%'`);
    expect(audited.map((r) => r.action)).toEqual(expect.arrayContaining(["analytics.report_saved"]));
    expect(await deleteReport(store.id, account, id)).toBe(true);
    expect(await listSavedReports(store.id)).toEqual([]);

    // The limit, counted under the store's lock.
    await db().execute(sql`
      insert into commerce.saved_reports (store_id, title, spec)
      select ${store.id}::uuid, 'r' || g, ${JSON.stringify(spec0)}::jsonb from generate_series(1, ${SAVED_REPORTS_MAX}) g`);
    expect(await saveReport(store.id, account, { title: "One too many", spec: spec0 })).toEqual({ ok: false, reason: "too_many" });
    await db().execute(sql`delete from commerce.saved_reports where store_id = ${store.id}::uuid`);
  });
});

describe("the CSV", () => {
  it("is the table as the page shows it: labels, amounts as decimals, the rest row and the totals, formula characters escaped", async () => {
    const r = await report({ metrics: ["net_sales", "units"], dimensions: ["product"] });
    const labels = await reportLabels(store, r, "en", "en-GB");
    const csv = reportCsv(r, labels);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("period_from,period_to,previous_from,previous_to,product,net_sales,net_sales_previous,units,units_previous,currency");
    expect(lines.some((l) => l.includes(",Shipping and other order amounts,139.20,"))).toBe(true);
    expect(lines[lines.length - 1].startsWith("2026-09-01,2026-09-07,2026-08-25,2026-08-31,total,")).toBe(true);
    expect(lines.slice(1).every((l) => l.endsWith(",NOK"))).toBe(true);
  });
});
