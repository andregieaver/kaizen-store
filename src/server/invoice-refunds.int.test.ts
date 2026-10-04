import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** Kaizen's platform Stripe client, faked: refunds made and retrievable, the session behind a payment intent. */
const fake = vi.hoisted(() => {
  type FakeRefund = { id: string; object: "refund"; status: string; amount: number; currency: string; created: number; payment_intent: string; metadata: Record<string, string> };
  const state = { status: "succeeded", refunds: new Map<string, FakeRefund>(), next: 0, retrieved: [] as string[] };
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
        const id = `re_inv_${++state.next}_${Math.random().toString(36).slice(2, 8)}`;
        const refund: FakeRefund = { id, object: "refund", status: state.status, amount: params.amount, currency: "nok", created: Math.floor(Date.now() / 1000), payment_intent: params.payment_intent, metadata: params.metadata };
        state.refunds.set(id, refund);
        return refund;
      },
      retrieve: async (id: string) => {
        state.retrieved.push(id);
        return state.refunds.get(id);
      },
    },
  };
  return { client, state };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const inv = await import("./invoices");
const issue = await import("./invoice-issue");
const { refundOrder, getOrderAdmin, cancelOrder } = await import("./order-admin");
const { sendRefunded } = await import("./shopper-emails");
const { handleStripeEvent } = await import("./stripe-webhooks");
const refunds = await import("./stripe-refunds");

type Row = Record<string, unknown>;

/**
 * Credit notes for refunds (D159, docs 2.5 and 2.6), through the real server code with a faked Stripe: staff refunds (paths P1 to P4), a
 * pending refund that completes by the Stripe webhook (P6), a refund made in Stripe's Dashboard (P7), the job that asks Stripe about a refund
 * left pending, and every refusal: a failed refund, a replay, another store's, a refund reported failed after it succeeded. The credit note is
 * the database's (a deferred trigger at commit); none of the code here asks for one.
 */

let n = 0;
const eventOf = (type: string, refund: unknown, account: string): Stripe.Event => ({ id: `evt_inv_${++n}_${Math.random().toString(36).slice(2, 8)}`, type, account, data: { object: refund } }) as unknown as Stripe.Event;
const refundOf = (id: string) => fake.state.refunds.get(id)!;
const emails = (orderId: string, kind: string) =>
  db().execute<Row>(sql`select idempotency_key, to_address, html from commerce.email_messages where order_id = ${orderId}::uuid and kind = ${kind} order by created_at`);

beforeAll(() => {
  fake.state.status = "succeeded";
});
afterAll(async () => {
  await closeDb();
});

describe("staff refunds: each that succeeds gets a credit note, in its own series, never above the invoice", () => {
  it("shares a partial refund over the invoice, links the note in the refund email, and brings the whole to zero with the last one", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-a");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 3]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const first = await refundOrder(own.storeId, order.orderId, { amountMinor: 5_000, reason: "Skadet", restock: [] }, own.ownerId);
    expect(first).toMatchObject({ ok: true, status: "succeeded" });
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note).toMatchObject({ documentNumber: "K-1", totalMinor: 5_000, invoiceId: invoice.id, source: "refund", returnId: null, currency: "NOK" });
    expect(note.refundId).toBe((first as { refundId: string }).refundId);
    expect(note.netMinor + note.taxMinor).toBe(5_000);
    expect(note.snapshot).toMatchObject({
      documentType: "credit_note",
      refersTo: { invoiceId: invoice.id, invoiceNumber: invoice.documentNumber },
      position: { invoiceTotalMinor: invoice.totalMinor, creditedBeforeMinor: 0, creditedNowMinor: 5_000, leftOnInvoiceMinor: invoice.totalMinor - 5_000 },
    });
    // The refund email links the credit note (the database made it at commit, before the email) and says nothing it should not.
    await sendRefunded(own.storeId, order.orderId, note.refundId!, 5_000);
    const [mail] = await emails(order.orderId, "order.refunded");
    expect(String(mail.html)).toContain(`/account/documents/${note.token}`);
    expect(String(mail.html)).toContain("Din kreditnota K-1");
    const [carried] = await db().execute<Row>(sql`select count(*)::int as n from commerce.document_deliveries where document_id = ${note.id}::uuid`);
    expect(carried.n).toBe(1);

    // The rest of the order: a second note, then the invoice has nothing left, to the minor unit.
    const admin = (await getOrderAdmin(own.storeId, order.orderId))!;
    const second = await refundOrder(own.storeId, order.orderId, { amountMinor: admin.refundableMinor, reason: "Resten", restock: [] }, own.ownerId);
    expect(second).toMatchObject({ ok: true });
    const notes = await fx.notesOf(own.storeId, order.orderId);
    expect(notes.map((x) => x.documentNumber)).toEqual(["K-1", "K-2"]);
    expect(notes.reduce((sum, x) => sum + x.totalMinor, 0)).toBe(invoice.totalMinor);
    expect(notes.reduce((sum, x) => sum + x.taxMinor, 0)).toBe(invoice.taxMinor);
    expect(notes.reduce((sum, x) => sum + x.netMinor, 0)).toBe(invoice.netMinor);
    expect(notes[1].snapshot.position.leftOnInvoiceMinor).toBe(0);
    // The invoice lists its notes; the series are separate and unbroken; nothing waits.
    expect((await inv.getInvoice(own.storeId, invoice.id))!.creditNotes.map((c) => c.documentNumber)).toEqual(["K-1", "K-2"]);
    expect((await inv.listCreditNotes(own.storeId)).rows.map((r) => [r.documentNumber, r.invoiceNumber, r.source])).toEqual([["K-2", invoice.documentNumber, "refund"], ["K-1", invoice.documentNumber, "refund"]]);
    expect((await inv.documentAudit(own.storeId)).map((a) => [a.series, a.documents, a.ok])).toEqual([["credit_note", 2, true], ["invoice", 1, true]]);
    expect(await inv.waitingCreditNotes(own.storeId)).toEqual([]);
    expect(await inv.invoiceCheckupFindings(own.storeId)).toEqual([]);
    // The order's own history and the shopper's page.
    const docs = await inv.getOrderDocuments(own.storeId, order.orderId);
    expect(docs.creditNotes.map((c) => c.documentNumber)).toEqual(["K-1", "K-2"]);
  });

  it("allocates over two VAT rates in proportion to what each has left, and the notes add up to the invoice's VAT per rate", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-rates");
    // The notebook at the reduced rate for food (NO 15 %), the mug at 25 %.
    await db().execute(sql`
      update commerce.products set vat_category = 'food' where store_id = ${own.storeId}::uuid and id = (select product_id from commerce.product_variants where store_id = ${own.storeId}::uuid and sku = 'DEMO-NOTEBOOK-LINED')
    `);
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2], ["DEMO-NOTEBOOK-LINED", 3]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const rates = invoice.snapshot.buckets.map((b: { rate: number }) => b.rate).sort();
    expect(rates).toEqual([0.15, 0.25]);
    for (const amount of [3_333, 7_001]) {
      expect(await refundOrder(own.storeId, order.orderId, { amountMinor: amount, reason: "Del", restock: [] }, own.ownerId)).toMatchObject({ ok: true });
    }
    const admin = (await getOrderAdmin(own.storeId, order.orderId))!;
    await refundOrder(own.storeId, order.orderId, { amountMinor: admin.refundableMinor, reason: "Rest", restock: [] }, own.ownerId);
    const notes = await fx.notesOf(own.storeId, order.orderId);
    expect(notes).toHaveLength(3);
    expect(notes.map((x) => x.totalMinor)).toEqual([3_333, 7_001, invoice.totalMinor - 3_333 - 7_001]);
    for (const rate of [0.15, 0.25]) {
      const of = (b: { rate: number; vatMinor: number; netMinor: number; grossMinor: number }[]) => b.filter((x) => x.rate === rate);
      const credited = notes.flatMap((x) => of(x.snapshot.buckets));
      const bucket = of(invoice.snapshot.buckets)[0];
      expect(credited.reduce((s, b) => s + b.vatMinor, 0), `VAT at ${rate}`).toBe(bucket.vatMinor);
      expect(credited.reduce((s, b) => s + b.netMinor, 0), `net at ${rate}`).toBe(bucket.netMinor);
      expect(credited.reduce((s, b) => s + b.grossMinor, 0), `gross at ${rate}`).toBe(bucket.grossMinor);
    }
  });

  it("credits an order cancelled by staff (the whole refund), and an order in euro in euro with the VAT also at the invoice's rate in the seller's currency", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-euro");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { market: fx.noInEuro });
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    expect(await cancelOrder(own.storeId, order.orderId, "Kunden ombestemte seg", own.ownerId)).toMatchObject({ ok: true });
    const notes = await fx.notesOf(own.storeId, order.orderId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ currency: "EUR", totalMinor: invoice.totalMinor, taxMinor: invoice.taxMinor, vatHomeCurrency: "NOK", fxRate: invoice.fxRate });
    expect(notes[0].vatHomeMinor).toBe(invoice.vatHomeMinor);
    expect(notes[0].snapshot.vatHome).toMatchObject({ currency: "NOK", fxRate: 11.5 });
  });

  it("makes none for a refund that failed, or for an order with no invoice (test mode, waiting), and never a second for one refund", async () => {
    const own = await fx.makeStore("rf-none");
    fake.state.status = "failed";
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    const failed = await refundOrder(own.storeId, order.orderId, { amountMinor: 1_000, reason: "x", restock: [] }, own.ownerId);
    expect(failed).toMatchObject({ ok: true, status: "failed" });
    expect(await fx.notesOf(own.storeId, order.orderId)).toEqual([]);
    expect((await getOrderAdmin(own.storeId, order.orderId))!.refundableMinor).toBe(order.total);

    fake.state.status = "succeeded";
    const test = await fx.makeStore("rf-test", { mode: "test" });
    const testOrder = await fx.paidOrder(test, [["DEMO-MUG-WHITE", 1]]);
    expect(await refundOrder(test.storeId, testOrder.orderId, { amountMinor: 1_000, reason: "x", restock: [] }, test.ownerId)).toMatchObject({ ok: true });
    expect(await fx.notesOf(test.storeId, testOrder.orderId)).toEqual([]);
    // The database's own rule: one credit note per refund, however it is asked.
    const ok = await refundOrder(own.storeId, order.orderId, { amountMinor: 1_000, reason: "y", restock: [] }, own.ownerId);
    const refundId = (ok as { refundId: string }).refundId;
    const [again] = await db().execute<Row>(sql`select commerce.issue_credit_note(${own.storeId}::uuid, ${refundId}::uuid, null) as id`);
    const kept = await fx.notesOf(own.storeId, order.orderId);
    expect(kept).toHaveLength(1);
    // Asked again, the function answers with the note that is there.
    expect(String(again.id)).toBe(kept[0].id);
  });

  it("credits only what the invoice has left when a refund is larger (a payment beyond it), says so, and holds back nothing", async () => {
    const own = await fx.makeStore("rf-short");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const [payment] = await db().execute<Row>(sql`select id from commerce.payments where order_id = ${order.orderId}::uuid`);
    await db().execute(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
      values (${own.storeId}::uuid, ${String(payment.id)}::uuid, ${invoice.totalMinor + 7_000}, 'Mer enn fakturaen', 're_short1', 'succeeded')
    `);
    const notes = await fx.notesOf(own.storeId, order.orderId);
    expect(notes).toHaveLength(1);
    expect(notes[0].totalMinor).toBe(invoice.totalMinor);
    expect((await inv.waitingCreditNotes(own.storeId)).map((w) => [w.state, w.amountMinor])).toEqual([["short", 7_000]]);
    expect((await inv.invoiceCheckupFindings(own.storeId)).map((f) => f.code)).toEqual(["credit_note_short"]);
    // Said once, and not tried again by the job.
    expect(await issue.issueMissingCreditNotes(own.storeId)).toBe(0);
  });
});

describe("a refund Stripe left pending completes by its event, and one made in the Dashboard is recorded", () => {
  it("makes the credit note when a pending refund succeeds, once, and tells the shopper in an email of its own", async () => {
    const own = await fx.makeStore("rf-pending");
    fake.state.status = "pending";
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { email: "pending@example.com" });
    const made = await refundOrder(own.storeId, order.orderId, { amountMinor: 4_000, reason: "Bank", restock: [] }, own.ownerId);
    expect(made).toMatchObject({ ok: true, status: "pending" });
    expect(await fx.notesOf(own.storeId, order.orderId)).toEqual([]);
    const rows = await fx.refundRowsOf(own.storeId, order.orderId);
    expect(rows).toMatchObject([{ amount: 4_000, status: "pending" }]);

    const stripeRefund = { ...refundOf(rows[0].reference!), status: "succeeded" };
    const event = eventOf("refund.updated", stripeRefund, own.account);
    await handleStripeEvent(own.storeId, event);
    expect((await fx.refundRowsOf(own.storeId, order.orderId))[0].status).toBe("succeeded");
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note).toMatchObject({ documentNumber: "K-1", totalMinor: 4_000, refundId: rows[0].id });
    const [mail] = await emails(order.orderId, "credit_note.issued");
    expect(mail).toMatchObject({ to_address: "pending@example.com", idempotency_key: `credit-note:${note.id}` });
    expect(String(mail.html)).toContain(`/account/documents/${note.token}`);
    const history = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'refund.status_changed'`);
    expect(history).toHaveLength(1);
    expect(history[0].data).toMatchObject({ from: "pending", to: "succeeded" });

    // The same event again (Stripe retries), and another event with the same news: nothing changes.
    await handleStripeEvent(own.storeId, event);
    await handleStripeEvent(own.storeId, eventOf("charge.refund.updated", stripeRefund, own.account));
    expect(await fx.notesOf(own.storeId, order.orderId)).toHaveLength(1);
    expect(await emails(order.orderId, "credit_note.issued")).toHaveLength(1);
  });

  it("changes a pending refund to failed with no credit note, and gives the amount back to the order", async () => {
    const own = await fx.makeStore("rf-pfail");
    fake.state.status = "pending";
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    await refundOrder(own.storeId, order.orderId, { amountMinor: 4_000, reason: "Bank", restock: [] }, own.ownerId);
    const [row] = await fx.refundRowsOf(own.storeId, order.orderId);
    expect((await getOrderAdmin(own.storeId, order.orderId))!.refundableMinor).toBe(order.total - 4_000);
    await handleStripeEvent(own.storeId, eventOf("refund.updated", { ...refundOf(row.reference!), status: "failed" }, own.account));
    expect((await fx.refundRowsOf(own.storeId, order.orderId))[0].status).toBe("failed");
    expect(await fx.notesOf(own.storeId, order.orderId)).toEqual([]);
    expect((await getOrderAdmin(own.storeId, order.orderId))!.refundableMinor).toBe(order.total);
    // `canceled` is failed too.
    const again = await refundOrder(own.storeId, order.orderId, { amountMinor: 1_000, reason: "Bank", restock: [] }, own.ownerId);
    const reference = (await fx.refundRowsOf(own.storeId, order.orderId)).find((r) => r.id === (again as { refundId: string }).refundId)!.reference!;
    await handleStripeEvent(own.storeId, eventOf("refund.updated", { ...refundOf(reference), status: "canceled" }, own.account));
    expect((await fx.refundRowsOf(own.storeId, order.orderId)).find((r) => r.reference === reference)!.status).toBe("failed");
  });

  it("records a refund made in Stripe's Dashboard (its payment found by payment intent), with its credit note and a notice", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-dash");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { email: "dash@example.com" });
    const refund = { id: "re_dashboard_1", object: "refund", status: "succeeded", amount: 3_000, currency: "nok", created: Math.floor(Date.now() / 1000), payment_intent: `pi_for_${order.sessionId}`, metadata: {} };
    await handleStripeEvent(own.storeId, eventOf("refund.created", refund, own.account));
    const rows = await fx.refundRowsOf(own.storeId, order.orderId);
    expect(rows).toMatchObject([{ amount: 3_000, status: "succeeded", reference: "re_dashboard_1" }]);
    const [stored] = await db().execute<Row>(sql`select created_by, reason from commerce.refunds where provider_reference = 're_dashboard_1'`);
    expect(stored).toMatchObject({ created_by: null, reason: "Refunded in Stripe" });
    const [event] = await db().execute<Row>(sql`select actor, data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'order.refunded'`);
    expect(event).toMatchObject({ actor: "stripe" });
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note).toMatchObject({ totalMinor: 3_000, source: "refund" });
    expect(await emails(order.orderId, "credit_note.issued")).toHaveLength(1);
    // The order page counts it as refunded, so staff cannot refund the same money twice.
    expect((await getOrderAdmin(own.storeId, order.orderId))!.refundableMinor).toBe(order.total - 3_000);
    // Replayed, and updated to the same status: nothing more.
    await handleStripeEvent(own.storeId, eventOf("refund.updated", refund, own.account));
    expect(await fx.refundRowsOf(own.storeId, order.orderId)).toHaveLength(1);
    expect(await fx.notesOf(own.storeId, order.orderId)).toHaveLength(1);
  });

  it("changes nothing for a refund of a payment this store does not have, and never another store's", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-x-a");
    const other = await fx.makeStore("rf-x-b");
    const theirs = await fx.paidOrder(other, [["DEMO-MUG-WHITE", 1]]);
    const refund = { id: "re_foreign_1", object: "refund", status: "succeeded", amount: 1_000, currency: "nok", created: Math.floor(Date.now() / 1000), payment_intent: `pi_for_${theirs.sessionId}`, metadata: {} };
    expect(await refunds.applyStripeRefund(own.storeId, refund as unknown as Stripe.Refund, { stripe: fake.client as unknown as Stripe, account: own.account })).toEqual({ outcome: "unmatched", reason: "no_payment" });
    expect(await refunds.applyStripeRefund(own.storeId, { ...refund, payment_intent: "pi_unknown", id: "re_foreign_2" } as unknown as Stripe.Refund, { stripe: fake.client as unknown as Stripe, account: own.account })).toEqual({ outcome: "unmatched", reason: "no_payment" });
    expect(await fx.refundRowsOf(other.storeId, theirs.orderId)).toEqual([]);
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.refunds where provider_reference in ('re_foreign_1', 're_foreign_2')`);
    expect(count.n).toBe(0);
    // In another currency than the payment's: not recorded either.
    const mine = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    expect(await refunds.applyStripeRefund(own.storeId, { ...refund, id: "re_foreign_3", payment_intent: `pi_for_${mine.sessionId}`, currency: "eur" } as unknown as Stripe.Refund, { stripe: fake.client as unknown as Stripe, account: own.account })).toEqual({ outcome: "unmatched", reason: "other_currency" });
  });

  it("refuses an event for a refund of Kaizen's own whose row is not written yet (Stripe sends it again), and records it after two minutes", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-own");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    const refund = { id: "re_own_first", object: "refund", status: "succeeded", amount: 2_000, currency: "nok", created: Math.floor(Date.now() / 1000), payment_intent: `pi_for_${order.sessionId}`, metadata: { order_id: order.orderId } };
    const event = eventOf("refund.created", refund, own.account);
    await expect(handleStripeEvent(own.storeId, event)).rejects.toBeInstanceOf(refunds.RefundNotRecordedYet);
    expect(await fx.refundRowsOf(own.storeId, order.orderId)).toEqual([]);
    const [kept] = await db().execute<Row>(sql`select processed_at, last_error from commerce.webhook_events where event_id = ${event.id}`);
    expect(kept.processed_at).toBeNull();
    expect(String(kept.last_error)).toMatch(/not recorded yet/);
    // Stripe's retry, minutes later, finds Kaizen never wrote it: it is recorded now.
    const later = await refunds.applyStripeRefund(own.storeId, refund as unknown as Stripe.Refund, { stripe: fake.client as unknown as Stripe, account: own.account, now: () => Date.now() + 3 * 60_000 });
    expect(later).toMatchObject({ outcome: "inserted", status: "succeeded" });
    const [row] = await db().execute<Row>(sql`select reason from commerce.refunds where provider_reference = 're_own_first'`);
    expect(row.reason).toBe("Refund recorded from Stripe");
    expect(await fx.notesOf(own.storeId, order.orderId)).toHaveLength(1);
  });

  it("keeps a refund that succeeded succeeded when Stripe later says failed, says so once, and the checkup shows it", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-rev");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    const made = await refundOrder(own.storeId, order.orderId, { amountMinor: 2_000, reason: "x", restock: [] }, own.ownerId);
    const [row] = await fx.refundRowsOf(own.storeId, order.orderId);
    const failed = { ...refundOf(row.reference!), status: "failed" };
    // Stripe, asked, agrees that it failed (an event alone is not enough: it may be older than the row, see invoice-refunds-stale.security.int.test.ts).
    fake.state.refunds.set(row.reference!, failed);
    await handleStripeEvent(own.storeId, eventOf("refund.updated", failed, own.account));
    await handleStripeEvent(own.storeId, eventOf("refund.updated", failed, own.account));
    expect((await fx.refundRowsOf(own.storeId, order.orderId))[0].status).toBe("succeeded");
    expect(await fx.notesOf(own.storeId, order.orderId)).toHaveLength(1);
    const events = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'refund.reversed_after_success'`);
    expect(events).toHaveLength(1);
    expect(events[0].data).toMatchObject({ refundId: (made as { refundId: string }).refundId, reportedStatus: "failed" });
    expect((await inv.invoiceCheckupFindings(own.storeId)).map((f) => f.code)).toEqual(["refund_reversed_after_success"]);
    // The database's rule, held for any other writer too.
    await expect(db().execute(sql`update commerce.refunds set status = 'failed' where id = ${row.id}::uuid`)).rejects.toThrow();
  });

  it("asks Stripe about a pending refund of its own in the job, so a bank refund completes without the webhook", async () => {
    const own = await fx.makeStore("rf-job");
    fake.state.status = "pending";
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    await refundOrder(own.storeId, order.orderId, { amountMinor: 2_500, reason: "Bank", restock: [] }, own.ownerId);
    const [row] = await fx.refundRowsOf(own.storeId, order.orderId);
    // Too young: not asked yet.
    fake.state.retrieved.length = 0;
    await refunds.reconcilePendingRefunds(50, { stripeFor: () => fake.client as unknown as Stripe });
    expect(fake.state.retrieved).not.toContain(row.reference);
    await db().execute(sql`update commerce.refunds set created_at = now() - interval '30 minutes' where id = ${row.id}::uuid`);
    fake.state.refunds.set(row.reference!, { ...refundOf(row.reference!), status: "succeeded" });
    const result = await refunds.reconcilePendingRefunds(50, { stripeFor: () => fake.client as unknown as Stripe });
    expect(fake.state.retrieved).toContain(row.reference);
    expect(result.updated).toBeGreaterThanOrEqual(1);
    expect((await fx.refundRowsOf(own.storeId, order.orderId))[0].status).toBe("succeeded");
    expect(await fx.notesOf(own.storeId, order.orderId)).toHaveLength(1);
    expect(await emails(order.orderId, "credit_note.issued")).toHaveLength(1);
  });
});

describe("a refund made before the invoice existed", () => {
  it("is credited, in the order the refunds were made, when the job has issued the invoice", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-wait", { sellerDetails: false });
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 3]], { email: "wait@example.com" });
    expect(await fx.invoiceOf(own.storeId, order.orderId)).toBeNull();
    await refundOrder(own.storeId, order.orderId, { amountMinor: 3_000, reason: "a", restock: [] }, own.ownerId);
    await refundOrder(own.storeId, order.orderId, { amountMinor: 2_000, reason: "b", restock: [] }, own.ownerId);
    expect(await fx.notesOf(own.storeId, order.orderId)).toEqual([]);
    await db().execute(sql`update commerce.stores set legal_name = 'Wait AS', organisation_number = '923456789', postal_address = 'Gata 1', country = 'NO' where id = ${own.storeId}::uuid`);
    const result = await issue.invoiceJobs();
    expect(result.invoices).toBeGreaterThanOrEqual(1);
    const notes = await fx.notesOf(own.storeId, order.orderId);
    expect(notes.map((x) => [x.documentNumber, x.totalMinor])).toEqual([["K-1", 3_000], ["K-2", 2_000]]);
    expect(notes[0].issuedOn).toBe(new Date().toISOString().slice(0, 10));
  });
});
