/* eslint-disable @typescript-eslint/no-explicit-any -- rows are read as JSON */
import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, one, placeOrder, scalar, type Db } from "./invoice-fixture";

/**
 * What a single connection cannot show (PGlite is one): payments and refunds that commit at the same time. Against a real Postgres
 * (DATABASE_URL, after scripts/db-setup.mjs): fifty payments of one store at once are numbered 1 to 50 with no gap and no repeat,
 * and two refunds that together are more than the invoice cannot both take what is left.
 */

const url = process.env.DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("invoices and credit notes under concurrency", () => {
  let pool: Pool;
  let db: Db;

  beforeAll(() => {
    pool = new Pool({ connectionString: url, max: 60 });
    db = pool as unknown as Db;
  });
  afterAll(async () => {
    await pool.end();
  });

  /** Runs statements in a transaction of their own on their own connection, all started together. */
  async function atOnce(jobs: ((q: (sql: string, params?: unknown[]) => Promise<any>) => Promise<void>)[]) {
    const clients = await Promise.all(jobs.map(() => pool.connect()));
    try {
      await Promise.all(
        jobs.map(async (job, i) => {
          const c = clients[i];
          await c.query("begin");
          try {
            await job((sql, params) => c.query(sql, params));
            await c.query("commit");
          } catch (error) {
            await c.query("rollback");
            throw error;
          }
        }),
      );
    } finally {
      clients.forEach((c) => c.release());
    }
  }

  it("numbers fifty payments of one store at once from 1 to 50 with no gap", async () => {
    const store = await createInvoiceStore(db, `conc-${randomUUID().slice(0, 8)}`);
    const orders: string[] = [];
    for (let i = 0; i < 50; i += 1) orders.push((await placeOrder(db, store, { lines: [{ sku: `C${i}`, unit: 1000 + i }], pay: "pending-only" })).id);
    await atOnce(orders.map((id, i) => async (q) => void (await q("select commerce.complete_order_payment($1::uuid, $2)", [id, `cs_conc_${i}`]))));
    const numbers = (await db.query("select number::int as n from commerce.invoices where store_id = $1 order by number", [store])).rows.map((r: any) => r.n);
    expect(numbers).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const audit = await one<{ ok: boolean; missing: string }>(db, "select ok, missing::text from commerce.document_audit($1) where series = 'invoice'", [store]);
    expect(audit).toEqual({ ok: true, missing: "0" });
    expect(await scalar(db, "select count(distinct order_id)::int from commerce.invoices where store_id = $1", [store])).toBe(50);
  }, 60_000);

  it("a payment that fails to be invoiced does not leave a gap among payments that succeed at the same time", async () => {
    const store = await createInvoiceStore(db, `conc-gap-${randomUUID().slice(0, 8)}`);
    const orders: string[] = [];
    for (let i = 0; i < 12; i += 1) orders.push((await placeOrder(db, store, { lines: [{ sku: `G${i}`, unit: 2000 + i }], pay: "pending-only" })).id);
    // Every third order is made unissuable after the number is taken: a trigger that refuses its invoice.
    const bad = orders.filter((_, i) => i % 3 === 0);
    const fn = `fx_conc_boom_${randomUUID().slice(0, 6)}`;
    await db.query(`create function commerce.${fn}() returns trigger language plpgsql as $$ begin if new.order_id = any (array[${bad.map((id) => `'${id}'::uuid`).join(",")}]) then raise exception 'forced'; end if; return new; end $$`);
    await db.query(`create trigger ${fn} before insert on commerce.invoices for each row execute function commerce.${fn}()`);
    try {
      await atOnce(orders.map((id, i) => async (q) => void (await q("select commerce.complete_order_payment($1::uuid, $2)", [id, `cs_gap_${i}`]))));
    } finally {
      await db.query(`drop trigger ${fn} on commerce.invoices`);
      await db.query(`drop function commerce.${fn}()`);
    }
    expect(await scalar(db, "select count(*)::int from commerce.orders where store_id = $1 and status = 'paid'", [store])).toBe(12);
    const numbers = (await db.query("select number::int as n from commerce.invoices where store_id = $1 order by number", [store])).rows.map((r: any) => r.n);
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => i + 1));
    // The four that failed wait, and the job issues them with the next numbers.
    expect(await scalar(db, "select commerce.issue_waiting_invoices($1::uuid)", [store])).toBe(4);
    expect(await one(db, "select ok, missing::text from commerce.document_audit($1) where series = 'invoice'", [store])).toEqual({ ok: true, missing: "0" });
  }, 60_000);

  it("two refunds that together are more than the invoice cannot both take what is left", async () => {
    const store = await createInvoiceStore(db, `conc-refund-${randomUUID().slice(0, 8)}`);
    const order = await placeOrder(db, store, { lines: [{ sku: "R", unit: 10000 }] });
    const payment = await scalar<string>(db, "select id from commerce.payments where order_id = $1", [order.id]);
    await atOnce(
      [6000, 7000].map((amount, i) => async (q) => {
        await q("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status) values ($1, $2, $3, 'race', $4, 'succeeded')", [store, payment, amount, `re_race_${i}_${randomUUID()}`]);
      }),
    );
    const notes = (await db.query("select total_minor::int as total, snapshot -> 'notes' as notes from commerce.credit_notes where store_id = $1 order by number", [store])).rows as any[];
    expect(notes).toHaveLength(2);
    expect(notes.reduce((s, n) => s + n.total, 0)).toBe(10000);
    expect(notes.filter((n) => n.notes.includes("credit_capped"))).toHaveLength(1);
    expect(await scalar(db, "select count(*)::int from commerce.credit_notes where store_id = $1", [store])).toBe(2);
  }, 30_000);
});
