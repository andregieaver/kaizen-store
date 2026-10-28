import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** Kaizen's platform Stripe client, faked: a refund through Stripe succeeds. Store credit never reaches it. */
const fake = vi.hoisted(() => {
  const state = { created: 0 };
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }), list: async () => ({ data: [] }) } },
    refunds: {
      create: async (params: { amount: number; payment_intent: string }) => {
        state.created += 1;
        return { id: `re_sc_${state.created}_${Math.random().toString(36).slice(2, 8)}`, object: "refund", status: "succeeded", amount: params.amount, currency: "nok", created: 0, payment_intent: params.payment_intent, metadata: {} };
      },
      retrieve: async () => null,
    },
  };
  return { client, state };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { refundOrder, getOrderAdmin } = await import("./order-admin");
const { findGiftCard } = await import("./gift-card-cart");

type Row = Record<string, unknown>;

afterAll(async () => {
  await closeDb();
});

const cardOf = async (storeId: string, cardId: string) => {
  const [row] = await db().execute<Row>(sql`
    select source, currency, initial_minor, order_id, refund_id, recipient_email, test_mode, sent_at is not null as sent, commerce.gift_card_balance(id) as balance
    from commerce.gift_cards where store_id = ${storeId}::uuid and id = ${cardId}::uuid
  `);
  return row;
};

/**
 * Refund to store credit (wave 10 unit A, D364): no provider is asked, the refund is recorded as `store_credit`, one gift card of the store's
 * carries the amount (its balance the ledger's), the order's credit note follows as for any refund, the card can be spent, and what is left to
 * refund to the card is lowered by it. In kroner and in euros.
 */
describe("refund to store credit", () => {
  for (const [label, market] of [
    ["kroner", fx.no],
    ["euros", fx.noInEuro],
  ] as const) {
    it(`issues one card for the amount, with a credit note, in ${label}`, async () => {
      const own = await fx.makeStore(`sc-${label}`, { rates: true });
      const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { market });
      const before = (await getOrderAdmin(own.storeId, order.orderId))!;
      const amount = Math.floor(before.refundableMinor / 2);
      const stripeCalls = fake.state.created;

      const out = await refundOrder(own.storeId, order.orderId, { amountMinor: amount, reason: "Goodwill", restock: [], toCredit: true }, own.ownerId);
      expect(out).toMatchObject({ ok: true, status: "succeeded", amountMinor: amount });
      if (!out.ok || !out.credit) throw new Error("no credit");
      expect(fake.state.created).toBe(stripeCalls);
      expect(out.credit.amountMinor).toBe(amount);
      expect(out.credit.code).toMatch(/^[A-Z0-9-]+$/);

      const [refund] = await db().execute<Row>(sql`select kind, status, amount_minor from commerce.refunds where store_id = ${own.storeId}::uuid and id = ${out.refundId}::uuid`);
      expect({ ...refund, amount_minor: Number(refund.amount_minor) }).toMatchObject({ kind: "store_credit", status: "succeeded", amount_minor: amount });

      const card = await cardOf(own.storeId, out.credit.cardId);
      expect(card).toMatchObject({ source: "refund", currency: before.currency, order_id: order.orderId, refund_id: out.refundId, recipient_email: before.email, test_mode: false, sent: true });
      expect(Number(card.initial_minor)).toBe(amount);
      expect(Number(card.balance)).toBe(amount);

      // The credit note follows from the refund as for any refund (D159).
      const notes = await fx.notesOf(own.storeId, order.orderId);
      expect(notes.map((n) => [n.totalMinor, n.refundId])).toEqual([[amount, out.refundId]]);

      // What is left to refund to the card is lowered by the credit.
      const after = (await getOrderAdmin(own.storeId, order.orderId))!;
      expect(after.refundableMinor).toBe(before.refundableMinor - amount);

      // The card is found by its code at checkout in the order's currency.
      expect(await findGiftCard(db(), own.storeId, out.credit.code, { currency: before.currency, testMode: false })).toMatchObject({ ok: true, id: out.credit.cardId });

      // The code was emailed to the order's own address, once, never kept in the email log.
      const mails = await db().execute<Row>(sql`select to_address, idempotency_key, html from commerce.email_messages where store_id = ${own.storeId}::uuid and kind = 'gift_card.issued'`);
      expect(mails.map((m) => [m.to_address, m.idempotency_key])).toEqual([[before.email, `gift-card:${out.credit.cardId}:refund`]]);
      expect(String(mails[0].html ?? "")).not.toContain(out.credit.code);

      // The rest goes back to the card through Stripe; then nothing is left, for credit either.
      const rest = await refundOrder(own.storeId, order.orderId, { amountMinor: after.refundableMinor, reason: "Rest", restock: [] }, own.ownerId);
      expect(rest).toMatchObject({ ok: true });
      expect(fake.state.created).toBe(stripeCalls + 1);
      const more = await refundOrder(own.storeId, order.orderId, { amountMinor: 1, reason: "More", restock: [], toCredit: true }, own.ownerId);
      expect(more).toEqual({ ok: false, problem: "The amount is more than is left to refund." });
    });
  }

  it("refuses an amount of zero, and the database caps store credit at what the payment took", async () => {
    const own = await fx.makeStore("sc-refuse");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]]);
    expect(await refundOrder(own.storeId, order.orderId, { amountMinor: 0, reason: "x", restock: [], toCredit: true }, own.ownerId)).toEqual({
      ok: false,
      problem: "Enter an amount to refund as store credit.",
    });
    const [payment] = await db().execute<Row>(sql`select id, amount_minor from commerce.payments where store_id = ${own.storeId}::uuid and order_id = ${order.orderId}::uuid and status = 'captured'`);
    await expect(
      db().execute(sql`
        insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status, kind)
        values (${own.storeId}::uuid, ${payment.id}::uuid, ${Number(payment.amount_minor) + 1}, 'x', ${`store_credit_test_${fx.run}`}, 'succeeded', 'store_credit')
      `),
    ).rejects.toThrow();
    // A card is issued only for succeeded store credit refunds of one order.
    await expect(db().execute(sql`select commerce.gift_card_issue_refund(${own.storeId}::uuid, array[gen_random_uuid()], null, false)`)).rejects.toThrow();
  });
});
