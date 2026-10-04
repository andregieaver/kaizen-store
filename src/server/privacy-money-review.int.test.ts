import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { eraseSubject } = await import("./privacy-erasure");
const { applySession } = await import("./stripe-webhooks");
const { runRetention } = await import("./retention");

type Row = Record<string, unknown>;

let store: Awaited<ReturnType<typeof fx.makeStore>>;

beforeAll(async () => {
  store = await fx.makeStore("money-review");
}, 60_000);

afterAll(async () => {
  await closeDb();
});

describe("an order that is still waiting for payment when its person is erased (review, lens money)", () => {
  it("is still completed when a payment arrives afterwards (a race with the closing of the session): money taken by Stripe must never leave the order unpaid", async () => {
    const email = `${fx.unique("late")}@example.com`;
    const [c] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, name, email_verified_at) values (${store.storeId}::uuid, ${email}, 'Kari Late', now()) returning id`);
    const customerId = String(c.id);
    const placed = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email, customerId, pay: false });

    const erased = await eraseSubject(store.storeId, { customerId }, { channel: "shopper", accountId: null });
    expect(erased).toMatchObject({ ok: true });
    const [afterErase] = await db().execute<Row>(sql`select status, email, anonymised_at, restricted_at from commerce.orders where id = ${placed.orderId}::uuid`);
    // The order was not a sale: it is cancelled (stock back, checkout closed) and then anonymised, never left waiting for a payment.
    expect(afterErase.status).toBe("cancelled");
    expect(afterErase.email).toBe("[removed]");
    expect(afterErase.anonymised_at).not.toBeNull();

    // Stripe's Checkout session, opened before the erasure, is completed and paid by the shopper afterwards.
    await expect(applySession(store.storeId, {
      id: placed.sessionId,
      status: "complete",
      payment_status: "paid",
      mode: "payment",
      customer_details: { email, name: "Kari Late", phone: null, address: { line1: "Kirkeveien 5", line2: null, postal_code: "0368", city: "Oslo", country: "NO" } },
      collected_information: { shipping_details: { name: "Kari Late", address: { line1: "Kirkeveien 5", line2: null, postal_code: "0368", city: "Oslo", country: "NO" } } },
    } as never)).resolves.toBeUndefined();

    const [after] = await db().execute<Row>(sql`select status, email, billing_address, shipping_address, anonymised_at, restricted_at, customer_id from commerce.orders where id = ${placed.orderId}::uuid`);
    expect(after.status).toBe("paid");
    expect(after.anonymised_at).not.toBeNull();
    expect(after.email).toBe("[removed]");
    expect(JSON.stringify(after.billing_address)).not.toContain("Kari");
    expect(JSON.stringify(after.shipping_address)).not.toContain("Kirkeveien");
    await runRetention();
  });
});
