import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

/** Kaizen's platform Stripe client, faked: each refund takes a moment (as a real call does) and is recorded with its idempotency key. */
const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const byKey = new Map<string, { id: string; status: string }>();
  const client = {
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const key = String(options.idempotencyKey);
        // Stripe's idempotency: the same key gives back the same refund and moves no money twice.
        const known = byKey.get(key);
        if (known) return known;
        refunds.push({ params, options });
        const made = { id: `re_race_${refunds.length}`, status: "succeeded" };
        byKey.set(key, made);
        return made;
      },
    },
    checkout: { sessions: { create: async () => ({}), retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, status: "complete", payment_status: "paid" }), expire: async () => ({}) } },
  };
  return { client, refunds };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const edits = await import("./order-edits");
const { staffActor } = await import("./order-actor");
const { fxStore, paidOrder, lineOf } = await import("./fulfilment-test-fixture");

type Row = Record<string, unknown>;

/**
 * Security review (wave 3, run 3, D174): a double submit of *Save the change* for a lower total. Each call makes its own edit id, so `refundOrder()` is given a
 * different Stripe idempotency key (`order-edit-refund:{edit}`) and Stripe is called BEFORE the transaction that writes the change. The second call's
 * `writeEdit()` then finds the order moved ("changed") and rolls back, but the money has already left the merchant's account: the customer is refunded
 * the difference twice, and Kaizen records only one refund of it.
 */
let store: Awaited<ReturnType<typeof fxStore>>;
beforeAll(async () => {
  store = await fxStore("edit-race", { invoicing: true, live: true });
});
afterAll(async () => {
  await closeDb();
});

describe("a double submit of a lower-total change", () => {
  it("moves the difference back through Stripe once", async () => {
    const order = await paidOrder(store, [["DEMO-TOTE", 3]]);
    const tote = lineOf(order, "DEMO-TOTE");
    const raw = { quantities: { [tote.id]: 2 }, reason: "customer_request" };
    const preview = await edits.previewOrderEdit(store.storeId, order.orderId, raw);
    if (!preview || !("base" in preview)) throw new Error("no preview");
    const actor = staffActor(store.accountId);
    const before = fake.refunds.length;
    // The same form sent twice (a double click, a retry, two tabs), with the same base the editor showed.
    const results = await Promise.all([
      edits.applyOrderEdit(store.storeId, order.orderId, { ...raw, base: preview.base }, actor),
      edits.applyOrderEdit(store.storeId, order.orderId, { ...raw, base: preview.base }, actor),
    ]);
    const applied = results.filter((r) => r.ok).length;
    const [recorded] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
      where p.store_id = ${store.storeId}::uuid and p.order_id = ${order.orderId}::uuid
    `);
    expect(applied).toBe(1);
    expect(Number(recorded.n)).toBe(1);
    // Fails today: two Stripe refunds of the difference were made for one applied change.
    expect(fake.refunds.length - before).toBe(1);
  });
});
