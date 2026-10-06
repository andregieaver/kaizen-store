import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const { setCartGift } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { markSent } = await import("./order-admin");
const { cartOf, no, pay } = await import("./inventory-test-support");
const { newPlainStore } = await import("./order-ops-fixture");
const { sendOrderConfirmation, sendShipped } = await import("./shopper-emails");

type Row = Record<string, unknown>;

/**
 * Criterion G2 of `orders.gift-receipts-and-messages` (wave 3, run 2, D173, `docs/wave-3-orders.md` 6.4): the gift's message reaches the buyer's confirmation and nothing else the order
 * ever sends. The shipping notice to the buyer never carries it, and no email of the order's whole life is addressed to anyone but the order's own address (there is no email to a recipient).
 */

afterAll(async () => {
  await closeDb();
});

beforeEach(() => jar.clear());

describe("the gift message in the emails of an order", () => {
  it("is in the confirmation to the buyer and in no other email: the shipping notice carries neither the message nor the recipient's name, and nobody but the buyer is written to", async () => {
    const store = await newPlainStore("gift-shipping");
    await db().execute(sql`
      insert into commerce.order_settings (store_id, gift_messages) values (${store.storeId}::uuid, true) on conflict (store_id) do update set gift_messages = true
    `);
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 100 where store_id = ${store.storeId}::uuid`);
    const cartId = await cartOf(store.storeId, [["DEMO-MUG-WHITE", 1]]);
    jar.set(`cart_${store.storeId}_no`, cartId);

    const marker = "zq-unique-gift-words-7731";
    const recipient = "Zebulon Receiver";
    expect(await setCartGift({ storeId: store.storeId, market: no }, { isGift: true, to: recipient, from: "Anna", message: `${marker}\nWith love` })).toMatchObject({ ok: true });
    const placed = await placeOrder({ storeId: store.storeId, market: no }, cartId, {});
    if (!placed.ok) throw new Error("placing");
    await pay(store.storeId, placed.order, store.account);
    await db().execute(sql`update commerce.orders set email = 'buyer-gift-ship@example.com' where id = ${placed.order.orderId}::uuid`);

    await sendOrderConfirmation(store.storeId, placed.order.orderId);
    const shipment = await markSent(store.storeId, placed.order.orderId, { carrier: "bring", trackingNumber: "370722", trackingUrl: null }, null);
    expect(shipment).not.toBeNull();
    expect(await sendShipped(store.storeId, placed.order.orderId, shipment!)).toBe("logged");

    const mails = await db().execute<Row>(sql`
      select kind, to_address, subject, text, html from commerce.email_messages where store_id = ${store.storeId}::uuid and order_id = ${placed.order.orderId}::uuid
    `);
    const kinds = mails.map((m) => String(m.kind));
    expect(kinds).toContain("order.sent");
    // Every email the order produced is for the buyer's own address.
    expect(new Set(mails.map((m) => String(m.to_address)))).toEqual(new Set(["buyer-gift-ship@example.com"]));
    for (const mail of mails) {
      const whole = `${mail.subject}\n${mail.text}\n${mail.html}`;
      if (String(mail.kind) === "order.sent") {
        expect(whole).not.toContain(marker);
        expect(whole).not.toContain(recipient);
      }
    }
    // The confirmation, by contrast, does repeat it for the buyer.
    const confirmation = mails.find((m) => String(m.kind) !== "order.sent");
    expect(String(confirmation?.text)).toContain(marker);
  });
});
