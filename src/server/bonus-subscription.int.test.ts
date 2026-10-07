import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { earnAmount } from "@/lib/bonus";
import { toMarket } from "@/lib/markets";

import { placeOrder } from "./checkout";
import { applySession } from "./stripe-webhooks";
import { renewSubscription } from "./subscriptions";

type Row = Record<string, unknown>;

/**
 * Subscriptions and the bonus program (D130): the first order can use credits on what is bought once next to the
 * subscription, and earns on what is paid; each paid renewal earns on what it charges, and cannot use credits (v1).
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let customerId: string;
let plan: string;

const balance = async () => {
  const [row] = await db().execute<Row>(
    sql`select * from commerce.bonus_balance(${storeId}::uuid, ${customerId}::uuid)`,
  );
  return { available: Number(row.available_minor), pending: Number(row.pending_minor) };
};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`bsub-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(
    sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`bsub-${run}`}, 'Test', null) as id`,
  );
  storeId = String(store.id);
  // The bonus program works only with its store feature on (D178).
  await db().execute(sql`update commerce.stores set features = features || array['bonus', 'subscriptions'] where id = ${storeId}::uuid`);
  const [p] = await db().execute<Row>(sql`
    insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
    select store_id, id, 'month'::commerce.plan_interval, 1, 10 from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-notatbok' returning id
  `);
  plan = String(p.id);
  await db().execute(sql`
    insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, currency)
    values (${storeId}::uuid, true, 500, 0, 50, 'NOK')
  `);
  const [customer] = await db().execute<Row>(
    sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`sub-buyer-${run}@example.com`}) returning id`,
  );
  customerId = String(customer.id);
  await db().execute(
    sql`select commerce.bonus_adjust(${storeId}::uuid, ${customerId}::uuid, 100000, 'start', null, ${`start-${run}`})`,
  );
});

afterAll(async () => {
  await closeDb();
});

describe("a subscription and credits", () => {
  it("uses credits on what is bought once, earns on what is paid, and earns on each renewal without using any", async () => {
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, customer_id, bonus_request_minor, bonus_request_currency, expires_at)
      values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', ${customerId}::uuid, 9000, 'NOK', now() + interval '1 day') returning id
    `);
    for (const [sku, quantity, sellingPlan] of [
      ["DEMO-NOTEBOOK-LINED", 1, plan],
      ["DEMO-TOTE", 1, null],
    ] as const) {
      await db().execute(sql`
        insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, selling_plan_id)
        select ${storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity}, ${sellingPlan}::uuid
        from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
      `);
    }
    const placed = await placeOrder({ storeId, market: no }, String(cart.id), { subscription: true }, { customerId });
    if (!placed.ok) throw new Error(placed.problem);
    const { order } = placed;
    // The tote (199 NOK) bought once takes the 90 NOK asked for (half of it would be 99.50); the subscriber's notebook (116.10) and shipping are paid in full.
    expect(order.creditMinor).toBe(9_000);
    expect(order.lines.find((l) => l.recurring)?.dueNowMinor).toBe(11_610);
    expect(order.lines.find((l) => !l.recurring)?.dueNowMinor).toBe(19_900 - 9_000);
    expect(order.dueNowMinor).toBe(11_610 + 19_900 + 9_900 - 9_000);
    expect(order.discount?.couponMinor).toBe(9_000);
    const [bonusLines] = await db().execute<Row>(
      sql`select sum(bonus_discount_minor)::bigint as n from commerce.order_lines where order_id = ${order.orderId}::uuid and selling_plan_id is not null`,
    );
    expect(Number(bonusLines.n)).toBe(0);
    expect((await balance()).available).toBe(91_000);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency)
      values (${storeId}::uuid, ${order.orderId}::uuid, 'stripe', ${`cs_bsub_${run}`}, 'acct_bsub', ${order.dueNowMinor}, 'NOK')
    `);
    const reference = `sub_bsub_${run}`;
    await applySession(storeId, {
      id: `cs_bsub_${run}`,
      object: "checkout.session",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: reference,
      customer_details: {
        email: "kari@example.com",
        name: "Kari",
        address: { line1: "Storgata 1", postal_code: "0155", city: "Oslo", country: "NO" },
      },
    } as unknown as Stripe.Checkout.Session);
    // It earns 5 % of what was paid for goods: the notebook's first charge and the tote less the credits.
    const first = earnAmount(11_610 + 19_900 - 9_000, 500);
    expect((await balance()).available).toBe(91_000 + first);

    // A renewal is paid by Stripe Billing: it earns on its lines (not on shipping), and used nothing.
    const renewal = await renewSubscription(storeId, {
      id: `in_bsub_${run}`,
      billing_reason: "subscription_cycle",
      amount_paid: 21_510,
      parent: { subscription_details: { subscription: reference } },
      lines: { data: [{ period: { end: 1_902_600_000 } }] },
    } as unknown as Stripe.Invoice);
    expect(renewal).not.toBeNull();
    const [lines] = await db().execute<Row>(
      sql`select coalesce(sum(total_minor - venue_minor), 0)::bigint as n from commerce.order_lines where order_id = ${renewal}::uuid`,
    );
    const entries = await db().execute<Row>(
      sql`select kind, amount_minor from commerce.bonus_entries where order_id = ${renewal}::uuid`,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "earn" });
    expect(Number(entries[0].amount_minor)).toBe(earnAmount(Number(lines.n), 500));
    expect(Number(entries[0].amount_minor)).toBeGreaterThan(0);
    const [renewed] = await db().execute<Row>(
      sql`select credit_minor from commerce.orders where id = ${renewal}::uuid`,
    );
    expect(Number(renewed.credit_minor)).toBe(0);
    // The same invoice twice earns once.
    await renewSubscription(storeId, {
      id: `in_bsub_${run}`,
      billing_reason: "subscription_cycle",
      amount_paid: 21_510,
      parent: { subscription_details: { subscription: reference } },
      lines: { data: [{ period: { end: 1_902_600_000 } }] },
    } as unknown as Stripe.Invoice);
    expect(
      await db().execute(sql`select 1 from commerce.bonus_entries where order_id = ${renewal}::uuid`),
    ).toHaveLength(1);
  });
});
