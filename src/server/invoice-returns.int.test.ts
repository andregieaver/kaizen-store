import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }) },
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        refunds.push({ params, options });
        return { id: `re_ret_${refunds.length}_${Math.random().toString(36).slice(2, 8)}`, status: "succeeded" };
      },
    },
  };
  return { client, refunds };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "butikk@example.com";
let sent = 0;
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: `em_inv_ret_${++sent}` }), { status: 200, headers: { "content-type": "application/json" } }));

const fx = await import("./invoice-test-fixture");
const inv = await import("./invoices");
const { markSent } = await import("./order-admin");
const w = await import("./withdrawals");
const r = await import("./returns");

type Row = Record<string, unknown>;

/**
 * Credit notes for withdrawals and returns (D153 and D159, docs 2.5, 4.6): the refund of a return is one credit note whose rows are its working
 * (each returned line, the deductions, the delivery given back, the return shipping the shopper pays, and what staff raised), whose sum is the
 * refund to the minor unit, whether it went through Stripe or was made outside Kaizen. The working is written once with the refund.
 */

const opts = { floorMs: 0 };
const statement = (order: Awaited<ReturnType<typeof fx.paidOrder>>, lines: { lineId: string; quantity: number }[]) => ({ orderNumber: order.number, email: order.email, name: "Kari Nordmann", lines });

async function sentOrder(store: Awaited<ReturnType<typeof fx.makeStore>>, items: [string, number][], o: Parameters<typeof fx.paidOrder>[2] = {}) {
  const order = await fx.paidOrder(store, items, o);
  await markSent(store.storeId, order.orderId, { carrier: "other", trackingNumber: `T-${order.orderId.slice(0, 8)}`, trackingUrl: null }, null);
  return order;
}

async function withdraw(store: Awaited<ReturnType<typeof fx.makeStore>>, order: Awaited<ReturnType<typeof fx.paidOrder>>, lines: { lineId: string; quantity: number }[]) {
  const started = await w.startWithdrawal(store.storeId, statement(order, lines), opts);
  if (!started.ok || !started.matched || !started.request) throw new Error(`step 1 failed: ${JSON.stringify(started)}`);
  const confirmed = await w.confirmWithdrawal(store.storeId, { requestId: started.request.id });
  if (!confirmed.ok) throw new Error(`step 2 failed: ${JSON.stringify(confirmed)}`);
  const returnId = confirmed.returns[0].id;
  expect(await r.markInTransit(store.storeId, { returnId }, null)).toMatchObject({ ok: true });
  expect(await r.markReceived(store.storeId, { returnId }, null)).toMatchObject({ ok: true });
  return returnId;
}

const returnRow = async (returnId: string) => (await db().execute<Row>(sql`select refund_minor, refund_working, refund_id, refund_outside, number from commerce.returns where id = ${returnId}::uuid`))[0];
const sumOf = (rows: { grossMinor: number }[]) => rows.reduce((s, row) => s + row.grossMinor, 0);

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

describe("a return refunded through Stripe", () => {
  it("is one credit note with the working: goods, the deduction, the delivery given back and the return shipping the shopper pays", async () => {
    const own = await fx.makeStore("rt-a");
    const order = await sentOrder(own, [["DEMO-TOTE", 2]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const returnId = await withdraw(own, order, order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })));
    expect(await r.inspectReturn(own.storeId, { returnId, lines: [{ lineId: order.lines[0].id, condition: "opened", restock: true, deductionMinor: 1_000, deductionNote: "Used" }] }, null)).toMatchObject({ ok: true });
    const preview = (await r.previewRefund(own.storeId, returnId, 5_000))!;
    expect(preview.refund).toMatchObject({ deductionsMinor: 1_000, wholeOrder: true, returnShippingMinor: 5_000 });
    const done = await r.refundReturn(own.storeId, { returnId, amountMinor: preview.refund.amountMinor, returnShippingMinor: 5_000 }, null);
    expect(done).toMatchObject({ ok: true, amountMinor: preview.refund.amountMinor, adjusted: false });

    // The working is kept with the refund, and cannot be changed after.
    const ret = await returnRow(returnId);
    expect(ret.refund_working).toMatchObject({
      lines: [{ lineId: order.lines[0].id, quantity: 2, valueMinor: order.lines[0].total, deductionMinor: 1_000 }],
      deliveryMinor: order.shipping,
      returnShippingMinor: 5_000,
      adjustmentMinor: 0,
      amountMinor: preview.refund.amountMinor,
      outside: false,
    });
    await expect(db().execute(sql`update commerce.returns set refund_working = '{}'::jsonb where id = ${returnId}::uuid`)).rejects.toThrow();

    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note).toMatchObject({ documentNumber: "K-1", totalMinor: preview.refund.amountMinor, source: "refund", returnId: null, refundId: ret.refund_id });
    expect(Number(ret.refund_minor)).toBe(note.totalMinor);
    // Its rows are the working, and add up to the refund.
    const rows = note.snapshot.lines as { kind: string; grossMinor: number; quantity: number | null }[];
    expect(rows.map((x) => x.kind)).toEqual(["goods", "deduction", "delivery", "return_shipping"]);
    expect(rows.map((x) => x.grossMinor)).toEqual([order.lines[0].total, -1_000, order.shipping, -5_000]);
    expect(sumOf(rows)).toBe(note.totalMinor);
    expect(note.snapshot.reason).toEqual({ kind: "return", returnNumber: String(ret.number) });
    expect(note.snapshot.refersTo).toMatchObject({ invoiceId: invoice.id, invoiceNumber: invoice.documentNumber });
    expect(note.netMinor + note.taxMinor).toBe(note.totalMinor);
    // The refund email of the return links the credit note, and says nothing more than it did.
    const [mail] = await db().execute<Row>(sql`select html, idempotency_key from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.refunded'`);
    expect(String(mail.html)).toContain(`/account/documents/${note.token}`);
    const [carried] = await db().execute<Row>(sql`select count(*)::int as n from commerce.document_deliveries where document_id = ${note.id}::uuid`);
    expect(carried.n).toBe(1);
  });

  it("is credited in full when the shopper sends everything back, so the invoice has nothing left", async () => {
    const own = await fx.makeStore("rt-full");
    const order = await sentOrder(own, [["DEMO-TOTE", 1], ["DEMO-MUG-WHITE", 2]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const returnId = await withdraw(own, order, order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })));
    const preview = (await r.previewRefund(own.storeId, returnId))!;
    expect(preview.refund.amountMinor).toBe(order.total);
    expect(await r.refundReturn(own.storeId, { returnId, amountMinor: preview.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const notes = await fx.notesOf(own.storeId, order.orderId);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ totalMinor: invoice.totalMinor, taxMinor: invoice.taxMinor, netMinor: invoice.netMinor });
    expect(notes[0].snapshot.position.leftOnInvoiceMinor).toBe(0);
    // Each returned line at its own rate: the rows name the lines.
    const rows = notes[0].snapshot.lines as { kind: string; sku: string | null; quantity: number | null }[];
    expect(rows.filter((x) => x.kind === "goods").map((x) => [x.sku, x.quantity]).sort()).toEqual([["DEMO-MUG-WHITE", 2], ["DEMO-TOTE", 1]]);
  });

  it("shows what staff raised as an adjustment row, so the rows still add up to the refund", async () => {
    const own = await fx.makeStore("rt-adj");
    const order = await sentOrder(own, [["DEMO-TOTE", 2]]);
    const returnId = await withdraw(own, order, [{ lineId: order.lines[0].id, quantity: 1 }]);
    const preview = (await r.previewRefund(own.storeId, returnId))!;
    const done = await r.refundReturn(own.storeId, { returnId, amountMinor: preview.refund.amountMinor + 100, reason: "Goodwill for the wait" }, null);
    expect(done).toMatchObject({ ok: true, adjusted: true });
    const ret = await returnRow(returnId);
    expect(ret.refund_working).toMatchObject({ adjustmentMinor: 100, amountMinor: preview.refund.amountMinor + 100 });
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note.totalMinor).toBe(preview.refund.amountMinor + 100);
    const rows = note.snapshot.lines as { kind: string; grossMinor: number }[];
    expect(rows.map((x) => x.kind)).toEqual(["goods", "adjustment"]);
    expect(rows[1].grossMinor).toBe(100);
    expect(sumOf(rows)).toBe(note.totalMinor);
    // The reason is in the order's history and the audit trail, never on the document the shopper gets.
    expect(JSON.stringify(note.snapshot)).not.toContain("Goodwill");
  });

  it("is two notes for two returns of one order, which together are the invoice and no more", async () => {
    const own = await fx.makeStore("rt-two");
    const order = await sentOrder(own, [["DEMO-TOTE", 2]]);
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const first = await withdraw(own, order, [{ lineId: order.lines[0].id, quantity: 1 }]);
    expect(await r.refundReturn(own.storeId, { returnId: first, amountMinor: (await r.previewRefund(own.storeId, first))!.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const second = await withdraw(own, order, [{ lineId: order.lines[0].id, quantity: 1 }]);
    const rest = (await r.previewRefund(own.storeId, second))!;
    expect(rest.refund.wholeOrder).toBe(true);
    expect(await r.refundReturn(own.storeId, { returnId: second, amountMinor: rest.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const notes = await fx.notesOf(own.storeId, order.orderId);
    expect(notes.map((x) => x.documentNumber)).toEqual(["K-1", "K-2"]);
    expect(sumOf(notes.map((x) => ({ grossMinor: x.totalMinor })))).toBe(invoice.totalMinor);
    expect(sumOf(notes.map((x) => ({ grossMinor: x.taxMinor })))).toBe(invoice.taxMinor);
    expect(notes[1].snapshot.position).toMatchObject({ creditedBeforeMinor: notes[0].totalMinor, leftOnInvoiceMinor: 0 });
    // The second note's rows carry the delivery: the order is whole again.
    expect((notes[1].snapshot.lines as { kind: string }[]).map((x) => x.kind)).toContain("delivery");
  });

  it("is in euro for an order in euro, with the VAT in the seller's currency at the invoice's own rate", async () => {
    const own = await fx.makeStore("rt-euro");
    const order = await sentOrder(own, [["DEMO-TOTE", 2]], { market: fx.noInEuro });
    const invoice = (await fx.invoiceOf(own.storeId, order.orderId))!;
    const returnId = await withdraw(own, order, order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })));
    const preview = (await r.previewRefund(own.storeId, returnId))!;
    expect(await r.refundReturn(own.storeId, { returnId, amountMinor: preview.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note).toMatchObject({ currency: "EUR", totalMinor: invoice.totalMinor, vatHomeCurrency: "NOK", fxRate: invoice.fxRate, vatHomeMinor: invoice.vatHomeMinor });
  });
});

describe("a return refunded outside Kaizen", () => {
  it("is a credit note from the return, once, with the same working, and is linked in the return's refund email", async () => {
    const own = await fx.makeStore("rt-out");
    // Paid at the venue: nothing was taken through Stripe, so the refund is made outside.
    const order = await sentOrder(own, [["DEMO-TOTE", 1]], { provider: "venue" });
    const invoice = await fx.invoiceOf(own.storeId, order.orderId);
    expect(invoice).not.toBeNull();
    const returnId = await withdraw(own, order, order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })));
    const preview = (await r.previewRefund(own.storeId, returnId))!;
    expect(preview.canRefund).toBe(false);
    const stripeBefore = fake.refunds.length;
    const done = await r.refundReturn(own.storeId, { returnId, amountMinor: preview.refund.amountMinor }, null);
    expect(done).toMatchObject({ ok: true, outside: true, refundId: null });
    expect(fake.refunds.length).toBe(stripeBefore);
    const ret = await returnRow(returnId);
    expect(ret).toMatchObject({ refund_outside: true, refund_id: null });
    expect(ret.refund_working).toMatchObject({ outside: true, amountMinor: preview.refund.amountMinor });

    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note).toMatchObject({ source: "return_outside", returnId, refundId: null, totalMinor: preview.refund.amountMinor });
    expect(Number(ret.refund_minor)).toBe(note.totalMinor);
    // One per return, however the job or a person asks.
    const [again] = await db().execute<Row>(sql`select commerce.issue_credit_note(${own.storeId}::uuid, null, ${returnId}::uuid) as id`);
    expect(String(again.id)).toBe(note.id);
    expect(await fx.notesOf(own.storeId, order.orderId)).toHaveLength(1);
    expect(await inv.waitingCreditNotes(own.storeId)).toEqual([]);
    const [mail] = await db().execute<Row>(sql`select html from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.refunded'`);
    expect(String(mail.html)).toContain(`/account/documents/${note.token}`);
    expect((await inv.getOrderDocuments(own.storeId, order.orderId)).creditNotes.map((c) => c.documentNumber)).toEqual(["K-1"]);
  });

  it("is made when the invoice exists even if the return was refunded before it did", async () => {
    const own = await fx.makeStore("rt-out-wait", { sellerDetails: false });
    const order = await sentOrder(own, [["DEMO-TOTE", 1]], { provider: "venue" });
    expect(await fx.invoiceOf(own.storeId, order.orderId)).toBeNull();
    const returnId = await withdraw(own, order, order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })));
    const preview = (await r.previewRefund(own.storeId, returnId))!;
    expect(await r.refundReturn(own.storeId, { returnId, amountMinor: preview.refund.amountMinor }, null)).toMatchObject({ ok: true, outside: true });
    expect(await fx.notesOf(own.storeId, order.orderId)).toEqual([]);
    await db().execute(sql`update commerce.stores set legal_name = 'Wait AS', organisation_number = '923456789', postal_address = 'Gata 1', country = 'NO' where id = ${own.storeId}::uuid`);
    const issue = await import("./invoice-issue");
    expect(await issue.issueWaitingInvoices(own.storeId)).toBe(1);
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note).toMatchObject({ source: "return_outside", returnId, totalMinor: preview.refund.amountMinor });
  });
});
