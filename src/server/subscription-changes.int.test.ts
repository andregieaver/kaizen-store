import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { addPeriods } from "@/lib/subscriptions";

type Row = Record<string, unknown>;

/**
 * A stand-in for Stripe's subscription on the store's account (D29): it
 * keeps what it is told, as Stripe would, and records each call.
 */
const fake = vi.hoisted(() => {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  let products = 0;
  const state = {
    id: "",
    status: "active",
    metadata: {} as Record<string, string>,
    cancel_at_period_end: false,
    cancel_at: null as number | null,
    pause_collection: null as { behavior: string; resumes_at: number | null } | null,
    trial_end: null as number | null,
    ended_at: null as number | null,
    items: {
      data: [] as { id: string; quantity: number; current_period_end: number; price: Record<string, unknown> }[],
    },
  };
  const client = {
    subscriptions: {
      retrieve: async (id: string, params: Record<string, unknown>) => {
        calls.push({ method: "retrieve", params: { id, ...params } });
        return structuredClone(state);
      },
      update: async (id: string, params: Record<string, unknown>, options: { stripeAccount?: string }) => {
        if (!options?.stripeAccount) throw new Error("no connected account");
        calls.push({ method: "update", params });
        if ("pause_collection" in params) {
          state.pause_collection = params.pause_collection === "" ? null : (params.pause_collection as typeof state.pause_collection);
        }
        if ("cancel_at_period_end" in params) {
          state.cancel_at_period_end = Boolean(params.cancel_at_period_end);
          state.cancel_at = null;
        }
        if ("cancel_at" in params) state.cancel_at = params.cancel_at === "" ? null : (params.cancel_at as number);
        if (params.items) {
          const periodEnd = state.items.data[0]?.current_period_end ?? 0;
          state.items.data = (params.items as Record<string, unknown>[])
            .filter((item) => !item.deleted)
            .map((item, i) => ({
              id: `si_new_${calls.length}_${i}`,
              quantity: Number(item.quantity),
              current_period_end: periodEnd,
              price: {
                unit_amount: (item.price_data as Record<string, unknown>).unit_amount,
                product: { id: (item.price_data as Record<string, unknown>).product, name: "", deleted: false },
              },
            }));
        }
        return structuredClone(state);
      },
      cancel: async () => {
        calls.push({ method: "cancel", params: {} });
        state.status = "canceled";
        state.ended_at = Math.floor(Date.now() / 1000);
        return structuredClone(state);
      },
    },
    products: {
      create: async (params: { name: string }) => {
        calls.push({ method: "products.create", params });
        return { id: `prod_${++products}`, name: params.name };
      },
    },
  };
  return { client, calls, state };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const { placeOrder, subscriptionShipping } = await import("./checkout");
const { applySession } = await import("./stripe-webhooks");
const { sendSubscriptionChanged } = await import("./shopper-emails");
const { sendDueReminders } = await import("./subscription-reminders");
const { allowedChanges, changeSubscription, changeSubscriptionContents, getSubscription, swapChoices, syncSubscription } =
  await import("./subscriptions");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const accountId = `acct_chg${run}`;
const DAY = 86_400;
let storeId: string;
let monthly: string;
let trial: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`chg-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`chg-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${accountId}, 'active', false)
  `);
  const plans = await db().execute<Row>(sql`
    insert into commerce.selling_plans (
      store_id, product_id, interval, interval_count, discount_percent, trial_days, signup_fee, min_cycles, position
    )
    select store_id, id, 'month', 1, 10, x.trial, x.fee::jsonb, x.cycles, x.pos
    from commerce.products, (values (0, '{}', 3, 0), (14, '{"NO": 4900}', 0, 1)) as x(trial, fee, cycles, pos)
    where store_id = ${storeId}::uuid and handle = 'demo-notatbok'
    order by x.pos
    returning id
  `);
  [monthly, trial] = plans.map((p) => String(p.id));
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

describe("a free trial with a sign-up fee", () => {
  it("charges the fee now, what renews after the trial, and ships the first delivery free", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart([["DEMO-NOTEBOOK-LINED", 1, trial]]), {
      subscription: true,
    });
    if (!result.ok) throw new Error(result.problem);
    const { order } = result;
    // Stripe gets the full price of what renews, and starts charging it when the trial ends.
    expect(order.lines).toContainEqual(expect.objectContaining({ unitPriceMinor: 11610, recurring: true }));
    expect(order.lines).toContainEqual(expect.objectContaining({ unitPriceMinor: 4900, recurring: false }));
    expect(order.subscription).toMatchObject({ trialDays: 14, shippingMinor: 9900 });
    expect(order).toMatchObject({ shippingMinor: 0, totalMinor: 4900 });
    // Shipping renews with each delivery; nothing extra now.
    expect(subscriptionShipping(order, "nok", "Frakt")).toEqual([
      expect.objectContaining({ price_data: expect.objectContaining({ unit_amount: 9900, recurring: expect.anything() }) }),
    ]);

    const lines = await db().execute<Row>(sql`
      select sku, variant_id, unit_price_minor, delivery from commerce.order_lines
      where order_id = ${order.orderId}::uuid order by sku
    `);
    expect(lines).toEqual([
      { sku: "DEMO-NOTEBOOK-LINED", variant_id: expect.any(String), unit_price_minor: "0", delivery: "physical" },
      { sku: "SIGNUP-FEE", variant_id: null, unit_price_minor: "4900", delivery: "digital" },
    ]);
    const subscription = await getSubscription(storeId, order.subscription!.id);
    expect(subscription).toMatchObject({ subtotalMinor: 11610, shippingMinor: 9900, totalMinor: 21510 });
  });
});

describe("changing a running subscription", () => {
  let subscriptionId: string;
  const reference = `sub_chg_${run}`;
  const periodEnd = Math.floor(Date.now() / 1000) + 20 * DAY;

  beforeAll(async () => {
    const result = await placeOrder({ storeId, market: no }, await cart([["DEMO-NOTEBOOK-LINED", 1, monthly]]), {
      subscription: true,
    });
    if (!result.ok) throw new Error(result.problem);
    subscriptionId = result.order.subscription!.id;
    const session = `cs_chg_${run}`;
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency)
      values (${storeId}::uuid, ${result.order.orderId}::uuid, 'stripe', ${session}, ${accountId}, ${result.order.totalMinor}, 'NOK')
    `);
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
    Object.assign(fake.state, { id: reference, metadata: { subscription_id: subscriptionId } });
    fake.state.items.data = [
      {
        id: "si_notebook",
        quantity: 1,
        current_period_end: periodEnd,
        price: { product: { id: "prod_notebook", name: "Demo: Notatbok A5 (lined)", deleted: false } },
      },
      {
        id: "si_shipping",
        quantity: 1,
        current_period_end: periodEnd,
        price: { product: { id: "prod_shipping", name: "Frakt", deleted: false } },
      },
    ];
    await syncSubscription(storeId, structuredClone(fake.state) as unknown as Stripe.Subscription);
  });

  const lastUpdate = () => fake.calls.filter((c) => c.method === "update").at(-1)!.params;

  it("knows its commitment: three payments, one made", async () => {
    const subscription = await getSubscription(storeId, subscriptionId);
    expect(subscription).toMatchObject({ status: "active", minCycles: 3, paidCycles: 1, pausedUntil: null });
    expect(subscription!.nextChargeAt).toBe(new Date(periodEnd * 1000).toISOString());
    // Two more payments: the next, and the one a month later, whose period ends two months on.
    const end = addPeriods(new Date(periodEnd * 1000), "month", 1, 2);
    expect(subscription!.commitmentEndsAt).toBe(end.toISOString());
    expect(allowedChanges(subscription!)).toEqual({
      cancel: true,
      resume: false,
      pause: true,
      skip: true,
      unpause: false,
      contents: true,
    });
  });

  it("skips the next delivery, and ends the pause again", async () => {
    const skipped = await changeSubscription(storeId, subscriptionId, "skip");
    if (!skipped.ok) throw new Error(skipped.problem);
    expect(lastUpdate()).toEqual({ pause_collection: { behavior: "void", resumes_at: periodEnd + DAY } });
    expect(skipped.subscription.status).toBe("paused");
    const next = addPeriods(new Date(periodEnd * 1000), "month", 1, 1);
    expect(skipped.subscription.nextChargeAt).toBe(next.toISOString());
    expect(await sendSubscriptionChanged(storeId, skipped.subscription, "skip")).toBe("logged");

    const resumed = await changeSubscription(storeId, subscriptionId, "unpause");
    if (!resumed.ok) throw new Error(resumed.problem);
    expect(lastUpdate()).toEqual({ pause_collection: "" });
    expect(resumed.subscription).toMatchObject({ status: "active", pausedUntil: null });
  });

  it("pauses for up to three deliveries", async () => {
    expect(await changeSubscription(storeId, subscriptionId, "pause", { periods: 4 })).toEqual({
      ok: false,
      problem: "invalid",
    });
    const paused = await changeSubscription(storeId, subscriptionId, "pause", { periods: 2 });
    if (!paused.ok) throw new Error(paused.problem);
    const third = addPeriods(new Date(periodEnd * 1000), "month", 1, 2);
    expect(paused.subscription.nextChargeAt).toBe(third.toISOString());
    // Already paused: not again, but one more delivery can be skipped (three in all).
    expect(allowedChanges(paused.subscription)).toMatchObject({ pause: false, skip: true, unpause: true });
    await changeSubscription(storeId, subscriptionId, "unpause");
  });

  it("cancels when the commitment is met, and takes it back", async () => {
    const cancelled = await changeSubscription(storeId, subscriptionId, "cancel");
    if (!cancelled.ok) throw new Error(cancelled.problem);
    const end = addPeriods(new Date(periodEnd * 1000), "month", 1, 2);
    expect(lastUpdate()).toEqual({ cancel_at: end.getTime() / 1000, proration_behavior: "none" });
    expect(cancelled.subscription.endsAt).toBe(end.toISOString());
    expect(allowedChanges(cancelled.subscription)).toMatchObject({ resume: true, pause: false, contents: false });

    const kept = await changeSubscription(storeId, subscriptionId, "resume");
    if (!kept.ok) throw new Error(kept.problem);
    expect(lastUpdate()).toEqual({ cancel_at: "" });
    expect(kept.subscription.endsAt).toBeNull();
  });

  it("lets only staff end it at once", async () => {
    expect(await changeSubscription(storeId, subscriptionId, "cancel_now")).toEqual({ ok: false, problem: "not_allowed" });
  });

  it("swaps a variant and changes the quantity from the next renewal", async () => {
    const subscription = (await getSubscription(storeId, subscriptionId))!;
    const [line] = subscription.lines;
    const choices = (await swapChoices(storeId, subscriptionId)).get(line.id)!;
    const dotted = choices.find((c) => c.sku === "DEMO-NOTEBOOK-DOTTED")!;
    expect(dotted).toMatchObject({ unitPriceMinor: 11610 });

    // Removing the only line is cancelling, not a change.
    expect(
      await changeSubscriptionContents(storeId, subscriptionId, [{ lineId: line.id, variantId: line.variantId!, quantity: 0 }]),
    ).toEqual({ ok: false, problem: "invalid" });
    // Not another product's variant.
    const [tote] = await db().execute<Row>(sql`
      select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'
    `);
    expect(
      await changeSubscriptionContents(storeId, subscriptionId, [{ lineId: line.id, variantId: String(tote.id), quantity: 1 }]),
    ).toEqual({ ok: false, problem: "invalid" });

    const changed = await changeSubscriptionContents(storeId, subscriptionId, [
      { lineId: line.id, variantId: dotted.variantId, quantity: 3 },
    ]);
    if (!changed.ok) throw new Error(changed.problem);
    expect(changed.changed).toBe(true);
    expect(changed.subscription).toMatchObject({
      subtotalMinor: 34830,
      shippingMinor: 9900,
      totalMinor: 44730,
      lines: [{ sku: "DEMO-NOTEBOOK-DOTTED", quantity: 3, unitPriceMinor: 11610, totalMinor: 34830 }],
    });
    const update = lastUpdate();
    expect(update.proration_behavior).toBe("none");
    expect(update.items).toEqual([
      { id: "si_notebook", deleted: true },
      { id: "si_shipping", deleted: true },
      {
        quantity: 3,
        price_data: {
          currency: "nok",
          product: expect.stringMatching(/^prod_\d+$/),
          unit_amount: 11610,
          recurring: { interval: "month", interval_count: 1 },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "nok",
          product: "prod_shipping",
          unit_amount: 9900,
          recurring: { interval: "month", interval_count: 1 },
        },
      },
    ]);
    // The same again changes nothing.
    const again = await changeSubscriptionContents(storeId, subscriptionId, [
      { lineId: line.id, variantId: dotted.variantId, quantity: 3 },
    ]);
    expect(again).toMatchObject({ ok: true, changed: false });
  });

  it("follows a free trial, a pause and a commitment's end from Stripe", async () => {
    const trialEnd = Math.floor(Date.now() / 1000) + 5 * DAY;
    await syncSubscription(storeId, {
      ...structuredClone(fake.state),
      trial_end: trialEnd,
      pause_collection: { behavior: "void", resumes_at: periodEnd + DAY },
      cancel_at: periodEnd + 40 * DAY,
    } as unknown as Stripe.Subscription);
    expect(await getSubscription(storeId, subscriptionId)).toMatchObject({
      status: "paused",
      trialEndsAt: new Date(trialEnd * 1000).toISOString(),
      pausedUntil: new Date((periodEnd + DAY) * 1000).toISOString(),
      endsAt: new Date((periodEnd + 40 * DAY) * 1000).toISOString(),
      nextChargeAt: null,
    });
    await syncSubscription(storeId, structuredClone(fake.state) as unknown as Stripe.Subscription);
  });

  it("reminds before renewal, once per charge (D29)", async () => {
    // The renewal is 20 days away: too early. Five days before it, due.
    const count = async () => {
      const [row] = await db().execute<Row>(sql`
        select count(*)::int as n from commerce.email_messages
        where subscription_id = ${subscriptionId}::uuid and kind = 'subscription.renewal_reminder'
      `);
      return Number(row.n);
    };
    await sendDueReminders();
    expect(await count()).toBe(0);
    const soon = new Date((periodEnd - 5 * DAY) * 1000);
    await sendDueReminders(soon);
    await sendDueReminders(soon);
    expect(await count()).toBe(1);
    const [email] = await db().execute<Row>(sql`
      select to_address, subject, text from commerce.email_messages
      where subscription_id = ${subscriptionId}::uuid and kind = 'subscription.renewal_reminder'
    `);
    expect(email.to_address).toBe("kari@example.com");
    expect(String(email.subject)).toMatch(/^Abonnementet ditt hos .+ fornyes /);
    expect(String(email.text)).toContain("447,30");
  });
});
