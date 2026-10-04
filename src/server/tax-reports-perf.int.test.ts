import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { quarterPeriod } from "@/lib/tax-periods";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fake = vi.hoisted(() => {
  const refunds = new Map<string, { id: string; object: "refund"; status: string; amount: number; currency: string; created: number; payment_intent: string; metadata: Record<string, string> }>();
  let next = 0;
  const client = {
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }),
        list: async ({ payment_intent }: { payment_intent: string }) => ({ data: payment_intent.startsWith("pi_for_") ? [{ id: payment_intent.slice("pi_for_".length) }] : [] }),
      },
    },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    refunds: {
      create: async (params: { amount: number; payment_intent: string; metadata: Record<string, string> }) => {
        const id = `re_perf_${++next}_${Math.random().toString(36).slice(2, 8)}`;
        const refund = { id, object: "refund" as const, status: "succeeded", amount: params.amount, currency: "nok", created: Math.floor(Date.now() / 1000), payment_intent: params.payment_intent, metadata: params.metadata };
        refunds.set(id, refund);
        return refund;
      },
      retrieve: async (id: string) => refunds.get(id),
    },
  };
  return { client };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
type Fixture = Awaited<ReturnType<typeof fx.makeStore>>;
const t = await import("./tax-reports-fixture");
const { documentGroups, returnView, vatReport } = await import("./tax-reports");
const { reconciliation } = await import("./tax-reconciliation");
const { refundOrder } = await import("./order-admin");

type Row = Record<string, unknown>;

/**
 * A guard for the speed of the VAT, OSS and IOSS reports (D161, docs 6.4), as the analytics guard is for the cockpit: one store with five
 * thousand documents (four thousand invoices and a thousand credit notes) over a quarter, made by set-based SQL from real ones, and every
 * read timed. Nothing is analysed after the seed on purpose: the planner then knows nothing of the tables, which is when a read that leans on
 * its estimates turns into a nested loop that reads a side once per row. The bound is generous, a few times what a read takes here.
 */

const INVOICES = 4_000;
const CREDITS = 1_000;
const BOUND_MS = 2_000;
const Q3 = quarterPeriod(2026, 3);
const RANGE = { from: Q3.from, to: Q3.to };

afterAll(async () => {
  await closeDb();
});

async function columns(table: string): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    select column_name from information_schema.columns where table_schema = 'commerce' and table_name = ${table} and is_generated = 'NEVER' order by ordinal_position
  `);
  return rows.map((r) => String(r.column_name));
}

const token = (prefix: string) => sql.raw(`'${prefix}' || substr(md5(random()::text) || md5(random()::text) || md5(random()::text), 1, 43)`);

let own: Fixture;
let storeId: string;

beforeAll(async () => {
  await t.insertEcb("2026-09-30", t.ECB_2026_09_30);
  own = await t.sellerStore("tax-perf");
  storeId = own.storeId;
  const de = await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 2]], { market: t.markets.de });
  const dk = await t.paidOn(own, "2026-09-12", [["DEMO-MUG-WHITE", 2]], { market: t.markets.dk });
  await t.issueBackdated(storeId);
  await refundOrder(storeId, de.orderId, { amountMinor: 5_000, reason: "Skadet", restock: [] }, own.ownerId);
  await refundOrder(storeId, dk.orderId, { amountMinor: 50_000, reason: "Skadet", restock: [] }, own.ownerId);

  const [templates] = await db().execute<Row>(sql`select array_agg(o.id order by o.market_code) as ids from commerce.orders o where o.store_id = ${storeId}::uuid`);
  const [dkOrder, deOrder] = (templates.ids as string[]).map(String);
  const [dkCredit] = await db().execute<Row>(sql`select c.id from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = ${dkOrder}::uuid`);
  const [deCredit] = await db().execute<Row>(sql`select c.id from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = ${deOrder}::uuid`);
  const [orderCols, paymentCols, invoiceCols, creditCols] = await Promise.all([columns("orders"), columns("payments"), columns("invoices"), columns("credit_notes")]);
  const list = (cols: string[], over: Record<string, ReturnType<typeof sql.raw> | ReturnType<typeof sql>>) =>
    sql.join(cols.map((c) => over[c] ?? sql.raw(`t.${c}`)), sql`, `);
  const names = (cols: string[]) => sql.raw(cols.join(", "));

  await db().transaction(async (tx) => {
    // As a bulk load would: no triggers and no key checks (the postgres role may set it).
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`
      create temp table perf_map on commit drop as
        select g, gen_random_uuid() as oid, gen_random_uuid() as iid, gen_random_uuid() as pid, gen_random_uuid() as cid, gen_random_uuid() as rid,
               (g % 2 = 0) as is_de, date '2026-07-01' + (g % 92) as day
        from generate_series(1, ${INVOICES}) g
    `);
    for (const [deFlag, orderId] of [[true, deOrder], [false, dkOrder]] as const) {
      await tx.execute(sql`
        insert into commerce.orders (${names(orderCols)})
        select ${list(orderCols, {
          id: sql.raw("m.oid"),
          number: sql.raw("'P' || m.g"),
          placed_at: sql.raw("(m.day + time '12:00') at time zone 'Europe/Oslo'"),
        })}
        from commerce.orders t join perf_map m on m.is_de = ${deFlag} where t.id = ${orderId}::uuid
      `);
      await tx.execute(sql`
        insert into commerce.payments (${names(paymentCols)})
        select ${list(paymentCols, { id: sql.raw("m.pid"), order_id: sql.raw("m.oid"), provider_reference: sql.raw("'cs_perf_' || m.g") })}
        from commerce.payments t join perf_map m on m.is_de = ${deFlag} where t.order_id = ${orderId}::uuid
      `);
      await tx.execute(sql`
        insert into commerce.invoices (${names(invoiceCols)})
        select ${list(invoiceCols, {
          id: sql.raw("m.iid"),
          order_id: sql.raw("m.oid"),
          number: sql.raw("1000 + m.g"),
          document_number: sql.raw("'P' || (1000 + m.g)"),
          public_token: token("inv_"),
          issued_on: sql.raw("m.day"),
          supply_date: sql.raw("m.day"),
        })}
        from commerce.invoices t join perf_map m on m.is_de = ${deFlag} where t.order_id = ${orderId}::uuid
      `);
    }
    for (const [deFlag, creditId] of [[true, String(deCredit.id)], [false, String(dkCredit.id)]] as const) {
      await tx.execute(sql`
        insert into commerce.credit_notes (${names(creditCols)})
        select ${list(creditCols, {
          id: sql.raw("m.cid"),
          invoice_id: sql.raw("m.iid"),
          refund_id: sql.raw("m.rid"),
          number: sql.raw("1000 + m.g"),
          document_number: sql.raw("'PK' || (1000 + m.g)"),
          public_token: token("crn_"),
          issued_on: sql.raw("least(m.day + 3, date '2026-09-30')"),
        })}
        from commerce.credit_notes t join perf_map m on m.is_de = ${deFlag} and m.g <= ${CREDITS} where t.id = ${creditId}::uuid
      `);
    }
  });
}, 180_000);

async function timed<T>(label: string, work: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const started = performance.now();
  const value = await work();
  const ms = performance.now() - started;
  expect(ms, `${label} took ${Math.round(ms)} ms`).toBeLessThan(BOUND_MS);
  return { value, ms };
}

describe("the reports on a store with five thousand documents", () => {
  it("has the documents the test made", async () => {
    const [i] = await db().execute<Row>(sql`select count(*)::int as n from commerce.invoices where store_id = ${storeId}::uuid`);
    const [c] = await db().execute<Row>(sql`select count(*)::int as n from commerce.credit_notes where store_id = ${storeId}::uuid`);
    expect(Number(i.n)).toBeGreaterThanOrEqual(INVOICES);
    expect(Number(c.n)).toBeGreaterThanOrEqual(CREDITS);
  });

  it("reads the quarter's document groups within the bound, and gives a few hundred rows at most", async () => {
    const { value } = await timed("documentGroups", () => documentGroups(storeId, RANGE));
    expect(value.length).toBeGreaterThan(0);
    expect(value.length).toBeLessThan(2_000);
    const invoices = value.filter((g) => g.docKind === "invoice").reduce((n, g) => n + g.documents, 0);
    const notes = value.filter((g) => g.docKind === "credit_note").reduce((n, g) => n + g.documents, 0);
    expect(invoices).toBeGreaterThanOrEqual(INVOICES);
    expect(notes).toBeGreaterThanOrEqual(CREDITS);
  });

  it("builds the VAT report, the OSS return and the reconciliation each within the bound, and they agree on the numbers", async () => {
    const store = (await fx.ownerOf(own)).store;
    const vat = await timed("vatReport", () => vatReport(store, RANGE));
    expect(vat.value.report.totals.invoices).toBeGreaterThanOrEqual(INVOICES);
    const oss = await timed("returnView", () => returnView(store, "oss", Q3, "filing"));
    expect(oss.value.data.incomplete).toBe(false);
    expect(oss.value.data.part2.length).toBeGreaterThan(0);
    const rec = await timed("reconciliation", () => reconciliation(store, RANGE));
    expect(rec.value.balanced).toBe(true);
    expect(rec.value.bridges.reduce((n, b) => n + b.reportMinor, 0)).toBeGreaterThan(0);
  });
});
