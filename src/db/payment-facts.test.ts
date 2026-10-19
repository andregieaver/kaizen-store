/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the tests read them as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COPY_RULES } from "@/lib/store-copy-rules";

import { createInvoiceStore, one as q1, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Payment facts and disputes (wave 4 unit A, D288, `docs/wave-4-payments.md` 3): every rule the database holds, against every migration applied to a
 * real Postgres (PGlite).
 */

let db: PGlite;
let store: string;

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "pf-a");
});

afterAll(async () => {
  await db.close();
});

async function paidOrder(provider: "stripe" | "manual" = "stripe") {
  const order = await placeOrder(db, store, { lines: [{ sku: "A", unit: 10000 }], provider });
  const payment = await scalar<string>("select id from commerce.payments where order_id = $1", [order.id]);
  return { order, payment };
}

let disputes = 0;
const dispute = (orderId: string, paymentId: string, over: Record<string, unknown> = {}) => {
  disputes += 1;
  const row = { reference: `dp_${disputes}`, currency: "NOK", status: "needs_response", amount: 10000, ...over };
  return db.query(
    `insert into commerce.payment_disputes (store_id, order_id, payment_id, provider, provider_reference, amount_minor, currency, reason, status, evidence_due_by, opened_at)
     values ($1, $2, $3, 'stripe', $4, $5, $6, 'fraudulent', $7, now() + interval '7 days', now()) returning id`,
    [store, orderId, paymentId, row.reference, row.amount, row.currency, row.status],
  );
};

describe("a payment's facts", () => {
  it("keeps Stripe's method, wallet, brand and risk on a Stripe payment", async () => {
    const { payment } = await paidOrder();
    await db.query(
      "update commerce.payments set method_type = 'card', wallet = 'apple_pay', card_brand = 'visa', risk_level = 'elevated', risk_score = 67, charge_reference = 'ch_1', facts_read_at = now() where id = $1",
      [payment],
    );
    expect(await one("select method_type, wallet, risk_level, risk_score from commerce.payments where id = $1", [payment])).toEqual({
      method_type: "card",
      wallet: "apple_pay",
      risk_level: "elevated",
      risk_score: 67,
    });
  });

  it("refuses a risk level Stripe does not have and a score out of 0 to 100", async () => {
    const { payment } = await paidOrder();
    await rejects("update commerce.payments set risk_level = 'low' where id = $1", [payment], /payments_risk_level/);
    await rejects("update commerce.payments set risk_score = 101 where id = $1", [payment], /payments_risk_score/);
  });

  it("refuses Stripe's facts on a payment recorded by staff", async () => {
    const { payment } = await paidOrder("manual");
    await rejects("update commerce.payments set method_type = 'card' where id = $1", [payment], /payments_facts_stripe/);
  });
});

describe("a dispute", () => {
  it("belongs to its payment's order, in its payment's currency", async () => {
    const a = await paidOrder();
    const b = await paidOrder();
    await expect(dispute(a.order.id, a.payment)).resolves.toBeTruthy();
    await expect(dispute(b.order.id, a.payment)).rejects.toThrow(/payment_disputes.other_order/);
    await expect(dispute(a.order.id, a.payment, { currency: "EUR" })).rejects.toThrow(/payment_disputes.currency/);
  });

  it("is one row per provider's reference", async () => {
    const a = await paidOrder();
    await dispute(a.order.id, a.payment, { reference: "dp_same" });
    await expect(dispute(a.order.id, a.payment, { reference: "dp_same" })).rejects.toThrow(/payment_disputes_reference_key/);
  });

  it("keeps what identifies it, closes once with an outcome, is reminded once and is never deleted", async () => {
    const a = await paidOrder();
    const id = (await dispute(a.order.id, a.payment)).rows[0] as { id: string };
    await rejects("update commerce.payment_disputes set provider_reference = 'dp_other' where id = $1", [id.id], /payment_disputes.fixed/);
    await rejects("update commerce.payment_disputes set amount_minor = 0 where id = $1", [id.id], /payment_disputes_amount/);
    await rejects("update commerce.payment_disputes set status = 'teapot' where id = $1", [id.id], /payment_disputes_status/);
    // A closed dispute has its outcome, and only then.
    await rejects("update commerce.payment_disputes set closed_at = now() where id = $1", [id.id], /payment_disputes_closed/);
    await db.query("update commerce.payment_disputes set reminded_at = now() where id = $1", [id.id]);
    await rejects("update commerce.payment_disputes set reminded_at = now() + interval '1 day' where id = $1", [id.id], /payment_disputes.reminded/);
    await db.query("update commerce.payment_disputes set status = 'lost', outcome = 'lost', closed_at = now() where id = $1", [id.id]);
    await rejects("update commerce.payment_disputes set outcome = 'won' where id = $1", [id.id], /payment_disputes.closed/);
    // Stripe may still update a closed dispute's balance figures.
    await db.query("update commerce.payment_disputes set funds_withdrawn_minor = 10000, fee_minor = 15000 where id = $1", [id.id]);
    await rejects("delete from commerce.payment_disputes where id = $1", [id.id], /payment_disputes.no_delete/);
  });

  it("is never copied with a store", () => {
    expect(COPY_RULES.payment_disputes.group).toBe("never");
  });
});

describe("staff alerts", () => {
  it("take a dispute alert", async () => {
    const account = await scalar<string>("insert into commerce.accounts (email) values ('pf-owner@example.com') returning id");
    await db.query("insert into commerce.staff_alert_recipients (store_id, account_id, events) values ($1, $2, array['dispute'])", [store, account]);
    expect(await scalar("select events from commerce.staff_alert_recipients where store_id = $1 and account_id = $2", [store, account])).toEqual(["dispute"]);
  });
});
