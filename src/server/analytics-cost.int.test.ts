import { sql } from "drizzle-orm";
import type Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import type { Membership } from "./auth";
import { saveCampaign } from "./campaigns";
import { placeOrder } from "./checkout";
import { applySession } from "./stripe-webhooks";
import type { Store } from "./stores";
import { renewSubscription } from "./subscriptions";

type Row = Record<string, unknown>;

/**
 * What a unit cost when it was sold (D152): `placeOrder()` and the subscription renewal copy the variant's cost onto each
 * order line, so a later change of the cost never rewrites an old sale, and a cost that is not known stays unknown
 * (null, never zero). The cost never reaches a price.
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let member: Membership;
const variant: Record<string, string> = {};

const setCost = (sku: string, cost: number | null) =>
  db().execute(sql`update commerce.product_variants set cost_minor = ${cost} where store_id = ${storeId}::uuid and sku = ${sku}`);

/** A cart with these lines, placed. */
async function place(lines: [sku: string, quantity: number, plan?: string][], consent: { subscription?: boolean } = {}) {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
  `);
  for (const [sku, quantity, plan] of lines) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity, selling_plan_id)
      values (${storeId}::uuid, ${String(cart.id)}::uuid, ${variant[sku]}::uuid, ${quantity}, ${plan ?? null}::uuid)
    `);
  }
  const placed = await placeOrder({ storeId, market: no }, String(cart.id), consent);
  if (!placed.ok) throw new Error(placed.problem);
  return placed.order;
}

/** An order's lines as [sku, unit cost or null], gifts and fees included. */
async function costs(orderId: string) {
  const rows = await db().execute<Row>(sql`
    select sku, unit_cost_minor, gift from commerce.order_lines where order_id = ${orderId}::uuid order by sku, gift
  `);
  return rows.map((r) => [String(r.sku), r.unit_cost_minor === null ? null : Number(r.unit_cost_minor), Boolean(r.gift)] as const);
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`cost-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`cost-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
  const rows = await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${storeId}::uuid`);
  for (const row of rows) variant[String(row.sku)] = String(row.id);
  const [owner] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-cost-${run}@example.com`}, 'Owner') returning id
  `);
  member = {
    account: { id: String(owner.id), email: `owner-cost-${run}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug: `cost-${run}`, markets: [no] } as unknown as Store,
  };
  await setCost("DEMO-MUG-WHITE", 3_000);
  await setCost("DEMO-NOTEBOOK-LINED", 1_200);
  await setCost("DEMO-TOTE", null);
});

afterAll(async () => {
  await closeDb();
});

describe("the cost kept on an order line", () => {
  it("is the variant's cost when it was sold, and null when none was known", async () => {
    const order = await place([
      ["DEMO-MUG-WHITE", 2],
      ["DEMO-TOTE", 1],
    ]);
    expect(await costs(order.orderId)).toEqual([
      ["DEMO-MUG-WHITE", 3_000, false],
      ["DEMO-TOTE", null, false],
    ]);
  });

  it("is not changed by a later change of the variant's cost, and a new order takes the new one", async () => {
    const first = await place([["DEMO-MUG-WHITE", 1]]);
    await setCost("DEMO-MUG-WHITE", 4_500);
    expect(await costs(first.orderId)).toEqual([["DEMO-MUG-WHITE", 3_000, false]]);
    const second = await place([["DEMO-MUG-WHITE", 1]]);
    expect(await costs(second.orderId)).toEqual([["DEMO-MUG-WHITE", 4_500, false]]);
    // Taking the cost away makes the next sale unknown, never zero; a cost of zero is a known zero.
    await setCost("DEMO-MUG-WHITE", null);
    expect(await costs((await place([["DEMO-MUG-WHITE", 1]])).orderId)).toEqual([["DEMO-MUG-WHITE", null, false]]);
    await setCost("DEMO-MUG-WHITE", 0);
    expect(await costs((await place([["DEMO-MUG-WHITE", 1]])).orderId)).toEqual([["DEMO-MUG-WHITE", 0, false]]);
    await setCost("DEMO-MUG-WHITE", 3_000);
  });

  it("never reaches the price: the same basket costs the same whatever the variants cost", async () => {
    const cheap = await place([["DEMO-MUG-WHITE", 2]]);
    await setCost("DEMO-MUG-WHITE", 2_900_000);
    const dear = await place([["DEMO-MUG-WHITE", 2]]);
    await setCost("DEMO-MUG-WHITE", 3_000);
    expect([dear.dueNowMinor, dear.lines.map((l) => l.dueNowMinor)]).toEqual([cheap.dueNowMinor, cheap.lines.map((l) => l.dueNowMinor)]);
  });

  it("is on a free product a campaign gives, and not on a sign-up fee", async () => {
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    const saved = await saveCampaign(member, null, {
      name: "Free notebook",
      kind: "gift",
      giftVariantId: variant["DEMO-NOTEBOOK-LINED"],
      thresholds: { NO: "1" },
    });
    if (!saved.ok) throw new Error(saved.problems.join(" "));
    const order = await place([["DEMO-MUG-WHITE", 1]]);
    expect(await costs(order.orderId)).toEqual([
      ["DEMO-MUG-WHITE", 3_000, false],
      ["DEMO-NOTEBOOK-LINED", 1_200, true],
    ]);
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);

    const [plan] = await db().execute<Row>(sql`
      insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent, signup_fee)
      select store_id, id, 'month'::commerce.plan_interval, 1, 0, '{"NO": 5000}'::jsonb
      from commerce.products where store_id = ${storeId}::uuid and handle = 'demo-notatbok' returning id
    `);
    const subscribed = await place([["DEMO-NOTEBOOK-LINED", 1, String(plan.id)]], { subscription: true });
    expect(await costs(subscribed.orderId)).toEqual([
      ["DEMO-NOTEBOOK-LINED", 1_200, false],
      ["SIGNUP-FEE", null, false],
    ]);
  });

  it("is taken from the variant when a subscription renews, as it is then", async () => {
    const [plan] = await db().execute<Row>(sql`
      select id from commerce.selling_plans where store_id = ${storeId}::uuid order by created_at desc limit 1
    `);
    const order = await place([["DEMO-NOTEBOOK-LINED", 1, String(plan.id)]], { subscription: true });
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency)
      values (${storeId}::uuid, ${order.orderId}::uuid, 'stripe', ${`cs_cost_${run}`}, 'acct_cost', ${order.dueNowMinor}, 'NOK')
    `);
    const reference = `sub_cost_${run}`;
    await applySession(storeId, {
      id: `cs_cost_${run}`,
      object: "checkout.session",
      mode: "subscription",
      status: "complete",
      payment_status: "paid",
      subscription: reference,
      customer_details: { email: "kari@example.com", name: "Kari", address: { line1: "Storgata 1", postal_code: "0155", city: "Oslo", country: "NO" } },
    } as unknown as Stripe.Checkout.Session);
    expect(await costs(order.orderId)).toEqual(expect.arrayContaining([["DEMO-NOTEBOOK-LINED", 1_200, false]]));

    await setCost("DEMO-NOTEBOOK-LINED", 1_500);
    const renewal = await renewSubscription(storeId, {
      id: `in_cost_${run}`,
      billing_reason: "subscription_cycle",
      amount_paid: 10_000,
      parent: { subscription_details: { subscription: reference } },
      lines: { data: [{ period: { end: 1_902_600_000 } }] },
    } as unknown as Stripe.Invoice);
    expect(renewal).not.toBeNull();
    expect(await costs(renewal!)).toEqual([["DEMO-NOTEBOOK-LINED", 1_500, false]]);
    // The first order keeps what it had.
    expect(await costs(order.orderId)).toEqual(expect.arrayContaining([["DEMO-NOTEBOOK-LINED", 1_200, false]]));
    await setCost("DEMO-NOTEBOOK-LINED", 1_200);
  });
});
