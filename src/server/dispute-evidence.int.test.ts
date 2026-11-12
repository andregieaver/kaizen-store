import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const { disputeEvidence, saveDisputeEvidence, customerReturns } = await import("./dispute-evidence");
const { markSent } = await import("./order-admin");
const { fxStore, paidOrder } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;

/**
 * The chargeback assistant (D417) against a real database: the evidence drafted from an order's own records, kept as a draft, sent to Stripe only with
 * `send` and only once (a refusal gives the claim back and keeps the draft), never for a dispute that no longer asks; the evidence emptied when the order
 * is anonymised; and a customer who returns a lot.
 */

let fx: Fx;

beforeAll(async () => {
  fx = await fxStore("evidence");
}, 120_000);

afterAll(async () => {
  await closeDb();
});

let disputes = 0;
async function disputed(orderId: string, over: { status?: string; reason?: string } = {}): Promise<string> {
  disputes += 1;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.payment_disputes (store_id, order_id, payment_id, provider, provider_reference, amount_minor, currency, reason, status, evidence_due_by, opened_at)
    select p.store_id, p.order_id, p.id, 'stripe', ${`dp_ev_${Date.now()}_${disputes}`}, p.amount_minor, p.currency, ${over.reason ?? "product_not_received"},
      ${over.status ?? "needs_response"}, now() + interval '7 days', now()
    from commerce.payments p where p.order_id = ${orderId}::uuid and p.provider = 'stripe'
    returning id
  `);
  return String(row.id);
}

/** A stand-in for the connected account's Stripe: records what it was sent, or refuses. */
function stripeStub(refuse?: string) {
  const sent: { ref: string; body: Record<string, unknown>; account: string | undefined }[] = [];
  const stripe = {
    disputes: {
      update: async (ref: string, body: Record<string, unknown>, options?: { stripeAccount?: string }) => {
        if (refuse) throw Object.assign(new Error(refuse), { type: "StripeInvalidRequestError" });
        sent.push({ ref, body, account: options?.stripeAccount });
        return { id: ref };
      },
    },
  };
  return { sent, deps: { stripeFor: async () => stripe as never } };
}

describe("the evidence for a dispute (D417)", () => {
  it("is drafted from the order: its goods, its parcel and the store's return terms; nothing about why no refund was due", async () => {
    const order = await paidOrder(fx, [["DEMO-MUG-WHITE", 2]]);
    const sent = await markSent(fx.storeId, order.orderId, { carrier: "Posten", trackingNumber: "EV123", trackingUrl: null }, fx.accountId);
    if (!sent.ok) throw new Error(sent.reason);
    const id = await disputed(order.orderId);
    const view = (await disputeEvidence(fx.storeId, order.orderId, id))!;
    expect(view.dispute.answerable).toBe(true);
    expect(view.savedAt).toBeNull();
    expect(view.fields).toEqual(view.drafted);
    expect(view.fields.customer_email_address).toBe(order.email);
    expect(view.fields.shipping_carrier).toBe("Posten");
    expect(view.fields.shipping_tracking_number).toBe("EV123");
    expect(view.fields.product_description).toMatch(/^2 × /);
    expect(view.fields.refund_refusal_explanation).toBe("");
    expect(view.fields.uncategorized_text).toContain(`Order ${order.number}, placed on`);
    // Another store's dispute, or one on another order, is not found.
    const other = await fxStore("evidence-other");
    expect(await disputeEvidence(other.storeId, order.orderId, id)).toBeNull();
    const second = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]]);
    expect(await disputeEvidence(fx.storeId, second.orderId, id)).toBeNull();
  }, 60_000);

  it("keeps the owner's draft, sends it once with the tick, and records it in the order's history and the audit log", async () => {
    const order = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]]);
    const id = await disputed(order.orderId, { reason: "fraudulent" });
    const view = (await disputeEvidence(fx.storeId, order.orderId, id))!;
    const fields = { ...view.fields, refund_refusal_explanation: "The customer kept the mug and never asked to return it." };
    const stub = stripeStub();

    expect(await saveDisputeEvidence(fx.storeId, fx.accountId, order.orderId, id, fields, { send: false }, stub.deps)).toEqual({ ok: true, sent: false });
    expect(stub.sent).toHaveLength(0);
    const draft = (await disputeEvidence(fx.storeId, order.orderId, id))!;
    expect(draft.fields.refund_refusal_explanation).toBe("The customer kept the mug and never asked to return it.");
    expect(draft.savedAt).not.toBeNull();

    expect(await saveDisputeEvidence(fx.storeId, fx.accountId, order.orderId, id, fields, { send: true }, stub.deps)).toEqual({ ok: true, sent: true });
    expect(stub.sent).toHaveLength(1);
    expect(stub.sent[0].account).toBe(fx.stripeAccount);
    expect(stub.sent[0].body.submit).toBe(true);
    const evidence = stub.sent[0].body.evidence as Record<string, string>;
    expect(evidence.refund_refusal_explanation).toBe("The customer kept the mug and never asked to return it.");
    // Empty fields are not sent.
    expect(Object.values(evidence).every((v) => v.trim() !== "")).toBe(true);

    const after = (await disputeEvidence(fx.storeId, order.orderId, id))!;
    expect(after.submittedAt).not.toBeNull();
    expect(after.dispute.answerable).toBe(false);
    const [event] = await db().execute<Row>(sql`select actor, data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'dispute.evidence_sent'`);
    expect(event.actor).toBe("staff");
    const [audited] = await db().execute<Row>(sql`select account_id, target_id from commerce.audit_log where store_id = ${fx.storeId}::uuid and action = 'order.dispute_evidence_sent' order by id desc limit 1`);
    expect(String(audited.account_id)).toBe(fx.accountId);
    expect(String(audited.target_id)).toBe(order.orderId);

    // A second press, or a change after sending, finds it sent; the database keeps what was sent.
    expect(await saveDisputeEvidence(fx.storeId, fx.accountId, order.orderId, id, fields, { send: true }, stub.deps)).toEqual({ ok: false, reason: "sent_before" });
    expect(stub.sent).toHaveLength(1);
    const changed = await db()
      .execute(sql`update commerce.dispute_evidence set fields = '{"customer_name":"Someone else"}'::jsonb where dispute_id = ${id}::uuid`)
      .then(() => null, (error: Error & { cause?: Error }) => String(error.cause?.message ?? error.message));
    expect(changed).toMatch(/dispute_evidence.sent/);
  }, 60_000);

  it("gives the claim back when Stripe refuses, keeping the draft to send again", async () => {
    const order = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]]);
    const id = await disputed(order.orderId);
    const view = (await disputeEvidence(fx.storeId, order.orderId, id))!;
    const refused = await saveDisputeEvidence(fx.storeId, fx.accountId, order.orderId, id, view.fields, { send: true }, stripeStub("This dispute is already closed.").deps);
    expect(refused).toEqual({ ok: false, reason: "stripe_refused", detail: "This dispute is already closed." });
    const after = (await disputeEvidence(fx.storeId, order.orderId, id))!;
    expect(after.submittedAt).toBeNull();
    expect(after.savedAt).not.toBeNull();
    expect(after.dispute.answerable).toBe(true);
  }, 60_000);

  it("sends nothing for a dispute that no longer asks, or a field longer than Stripe takes", async () => {
    const order = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]]);
    const id = await disputed(order.orderId, { status: "under_review" });
    const view = (await disputeEvidence(fx.storeId, order.orderId, id))!;
    expect(view.dispute.answerable).toBe(false);
    const stub = stripeStub();
    expect(await saveDisputeEvidence(fx.storeId, fx.accountId, order.orderId, id, view.fields, { send: true }, stub.deps)).toEqual({ ok: false, reason: "not_answerable" });
    const long = await saveDisputeEvidence(fx.storeId, fx.accountId, order.orderId, id, { ...view.fields, customer_name: "x".repeat(501) }, { send: false }, stub.deps);
    expect(long).toMatchObject({ ok: false, reason: "invalid", fields: { customer_name: expect.any(String) } });
    expect(stub.sent).toHaveLength(0);
  }, 60_000);

  it("is emptied when its order is anonymised, and none is kept for an anonymised order", async () => {
    const order = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]]);
    const id = await disputed(order.orderId);
    const view = (await disputeEvidence(fx.storeId, order.orderId, id))!;
    await saveDisputeEvidence(fx.storeId, fx.accountId, order.orderId, id, view.fields, { send: false });
    // A sale from long before the bookkeeping period: erasing anonymises it rather than restricting it.
    const long = `${new Date().getUTCFullYear() - 12}-06-15T12:00:00Z`;
    await db().execute(sql`update commerce.orders set placed_at = ${long}::timestamptz, sold_at = ${long}::timestamptz where id = ${order.orderId}::uuid`);
    await db().execute(sql`update commerce.payments set created_at = ${long}::timestamptz, updated_at = ${long}::timestamptz where order_id = ${order.orderId}::uuid`);
    const [done] = await db().execute<Row>(sql`select commerce.anonymise_order(${fx.storeId}::uuid, ${order.orderId}::uuid, 'erasure') as result`);
    expect(done.result).toBe("anonymised");
    const [kept] = await db().execute<Row>(sql`select fields from commerce.dispute_evidence where dispute_id = ${id}::uuid`);
    expect(kept.fields).toEqual({});
    expect(await saveDisputeEvidence(fx.storeId, fx.accountId, order.orderId, id, view.fields, { send: false })).toEqual({ ok: false, reason: "gone" });
    expect((await disputeEvidence(fx.storeId, order.orderId, id))!.dispute.answerable).toBe(false);
  }, 60_000);
});

describe("customers who return a lot (D417)", () => {
  it("counts a customer's year of paid orders and those with a refund", async () => {
    const email = `returner-${Date.now()}@example.com`;
    const orders = [];
    for (let i = 0; i < 4; i++) orders.push(await paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { email }));
    expect(await customerReturns(fx.storeId, { customerId: null, email })).toEqual({ orders: 4, returned: 0, often: false });
    for (const order of orders.slice(0, 3)) {
      await db().execute(sql`
        insert into commerce.refunds (store_id, payment_id, provider_reference, amount_minor, status, reason)
        select store_id, id, ${`re_${order.orderId}`}, 100, 'succeeded', 'requested_by_customer' from commerce.payments where order_id = ${order.orderId}::uuid
      `);
    }
    expect(await customerReturns(fx.storeId, { customerId: null, email: email.toUpperCase() })).toEqual({ orders: 4, returned: 3, often: true });
    expect(await customerReturns(fx.storeId, { customerId: null, email: "" })).toEqual({ orders: 0, returned: 0, often: false });
  }, 120_000);
});
