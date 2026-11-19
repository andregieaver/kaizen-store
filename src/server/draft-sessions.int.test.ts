import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

/**
 * Closing an order's open payments before staff act on it (`src/server/draft-sessions.ts`, D173; code review 1.9's next, FH9, D811): the pay
 * link of a draft order may have opened several Stripe sessions, and each must be closed before the order is reopened, paid outside Kaizena
 * Flow or cancelled, so a buyer cannot pay an order that is no longer theirs to pay. One found paid completes the order (`paid`: the caller must
 * not cancel it); one whose money is on its way, or that Stripe could not be asked about, is left pending and the caller waits (`processing`).
 *
 * Stripe is the stand-in of `stripe-test-support.ts`; each session is closed by its own provider (`payment-providers/stripe.ts`).
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }), headers: async () => new Headers() }));
vi.mock("./stripe", async (importActual) => {
  const { stripe } = await import("./stripe-test-support");
  return { ...(await importActual<typeof import("./stripe")>()), platformStripe: stripe.platform };
});
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test", "live"], platformPublishableKey: (mode: string) => `pk_${mode}_x`, platformSecretKey: () => null }));

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { stripe } = await import("./stripe-test-support");
const fx = await import("./invoice-test-fixture");
const { placeOrder } = await import("./checkout");
const { openPaymentSession, paymentConnection } = await import("./payment-session");
const { settleOrderSessions } = await import("./draft-sessions");

type Fixture = import("./invoice-test-fixture").Fixture;
type PlacedOrder = import("./checkout").PlacedOrder;

const buyer = { email: "kari@example.no", name: "Kari Nordmann" };
let store: Fixture;

async function placed(): Promise<PlacedOrder> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${store.storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${store.storeId}::uuid, ${String(cart.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-MUG-WHITE'
  `);
  const result = await placeOrder({ storeId: store.storeId, market: fx.no }, String(cart.id));
  if (!result.ok) throw new Error(result.problem);
  return result.order;
}

/** One press of the draft's pay link: a new hosted session for the order, under the press's own key. */
async function press(order: PlacedOrder, n: number): Promise<string> {
  const opened = await openPaymentSession({ storeId: store.storeId, storeSlug: store.slug, market: fx.no }, order, "https://shop.test", "Frakt", {
    ...(await paymentConnection(store.storeId))!,
    ui: "hosted",
    exactAmounts: true,
    idempotencyKey: `draft-pay-${order.orderId}-${n}`,
    allowedCountry: "NO",
    expiresInSeconds: 60 * 60,
  });
  if (!opened.ok) throw new Error(opened.problem);
  return opened.sessionId;
}

async function rows(orderId: string): Promise<Record<string, string>> {
  const found = await db().execute<Row>(sql`select provider_reference, status::text from commerce.payments where order_id = ${orderId}::uuid`);
  return Object.fromEntries(found.map((row) => [String(row.provider_reference), String(row.status)]));
}

const orderStatus = async (orderId: string) => String((await db().execute<Row>(sql`select status::text from commerce.orders where id = ${orderId}::uuid`))[0].status);

beforeAll(async () => {
  store = await fx.makeStore("settle");
});

afterAll(async () => {
  await closeDb();
});

describe("closing an order's open payments (settleOrderSessions)", () => {
  it("is none for an order without one, asking Stripe nothing", async () => {
    const order = await placed();
    const mark = stripe.calls.length;
    expect(await settleOrderSessions(store.storeId, order.orderId)).toBe("none");
    expect(stripe.calls.slice(mark)).toEqual([]);
  });

  it("closes every session the pay link opened, at Stripe and in its row, and no other order's", async () => {
    const order = await placed();
    const neighbour = await placed();
    const sessions = [await press(order, 0), await press(order, 1), await press(order, 2)];
    const theirs = await press(neighbour, 0);
    expect(await settleOrderSessions(store.storeId, order.orderId)).toBe("closed");
    for (const id of sessions) expect(stripe.sessions.get(id)?.status).toBe("expired");
    expect(await rows(order.orderId)).toEqual(Object.fromEntries(sessions.map((id) => [id, "cancelled"])));
    expect(stripe.sessions.get(theirs)?.status).toBe("open");
    expect(await rows(neighbour.orderId)).toEqual({ [theirs]: "pending" });
    // Settled again, nothing is left to close and Stripe is not asked.
    const mark = stripe.calls.length;
    expect(await settleOrderSessions(store.storeId, order.orderId)).toBe("none");
    expect(stripe.calls.slice(mark)).toEqual([]);
    // Another store's id never reaches this order's payments.
    expect(await settleOrderSessions((await fx.makeStore("settle-other")).storeId, neighbour.orderId)).toBe("none");
    expect(stripe.sessions.get(theirs)?.status).toBe("open");
  });

  it("completes the order when a session turns out paid, so the caller does not cancel or reopen a paid order", async () => {
    const order = await placed();
    const first = await press(order, 0);
    const second = await press(order, 1);
    stripe.pay(second, buyer);
    expect(await settleOrderSessions(store.storeId, order.orderId)).toBe("paid");
    expect(await orderStatus(order.orderId)).toBe("paid");
    expect(await rows(order.orderId)).toEqual({ [first]: "cancelled", [second]: "captured" });
  });

  it("waits for a session whose money is on its way, or that Stripe could not be asked about, and closes the rest", async () => {
    const order = await placed();
    const coming = await press(order, 0);
    const unasked = await press(order, 1);
    const open = await press(order, 2);
    stripe.finish(coming, buyer);
    const client = stripe.platform("live") as unknown as { checkout: { sessions: { retrieve: (id: string, ...rest: unknown[]) => Promise<unknown> } } };
    const retrieve = client.checkout.sessions.retrieve;
    client.checkout.sessions.retrieve = async (id: string, ...rest: unknown[]) => {
      if (id === unasked) throw new Error("socket hang up");
      return retrieve(id, ...rest);
    };
    try {
      expect(await settleOrderSessions(store.storeId, order.orderId)).toBe("processing");
    } finally {
      client.checkout.sessions.retrieve = retrieve;
    }
    expect(await rows(order.orderId)).toEqual({ [coming]: "pending", [unasked]: "pending", [open]: "cancelled" });
    expect(stripe.sessions.get(unasked)?.status).toBe("open");
    expect(await orderStatus(order.orderId)).toBe("pending_payment");
  });

  it("closes a session Stripe says does not exist", async () => {
    const order = await placed();
    const gone = await press(order, 0);
    stripe.sessions.delete(gone);
    expect(await settleOrderSessions(store.storeId, order.orderId)).toBe("closed");
    expect(await rows(order.orderId)).toEqual({ [gone]: "cancelled" });
  });
});
