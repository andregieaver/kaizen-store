/* eslint-disable @typescript-eslint/no-explicit-any -- rows are JSON and the tests read them as such */
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createInvoiceStore, one as q1, placeOrder, scalar as q0 } from "./invoice-fixture";
import { createTestDatabase } from "./testing";

/**
 * Payment terms for company accounts (wave 4 unit F, D293, `docs/wave-4-payments.md` 8): every rule the database holds, against every migration
 * applied to a real Postgres (PGlite). An order on terms is placed as `placeOrder()` places it: pending, its whole total its balance, its terms row
 * and a pending `terms` payment written, then confirmed by `complete_order_payment()`.
 */

let db: PGlite;
let store: string;
let company: string;

const one = <T = Record<string, any>>(sql: string, params: unknown[] = []) => q1<T>(db, sql, params);
const scalar = <T = unknown>(sql: string, params: unknown[] = []) => q0<T>(db, sql, params);
const rejects = (sql: string, params: unknown[], pattern: RegExp) => expect(db.query(sql, params)).rejects.toThrow(pattern);

beforeAll(async () => {
  db = await createTestDatabase();
  store = await createInvoiceStore(db, "terms-a");
  // A live store: an order on terms takes the store's mode, as a venue booking does, and only a live one gets an invoice number.
  await db.query(
    "insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values ($1, 'stripe', true, 'live') on conflict (store_id, provider) do update set active_mode = 'live'",
    [store],
  );
  company = await scalar<string>(
    "insert into commerce.customer_companies (store_id, name, organisation_number, payment_terms) values ($1, 'Fjord AS', '923456789', 'net_30') returning id",
    [store],
  );
});

afterAll(async () => {
  await db.close();
});

let n = 0;

/** An order bought on terms, confirmed: its terms row, its `terms` payment and the payment completed. */
async function termsOrder(options: { confirm?: boolean; customer?: string | null } = {}) {
  n += 1;
  const order = await placeOrder(db, store, { lines: [{ sku: `T${n}`, unit: 12500 }], company: { name: "Fjord AS", number: "923456789" }, pay: false });
  await db.query("update commerce.orders set balance_minor = total_minor, customer_id = $2 where id = $1", [order.id, options.customer ?? null]);
  await db.query("insert into commerce.order_payment_terms (store_id, order_id, company_id, terms, due_on) values ($1, $2, $3, 'net_30', current_date + 30)", [
    store,
    order.id,
    company,
  ]);
  const reference = `terms_fx_${n}`;
  await db.query("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'terms', $3, $4, 'NOK', 'pending')", [
    store,
    order.id,
    reference,
    order.total,
  ]);
  if (options.confirm !== false) await db.query("select commerce.complete_order_payment($1, $2)", [order.id, reference]);
  const payment = await scalar<string>("select id from commerce.payments where order_id = $1 and provider = 'terms'", [order.id]);
  return { order, payment, reference };
}

describe("an order's terms", () => {
  it("are given only to an order of a company while it is placed, never to a paid or copied order", async () => {
    const paid = await placeOrder(db, store, { lines: [{ sku: "P1", unit: 5000 }] });
    await rejects("insert into commerce.order_payment_terms (store_id, order_id, company_id, terms, due_on) values ($1, $2, $3, 'net_30', current_date)", [store, paid.id, company], /order_payment_terms.order/);
    const pending = await placeOrder(db, store, { lines: [{ sku: "P2", unit: 5000 }], pay: false });
    await rejects("insert into commerce.order_payment_terms (store_id, order_id, company_id, terms, due_on) values ($1, $2, null, 'net_30', current_date)", [store, pending.id], /order_payment_terms.order/);
    await rejects("insert into commerce.order_payment_terms (store_id, order_id, company_id, terms, due_on) values ($1, $2, $3, 'net_90', current_date)", [store, pending.id, company], /order_payment_terms_terms/);
  });

  it("keep their company, terms and due day; the claims and the payment are recorded once; the row is never deleted", async () => {
    const { order } = await termsOrder();
    await rejects("update commerce.order_payment_terms set due_on = due_on + 1 where order_id = $1", [order.id], /order_payment_terms.fixed/);
    await rejects("update commerce.order_payment_terms set terms = 'net_60' where order_id = $1", [order.id], /order_payment_terms.fixed/);
    await db.query("update commerce.order_payment_terms set reminder_sent_at = now() where order_id = $1", [order.id]);
    await rejects("update commerce.order_payment_terms set reminder_sent_at = now() + interval '1 day' where order_id = $1", [order.id], /order_payment_terms.once/);
    await rejects("delete from commerce.order_payment_terms where order_id = $1", [order.id], /order_payment_terms.delete/);
    // The company's deletion nulls it (refused by the server while it owes anything).
    await db.query("update commerce.order_payment_terms set company_id = null where order_id = $1", [order.id]);
    await rejects("update commerce.order_payment_terms set company_id = $2 where order_id = $1", [order.id, company], /order_payment_terms.fixed/);
  });

  it("a company's terms and credit limit are checked", async () => {
    await rejects("update commerce.customer_companies set payment_terms = 'net_45' where id = $1", [company], /customer_companies_terms/);
    await rejects("update commerce.customer_companies set credit_limit_minor = 100000 where id = $1", [company], /customer_companies_credit/);
    await rejects("update commerce.customer_companies set credit_limit_minor = -1, credit_currency = 'NOK' where id = $1", [company], /customer_companies_credit/);
    await db.query("update commerce.customer_companies set credit_limit_minor = 1000000, credit_currency = 'NOK' where id = $1", [company]);
    await db.query("update commerce.customer_companies set credit_limit_minor = null, credit_currency = null where id = $1", [company]);
  });
});

describe("confirming an order on terms", () => {
  it("makes it paid as a shop status with its invoice issued at once, its payment line due by its day", async () => {
    const { order } = await termsOrder();
    expect(await one("select status, balance_minor::int as balance from commerce.orders where id = $1", [order.id])).toEqual({ status: "paid", balance: order.total });
    expect(await scalar("select status from commerce.payments where order_id = $1 and provider = 'terms'", [order.id])).toBe("pending");
    const payments = await scalar<any[]>("select snapshot -> 'payments' from commerce.invoices where order_id = $1", [order.id]);
    const due = await scalar<string>("select to_char(due_on, 'YYYY-MM-DD') from commerce.order_payment_terms where order_id = $1", [order.id]);
    expect(payments).toEqual([{ kind: "due", amountMinor: order.total, provider: "terms", dueOn: due, terms: "net_30" }]);
  });

  it("is a test in the store's test mode, as a venue booking is: no invoice number", async () => {
    await db.query("insert into commerce.payment_providers (store_id, provider, enabled, active_mode) values ($1, 'stripe', true, 'test') on conflict (store_id, provider) do update set active_mode = 'test'", [store]);
    try {
      const { order } = await termsOrder();
      expect(await scalar("select test_mode from commerce.payments where order_id = $1 and provider = 'terms'", [order.id])).toBe(true);
      expect(await scalar("select commerce.invoice_eligibility($1)", [order.id])).toBe("test_mode");
      expect(await scalar("select count(*)::int from commerce.invoices where order_id = $1", [order.id])).toBe(0);
    } finally {
      await db.query("update commerce.payment_providers set active_mode = 'live' where store_id = $1", [store]);
    }
  });
});

describe("the money of an order on terms", () => {
  it("arrives after the invoice and is the invoice's money: a later refund of it gets its credit note", async () => {
    const { order, payment } = await termsOrder();
    // Paid by the pay link: a Stripe payment made after the invoice; the balance settled and the placeholder ended.
    await db.query("update commerce.payments set status = 'cancelled' where id = $1", [payment]);
    const paid = await scalar<string>(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, created_at) values ($1, $2, 'stripe', $3, $4, 'NOK', 'captured', now() + interval '1 minute') returning id",
      [store, order.id, `pi_terms_${order.id}`, order.total],
    );
    await db.query("update commerce.orders set balance_minor = 0 where id = $1", [order.id]);
    await db.query("update commerce.order_payment_terms set paid_at = now() where order_id = $1", [order.id]);
    const issued = await scalar<string>("select issued_at from commerce.invoices where order_id = $1", [order.id]);
    expect(await scalar("select commerce.payment_on_invoice($1, $2, $3)", [store, paid, issued])).toBe(true);
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status) values ($1, $2, 2500, 'Returned', 'succeeded')", [store, paid]);
    expect(await scalar("select count(*)::int from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = $1", [order.id])).toBe(1);
  });

  it("a later payment of an order not on terms is still not on its invoice (a no-show fee's rule is unchanged)", async () => {
    const plain = await placeOrder(db, store, { lines: [{ sku: "PL", unit: 5000 }] });
    const later = await scalar<string>(
      "insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status, created_at) values ($1, $2, 'stripe', $3, 1000, 'NOK', 'captured', now() + interval '1 hour') returning id",
      [store, plain.id, `pi_later_${plain.id}`],
    );
    const issued = await scalar<string>("select issued_at from commerce.invoices where order_id = $1", [plain.id]);
    expect(await scalar("select commerce.payment_on_invoice($1, $2, $3)", [store, later, issued])).toBe(false);
  });
});

describe("cancelling an unpaid order on terms", () => {
  it("voids its invoice: a succeeded `void` on the terms payment, never with a provider reference or above the payment, gets the credit note", async () => {
    const { order, payment } = await termsOrder();
    await rejects(
      "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind, provider_reference) values ($1, $2, $3, 'Cancelled', 'succeeded', 'void', 're_x')",
      [store, payment, order.total],
      /refunds_void/,
    );
    await rejects(
      "insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind) values ($1, $2, $3, 'Cancelled', 'succeeded', 'void')",
      [store, payment, order.total + 1],
      /refund.over_payment/,
    );
    const events = async () => scalar<number>("select count(*)::int from commerce.integration_events where store_id = $1 and event = 'order.refunded'", [store]).catch(() => 0);
    const before = await events();
    await db.query("insert into commerce.refunds (store_id, payment_id, amount_minor, reason, status, kind) values ($1, $2, $3, 'Cancelled', 'succeeded', 'void')", [store, payment, order.total]);
    expect(await scalar("select count(*)::int from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = $1", [order.id])).toBe(1);
    expect(await scalar("select coalesce(sum(c.total_minor), 0)::int from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = $1", [order.id])).toBe(order.total);
    expect(await events()).toBe(before);
  });
});

describe("what an order on terms earns", () => {
  it("earns no bonus credits, as a venue's balance does not", async () => {
    await db.query("update commerce.stores set features = array_append(features, 'bonus') where id = $1 and not ('bonus' = any(features))", [store]);
    await db.query(
      `insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, expires_months, currency)
       values ($1, true, 500, 0, 50, 12, 'NOK') on conflict (store_id) do update set enabled = true, earn_bps = 500`,
      [store],
    );
    const customer = await scalar<string>("insert into commerce.customers (store_id, email) values ($1, 'buyer@fjord.example') returning id", [store]);
    const { order } = await termsOrder({ customer });
    expect(await scalar("select count(*)::int from commerce.bonus_entries where order_id = $1 and kind = 'earn'", [order.id])).toBe(0);
    // The same basket paid at once earns.
    const plain = await placeOrder(db, store, { lines: [{ sku: "EARN", unit: 12500 }], pay: false });
    await db.query("update commerce.orders set customer_id = $2 where id = $1", [plain.id, customer]);
    await db.query("insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status) values ($1, $2, 'stripe', $3, $4, 'NOK', 'pending')", [
      store,
      plain.id,
      `pi_earn_${plain.id}`,
      plain.total,
    ]);
    await db.query("select commerce.complete_order_payment($1, $2)", [plain.id, `cs_earn_${plain.id}`]);
    expect(await scalar("select count(*)::int from commerce.bonus_entries where order_id = $1 and kind = 'earn'", [plain.id])).toBe(1);
  });
});
