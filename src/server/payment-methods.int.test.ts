import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket, type Market } from "@/lib/markets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/** Kaizena Flow's platform Stripe client, faked: it records every session it is asked to open. */
const fake = vi.hoisted(() => {
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  let next = 0;
  const client = {
    paymentMethodDomains: { create: async () => ({ id: "pmd", enabled: true }), list: async () => ({ data: [{ id: "pmd" }] }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_pm_${++next}`;
          created.push({ params, options });
          return params.ui_mode === "elements" ? { id, url: null, client_secret: `${id}_secret` } : { id, url: `https://checkout.stripe.test/${id}`, client_secret: null };
        },
        retrieve: async (id: string) => ({ id, status: "open", payment_status: "unpaid" }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client, created };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { startCheckout } = await import("./checkout");
const { saveMethodChoices, methodChoices } = await import("./payment-methods");
const { applySession } = await import("./stripe-webhooks");
const { getOrder } = await import("./orders");

type Row = Record<string, unknown>;

/**
 * Payment methods per country (wave 4 unit D, D291, `docs/wave-4-payments.md` 6), through the real server code with a faked Stripe: the owner's choice
 * per country reaches exactly that country's checkout sessions as `excluded_payment_method_types` (never `payment_method_types`), in its own currency
 * and shown in euro; and a bank payment that arrives days later keeps the order waiting with its stock held, then pays it or lets it go.
 */

afterAll(async () => {
  await closeDb();
});

const se: Market = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });

async function cartIn(storeId: string, market: Market): Promise<string> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${storeId}::uuid, ${String(cart.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE'
  `);
  return String(cart.id);
}

/** The parameters of the session a checkout in this market opened. */
async function sessionFor(own: Awaited<ReturnType<typeof fx.makeStore>>, market: Market) {
  const before = fake.created.length;
  const cartId = await cartIn(own.storeId, market);
  const result = await startCheckout({ storeId: own.storeId, storeSlug: own.slug, market }, cartId, "https://shop.test", "Frakt");
  expect(result).toMatchObject({ ok: true });
  expect(fake.created.length).toBe(before + 1);
  return fake.created.at(-1)!.params;
}

describe("methods per country", () => {
  it("leaves out of a country's checkout exactly what its owner switched off there, never naming the methods to offer", async () => {
    const own = await fx.makeStore("pm-country");
    // Everything on: no exclusion at all.
    const plain = await sessionFor(own, fx.no);
    expect(plain).not.toHaveProperty("excluded_payment_method_types");
    expect(plain).not.toHaveProperty("payment_method_types");

    // Klarna and SEPA Direct Debit off in Norway; Sweden as it was. A country left out of the form keeps its choice; cards cannot be switched off.
    const on = new Set(["NO:link", "NO:mobilepay", "NO:ideal", "NO:bancontact", "NO:eps", "NO:p24", "NO:blik", "NO:card"]);
    expect(await saveMethodChoices(own.storeId, own.ownerId, { markets: ["NO", "XX"], on })).toEqual({ changed: 2 });
    expect((await methodChoices(own.storeId)).filter((c) => !c.enabled).map((c) => `${c.market}:${c.method}`).sort()).toEqual(["NO:klarna", "NO:sepa_debit"]);

    const norway = await sessionFor(own, fx.no);
    expect(norway.excluded_payment_method_types).toEqual(["klarna", "sepa_debit"]);
    expect(norway).not.toHaveProperty("payment_method_types");
    // Norway shown in euro is still Norway's checkout: the same methods left out.
    const euro = await sessionFor(own, fx.noInEuro);
    expect(euro).toMatchObject({ excluded_payment_method_types: ["klarna", "sepa_debit"], line_items: [expect.objectContaining({ price_data: expect.objectContaining({ currency: "eur" }) })] });
    const sweden = await sessionFor(own, se);
    expect(sweden).not.toHaveProperty("excluded_payment_method_types");

    // Switched back on: the row says so, and the checkout leaves nothing out; saving the same again changes nothing.
    const all = new Set([...on, "NO:klarna", "NO:sepa_debit"]);
    expect(await saveMethodChoices(own.storeId, own.ownerId, { markets: ["NO"], on: all })).toEqual({ changed: 2 });
    expect(await saveMethodChoices(own.storeId, own.ownerId, { markets: ["NO"], on: all })).toEqual({ changed: 0 });
    expect(await sessionFor(own, fx.no)).not.toHaveProperty("excluded_payment_method_types");
    const [log] = await db().execute<Row>(sql`select count(*)::int as n from commerce.audit_log where store_id = ${own.storeId}::uuid and action = 'payments.methods_changed'`);
    expect(log.n).toBe(2);
  });
});

describe("a bank payment that arrives days later", () => {
  const complete = (sessionId: string, paid: boolean) =>
    ({ id: sessionId, status: "complete", payment_status: paid ? "paid" : "unpaid", mode: "payment", payment_intent: null, customer_details: null }) as unknown as Stripe.Checkout.Session;
  const held = async (orderId: string) =>
    Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.inventory_reservations where order_id = ${orderId}::uuid and released_at is null and expires_at > now() + interval '20 days'`))[0].n);

  it("keeps the order waiting for the bank with its stock held, says so, and makes it paid when the money arrives", async () => {
    const own = await fx.makeStore("pm-bank");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { pay: false });
    await applySession(own.storeId, complete(order.sessionId, false), "checkout.session.completed");
    const waiting = await getOrder(own.storeId, order.orderId);
    expect(waiting).toMatchObject({ status: "pending_payment", awaitingBank: true });
    expect(await held(order.orderId)).toBeGreaterThan(0);
    // The shopper's return applies it again: nothing more.
    await applySession(own.storeId, complete(order.sessionId, false));
    const [events] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'order.awaiting_bank'`);
    expect(events.n).toBe(1);

    await applySession(own.storeId, complete(order.sessionId, true), "checkout.session.async_payment_succeeded");
    expect(await getOrder(own.storeId, order.orderId)).toMatchObject({ status: "paid", awaitingBank: false });
  });

  it("cancels the order and lets its stock go when the bank payment fails", async () => {
    const own = await fx.makeStore("pm-bank-fail");
    const order = await fx.paidOrder(own, [["DEMO-MUG-WHITE", 1]], { pay: false });
    await applySession(own.storeId, complete(order.sessionId, false), "checkout.session.completed");
    expect(await held(order.orderId)).toBeGreaterThan(0);
    await applySession(own.storeId, complete(order.sessionId, false), "checkout.session.async_payment_failed");
    expect((await getOrder(own.storeId, order.orderId))?.status).toBe("cancelled");
    expect(await held(order.orderId)).toBe(0);
  });
});
