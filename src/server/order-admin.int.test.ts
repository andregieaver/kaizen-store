import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

/** A stand-in for Stripe that records refunds. */
const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  let fail = false;
  const client = {
    checkout: {
      sessions: {
        retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }),
      },
    },
    invoices: {
      retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }),
    },
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        if (fail) throw Object.assign(new Error("Charge already refunded"), { type: "StripeInvalidRequestError" });
        refunds.push({ params, options });
        return { id: `re_${refunds.length}`, status: "succeeded" };
      },
    },
  };
  return { client, refunds, setFail: (value: boolean) => (fail = value) };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { cancelOrder, getOrderAdmin, markSent, refundOrder, trackingUrl } = await import("./order-admin");
const { sendRefunded, sendShipped } = await import("./shopper-emails");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`orders-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`orders-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)
  `);
});

afterAll(async () => {
  await closeDb();
});

const onHand = async (sku: string) => {
  const [row] = await db().execute<Row>(sql`
    select l.on_hand from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id
    where v.store_id = ${storeId}::uuid and v.sku = ${sku}
  `);
  return Number(row.on_hand);
};

/** A paid order, as a Checkout session leaves it. */
async function paidOrder(sku: string, quantity: number): Promise<string> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity}
    from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
  `);
  const result = await placeOrder({ storeId, market: no }, String(cart.id));
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_${run}`}, ${totalMinor}, 'NOK', 'captured')
  `);
  await completeOrderPayment(orderId, `cs_${orderId}`);
  await db().execute(sql`
    update commerce.orders set email = 'kari@example.com',
      shipping_address = '{"name": "Kari Nordmann", "line1": "Storgata 1", "postalCode": "0155", "city": "Oslo"}'
    where id = ${orderId}::uuid
  `);
  return orderId;
}

describe("sending an order", () => {
  it("builds the carrier's tracking link, or takes the one typed", () => {
    expect(trackingUrl({ carrier: "posten", trackingNumber: "CD 123", trackingUrl: null })).toBe(
      "https://sporing.posten.no/sporing/CD%20123",
    );
    expect(trackingUrl({ carrier: "other", trackingNumber: "1", trackingUrl: "https://x.test/1" })).toBe("https://x.test/1");
    expect(trackingUrl({ carrier: "other", trackingNumber: "1", trackingUrl: "javascript:alert(1)" })).toBeNull();
  });

  it("marks a paid order as sent with its parcel, and emails the tracking once", async () => {
    const orderId = await paidOrder("DEMO-TOTE", 1);
    const shipment = await markSent(storeId, orderId, { carrier: "bring", trackingNumber: "370722", trackingUrl: null }, null);
    expect(shipment).toMatchObject({ carrier: "Bring", trackingUrl: "https://sporing.bring.no/sporing/370722" });
    expect((await getOrderAdmin(storeId, orderId))?.status).toBe("fulfilled");

    expect(await sendShipped(storeId, orderId, shipment!)).toBe("logged");
    expect(await sendShipped(storeId, orderId, shipment!)).toBe("duplicate");
    const [email] = await db().execute<Row>(sql`
      select subject, text from commerce.email_messages where order_id = ${orderId}::uuid and kind = 'order.sent'
    `);
    expect(String(email.subject)).toMatch(/^Ordre \d+ fra .+ er sendt$/);
    expect(String(email.text)).toContain("Sporing: Bring 370722");
    expect(String(email.text)).toContain("Spor pakken: https://sporing.bring.no/sporing/370722");
  });
});

describe("refunds", () => {
  it("refunds part through Stripe on the store's account and puts items back in stock", async () => {
    const orderId = await paidOrder("DEMO-MUG-WHITE", 2);
    const before = await onHand("DEMO-MUG-WHITE");
    const order = await getOrderAdmin(storeId, orderId);
    expect(order).toMatchObject({ paidMinor: 59700, refundableMinor: 59700, canRefund: true });

    const outcome = await refundOrder(
      storeId,
      orderId,
      { amountMinor: 24900, reason: "Broken in transit", restock: [{ lineId: order!.lines[0].id, quantity: 1 }] },
      null,
    );
    expect(outcome).toMatchObject({ ok: true, amountMinor: 24900 });
    const { params, options } = fake.refunds.at(-1)!;
    expect(params).toMatchObject({ payment_intent: `pi_for_cs_${orderId}`, amount: 24900, refund_application_fee: true });
    expect(options).toMatchObject({ stripeAccount: `acct_${run}` });
    expect(await onHand("DEMO-MUG-WHITE")).toBe(before + 1);

    const after = await getOrderAdmin(storeId, orderId);
    expect(after).toMatchObject({ refundedMinor: 24900, refundableMinor: 34800 });
    expect(after!.lines[0].restocked).toBe(1);
    expect(after!.refunds).toMatchObject([{ amountMinor: 24900, reason: "Broken in transit", status: "succeeded" }]);

    if (!outcome.ok) throw new Error();
    expect(await sendRefunded(storeId, orderId, outcome.refundId, 24900)).toBe("logged");
  });

  it("refuses more than is left, more stock than was bought, and says what Stripe said", async () => {
    const orderId = await paidOrder("DEMO-MUG-WHITE", 1);
    const order = await getOrderAdmin(storeId, orderId);
    expect(await refundOrder(storeId, orderId, { amountMinor: 999999, reason: "x", restock: [] }, null)).toEqual({
      ok: false,
      problem: "The amount is more than is left to refund.",
    });
    expect(
      await refundOrder(storeId, orderId, { amountMinor: 0, reason: "x", restock: [{ lineId: order!.lines[0].id, quantity: 2 }] }, null),
    ).toMatchObject({ ok: false });
    fake.setFail(true);
    expect(await refundOrder(storeId, orderId, { amountMinor: 100, reason: "x", restock: [] }, null)).toEqual({
      ok: false,
      problem: "Stripe said: Charge already refunded",
    });
    fake.setFail(false);
  });

  it("puts items back in stock without money back", async () => {
    const orderId = await paidOrder("DEMO-TOTE", 2);
    const before = await onHand("DEMO-TOTE");
    const order = await getOrderAdmin(storeId, orderId);
    const refundsBefore = fake.refunds.length;
    expect(
      await refundOrder(storeId, orderId, { amountMinor: 0, reason: "Returned", restock: [{ lineId: order!.lines[0].id, quantity: 2 }] }, null),
    ).toMatchObject({ ok: true });
    expect(fake.refunds.length).toBe(refundsBefore);
    expect(await onHand("DEMO-TOTE")).toBe(before + 2);
    expect((await getOrderAdmin(storeId, orderId))!.lines[0].restocked).toBe(2);
  });
});

describe("cancelling", () => {
  it("refunds everything left, restocks and closes a paid order", async () => {
    const orderId = await paidOrder("DEMO-NOTEBOOK-LINED", 3);
    const before = await onHand("DEMO-NOTEBOOK-LINED");
    const outcome = await cancelOrder(storeId, orderId, "Customer asked", null);
    expect(outcome).toMatchObject({ ok: true });
    const order = await getOrderAdmin(storeId, orderId);
    expect(order).toMatchObject({ status: "cancelled", refundableMinor: 0 });
    expect(await onHand("DEMO-NOTEBOOK-LINED")).toBe(before + 3);
    expect(fake.refunds.at(-1)!.params).toMatchObject({ amount: order!.paidMinor });
  });

  it("will not cancel an order that is already sent", async () => {
    const orderId = await paidOrder("DEMO-TOTE", 1);
    await markSent(storeId, orderId, { carrier: "posten", trackingNumber: "", trackingUrl: null }, null);
    expect(await cancelOrder(storeId, orderId, "x", null)).toEqual({
      ok: false,
      problem: "The order is already sent: refund it instead.",
    });
  });
});
