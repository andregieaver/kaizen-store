import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import { cancelUnpaidOrder, placeOrder } from "./checkout";
import { sendOrderConfirmation } from "./shopper-emails";
import { applySession } from "./stripe-webhooks";
import { getSubscription, listSubscriptions, renewSubscription, syncSubscription } from "./subscriptions";

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let monthly: string;
let fortnightly: string;

/** A store copied from the template, with purchase options on the notebook (D25). */
beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`subs-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`subs-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const plans = await db().execute<Row>(sql`
    insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent, position)
    select store_id, id, x.interval::commerce.plan_interval, x.n, x.pct, x.pos
    from commerce.products, (values ('month', 1, 10, 0), ('week', 2, 0, 1)) as x(interval, n, pct, pos)
    where store_id = ${storeId}::uuid and handle = 'demo-notatbok'
    order by x.pos
    returning id
  `);
  [monthly, fortnightly] = plans.map((p) => String(p.id));
});

afterAll(async () => {
  await closeDb();
});

async function cart(lines: [string, number, string | null][]): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  for (const [sku, quantity, plan] of lines) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, selling_plan_id)
      select ${storeId}::uuid, ${String(row.id)}::uuid, id, ${quantity}, ${plan}::uuid
      from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
    `);
  }
  return String(row.id);
}

const onHand = async (sku: string) => {
  const [row] = await db().execute<Row>(sql`
    select l.on_hand from commerce.inventory_levels l
    join commerce.product_variants v on v.id = l.variant_id
    where v.store_id = ${storeId}::uuid and v.sku = ${sku}
  `);
  return Number(row.on_hand);
};

describe("placing a subscription order", () => {
  it("needs the shopper's agreement, and one schedule per checkout", async () => {
    const one = await cart([["DEMO-NOTEBOOK-LINED", 1, monthly]]);
    expect(await placeOrder({ storeId, market: no }, one)).toEqual({ ok: false, problem: "subscription_consent" });

    const mixed = await cart([
      ["DEMO-NOTEBOOK-LINED", 1, monthly],
      ["DEMO-NOTEBOOK-DOTTED", 1, fortnightly],
    ]);
    expect(await placeOrder({ storeId, market: no }, mixed, { subscription: true })).toEqual({
      ok: false,
      problem: "plans",
    });
  });

  it("prices the subscriber's lines, ships per delivery and waits for the first payment", async () => {
    const cartId = await cart([
      ["DEMO-NOTEBOOK-LINED", 2, monthly],
      ["DEMO-TOTE", 1, null],
    ]);
    const result = await placeOrder({ storeId, market: no }, cartId, { subscription: true });
    if (!result.ok) throw new Error(result.problem);
    const { order } = result;
    // 129,00 less 10 % = 116,10 each; the tote is bought once.
    expect(order.lines).toEqual([
      { title: "Demo: Handlenett i lerret", unitPriceMinor: 19900, quantity: 1, recurring: false },
      { title: "Demo: Notatbok A5 (lined)", unitPriceMinor: 11610, quantity: 2, recurring: true },
    ]);
    expect(order.subscription).toMatchObject({ interval: "month", intervalCount: 1, shippingMinor: 9900 });
    expect(order.shippingMinor).toBe(9900);

    const subscription = await getSubscription(storeId, order.subscription!.id);
    expect(subscription).toMatchObject({
      status: "pending",
      number: order.number,
      subtotalMinor: 23220,
      shippingMinor: 9900,
      totalMinor: 33120,
      lines: [{ sku: "DEMO-NOTEBOOK-LINED", quantity: 2, unitPriceMinor: 11610 }],
    });
    expect(subscription!.manageToken).toMatch(/^[0-9a-f]{64}$/);
    const lines = await db().execute<Row>(sql`
      select sku, plan_interval, plan_interval_count from commerce.order_lines
      where order_id = ${order.orderId}::uuid order by sku
    `);
    expect(lines).toEqual([
      { sku: "DEMO-NOTEBOOK-LINED", plan_interval: "month", plan_interval_count: 1 },
      { sku: "DEMO-TOTE", plan_interval: null, plan_interval_count: null },
    ]);
    // Never listed for staff until it starts.
    expect((await listSubscriptions(storeId)).map((s) => s.id)).not.toContain(order.subscription!.id);
  });

  it("does not sell a subscription-only product once, nor through an option switched off", async () => {
    await db().execute(sql`update commerce.products set subscription_only = true where store_id = ${storeId}::uuid and handle = 'demo-notatbok'`);
    const once = await cart([["DEMO-NOTEBOOK-DOTTED", 1, null]]);
    expect(await placeOrder({ storeId, market: no }, once)).toEqual({ ok: false, problem: "unavailable" });
    await db().execute(sql`update commerce.products set subscription_only = false where store_id = ${storeId}::uuid and handle = 'demo-notatbok'`);

    await db().execute(sql`update commerce.selling_plans set active = false where id = ${fortnightly}::uuid`);
    const off = await cart([["DEMO-NOTEBOOK-DOTTED", 1, fortnightly]]);
    expect(await placeOrder({ storeId, market: no }, off, { subscription: true })).toEqual({
      ok: false,
      problem: "unavailable",
    });
    await db().execute(sql`update commerce.selling_plans set active = true where id = ${fortnightly}::uuid`);
  });

  it("marks a subscription whose checkout was never paid as never started", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart([["DEMO-NOTEBOOK-LINED", 1, monthly]]), {
      subscription: true,
    });
    if (!result.ok) throw new Error(result.problem);
    await cancelUnpaidOrder(result.order.orderId, "checkout expired");
    expect((await getSubscription(storeId, result.order.subscription!.id))?.status).toBe("expired");
  });
});

describe("a subscription's life", () => {
  let subscriptionId: string;
  let orderId: string;
  const session = `cs_sub_${run}`;
  const reference = `sub_${run}`;

  beforeAll(async () => {
    const result = await placeOrder({ storeId, market: no }, await cart([["DEMO-NOTEBOOK-LINED", 1, monthly]]), {
      subscription: true,
    });
    if (!result.ok) throw new Error(result.problem);
    subscriptionId = result.order.subscription!.id;
    orderId = result.order.orderId;
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency)
      values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${session}, 'acct_sub', ${result.order.totalMinor}, 'NOK')
    `);
  });

  it("learns Stripe's subscription by Kaizen's id, even before the checkout event", async () => {
    await syncSubscription(storeId, {
      id: reference,
      status: "incomplete",
      metadata: { subscription_id: subscriptionId },
      cancel_at_period_end: false,
      ended_at: null,
      items: { data: [{ current_period_end: 1_900_000_000 }] },
    } as unknown as Stripe.Subscription);
    expect(await getSubscription(storeId, subscriptionId)).toMatchObject({
      status: "pending",
      currentPeriodEnd: new Date(1_900_000_000_000).toISOString(),
    });
  });

  it("starts when the first payment is in, with the customer's details", async () => {
    await applySession(storeId, {
      id: session,
      object: "checkout.session",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: reference,
      customer_details: {
        email: "kari@example.com",
        name: "Kari Nordmann",
        address: { line1: "Storgata 1", postal_code: "0155", city: "Oslo", country: "NO" },
      },
    } as unknown as Stripe.Checkout.Session);
    const subscription = await getSubscription(storeId, subscriptionId);
    expect(subscription).toMatchObject({ status: "active", email: "kari@example.com" });
    expect(subscription!.orders).toHaveLength(1);
    expect((await listSubscriptions(storeId)).map((s) => s.id)).toContain(subscriptionId);
  });

  it("emails the order confirmation once, with the subscription's terms (D26)", async () => {
    // The session applied again (webhook and return page) sends nothing more.
    await applySession(storeId, {
      id: session,
      object: "checkout.session",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: reference,
      customer_details: { email: "kari@example.com", name: "Kari Nordmann", address: { line1: "Storgata 1", postal_code: "0155", city: "Oslo", country: "NO" } },
    } as unknown as Stripe.Checkout.Session);
    const emails = await db().execute<Row>(sql`
      select kind, to_address, subject, status, text from commerce.email_messages where order_id = ${orderId}::uuid
    `);
    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ kind: "order.confirmation", to_address: "kari@example.com", status: "logged" });
    expect(String(emails[0].subject)).toMatch(/^Ordrebekreftelse \d+ fra /);
    expect(String(emails[0].text)).toContain("Abonnement: fornyes hver måned");
    expect(String(emails[0].text)).toContain("/subscription/");
  });

  it("turns each paid renewal into a paid order that draws stock, once per invoice", async () => {
    const before = await onHand("DEMO-NOTEBOOK-LINED");
    const invoice = {
      id: `in_${run}`,
      billing_reason: "subscription_cycle",
      amount_paid: 21510,
      parent: { subscription_details: { subscription: reference } },
      lines: { data: [{ period: { end: 1_902_600_000 } }] },
    } as unknown as Stripe.Invoice;
    const renewal = await renewSubscription(storeId, invoice);
    expect(renewal).not.toBeNull();
    expect(await renewSubscription(storeId, invoice)).toBe(renewal);
    // The renewal's receipt names it as such.
    expect(await sendOrderConfirmation(storeId, renewal!)).toBe("logged");
    expect(await sendOrderConfirmation(storeId, renewal!)).toBe("duplicate");

    const [order] = await db().execute<Row>(sql`select * from commerce.orders where id = ${renewal}::uuid`);
    expect(order).toMatchObject({
      status: "paid",
      subscription_id: subscriptionId,
      email: "kari@example.com",
      subtotal_minor: "11610",
      shipping_minor: "9900",
      total_minor: "21510",
    });
    expect(order.shipping_address).toMatchObject({ city: "Oslo" });
    expect(await onHand("DEMO-NOTEBOOK-LINED")).toBe(before - 1);
    expect(await getSubscription(storeId, subscriptionId)).toMatchObject({
      currentPeriodEnd: new Date(1_902_600_000_000).toISOString(),
    });

    // The first invoice is the checkout's own.
    expect(
      await renewSubscription(storeId, { ...invoice, id: `in_first_${run}`, billing_reason: "subscription_create" }),
    ).toBeNull();
  });

  it("follows cancellation in Stripe", async () => {
    const stripeSub = (fields: Record<string, unknown>) =>
      ({ id: reference, metadata: {}, items: { data: [{ current_period_end: 1_902_600_000 }] }, ...fields }) as unknown as Stripe.Subscription;
    await syncSubscription(storeId, stripeSub({ status: "active", cancel_at_period_end: true, ended_at: null }));
    expect(await getSubscription(storeId, subscriptionId)).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
    await syncSubscription(storeId, stripeSub({ status: "canceled", cancel_at_period_end: false, ended_at: 1_902_600_000 }));
    expect(await getSubscription(storeId, subscriptionId)).toMatchObject({
      status: "cancelled",
      cancelledAt: new Date(1_902_600_000_000).toISOString(),
    });
  });
});

describe("new stores", () => {
  it("copy the template's purchase options", async () => {
    await db().execute(sql`
      insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
      select p.store_id, p.id, 'month', 3, 15 from commerce.products p
      join commerce.stores s on s.id = p.store_id and s.is_template
      where p.handle = 'demo-notatbok'
        and not exists (select 1 from commerce.selling_plans sp where sp.product_id = p.id)
    `);
    const [request] = await db().execute<Row>(sql`
      insert into commerce.access_requests (email, name, store_name)
      values (${`copy-${run}@example.com`}, 'Test', 'Test') returning id
    `);
    const [store] = await db().execute<Row>(sql`
      select commerce.approve_access_request(${String(request.id)}::uuid, ${`copy-${run}`}, 'Test', null) as id
    `);
    const plans = await db().execute<Row>(sql`
      select interval, interval_count, discount_percent from commerce.selling_plans where store_id = ${String(store.id)}::uuid
    `);
    expect(plans).toContainEqual({ interval: "month", interval_count: 3, discount_percent: 15 });
  });
});
