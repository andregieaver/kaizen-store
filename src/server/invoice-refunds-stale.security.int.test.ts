import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const fake = vi.hoisted(() => {
  const refunds = new Map<string, Record<string, unknown>>();
  const byKey = new Map<string, string>();
  const state = { status: "succeeded", retrieveStatus: null as string | null };
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }), list: async ({ payment_intent }: { payment_intent: string }) => ({ data: payment_intent.startsWith("pi_for_") ? [{ id: payment_intent.slice("pi_for_".length) }] : [] }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [] } }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    refunds: {
      // Idempotent by key, as Stripe is: the same key gives back the same refund.
      create: async (p: { amount: number; payment_intent: string; metadata: Record<string, string> }, o?: { idempotencyKey?: string }) => {
        const known = o?.idempotencyKey ? byKey.get(o.idempotencyKey) : undefined;
        if (known) return refunds.get(known);
        const r = { id: `re_stale_${refunds.size + 1}_${Math.random().toString(36).slice(2, 7)}`, object: "refund", status: state.status, amount: p.amount, currency: "nok", created: Math.floor(Date.now() / 1000), payment_intent: p.payment_intent, metadata: p.metadata };
        refunds.set(r.id, r);
        if (o?.idempotencyKey) byKey.set(o.idempotencyKey, r.id);
        return r;
      },
      retrieve: async (id: string) => {
        const r = refunds.get(id)!;
        return state.retrieveStatus ? { ...r, status: state.retrieveStatus } : r;
      },
    },
  };
  return { client, refunds, state };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { refundOrder } = await import("./order-admin");
const { handleStripeEvent } = await import("./stripe-webhooks");
const { applyStripeRefund } = await import("./stripe-refunds");

afterAll(async () => {
  await closeDb();
});

/**
 * Security review (lens: abuse, ordering). Stripe does not promise to deliver events in order, and Kaizen itself makes the first
 * `refund.created` of its own refunds fail on purpose (`RefundNotRecordedYet`) so that Stripe sends it again later. An event that is
 * older than what the row already knows (a `pending` snapshot arriving after the refund `succeeded`) must change nothing: only a
 * refund Stripe itself says is failed or canceled is a reversal.
 */
describe("a stale event for a refund that already succeeded", () => {
  it("is not written down as a reversal (it would show the owner a false 'refund reversed after success' finding)", async () => {
    const own = await fx.makeStore("rf-stale");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    await refundOrder(own.storeId, order.orderId, { amountMinor: 2_000, reason: "x", restock: [] }, own.ownerId);
    const [row] = await fx.refundRowsOf(own.storeId, order.orderId);
    const stale = { ...fake.refunds.get(row.reference!)!, status: "pending" };
    await handleStripeEvent(own.storeId, { id: "evt_stale_1", type: "refund.created", account: own.account, data: { object: stale } } as unknown as Stripe.Event);
    const events = await db().execute<Record<string, unknown>>(sql`select data from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'refund.reversed_after_success'`);
    expect(events).toHaveLength(0);
  });
});

const reversals = (orderId: string) =>
  db().execute<Record<string, unknown>>(sql`select data from commerce.order_events where order_id = ${orderId}::uuid and type = 'refund.reversed_after_success'`);
const statusOf = async (reference: string) => String((await db().execute<Record<string, unknown>>(sql`select status from commerce.refunds where provider_reference = ${reference}`))[0].status);
let n = 0;
const event = (type: string, refund: unknown, account: string) => ({ id: `evt_ord_${++n}_${Math.random().toString(36).slice(2, 7)}`, type, account, data: { object: refund } }) as unknown as Stripe.Event;

describe("events out of order", () => {
  it("a late pending event never moves a failed refund back to pending", async () => {
    fake.state.status = "failed";
    const own = await fx.makeStore("rf-late");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    await refundOrder(own.storeId, order.orderId, { amountMinor: 1_000, reason: "x", restock: [] }, own.ownerId);
    fake.state.status = "succeeded";
    const [row] = await fx.refundRowsOf(own.storeId, order.orderId);
    expect(row.status).toBe("failed");
    await handleStripeEvent(own.storeId, event("refund.updated", { ...fake.refunds.get(row.reference!)!, status: "pending" }, own.account));
    expect(await statusOf(row.reference!)).toBe("failed");
  });

  it("a refund that Stripe itself still reports failed after it succeeded is a reversal, said once; if Stripe says it succeeded, it is not", async () => {
    const own = await fx.makeStore("rf-rev");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]]);
    await refundOrder(own.storeId, order.orderId, { amountMinor: 1_000, reason: "x", restock: [] }, own.ownerId);
    const [row] = await fx.refundRowsOf(own.storeId, order.orderId);
    const failedEvent = { ...fake.refunds.get(row.reference!)!, status: "failed" };
    // An old failed snapshot while Stripe now says succeeded: not a reversal.
    fake.state.retrieveStatus = "succeeded";
    await handleStripeEvent(own.storeId, event("refund.updated", failedEvent, own.account));
    expect(await reversals(order.orderId)).toHaveLength(0);
    // Stripe still says failed: a reversal, once, and the status in the database does not change.
    fake.state.retrieveStatus = "failed";
    await handleStripeEvent(own.storeId, event("refund.updated", failedEvent, own.account));
    await handleStripeEvent(own.storeId, event("refund.failed", failedEvent, own.account));
    fake.state.retrieveStatus = null;
    expect(await reversals(order.orderId)).toHaveLength(1);
    expect(await statusOf(row.reference!)).toBe("succeeded");
  });
});

describe("a staff retry after a refund Stripe accepted but whose row was not written", () => {
  it("replays the same Stripe refund and claims the row the webhook wrote, instead of refunding a second time", async () => {
    fake.state.status = "succeeded";
    const own = await fx.makeStore("rf-retry");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 4]]);
    const before = fake.refunds.size;
    // The first try: Stripe accepts, then the database write fails (the caller's own step throws inside the transaction).
    await expect(
      refundOrder(own.storeId, order.orderId, { amountMinor: 3_000, reason: "Damaged", restock: [] }, own.ownerId, {
        inTransaction: async () => {
          throw new Error("connection lost");
        },
      }),
    ).rejects.toThrow("connection lost");
    expect(fake.refunds.size).toBe(before + 1);
    expect(await fx.refundRowsOf(own.storeId, order.orderId)).toHaveLength(0);
    const stripeRefund = [...fake.refunds.values()].at(-1)!;
    // The webhook writes the row after its grace period.
    const applied = await applyStripeRefund(own.storeId, stripeRefund as unknown as Stripe.Refund, { account: own.account, stripe: fake.client as unknown as Stripe, now: () => Date.now() + 10 * 60_000 });
    expect(applied.outcome).toBe("inserted");
    expect(await fx.refundRowsOf(own.storeId, order.orderId)).toHaveLength(1);
    // The retry: the same key (the row the webhook wrote is not counted), so Stripe gives back the same refund and no second one is made.
    const retry = await refundOrder(own.storeId, order.orderId, { amountMinor: 3_000, reason: "Damaged", restock: [] }, own.ownerId);
    expect(retry).toMatchObject({ ok: true, amountMinor: 3_000 });
    expect(fake.refunds.size).toBe(before + 1);
    const rows = await fx.refundRowsOf(own.storeId, order.orderId);
    expect(rows).toHaveLength(1);
    const [claimed] = await db().execute<Record<string, unknown>>(sql`select reason, created_by from commerce.refunds where provider_reference = ${rows[0].reference}`);
    expect(claimed.reason).toBe("Damaged");
    expect(claimed.created_by).toBe(own.ownerId);
    // The credit note is still one for the one refund.
    expect(await fx.notesOf(own.storeId, order.orderId)).toHaveLength(1);
    // A deliberate second refund of the same amount is a new refund with a new key.
    const again = await refundOrder(own.storeId, order.orderId, { amountMinor: 3_000, reason: "More", restock: [] }, own.ownerId);
    expect(again.ok).toBe(true);
    expect(fake.refunds.size).toBe(before + 2);
  });
});
