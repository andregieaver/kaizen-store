import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret, parseKey } from "@/lib/secret-box";

type Row = Record<string, unknown>;

/**
 * Stripe behind the payment-provider adapter (`src/server/payment-providers/stripe.ts`, D292; code review 1.9's next, FH9, D811): the order page's
 * late read (`refresh`), closing a payment that must not be paid any more (`close`) and refunds (`refund`), each on the payment's own connected
 * account and in its own mode. What is closed is closed only on Stripe's word; a refund gives Kaizena Flow's fee back and is made once per key.
 *
 * Stripe is the stand-in of `stripe-test-support.ts`: a session, payment intent or invoice is found only on the account it was made on, an
 * idempotency key is answered as Stripe answers it, and a refund above what is left is refused. Mollie's provider is tested in `mollie.int.test.ts`.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {}, has: () => false }), headers: async () => new Headers() }));
vi.mock("../stripe", async (importActual) => {
  const { stripe } = await import("../stripe-test-support");
  return { ...(await importActual<typeof import("../stripe")>()), platformStripe: stripe.platform, stripeFor: stripe.ownKey };
});
vi.mock("../stripe-keys", () => ({ platformModes: () => ["test", "live"], platformPublishableKey: (mode: string) => `pk_${mode}_x`, platformSecretKey: () => null }));

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { stripe, stripeRefusal } = await import("../stripe-test-support");
const fx = await import("../invoice-test-fixture");
const { placeOrder } = await import("../checkout");
const { openPaymentSession, paymentConnection } = await import("../payment-session");
const { providerOf, PaymentProviderRefusal } = await import("./index");

type StoredPayment = import("./types").StoredPayment;
type Fixture = import("../invoice-test-fixture").Fixture;

const provider = providerOf("stripe")!;
const buyer = { email: "kari@example.no", name: "Kari Nordmann", address: { line1: "Storgata 5", postal_code: "0182", city: "Oslo", country: "NO" } };
let store: Fixture;
let other: Fixture;

/** An order placed and its Stripe session opened, as checkout leaves it: the payment as Kaizena Flow keeps it. */
async function opened(on: Fixture = store, quantity = 1): Promise<StoredPayment & { amount: number }> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${on.storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${on.storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${on.storeId}::uuid and sku = 'DEMO-MUG-WHITE'
  `);
  const placed = await placeOrder({ storeId: on.storeId, market: fx.no }, String(cart.id));
  if (!placed.ok) throw new Error(placed.problem);
  const connection = (await paymentConnection(on.storeId))!;
  const session = await openPaymentSession({ storeId: on.storeId, storeSlug: on.slug, market: fx.no }, placed.order, "https://shop.test", "Frakt", { ...connection, ui: "hosted" });
  if (!session.ok) throw new Error(session.problem);
  const [payment] = await db().execute<Row>(sql`select id from commerce.payments where order_id = ${placed.order.orderId}::uuid`);
  return { id: String(payment.id), orderId: placed.order.orderId, provider: "stripe", reference: session.sessionId, account: on.account, mode: "live", amount: placed.order.dueNowMinor };
}

async function orderState(orderId: string): Promise<Row> {
  const [row] = await db().execute<Row>(sql`
    select o.status::text as order_status, o.email, p.status::text as payment_status
    from commerce.orders o join commerce.payments p on p.order_id = o.id where o.id = ${orderId}::uuid
  `);
  return row;
}

const callsSince = (mark: number, method?: string) => stripe.calls.slice(mark).filter((call) => !method || call.method === method);
const refundOf = (payment: StoredPayment, amountMinor: number, key = `refund-${payment.orderId}-${amountMinor}`) =>
  provider.refund(store.storeId, payment, { amountMinor, idempotencyKey: key, orderId: payment.orderId, orderNumber: "1001" });

beforeAll(async () => {
  [store, other] = await Promise.all([fx.makeStore("stripeprov"), fx.makeStore("stripeprov-other")]);
});

afterAll(async () => {
  await closeDb();
});

it("is the provider of a payment Stripe took, and of no payment taken outside a provider", () => {
  expect(provider.id).toBe("stripe");
  for (const none of ["manual", "venue", "exchange", "terms", null, ""]) expect(providerOf(none)).toBeNull();
});

describe("the order page's late read (refresh)", () => {
  it("completes the order from Stripe's word that it is paid, asking on the payment's own account in its mode", async () => {
    const payment = await opened();
    stripe.pay(payment.reference, buyer);
    const mark = stripe.calls.length;
    expect(await provider.refresh(store.storeId, payment)).toBe(true);
    expect(callsSince(mark, "checkout.sessions.retrieve").map((call) => ({ args: call.args, mode: call.mode }))).toEqual([
      { args: [payment.reference, {}, { stripeAccount: store.account }], mode: "live" },
    ]);
    expect(await orderState(payment.orderId)).toEqual({ order_status: "paid", email: "kari@example.no", payment_status: "captured" });
  });

  it("says it could not ask when Stripe is unreachable, or the session is not on that account, and changes nothing", async () => {
    const payment = await opened();
    stripe.pay(payment.reference, buyer);
    stripe.failNext.set("checkout.sessions.retrieve", new Error("socket hang up"));
    expect(await provider.refresh(store.storeId, payment)).toBe(false);
    // Another store's account has no such session: nothing is taken from it.
    expect(await provider.refresh(store.storeId, { ...payment, account: other.account })).toBe(false);
    expect(await orderState(payment.orderId)).toMatchObject({ order_status: "pending_payment", payment_status: "pending" });
  });

  it("reads a payment taken with the store's own keys before Connect with those keys, and asks nobody without them", async () => {
    const payment = await opened();
    const mark = stripe.calls.length;
    const before = stripe.ownKeys.length;
    expect(await provider.refresh(store.storeId, { ...payment, mode: null, account: null })).toBe(false);
    expect(callsSince(mark)).toEqual([]);
    expect(stripe.ownKeys.length).toBe(before);

    // A session made with the store's own key: on no connected account.
    const own = stripe.ownKey("sk_live_own");
    const legacy = await own.checkout.sessions.create({ mode: "payment", line_items: [{ quantity: 1, price_data: { currency: "nok", unit_amount: payment.amount, product_data: { name: "Mug" } } }] });
    await db().execute(sql`update commerce.payments set provider_reference = ${legacy.id}, provider_account = null where id = ${payment.id}::uuid`);
    stripe.pay(legacy.id, buyer);
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await db().execute(sql`
      insert into commerce.payment_credentials (store_id, provider, mode, secret_key_ciphertext)
      values (${store.storeId}::uuid, 'stripe', 'test', ${encryptSecret("sk_test_own_old", key)}), (${store.storeId}::uuid, 'stripe', 'live', ${encryptSecret("sk_live_own", key)})
    `);
    try {
      expect(await provider.refresh(store.storeId, { ...payment, reference: legacy.id, mode: null, account: null })).toBe(true);
    } finally {
      await db().execute(sql`delete from commerce.payment_credentials where store_id = ${store.storeId}::uuid`);
    }
    // Each of the store's keys may be tried; the session is found with the key it was made with.
    expect(stripe.ownKeys.slice(before + 1)).toContain("sk_live_own");
    expect(stripe.ownKeys.slice(before + 1).every((secret) => ["sk_live_own", "sk_test_own_old"].includes(secret))).toBe(true);
    expect((await orderState(payment.orderId)).order_status).toBe("paid");
  });
});

describe("closing a payment that must not be paid any more (close)", () => {
  it("expires an open session on its own account, so it cannot be paid", async () => {
    const payment = await opened();
    expect(await provider.close(store.storeId, payment)).toBe("closed");
    expect(stripe.sessions.get(payment.reference)?.status).toBe("expired");
    expect(stripe.callsOf("checkout.sessions.expire").at(-1)?.args).toEqual([payment.reference, {}, { stripeAccount: store.account }]);
    // Already expired: closed, without asking Stripe to expire it again.
    const expires = stripe.callsOf("checkout.sessions.expire").length;
    expect(await provider.close(store.storeId, payment)).toBe("closed");
    expect(stripe.callsOf("checkout.sessions.expire")).toHaveLength(expires);
  });

  it("completes a paid one instead (the caller must not cancel it), and waits for one whose money is on its way", async () => {
    const paid = await opened();
    stripe.pay(paid.reference, buyer);
    expect(await provider.close(store.storeId, paid)).toBe("paid");
    expect((await orderState(paid.orderId)).order_status).toBe("paid");

    const coming = await opened();
    stripe.finish(coming.reference, buyer);
    const expires = stripe.callsOf("checkout.sessions.expire").length;
    expect(await provider.close(store.storeId, coming)).toBe("processing");
    expect(stripe.callsOf("checkout.sessions.expire")).toHaveLength(expires);
    expect(await orderState(coming.orderId)).toMatchObject({ order_status: "pending_payment", payment_status: "pending" });
  });

  it("finds the buyer paid when expiring fails because they finished meanwhile", async () => {
    const payment = await opened();
    const client = stripe.platform("live") as unknown as { checkout: { sessions: { expire: (...args: unknown[]) => Promise<unknown> } } };
    const expire = client.checkout.sessions.expire;
    client.checkout.sessions.expire = async () => {
      // The buyer pressed Pay a moment before: Stripe will not expire a session that is complete.
      stripe.pay(payment.reference, buyer);
      throw stripeRefusal('Only Checkout Sessions with a status in ["open"] can be expired.');
    };
    try {
      expect(await provider.close(store.storeId, payment)).toBe("paid");
    } finally {
      client.checkout.sessions.expire = expire;
    }
    expect((await orderState(payment.orderId)).order_status).toBe("paid");
  });

  it("closes on Stripe's word that the session does not exist, and on nothing else", async () => {
    const payment = await opened();
    expect(await provider.close(store.storeId, { ...payment, reference: "cs_live_gone" })).toBe("closed");
    // Stripe twice unreachable: nothing proves the buyer cannot still pay.
    const client = stripe.platform("live") as unknown as { checkout: { sessions: { retrieve: (...args: unknown[]) => Promise<unknown> } } };
    const retrieve = client.checkout.sessions.retrieve;
    let asked = 0;
    client.checkout.sessions.retrieve = async (...args: unknown[]) => {
      asked += 1;
      if (asked <= 2) throw new Error("rate limited");
      return retrieve(...args);
    };
    try {
      expect(await provider.close(store.storeId, payment)).toBe("unknown");
      expect(stripe.sessions.get(payment.reference)?.status).toBe("open");
      // Once unreachable, then answered: closed on the second look.
      asked = 1;
      expect(await provider.close(store.storeId, payment)).toBe("closed");
    } finally {
      client.checkout.sessions.retrieve = retrieve;
    }
  });

  it("is unknown, asking nobody, without a client for the payment's mode or an account", async () => {
    const payment = await opened();
    const mark = stripe.calls.length;
    stripe.modes.delete("live");
    try {
      expect(await provider.close(store.storeId, payment)).toBe("unknown");
    } finally {
      stripe.modes.add("live");
    }
    expect(await provider.close(store.storeId, { ...payment, account: null })).toBe("unknown");
    expect(await provider.close(store.storeId, { ...payment, mode: null })).toBe("unknown");
    expect(callsSince(mark)).toEqual([]);
    expect(stripe.sessions.get(payment.reference)?.status).toBe("open");
  });
});

describe("refunds (refund)", () => {
  it("gives back part of a paid session's payment on its account, with Kaizena Flow's fee on that part, once per key", async () => {
    const payment = await opened(store, 2);
    const paid = stripe.pay(payment.reference, buyer);
    const part = Math.floor(payment.amount / 4);
    const first = await refundOf(payment, part, `refund-once-${payment.orderId}`);
    expect(first).toEqual({ reference: expect.stringMatching(/^re_/), status: "succeeded" });
    expect(stripe.callsOf("refunds.create").at(-1)?.args).toEqual([
      { payment_intent: paid.payment_intent, amount: part, reason: "requested_by_customer", refund_application_fee: true, metadata: { order_id: payment.orderId, order_number: "1001" } },
      { stripeAccount: store.account, idempotencyKey: `refund-once-${payment.orderId}` },
    ]);
    // A retry after a lost answer is the same refund, not a second one.
    expect(await refundOf(payment, part, `refund-once-${payment.orderId}`)).toEqual(first);
    expect(stripe.intents.get(String(paid.payment_intent))?.refunded).toBe(part);
    // The same key for another amount is refused, as Stripe refuses it.
    await expect(refundOf(payment, part + 1, `refund-once-${payment.orderId}`)).rejects.toThrow(/Stripe said: Keys for idempotent requests/);
    // More than is left is Stripe's refusal, in staff's words.
    await expect(refundOf(payment, payment.amount)).rejects.toThrow(/^Stripe said: Refund amount/);
    expect(stripe.intents.get(String(paid.payment_intent))?.refunded).toBe(part);
  });

  it("finds the payment behind a no-show fee, a subscription's first invoice and a renewal invoice", async () => {
    const fee = stripe.intent(store.account, 50_000, "nok");
    const payment = await opened();
    expect(await refundOf({ ...payment, reference: fee }, 10_000)).toMatchObject({ status: "succeeded" });
    expect((stripe.callsOf("refunds.create").at(-1)?.args[0] as Row).payment_intent).toBe(fee);

    const subscription = await opened();
    const first = stripe.payByInvoice(subscription.reference, buyer);
    await refundOf(subscription, 1_000);
    // The invoice's paid payment, never one it tried and gave up.
    expect((stripe.callsOf("refunds.create").at(-1)?.args[0] as Row).payment_intent).toBe(first.intent);
    await refundOf({ ...subscription, reference: first.invoice }, 1_000, `renewal-${first.invoice}`);
    expect((stripe.callsOf("refunds.create").at(-1)?.args[0] as Row).payment_intent).toBe(first.intent);
  });

  it("says Stripe's status in three words: done, on its way, or failed", async () => {
    const payment = await opened(store, 3);
    stripe.pay(payment.reference, buyer);
    const said: string[] = [];
    try {
      for (const status of ["pending", "requires_action", "failed", "canceled", "succeeded"]) {
        stripe.refundAnswer.status = status;
        said.push((await refundOf(payment, 100, `status-${status}-${payment.orderId}`)).status);
      }
    } finally {
      stripe.refundAnswer.status = "succeeded";
    }
    expect(said).toEqual(["pending", "pending", "failed", "failed", "succeeded"]);
  });

  it("refuses in staff's words when there is nothing to refund, no account, or Stripe cannot be reached, and never on another account", async () => {
    const unpaid = await opened();
    await expect(refundOf(unpaid, 100)).rejects.toThrow("Stripe has no payment to refund for this order.");
    await expect(refundOf({ ...unpaid, account: null }, 100)).rejects.toThrow("Stripe cannot be reached for this store right now.");
    await expect(refundOf({ ...unpaid, mode: null }, 100)).rejects.toThrow(PaymentProviderRefusal);
    const paid = await opened();
    const session = stripe.pay(paid.reference, buyer);
    stripe.failNext.set("refunds.create", new Error("socket hang up"));
    await expect(refundOf(paid, 100)).rejects.toThrow(/^Stripe could not make the refund\.$/);
    // The payment intent is the store's: asked on another account, Stripe has no such payment, and no money moves.
    await expect(refundOf({ ...paid, account: other.account }, 100)).rejects.toThrow(/^Stripe said: No such checkout\.session/);
    expect(stripe.intents.get(String(session.payment_intent))?.refunded).toBe(0);
  });
});
