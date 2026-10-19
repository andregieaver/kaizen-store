/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the tests read them as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, one as q1, placeOrder, refund, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Payouts and reconciliation (wave 4 unit C, D290, `docs/wave-4-payments.md` 5): every rule the database holds, against every migration applied to a real
 * Postgres (PGlite).
 */

let db: PGlite;
let store: string;

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "po-a");
});

afterAll(async () => {
  await db.close();
});

let n = 0;
const payout = async (over: { currency?: string; automatic?: boolean } = {}) => {
  n += 1;
  return scalar<string>(
    `insert into commerce.payouts (store_id, provider, provider_reference, provider_account, amount_minor, currency, status, automatic, arrival_on, provider_created_at)
     values ($1, 'stripe', $2, 'acct_fx', 9000, $3, 'paid', $4, current_date, now()) returning id`,
    [store, `po_fx_${n}`, over.currency ?? "NOK", over.automatic ?? true],
  );
};

const line = (payoutId: string, values: { kind?: string; amount?: number; fee?: number; net?: number; currency?: string; payment?: string | null; order?: string | null }) => {
  n += 1;
  const amount = values.amount ?? 10000;
  const fee = values.fee ?? 300;
  return db.query(
    `insert into commerce.payout_lines (store_id, payout_id, provider_reference, kind, provider_type, amount_minor, fee_minor, net_minor, currency, payment_id, order_id, provider_created_at)
     values ($1, $2, $3, $4, 'charge', $5, $6, $7, $8, $9, $10, now()) returning id`,
    [store, payoutId, `txn_fx_${n}`, values.kind ?? "charge", amount, fee, values.net ?? amount - fee, values.currency ?? "NOK", values.payment ?? null, values.order ?? null],
  );
};

describe("a payout", () => {
  it("is never deleted, and what identifies it never changes; its status does", async () => {
    const id = await payout();
    await db.query("update commerce.payouts set status = 'failed', failure_code = 'account_closed' where id = $1", [id]);
    expect(await scalar("select status from commerce.payouts where id = $1", [id])).toBe("failed");
    await rejects("update commerce.payouts set provider_reference = 'po_other' where id = $1", [id], /payouts.fixed/);
    await rejects("update commerce.payouts set currency = 'EUR' where id = $1", [id], /payouts.fixed/);
    await rejects("delete from commerce.payouts where id = $1", [id], /payouts.no_delete/);
    await rejects(
      "insert into commerce.payouts (store_id, provider, provider_reference, provider_account, amount_minor, currency, status, automatic, provider_created_at) values ($1, 'stripe', $2, 'acct', 1, 'NOK', 'paid', true, now())",
      [store, `po_fx_${n}`],
      /payouts_reference_key/,
    );
    await rejects(
      "insert into commerce.payouts (store_id, provider, provider_reference, provider_account, amount_minor, currency, status, automatic, provider_created_at) values ($1, 'stripe', 'po_x', 'acct', 1, 'NOK', 'sent', true, now())",
      [store],
      /payouts_status/,
    );
  });
});

describe("a payout's line", () => {
  it("is in its payout's currency, adds up net = amount − fee, is never changed or deleted", async () => {
    const id = await payout();
    await expect(line(id, { currency: "EUR" })).rejects.toThrow(/payout_lines.currency/);
    await expect(line(id, { net: 1 })).rejects.toThrow(/payout_lines_net/);
    const lineId = (await line(id, {})).rows[0] as { id: string };
    await rejects("update commerce.payout_lines set amount_minor = 1, net_minor = 1 - fee_minor where id = $1", [lineId.id], /payout_lines.fixed/);
    await rejects("delete from commerce.payout_lines where id = $1", [lineId.id], /payout_lines.no_delete/);
  });

  it("is tied once, and only to the order its payment or refund belongs to", async () => {
    const order = await placeOrder(db, store, { lines: [{ sku: "A", unit: 10000 }] });
    const other = await placeOrder(db, store, { lines: [{ sku: "B", unit: 5000 }] });
    const payment = await scalar<string>("select id from commerce.payments where order_id = $1", [order.id]);
    const id = await payout();
    await expect(line(id, { payment, order: other.id })).rejects.toThrow(/payout_lines.other_order/);
    const untied = ((await line(id, {})).rows[0] as { id: string }).id;
    await db.query("update commerce.payout_lines set payment_id = $2, order_id = $3 where id = $1", [untied, payment, order.id]);
    expect(await one("select payment_id, order_id from commerce.payout_lines where id = $1", [untied])).toEqual({ payment_id: payment, order_id: order.id });
    await rejects("update commerce.payout_lines set order_id = $2, payment_id = null where id = $1", [untied, other.id], /payout_lines.tied/);

    const refundId = await refund(db, order.id, 2000);
    n += 1;
    await rejects(
      `insert into commerce.payout_lines (store_id, payout_id, provider_reference, kind, provider_type, amount_minor, fee_minor, net_minor, currency, refund_id, order_id, provider_created_at)
       values ($1, $2, $3, 'refund', 'refund', -2000, 0, -2000, 'NOK', $4, $5, now())`,
      [store, id, `txn_fx_${n}`, refundId, other.id],
      /payout_lines.other_order/,
    );
  });
});

describe("a payment's fee from Stripe", () => {
  it("is set once with its currency, Stripe's only, and never changed", async () => {
    const order = await placeOrder(db, store, { lines: [{ sku: "C", unit: 10000 }] });
    const payment = await scalar<string>("select id from commerce.payments where order_id = $1", [order.id]);
    await rejects("update commerce.payments set provider_fee_minor = 300 where id = $1", [payment], /payments_provider_fee/);
    await db.query("update commerce.payments set provider_fee_minor = 300, application_fee_minor = 150, fee_currency = 'NOK' where id = $1", [payment]);
    await rejects("update commerce.payments set provider_fee_minor = 301 where id = $1", [payment], /payments.fee_once/);
    const manual = await placeOrder(db, store, { lines: [{ sku: "D", unit: 10000 }], provider: "manual" });
    const manualPayment = await scalar<string>("select id from commerce.payments where order_id = $1", [manual.id]);
    await rejects("update commerce.payments set provider_fee_minor = 10, fee_currency = 'NOK' where id = $1", [manualPayment], /payments_provider_fee/);
  });
});
