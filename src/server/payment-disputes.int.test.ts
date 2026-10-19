import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** Kaizena Flow's platform Stripe client, faked: a session's PaymentIntent with its latest charge, and the session behind an intent. */
const fake = vi.hoisted(() => {
  type Charge = { id: string; payment_method_details: unknown; outcome: unknown };
  const state = { charges: new Map<string, Charge>(), down: false, asked: [] as string[] };
  const intentOf = (session: string) => `pi_for_${session}`;
  const client = {
    checkout: {
      sessions: {
        retrieve: async (id: string) => {
          state.asked.push(id);
          if (state.down) throw new Error("Stripe is down");
          return { id, payment_intent: { id: intentOf(id), latest_charge: state.charges.get(id) ?? null }, invoice: null };
        },
        list: async ({ payment_intent }: { payment_intent: string }) => ({ data: payment_intent.startsWith("pi_for_") ? [{ id: payment_intent.slice("pi_for_".length) }] : [] }),
      },
    },
    paymentIntents: { retrieve: async () => null },
    charges: { retrieve: async () => null },
    invoicePayments: { list: async () => ({ data: [] }) },
  };
  return { client, state, intentOf };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { handleStripeEvent } = await import("./stripe-webhooks");
const facts = await import("./payment-facts");
const disputes = await import("./payment-disputes");
const { getStore } = await import("./stores");
const { periodTotals } = await import("./analytics-totals");
const { paymentMethodsReport } = await import("./analytics-payments-data");
const { listOrdersPage, loadOrderListContext } = await import("./order-list");
const { parseOrderListParams } = await import("@/lib/order-list");
const { customPeriod, todayIn } = await import("@/lib/analytics-period");
const { DEFAULT_ANALYTICS_SETTINGS } = await import("@/lib/analytics-kpi");

type Row = Record<string, unknown>;

/**
 * Payment facts and disputes (wave 4 unit A, D288, `docs/wave-4-payments.md` 3), through the real server code with a faked Stripe: a captured payment's
 * charge read once (by the reply's `after()` or the job), Stripe's dispute events kept as one row each, the order's history, the staff emails once each,
 * the deadline reminder, a dispute Kaizena Flow does not know, and an order in euro.
 */

let n = 0;
const eventOf = (type: string, object: unknown, account: string): Stripe.Event =>
  ({ id: `evt_dp_${++n}_${Math.random().toString(36).slice(2, 8)}`, type, account, data: { object } }) as unknown as Stripe.Event;

async function sessionOf(storeId: string, orderId: string): Promise<string> {
  const [p] = await db().execute<Row>(sql`select provider_reference from commerce.payments where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid`);
  return String(p.provider_reference);
}

const disputeOf = (session: string, over: Record<string, unknown> = {}) => ({
  id: `dp_${session.slice(3, 15)}`,
  object: "dispute",
  amount: 10_000,
  currency: "nok",
  reason: "fraudulent",
  status: "needs_response",
  created: Math.floor(Date.now() / 1000),
  livemode: true,
  charge: `ch_${session.slice(3, 15)}`,
  payment_intent: fake.intentOf(session),
  evidence_details: { due_by: Math.floor(Date.now() / 1000) + 10 * 86_400 },
  balance_transactions: [],
  ...over,
});

const staffEmails = (orderId: string, kind: string) =>
  db().execute<Row>(sql`select idempotency_key, to_address, html, subject from commerce.email_messages where order_id = ${orderId}::uuid and kind = ${kind} order by created_at`);

afterAll(async () => {
  await closeDb();
});

describe("what a payment was", () => {
  it("reads a captured payment's charge once and keeps Stripe's method, wallet, brand and risk", async () => {
    const own = await fx.makeStore("pf-read");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const session = await sessionOf(own.storeId, order.orderId);
    fake.state.charges.set(session, {
      id: `ch_${session}`,
      payment_method_details: { type: "card", card: { brand: "visa", wallet: { type: "apple_pay" } } },
      outcome: { risk_level: "elevated", risk_score: 72 },
    });
    expect(await facts.readPaymentFacts(own.storeId, session)).toBe("read");
    const [p] = await db().execute<Row>(sql`select method_type, wallet, card_brand, risk_level, risk_score, charge_reference, facts_read_at from commerce.payments where provider_reference = ${session}`);
    expect(p).toMatchObject({ method_type: "card", wallet: "apple_pay", card_brand: "visa", risk_level: "elevated", risk_score: 72, charge_reference: `ch_${session}` });
    expect(p.facts_read_at).not.toBeNull();
    // Once: a second read finds nothing to do and asks Stripe nothing.
    const asked = fake.state.asked.length;
    expect(await facts.readPaymentFacts(own.storeId, session)).toBe("none");
    expect(fake.state.asked.length).toBe(asked);
  });

  it("keeps nulls when Stripe gave no charge, and leaves a payment for the job when Stripe cannot be asked", async () => {
    const own = await fx.makeStore("pf-job");
    const quiet = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const down = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const quietSession = await sessionOf(own.storeId, quiet.orderId);
    const downSession = await sessionOf(own.storeId, down.orderId);
    expect(await facts.readPaymentFacts(own.storeId, quietSession)).toBe("read");
    const [q] = await db().execute<Row>(sql`select method_type, risk_level, facts_read_at from commerce.payments where provider_reference = ${quietSession}`);
    expect(q).toMatchObject({ method_type: null, risk_level: null });
    expect(q.facts_read_at).not.toBeNull();

    fake.state.down = true;
    expect(await facts.readPaymentFacts(own.storeId, downSession)).toBe("failed");
    fake.state.down = false;
    fake.state.charges.set(downSession, { id: `ch_${downSession}`, payment_method_details: { type: "klarna" }, outcome: { risk_level: "not_assessed" } });
    const run = await facts.readMissingPaymentFacts(100, { storeIds: [own.storeId] });
    expect(run).toEqual({ checked: 1, read: 1, failed: 0 });
    const [d] = await db().execute<Row>(sql`select method_type, risk_level from commerce.payments where provider_reference = ${downSession}`);
    expect(d).toMatchObject({ method_type: "klarna", risk_level: "not_assessed" });
  });
});

describe("disputes", () => {
  it("keeps a dispute from Stripe's events once, writes the order's history and emails the owner once", async () => {
    const own = await fx.makeStore("pf-dispute");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const session = await sessionOf(own.storeId, order.orderId);
    const opened = disputeOf(session, { amount: order.total });
    await handleStripeEvent(own.storeId, eventOf("charge.dispute.created", opened, own.account));
    // Stripe sends it again, and an update before it closes.
    await handleStripeEvent(own.storeId, eventOf("charge.dispute.created", opened, own.account));
    await handleStripeEvent(own.storeId, eventOf("charge.dispute.updated", { ...opened, status: "under_review" }, own.account));
    const rows = await db().execute<Row>(sql`select status, amount_minor::int as amount_minor, currency, reason, outcome, closed_at, evidence_due_by from commerce.payment_disputes where order_id = ${order.orderId}::uuid`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "under_review", amount_minor: order.total, currency: "NOK", reason: "fraudulent", outcome: null, closed_at: null });
    const mails = await staffEmails(order.orderId, "staff.dispute");
    expect(mails).toHaveLength(1);
    expect(mails[0].to_address).toBe(own.ownerEmail);
    expect(String(mails[0].subject)).toContain(`order ${order.number}`);
    // Never who the customer is (D238 4.8).
    expect(String(mails[0].html)).not.toContain("Kari");
    expect(String(mails[0].html)).not.toContain("shopper-");

    // Lost: money out, once in the history, and the dispute stays as it closed.
    await handleStripeEvent(
      own.storeId,
      eventOf("charge.dispute.closed", { ...opened, status: "lost", balance_transactions: [{ amount: -order.total, fee: 15_000, currency: "nok" }] }, own.account),
    );
    await handleStripeEvent(own.storeId, eventOf("charge.dispute.updated", { ...opened, status: "won" }, own.account));
    const [closed] = await db().execute<Row>(sql`select status, outcome, funds_withdrawn_minor::int as funds_withdrawn_minor, fee_minor::int as fee_minor, closed_at from commerce.payment_disputes where order_id = ${order.orderId}::uuid`);
    expect(closed).toMatchObject({ status: "lost", outcome: "lost", funds_withdrawn_minor: order.total, fee_minor: 15_000 });
    const history = await db().execute<Row>(sql`select type, data from commerce.order_events where order_id = ${order.orderId}::uuid and type like 'dispute.%' order by created_at`);
    expect(history.map((h) => h.type)).toEqual(["dispute.opened", "dispute.closed"]);
    expect((history[1].data as Record<string, unknown>).outcome).toBe("lost");
    // Not a refund: no refund row, no credit note.
    const [refunds] = await db().execute<Row>(sql`select count(*)::int as n from commerce.refunds r join commerce.payments p on p.id = r.payment_id where p.order_id = ${order.orderId}::uuid`);
    expect(refunds.n).toBe(0);
  });

  it("ignores a dispute on a payment the store does not have", async () => {
    const own = await fx.makeStore("pf-unknown");
    const result = await disputes.applyStripeDispute(own.storeId, disputeOf("cs_notthisstores000000", { charge: "ch_nobody" }), { stripe: fake.client as unknown as Stripe, account: own.account });
    expect(result).toEqual({ outcome: "unmatched", reason: "no_payment" });
  });

  it("reminds staff once when the evidence is due within three days, and never for a closed dispute", async () => {
    const own = await fx.makeStore("pf-due");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const session = await sessionOf(own.storeId, order.orderId);
    await handleStripeEvent(
      own.storeId,
      eventOf("charge.dispute.created", disputeOf(session, { amount: order.total, evidence_details: { due_by: Math.floor(Date.now() / 1000) + 2 * 86_400 } }), own.account),
    );
    await disputes.sendDueDisputeReminders({ limit: 1000 });
    await disputes.sendDueDisputeReminders({ limit: 1000 });
    expect(await staffEmails(order.orderId, "staff.dispute_due")).toHaveLength(1);
    const [d] = await db().execute<Row>(sql`select reminded_at from commerce.payment_disputes where order_id = ${order.orderId}::uuid`);
    expect(d.reminded_at).not.toBeNull();
  });

  it("keeps a dispute on an order paid in euro in euro", async () => {
    const own = await fx.makeStore("pf-euro");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { market: fx.noInEuro });
    expect(order.currency).toBe("EUR");
    const session = await sessionOf(own.storeId, order.orderId);
    await handleStripeEvent(own.storeId, eventOf("charge.dispute.created", disputeOf(session, { amount: order.total, currency: "eur" }), own.account));
    const [d] = await db().execute<Row>(sql`select amount_minor::int as amount_minor, currency from commerce.payment_disputes where order_id = ${order.orderId}::uuid`);
    expect(d).toMatchObject({ amount_minor: order.total, currency: "EUR" });
    // A dispute in another currency than its payment's is not this payment's.
    const other = await disputes.applyStripeDispute(own.storeId, disputeOf(session, { id: "dp_other_currency", currency: "nok" }), { stripe: fake.client as unknown as Stripe, account: own.account });
    expect(other).toEqual({ outcome: "unmatched", reason: "no_payment" });
    const [mail] = await staffEmails(order.orderId, "staff.dispute");
    expect(String(mail.subject)).toContain("€");
  });
});

describe("where it shows", () => {
  it("lists a risky and a disputed order by their filters, groups the payments by method, and takes a lost dispute off profit once, in euro too", async () => {
    const own = await fx.makeStore("pf-surfaces");
    const risky = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const plain = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    const euro = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { market: fx.noInEuro });
    const card = (session: string, risk: string, wallet: string | null) =>
      fake.state.charges.set(session, { id: `ch_${session}`, payment_method_details: { type: "card", card: { brand: "visa", wallet: wallet ? { type: wallet } : null } }, outcome: { risk_level: risk } });
    card(risky.sessionId, "elevated", null);
    card(plain.sessionId, "normal", "apple_pay");
    card(euro.sessionId, "normal", null);
    for (const o of [risky, plain, euro]) expect(await facts.readPaymentFacts(own.storeId, o.sessionId)).toBe("read");
    await handleStripeEvent(own.storeId, eventOf("charge.dispute.closed", disputeOf(euro.sessionId, { amount: euro.total, currency: "eur", status: "lost", balance_transactions: [{ amount: -euro.total, fee: 1_500, currency: "eur" }] }), own.account));

    // The list's filters and chips.
    const context = await loadOrderListContext(own.storeId);
    const page = async (query: string) => (await listOrdersPage(own.storeId, parseOrderListParams(new URLSearchParams(query)), context)).rows;
    expect((await page("pay=elevated_risk")).map((r) => r.id)).toEqual([risky.orderId]);
    expect((await page("pay=disputed")).map((r) => r.id)).toEqual([euro.orderId]);
    const all = await page("");
    expect(all.find((r) => r.id === risky.orderId)).toMatchObject({ risk: "elevated", disputed: false });
    expect(all.find((r) => r.id === euro.orderId)).toMatchObject({ risk: null, disputed: true });

    // Payments by method: the rows add up to what was received, euro converted at the store's rate (1 EUR = 11.5 NOK).
    const store = (await getStore(own.slug))!;
    const today = todayIn(new Date(), store.timeZone);
    const period = customPeriod(today, today);
    const report = await paymentMethodsReport(store, period, { ...DEFAULT_ANALYTICS_SETTINGS, paymentFeeBps: 0, paymentFeeFixedMinor: 0 });
    const eurInNok = Math.round(euro.total * 11.5);
    expect(report.lines.map((l) => [l.label, l.payments, l.receivedMinor])).toEqual(
      [
        ["Card", 2, risky.total + eurInNok],
        ["Apple Pay", 1, plain.total],
      ].sort((a, b) => Number(b[2]) - Number(a[2])),
    );
    expect(report.total.receivedMinor).toBe(risky.total + plain.total + eurInNok);

    // Finance: the lost euro dispute without VAT plus Stripe's fee, converted, once; not a refund.
    const { totals } = await periodTotals(store, period);
    const [o] = await db().execute<Row>(sql`select total_minor::int as total, tax_minor::int as tax from commerce.orders where id = ${euro.orderId}::uuid`);
    const exVat = Math.round((euro.total * (Number(o.total) - Number(o.tax))) / Number(o.total));
    expect(totals.lostDisputesMinor).toBe(Math.round((exVat + 1_500) * 11.5));
    expect(totals.refundsMinor).toBe(0);
  });
});
