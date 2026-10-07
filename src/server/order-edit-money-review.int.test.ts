import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

/**
 * Adversarial money review of wave 3 run 3 (D174). Kaizen's platform Stripe faked: refunds are recorded with the PaymentIntent they name, so a test can check
 * that a refund never asks Stripe for more than the charge it names (Stripe refuses that: "Refund amount is greater than charge amount").
 */
const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const sessions = new Map<string, Record<string, unknown>>();
  let next = 0;
  const client = {
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        refunds.push({ params, options });
        return { id: `re_money_${refunds.length}`, status: "succeeded" };
      },
    },
    coupons: { create: async () => ({ id: "co_x" }) },
    checkout: {
      sessions: {
        create: async () => {
          const id = `cs_money_${++next}_${Math.random().toString(36).slice(2, 8)}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", payment_intent: `pi_${id}` });
          return { id, url: `https://checkout.stripe.test/${id}`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null, ...(sessions.get(id) ?? { status: "complete", payment_status: "paid" }) }),
        expire: async (id: string) => {
          sessions.set(id, { ...(sessions.get(id) ?? {}), status: "expired" });
          return { id };
        },
      },
    },
  };
  return { client, refunds, sessions };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const edits = await import("./order-edits");
const pay = await import("./order-edit-pay");
const { applySession } = await import("./stripe-webhooks");
const { cancelOrder } = await import("./order-admin");
const { getStore } = await import("./stores");
const { staffActor } = await import("./order-actor");
const { fxStore, paidOrder, variantOf, NO } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;
const origin = "https://kaizen.test";

let store: Awaited<ReturnType<typeof fxStore>>;
beforeAll(async () => {
  store = await fxStore("money-rev");
});
afterAll(async () => {
  await closeDb();
});

/** A change with a higher total, paid by the customer through the link (the webhook applies it). Returns the change's payment row. */
async function payChange(orderId: string, sku: string): Promise<{ editId: string; reference: string; amount: number }> {
  const actor = staffActor(store.accountId);
  const sent = await edits.sendOrderEdit(store.storeId, orderId, { added: [{ variantId: await variantOf(store, sku), quantity: 1 }], reason: "customer_request" }, actor, { email: false });
  if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
  const started = await pay.startEditPayment({ store: (await getStore(store.slug))!, market: NO }, sent.link.split("/").at(-1)!, { origin });
  if (!started.ok) throw new Error(JSON.stringify(started));
  const [payment] = await db().execute<Row>(sql`select provider_reference, amount_minor from commerce.payments where order_edit_id = ${sent.editId}::uuid`);
  return { editId: sent.editId, reference: String(payment.provider_reference), amount: Number(payment.amount_minor) };
}

describe("an order that carries a paid change has two Stripe payments", () => {
  it("cancelling it never asks Stripe to refund more than the charge it names", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const change = await payChange(order.orderId, "DEMO-LAMP");
    fake.sessions.set(change.reference, { status: "complete", payment_status: "paid", payment_intent: `pi_${change.reference}` });
    await applySession(store.storeId, { id: change.reference, status: "complete", payment_status: "paid" } as never, "checkout.session.completed");
    const [edit] = await db().execute<Row>(sql`select status from commerce.order_edits where id = ${change.editId}::uuid`);
    expect(edit.status).toBe("applied");

    // What each PaymentIntent took: the order's own (its session `cs_{order}`) and the change's.
    const charged = new Map<string, number>([
      [`pi_for_cs_${order.orderId}`, order.totalMinor],
      [`pi_${change.reference}`, change.amount],
    ]);
    const before = fake.refunds.length;
    const cancelled = await cancelOrder(store.storeId, order.orderId, "Customer cancelled", store.accountId);
    expect(cancelled).toMatchObject({ ok: true });
    const asked = fake.refunds.slice(before).map((r) => ({ intent: String(r.params.payment_intent), amount: Number(r.params.amount) }));
    // Everything paid is refunded...
    expect(asked.reduce((s, r) => s + r.amount, 0)).toBe(order.totalMinor + change.amount);
    // ...and no single Stripe refund is above the charge it names (Stripe would refuse it, and the cancel with it).
    for (const r of asked) expect(r.amount).toBeLessThanOrEqual(charged.get(r.intent) ?? 0);
  });
});

describe("a change recorded as paid in cash outside Kaizen", () => {
  it("is held to the country's cash ceiling as a draft paid in cash is (D173, src/lib/cash-limits.ts: Norway refuses 40,000 NOK or more)", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const raw = { added: [{ variantId: await variantOf(store, "DEMO-LAMP"), quantity: 1, unitPriceMinor: 4_500_000 }], reason: "customer_request" };
    const done = await edits.recordEditPaidOutside(store.storeId, { orderId: order.orderId, raw }, { method: "cash" }, staffActor(store.accountId));
    // 45,000 NOK in cash for one transaction: the draft path refuses this (`cash_limit`); the change path must not record it either.
    expect(done.ok).toBe(false);
    const [cash] = await db().execute<Row>(sql`select count(*)::int as n from commerce.payments where order_id = ${order.orderId}::uuid and provider = 'manual' and method = 'cash'`);
    expect(Number(cash.n)).toBe(0);
  });
});

describe("a payment for a change that could not be applied, given back in full", () => {
  it("leaves the customer's bonus credits as they were (the order did not change)", async () => {
    const bonus = await fxStore("money-bonus");
    await db().execute(sql`
      insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, currency)
      values (${bonus.storeId}::uuid, true, 1000, 0, 50, 'NOK') on conflict (store_id) do update set enabled = true, earn_bps = 1000, pending_days = 0
    `);
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name) values (${bonus.storeId}::uuid, ${`bonus-${bonus.slug}@example.com`}, 'B') returning id`);
    const order = await paidOrder(bonus, [["DEMO-TOTE", 2]], {
      beforePaid: async (orderId) => {
        await db().execute(sql`update commerce.orders set customer_id = ${String(customer.id)}::uuid where id = ${orderId}::uuid`);
      },
    });
    const [earned] = await db().execute<Row>(sql`select amount_minor from commerce.bonus_entries where idempotency_key = ${`earn:${order.orderId}`}`);
    expect(Number(earned?.amount_minor ?? 0)).toBeGreaterThan(0);

    const actor = staffActor(bonus.accountId);
    const sent = await edits.sendOrderEdit(bonus.storeId, order.orderId, { added: [{ variantId: await variantOf(bonus, "DEMO-LAMP"), quantity: 1 }], reason: "customer_request" }, actor, {
      email: false,
    });
    if (!sent.ok) throw new Error(JSON.stringify(sent.problems));
    const started = await pay.startEditPayment({ store: (await getStore(bonus.slug))!, market: NO }, sent.link.split("/").at(-1)!, { origin });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const [payment] = await db().execute<Row>(sql`select provider_reference from commerce.payments where order_edit_id = ${sent.editId}::uuid`);
    const reference = String(payment.provider_reference);
    // Cancelled while Stripe was still processing (forced, as the closing store does); then the money arrives and is given back in full (2.7).
    fake.sessions.set(reference, { status: "complete", payment_status: "unpaid" });
    await edits.endOrderEdit(bonus.storeId, sent.editId, "cancelled", actor, { force: true });
    fake.sessions.set(reference, { status: "complete", payment_status: "paid" });
    await applySession(bonus.storeId, { id: reference, status: "complete", payment_status: "paid" } as never, "checkout.session.completed");
    const [late] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'order.edit_payment_refunded'`);
    expect(Number(late.n)).toBe(1);

    // The order is as it was paid: none of the credits it earned is taken back, none is given back.
    const moved = await db().execute<Row>(sql`select kind, amount_minor from commerce.bonus_entries where order_id = ${order.orderId}::uuid and kind in ('reverse', 'restore')`);
    expect(moved).toEqual([]);
  });
});
