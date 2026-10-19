import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** Kaizena Flow's platform Stripe client, faked: a session's PaymentIntent held for capture, captured or let go. */
const fake = vi.hoisted(() => {
  type Intent = { id: string; status: string; amount: number; amount_received: number; latest_charge: unknown };
  const state = {
    intents: new Map<string, Intent>(),
    captures: [] as { id: string; params: Record<string, unknown> }[],
    cancels: [] as string[],
    failCapture: false,
  };
  const intentFor = (session: string) => {
    const id = `pi_for_${session}`;
    let pi = state.intents.get(id);
    if (!pi) {
      pi = { id, status: "requires_capture", amount: 0, amount_received: 0, latest_charge: { id: `ch_${session}`, payment_method_details: { type: "card", card: { brand: "visa", capture_before: Math.floor(Date.now() / 1000) + 6 * 86_400 } }, outcome: { risk_level: "normal" } } };
      state.intents.set(id, pi);
    }
    return pi;
  };
  const client = {
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, payment_intent: intentFor(id), invoice: null }),
        list: async ({ payment_intent }: { payment_intent: string }) => ({ data: payment_intent.startsWith("pi_for_") ? [{ id: payment_intent.slice("pi_for_".length) }] : [] }),
      },
    },
    paymentIntents: {
      retrieve: async (id: string) => state.intents.get(id) ?? null,
      capture: async (id: string, params: Record<string, unknown>) => {
        if (state.failCapture) throw new Error("card declined");
        const pi = state.intents.get(id)!;
        state.captures.push({ id, params });
        pi.status = "succeeded";
        pi.amount_received = Number(params.amount_to_capture ?? pi.amount);
        return pi;
      },
      cancel: async (id: string) => {
        state.cancels.push(id);
        const pi = state.intents.get(id)!;
        pi.status = "canceled";
        return pi;
      },
    },
    charges: { retrieve: async () => null },
    invoicePayments: { list: async () => ({ data: [] }) },
  };
  return { client, state, intentFor };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const capture = await import("./payment-capture");
const { applySession, handleStripeEvent } = await import("./stripe-webhooks");
const { markSent } = await import("./order-admin");
const { periodTotals } = await import("./analytics-totals");
const { getStore } = await import("./stores");
const { customPeriod, todayIn } = await import("@/lib/analytics-period");

type Row = Record<string, unknown>;

/**
 * Authorise now, capture later (wave 4 unit B, D289, `docs/wave-4-payments.md` 4), through the real server code with a faked Stripe: a checkout under a
 * later capture, the completed session making the order authorized (stock held, the confirmation sent, nothing a sale), a capture of the whole and of
 * less (the rest released with its credit note), the first parcel capturing under *when sent*, a void, Stripe letting a hold go, the job's warning and
 * expiry, and an order in euro.
 */

afterAll(async () => {
  await closeDb();
});

async function storeCapturing(label: string, capture: "when_sent" | "by_hand") {
  const own = await fx.makeStore(label);
  await db().execute(sql`insert into commerce.order_settings (store_id, capture) values (${own.storeId}::uuid, ${capture})`);
  return own;
}

/** An order checked out under the store's later capture, its session completed with the card held. */
async function heldOrder(own: Awaited<ReturnType<typeof storeCapturing>>, options: Parameters<typeof fx.paidOrder>[2] = {}) {
  const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { ...options, pay: false });
  const mode = await capture.prepareCapture(own.storeId, { orderId: order.orderId, subscription: null, balanceMinor: 0, hostId: null, ships: true, lines: [{ deposit: false } as never] });
  const pi = fake.intentFor(order.sessionId);
  pi.amount = order.total;
  await applySession(own.storeId, { id: order.sessionId, status: "complete", payment_status: "unpaid", mode: "payment", payment_intent: pi.id, customer_details: null } as unknown as Stripe.Checkout.Session, "checkout.session.completed");
  return { order, mode, pi };
}

const orderRow = async (orderId: string) =>
  (await db().execute<Row>(sql`select status, capture_mode, capture_before is not null as has_deadline from commerce.orders where id = ${orderId}::uuid`))[0];
const paymentStatus = async (orderId: string) => (await db().execute<Row>(sql`select status from commerce.payments where order_id = ${orderId}::uuid`))[0]?.status;
const heldStock = async (orderId: string) =>
  Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_reservations where order_id = ${orderId}::uuid and released_at is null and expires_at > now() + interval '5 days'`))[0].n);

describe("a checkout that holds the card", () => {
  it("makes the order authorized: its stock held to Stripe's deadline, the shopper's confirmation sent, nothing invoiced or counted as a sale", async () => {
    const own = await storeCapturing("cap-hold", "by_hand");
    const store = (await getStore(own.slug))!;
    const today = todayIn(new Date(), store.timeZone);
    const before = (await periodTotals(store, customPeriod(today, today))).totals.orders;
    const { order, mode } = await heldOrder(own);
    expect(mode).toBe("by_hand");
    expect(await orderRow(order.orderId)).toMatchObject({ status: "authorized", capture_mode: "by_hand", has_deadline: true });
    expect(await paymentStatus(order.orderId)).toBe("authorized");
    expect(await heldStock(order.orderId)).toBeGreaterThan(0);
    const [mail] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'order.confirmation'`);
    expect(mail.n).toBe(1);
    const [inv] = await db().execute<Row>(sql`select count(*)::int as n from commerce.invoices where order_id = ${order.orderId}::uuid`);
    expect(inv.n).toBe(0);
    expect((await periodTotals(store, customPeriod(today, today))).totals.orders).toBe(before);
  });

  it("is not held at all while the store captures at checkout", async () => {
    const own = await fx.makeStore("cap-off");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { pay: false });
    expect(await capture.prepareCapture(own.storeId, { orderId: order.orderId, subscription: null, balanceMinor: 0, hostId: null, ships: true, lines: [] })).toBeNull();
    expect((await orderRow(order.orderId)).capture_mode).toBeNull();
  });
});

describe("capturing", () => {
  it("captures the whole: the order is paid, invoiced and a sale, and a second press finds nothing held", async () => {
    const own = await storeCapturing("cap-whole", "by_hand");
    const { order, pi } = await heldOrder(own);
    expect(await capture.capturePayment(own.storeId, order.orderId, { accountId: own.ownerId })).toEqual({ ok: true, capturedMinor: order.total, releasedMinor: 0 });
    expect(fake.state.captures.find((c) => c.id === pi.id)?.params).toEqual({});
    expect((await orderRow(order.orderId)).status).toBe("paid");
    expect(await paymentStatus(order.orderId)).toBe("captured");
    const [inv] = await db().execute<Row>(sql`select count(*)::int as n from commerce.invoices where order_id = ${order.orderId}::uuid`);
    expect(inv.n).toBe(1);
    expect(await capture.capturePayment(own.storeId, order.orderId, { accountId: own.ownerId })).toEqual({ ok: false, problem: "not_authorized" });
  });

  it("captures less: Stripe is asked for that amount with its share of the fee, the rest is released and credited", async () => {
    const own = await storeCapturing("cap-less", "by_hand");
    const { order, pi } = await heldOrder(own);
    const less = order.total - 5_000;
    expect(await capture.capturePayment(own.storeId, order.orderId, { amountMinor: order.total + 1, accountId: own.ownerId })).toEqual({ ok: false, problem: "amount" });
    expect(await capture.capturePayment(own.storeId, order.orderId, { amountMinor: less, accountId: own.ownerId })).toEqual({ ok: true, capturedMinor: less, releasedMinor: 5_000 });
    expect(fake.state.captures.find((c) => c.id === pi.id)?.params).toMatchObject({ amount_to_capture: less });
    const [release] = await db().execute<Row>(sql`
      select r.amount_minor::int as amount, r.kind, r.status from commerce.refunds r join commerce.payments p on p.id = r.payment_id where p.order_id = ${order.orderId}::uuid`);
    expect(release).toEqual({ amount: 5_000, kind: "release", status: "succeeded" });
    const [note] = await db().execute<Row>(sql`
      select c.total_minor::int as total from commerce.credit_notes c join commerce.invoices i on i.id = c.invoice_id where i.order_id = ${order.orderId}::uuid`);
    expect(note.total).toBe(5_000);
  });

  it("captures an order held in euro in euro", async () => {
    const own = await storeCapturing("cap-euro", "by_hand");
    const { order } = await heldOrder(own, { market: fx.noInEuro });
    expect(order.currency).toBe("EUR");
    expect(await capture.capturePayment(own.storeId, order.orderId, { amountMinor: order.total - 100, accountId: own.ownerId })).toMatchObject({ ok: true, releasedMinor: 100 });
    const [p] = await db().execute<Row>(sql`select currency, amount_minor::int as amount from commerce.payments where order_id = ${order.orderId}::uuid`);
    expect(p).toEqual({ currency: "EUR", amount: order.total });
  });

  it("charges the held card with the first parcel when the store takes payment when sent, and refuses to send a card that is not charged", async () => {
    const own = await storeCapturing("cap-sent", "when_sent");
    const { order } = await heldOrder(own);
    fake.state.failCapture = true;
    expect(await markSent(own.storeId, order.orderId, { carrier: "other", trackingNumber: "", trackingUrl: null }, own.ownerId)).toMatchObject({ ok: false, reason: "capture_failed" });
    expect((await orderRow(order.orderId)).status).toBe("authorized");
    fake.state.failCapture = false;
    expect(await markSent(own.storeId, order.orderId, { carrier: "other", trackingNumber: "", trackingUrl: null }, own.ownerId)).toMatchObject({ ok: true });
    expect((await orderRow(order.orderId)).status).toBe("fulfilled");

    const byHand = await storeCapturing("cap-hand-send", "by_hand");
    const held = await heldOrder(byHand);
    expect(await markSent(byHand.storeId, held.order.orderId, { carrier: "other", trackingNumber: "", trackingUrl: null }, byHand.ownerId)).toMatchObject({ ok: false, reason: "authorized" });
  });
});

describe("a hold that ends", () => {
  it("staff release it: Stripe lets it go, the order is cancelled and its stock released", async () => {
    const own = await storeCapturing("cap-void", "by_hand");
    const { order, pi } = await heldOrder(own);
    expect(await capture.voidAuthorization(own.storeId, order.orderId, own.ownerId)).toEqual({ ok: true });
    expect(fake.state.cancels).toContain(pi.id);
    expect((await orderRow(order.orderId)).status).toBe("cancelled");
    expect(await paymentStatus(order.orderId)).toBe("cancelled");
    expect(await heldStock(order.orderId)).toBe(0);
  });

  it("Stripe lets it go (payment_intent.canceled): the order is cancelled once", async () => {
    const own = await storeCapturing("cap-ended", "by_hand");
    const { order, pi } = await heldOrder(own);
    pi.status = "canceled";
    const event = { id: `evt_cap_${order.orderId}`, type: "payment_intent.canceled", account: own.account, data: { object: { id: pi.id, status: "canceled" } } } as unknown as Stripe.Event;
    await handleStripeEvent(own.storeId, event);
    expect((await orderRow(order.orderId)).status).toBe("cancelled");
    expect(await paymentStatus(order.orderId)).toBe("cancelled");
  });

  it("the job warns staff a day before, and cancels an order whose hold Stripe ended past its deadline", async () => {
    const own = await storeCapturing("cap-job", "by_hand");
    const soon = await heldOrder(own);
    const past = await heldOrder(own);
    await db().execute(sql`update commerce.orders set capture_before = now() + interval '3 hours' where id = ${soon.order.orderId}::uuid`);
    await db().execute(sql`update commerce.orders set capture_before = now() - interval '1 hour' where id = ${past.order.orderId}::uuid`);
    past.pi.status = "canceled";
    const warned: string[] = [];
    const run = await capture.runCaptureJobs({ storeIds: [own.storeId], warn: async (_store, orderId) => void warned.push(orderId) });
    expect(warned).toEqual([soon.order.orderId]);
    expect(run).toMatchObject({ warned: 1, ended: 1 });
    expect((await orderRow(past.order.orderId)).status).toBe("cancelled");
    // Once: the second run warns nobody.
    expect((await capture.runCaptureJobs({ storeIds: [own.storeId], warn: async () => undefined })).warned).toBe(0);
  });
});
