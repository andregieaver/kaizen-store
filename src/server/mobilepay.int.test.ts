import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket, type Market } from "@/lib/markets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

/**
 * Kaizena Flow's platform Stripe client, faked: it records every Checkout session it is asked to open, answers a session's PaymentIntent with the charge
 * a test sets (Stripe's `payment_method_details.type`), and takes refunds.
 */
const fake = vi.hoisted(() => {
  const created: { params: Record<string, unknown> }[] = [];
  const charges = new Map<string, { id: string; payment_method_details: unknown; outcome: unknown }>();
  const refunds: Record<string, unknown>[] = [];
  let next = 0;
  const client = {
    paymentMethodDomains: { create: async () => ({ id: "pmd", enabled: true }), list: async () => ({ data: [{ id: "pmd" }] }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>) => {
          const id = `cs_mp_${++next}`;
          created.push({ params });
          return params.ui_mode === "elements" ? { id, url: null, client_secret: `${id}_secret` } : { id, url: `https://checkout.stripe.test/${id}`, client_secret: null };
        },
        retrieve: async (id: string) => ({ id, status: "open", payment_status: "unpaid", payment_intent: { id: `pi_${id}`, latest_charge: charges.get(id) ?? null }, invoice: null }),
        expire: async (id: string) => ({ id }),
        list: async () => ({ data: [] }),
      },
    },
    paymentIntents: { retrieve: async () => null },
    charges: { retrieve: async () => null },
    invoicePayments: { list: async () => ({ data: [] }) },
    refunds: {
      create: async (params: Record<string, unknown>) => {
        refunds.push(params);
        return { id: `re_mp_${refunds.length}`, status: "succeeded" };
      },
    },
  };
  return { client, created, charges, refunds };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const fx = await import("./invoice-test-fixture");
const { startCheckout } = await import("./checkout");
const { saveMethodChoices } = await import("./payment-methods");
const { applySession } = await import("./stripe-webhooks");
const { readPaymentFacts } = await import("./payment-facts");
const { refundOrder } = await import("./order-admin");
const { getOrder } = await import("./orders");
const rules = await import("./checkout-rules");

type Row = Record<string, unknown>;

/**
 * MobilePay (wave 11 unit H, D387): what Kaizena Flow sends Stripe for a Danish and a Finnish checkout (MobilePay is not left out) and for one where the
 * owner or a checkout rule leaves it out (named in `excluded_payment_method_types`, never `payment_method_types`); a payment Stripe reports as MobilePay
 * ends as a paid order whose method is MobilePay, and its refund is recorded. Which methods Stripe then shows the shopper is Stripe's.
 */

const dk: Market = toMarket({ code: "DK", currency: "DKK", defaultLocale: "da-DK" });
const fi: Market = toMarket({ code: "FI", currency: "EUR", defaultLocale: "en-GB" });
let own: Awaited<ReturnType<typeof fx.makeStore>>;

beforeAll(async () => {
  own = await fx.makeStore("mobilepay");
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values (${own.storeId}::uuid, 'FI', 'EUR', 'en-GB', array['en-GB'], true)
    on conflict do nothing
  `);
  await db().execute(sql`
    select commerce.set_price(v.id, 'FI', 2900, now()) from commerce.product_variants v where v.store_id = ${own.storeId}::uuid and v.sku = 'DEMO-MUG-WHITE'
  `);
  await db().execute(sql`insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor) values (${own.storeId}::uuid, 'FI', 'EUR', 590) on conflict do nothing`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

async function cartIn(market: Market): Promise<string> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${own.storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${own.storeId}::uuid, ${String(cart.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${own.storeId}::uuid and sku = 'DEMO-MUG-WHITE'
  `);
  return String(cart.id);
}

/** The session a checkout in this market opened, and its order. */
async function checkoutIn(market: Market) {
  const before = fake.created.length;
  const result = await startCheckout({ storeId: own.storeId, storeSlug: own.slug, market }, await cartIn(market), "https://shop.test", "Fragt");
  expect(result).toMatchObject({ ok: true });
  expect(fake.created.length).toBe(before + 1);
  const [order] = await db().execute<Row>(sql`select id from commerce.orders where store_id = ${own.storeId}::uuid order by placed_at desc limit 1`);
  return { params: fake.created.at(-1)!.params, orderId: String(order.id) };
}

describe("what a checkout sends Stripe", () => {
  it("leaves MobilePay in a Danish and a Finnish checkout, naming no methods to offer", async () => {
    for (const market of [dk, fi]) {
      const { params } = await checkoutIn(market);
      expect(params).not.toHaveProperty("payment_method_types");
      expect((params.excluded_payment_method_types as string[] | undefined) ?? []).not.toContain("mobilepay");
    }
  });

  it("leaves it out where the owner switched it off for a country, and where a checkout rule hides it", async () => {
    const all = ["link", "klarna", "ideal", "bancontact", "eps", "p24", "blik", "sepa_debit", "card"];
    expect(await saveMethodChoices(own.storeId, own.ownerId, { markets: ["NO"], on: new Set(all.map((m) => `NO:${m}`)) })).toEqual({ changed: 1 });
    expect((await checkoutIn(fx.no)).params.excluded_payment_method_types).toEqual(["mobilepay"]);
    // Denmark keeps it until a rule hides it there.
    expect((await checkoutIn(dk)).params.excluded_payment_method_types ?? []).not.toContain("mobilepay");
    const member = await fx.ownerOf(own);
    const saved = await rules.saveCheckoutRule(member, null, {
      name: "No MobilePay in Denmark",
      conditions: [{ kind: "country", op: "is", countries: ["DK"] }],
      effect: { kind: "hide_payment_method", methods: ["mobilepay"] },
    });
    if (!saved.ok) throw new Error(saved.problems.join("; "));
    expect(await rules.switchCheckoutRule(member, saved.id, true)).toBe(true);
    expect((await checkoutIn(dk)).params.excluded_payment_method_types).toContain("mobilepay");
    expect(await rules.switchCheckoutRule(member, saved.id, false)).toBe(true);
  });
});

describe("a MobilePay payment", () => {
  it("ends as a paid order whose method is MobilePay, and its refund is recorded", async () => {
    const { orderId } = await checkoutIn(dk);
    const [payment] = await db().execute<Row>(sql`select provider_reference, amount_minor from commerce.payments where store_id = ${own.storeId}::uuid and order_id = ${orderId}::uuid`);
    const session = String(payment.provider_reference);
    const complete = { id: session, status: "complete", payment_status: "paid", mode: "payment", payment_intent: `pi_${session}`, customer_details: null } as unknown as Stripe.Checkout.Session;
    await applySession(own.storeId, complete, "checkout.session.completed");
    expect((await getOrder(own.storeId, orderId))?.status).toBe("paid");

    fake.charges.set(session, { id: `ch_${session}`, payment_method_details: { type: "mobilepay", mobilepay: {} }, outcome: { risk_level: "normal", risk_score: 12 } });
    expect(await readPaymentFacts(own.storeId, session)).toBe("read");
    const [facts] = await db().execute<Row>(sql`select method_type, wallet, status from commerce.payments where provider_reference = ${session}`);
    expect(facts).toMatchObject({ method_type: "mobilepay", wallet: null, status: "captured" });

    const amount = Number(payment.amount_minor);
    const done = await refundOrder(own.storeId, orderId, { amountMinor: amount, reason: "Changed mind", restock: [] }, own.ownerId);
    expect(done).toMatchObject({ ok: true });
    expect(fake.refunds.at(-1)).toMatchObject({ amount });
    const [refund] = await db().execute<Row>(sql`
      select r.amount_minor, r.status from commerce.refunds r join commerce.payments p on p.id = r.payment_id where p.provider_reference = ${session}
    `);
    expect(refund).toMatchObject({ status: "succeeded" });
    expect(Number(refund.amount_minor)).toBe(amount);
  });
});
