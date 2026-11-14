import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import { makeStore, ownerOf, paidOrder, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

const { saveCheckoutContact, saveOrderContact, checkoutPhoneRequired } = await import("./checkout-contact");
const { applyPaymentAnswer } = await import("./payment-outcome");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

/**
 * Contact details at checkout (D357): the store's choice saved by its only writer and audited; what a shopper typed kept on an order waiting
 * for payment, never on another store's or a paid one; and kept when the paid session gives no phone or name of its own.
 */

let fx: Fixture;
let other: Fixture;
beforeAll(async () => {
  fx = await makeStore("contact-ask");
  other = await makeStore("contact-other");
});
afterAll(async () => {
  await closeDb();
});

const billingOf = async (orderId: string) =>
  (await db().execute<Row>(sql`select billing_address from commerce.orders where id = ${orderId}::uuid`))[0]?.billing_address as Record<string, unknown>;

describe("the store's choice", () => {
  it("is saved by the owner, refused when it is not a mode, audited, and read back by the store", async () => {
    const owner = await ownerOf(fx);
    expect(await saveCheckoutContact(owner, { phone: "always", name: "off" })).toEqual({ ok: false, problems: ["Choose off, optional or required."] });
    expect(await saveCheckoutContact(owner, { phone: "required", name: "optional" })).toEqual({ ok: true });
    expect((await getStore(fx.slug))?.checkoutContact).toEqual({ phone: "required", name: "optional" });
    expect(await checkoutPhoneRequired(fx.storeId)).toBe(true);
    expect(await checkoutPhoneRequired(other.storeId)).toBe(false);
    const [audit] = await db().execute<Row>(sql`
      select changes from commerce.audit_log where store_id = ${fx.storeId}::uuid and action = 'store.checkout_contact' order by created_at desc limit 1
    `);
    expect(audit?.changes).toEqual({ checkoutPhone: { from: "off", to: "required" }, checkoutName: { from: "off", to: "optional" } });
  });
});

describe("what the shopper typed", () => {
  it("is laid over the order waiting for payment, and kept when the paid session gives no phone or name of its own", async () => {
    const placed = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { pay: false, billing: {} });
    expect(await saveOrderContact(fx.storeId, placed.orderId, { name: "Kari Nordmann", phone: "+4791234567" })).toBe(true);
    // A field left empty keeps what is there.
    expect(await saveOrderContact(fx.storeId, placed.orderId, { name: null, phone: "+4791234568" })).toBe(true);
    expect(await billingOf(placed.orderId)).toEqual({ name: "Kari Nordmann", phone: "+4791234568" });
    // Stripe's session on our page asks neither: what was typed stays.
    await applyPaymentAnswer(fx.storeId, {
      provider: "stripe",
      reference: placed.sessionId,
      state: "paid",
      shopper: { email: placed.email, name: null, phone: null, billing: null, shipping: null },
    });
    expect(await billingOf(placed.orderId)).toMatchObject({ name: "Kari Nordmann", phone: "+4791234568" });
    // A paid order is no longer changed this way.
    expect(await saveOrderContact(fx.storeId, placed.orderId, { name: "Someone Else", phone: null })).toBe(false);
  });

  it("never reaches another store's order, and gives way to a phone and name the provider gives", async () => {
    const placed = await paidOrder(fx, [["DEMO-MUG-WHITE", 1]], { pay: false, billing: {} });
    expect(await saveOrderContact(other.storeId, placed.orderId, { name: "Intruder", phone: null })).toBe(false);
    expect(await saveOrderContact(fx.storeId, placed.orderId, { name: "Kari Nordmann", phone: "+4791234567" })).toBe(true);
    await applyPaymentAnswer(fx.storeId, {
      provider: "stripe",
      reference: placed.sessionId,
      state: "paid",
      shopper: { email: placed.email, name: "Ola Nordmann", phone: "+4740000000", billing: null, shipping: null },
    });
    expect(await billingOf(placed.orderId)).toMatchObject({ name: "Ola Nordmann", phone: "+4740000000" });
  });
});
