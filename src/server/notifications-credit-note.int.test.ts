import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fake = vi.hoisted(() => {
  let next = 0;
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    refunds: {
      create: async (params: { amount: number }) => ({ id: `re_ncn_${++next}_${Math.random().toString(36).slice(2, 8)}`, object: "refund", status: "succeeded", amount: params.amount, currency: "nok" }),
    },
  };
  return { client };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { refundOrder, markSent } = await import("./order-admin");
const { sendRefunded } = await import("./shopper-emails");
const { sendPendingDocumentNotices } = await import("./invoice-notices");
const w = await import("./withdrawals");
const r = await import("./returns");

type Row = Record<string, unknown>;

/**
 * Review finding (D238 with D159): a refund's credit note reaches the shopper in the refund email. When the store switched that email off
 * (`order.refunded`, or `return.refunded` for a return), the stand-alone credit note email must still go, once; a notification switch never
 * silences a document. With the switch on and staff choosing not to tell the shopper, nothing is announced, as before.
 */

const emails = (orderId: string, kind: string) => db().execute<Row>(sql`select idempotency_key from commerce.email_messages where order_id = ${orderId}::uuid and kind = ${kind}`);

async function switchOff(storeId: string, notification: string) {
  await db().execute(sql`
    insert into commerce.notification_settings (store_id, notification, enabled) values (${storeId}::uuid, ${notification}, false)
    on conflict (store_id, notification) do update set enabled = false
  `);
}

/** The job announces a credit note only two minutes after it was issued (so the refund's own email goes first): move it back three. */
async function age(noteId: string) {
  await db().transaction(async (tx) => {
    await tx.execute(sql`alter table commerce.credit_notes disable trigger user`);
    await tx.execute(sql`update commerce.credit_notes set issued_at = issued_at - interval '3 minutes' where id = ${noteId}::uuid`);
    await tx.execute(sql`alter table commerce.credit_notes enable trigger user`);
  });
}

afterAll(async () => {
  await closeDb();
});

describe("a credit note when the refund email is switched off", () => {
  it("is emailed on its own, once, for a staff refund with order.refunded off", async () => {
    const own = await fx.makeStore("ncn-order");
    await switchOff(own.storeId, "order.refunded");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { email: "ncn@example.com" });
    const made = await refundOrder(own.storeId, order.orderId, { amountMinor: 3_000, reason: "Skadet", restock: [] }, own.ownerId);
    expect(made).toMatchObject({ ok: true, status: "succeeded" });
    // Staff ticked Notify: the switch wins, so no refund email.
    expect(await sendRefunded(own.storeId, order.orderId, (made as { refundId: string }).refundId, 3_000)).toBeNull();
    expect(await emails(order.orderId, "order.refunded")).toHaveLength(0);
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    await age(note.id);
    await sendPendingDocumentNotices();
    await sendPendingDocumentNotices();
    expect((await emails(order.orderId, "credit_note.issued")).map((m) => m.idempotency_key)).toEqual([`credit-note:${note.id}`]);
  });

  it("is not announced for a staff refund staff chose not to tell the shopper about while the email is on", async () => {
    const own = await fx.makeStore("ncn-on");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    const made = await refundOrder(own.storeId, order.orderId, { amountMinor: 3_000, reason: "Skadet", restock: [] }, own.ownerId);
    expect(made).toMatchObject({ ok: true });
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    await age(note.id);
    await sendPendingDocumentNotices();
    expect(await emails(order.orderId, "credit_note.issued")).toHaveLength(0);
  });

  it("is emailed on its own, once, for a return refunded with return.refunded off", async () => {
    const own = await fx.makeStore("ncn-return");
    await switchOff(own.storeId, "return.refunded");
    const order = await fx.paidOrder(own, [["DEMO-TOTE", 1]], { email: "ncn-ret@example.com" });
    await markSent(own.storeId, order.orderId, { carrier: "other", trackingNumber: `T-${order.orderId.slice(0, 8)}`, trackingUrl: null }, null);
    const started = await w.startWithdrawal(own.storeId, { orderNumber: order.number, email: order.email, name: "Kari Nordmann", lines: order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })) }, { floorMs: 0 });
    if (!started.ok || !started.matched || !started.request) throw new Error(JSON.stringify(started));
    const confirmed = await w.confirmWithdrawal(own.storeId, { requestId: started.request.id });
    if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
    const returnId = confirmed.returns[0].id;
    expect(await r.markInTransit(own.storeId, { returnId }, null)).toMatchObject({ ok: true });
    expect(await r.markReceived(own.storeId, { returnId }, null)).toMatchObject({ ok: true });
    const preview = (await r.previewRefund(own.storeId, returnId))!;
    expect(await r.refundReturn(own.storeId, { returnId, amountMinor: preview.refund.amountMinor }, null)).toMatchObject({ ok: true });
    expect(await emails(order.orderId, "return.refunded")).toHaveLength(0);
    const [note] = await fx.notesOf(own.storeId, order.orderId);
    expect(note).toBeTruthy();
    await age(note.id);
    await sendPendingDocumentNotices();
    await sendPendingDocumentNotices();
    expect((await emails(order.orderId, "credit_note.issued")).map((m) => m.idempotency_key)).toEqual([`credit-note:${note.id}`]);
  });

  it("is not held back by older documents that can never be sent (the job reads past them)", async () => {
    const own = await fx.makeStore("ncn-stuck");
    await switchOff(own.storeId, "order.refunded");
    const note = async (email: string) => {
      const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { email });
      const made = await refundOrder(own.storeId, order.orderId, { amountMinor: 1_000, reason: "Skadet", restock: [] }, own.ownerId);
      expect(made).toMatchObject({ ok: true });
      const [n] = await fx.notesOf(own.storeId, order.orderId);
      await age(n.id);
      return { order, note: n };
    };
    // Two older credit notes whose order has no address left: `send()` gives up before any email is kept, so they stay waiting on every run.
    const stuck = [await note("ncn-stuck-1@example.com"), await note("ncn-stuck-2@example.com")];
    for (const { order } of stuck) await db().execute(sql`update commerce.orders set email = '' where id = ${order.orderId}::uuid`);
    const fresh = await note("ncn-fresh@example.com");
    // Dated before anything else the suite makes (still inside the job's three days), so these three are the first in the job's order whatever
    // other tests leave waiting: two stuck notes, then the fresh one.
    const back = async (id: string, hours: number) =>
      db().transaction(async (tx) => {
        await tx.execute(sql`alter table commerce.credit_notes disable trigger user`);
        await tx.execute(sql`update commerce.credit_notes set issued_at = now() - make_interval(hours => ${hours}) where id = ${id}::uuid`);
        await tx.execute(sql`alter table commerce.credit_notes enable trigger user`);
      });
    await back(stuck[0].note.id, 70);
    await back(stuck[1].note.id, 69);
    await back(fresh.note.id, 68);
    // A page of one: the first page holds only a stuck note, and the run still reaches the fresh one.
    await sendPendingDocumentNotices(1);
    expect((await emails(fresh.order.orderId, "credit_note.issued")).map((m) => m.idempotency_key)).toEqual([`credit-note:${fresh.note.id}`]);
    for (const { order } of stuck) expect(await emails(order.orderId, "credit_note.issued")).toHaveLength(0);
  });
});
