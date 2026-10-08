import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { conversionFor, localizationOf } from "@/lib/localization";
import { showMarket, toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

/** Adversarial review of D153's money paths (scratch scenarios, run on an empty seeded database). */

const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }) },
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        refunds.push({ params, options });
        return { id: `re_rev_${refunds.length}`, status: "succeeded" };
      },
    },
  };
  return { client, refunds };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const w = await import("./withdrawals");
const r = await import("./returns");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const noInEuro = showMarket(
  { code: "NO", currency: "NOK", defaultLocale: "nb-NO" },
  {
    currency: "EUR",
    conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]), "NOK", "EUR")!,
  },
);
let storeId: string;
let seq = 0;

beforeAll(async () => {
  const slug = `rev-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'T') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'T', null) as id`);
  storeId = String(store.id);
  // The template's countries, languages and currencies, as before D178 step 4 (a new store starts in its own country alone).
  await db().execute(sql`update commerce.stores set features = features || array['countries', 'languages', 'currencies'] where id = ${storeId}::uuid`);
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_rev${run}`}, 'active', false)`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
  `);
});
afterAll(async () => {
  await closeDb();
});

async function paid(items: [string, number][], market = no, extraShipping = 0) {
  const email = `s${++seq}-${run}@example.com`;
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, 'NO', ${market.currency}, 'nb-NO', now() + interval '1 day') returning id
  `);
  for (const [sku, quantity] of items) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
    `);
  }
  const result = await placeOrder({ storeId, market }, String(cart.id), {}, { customerId: null });
  if (!result.ok) throw new Error(result.problem);
  const { orderId } = result.order;
  if (extraShipping > 0) {
    // A carrier's dearer service the shopper chose (D135): the order says so, and its delivery costs more than the flat rate.
    await db().execute(sql`
      update commerce.orders set delivery = '{"label":"Express home"}'::jsonb, shipping_minor = shipping_minor + ${extraShipping},
        total_minor = total_minor + ${extraShipping} where id = ${orderId}::uuid
    `);
  }
  const [o] = await db().execute<Row>(sql`select total_minor, shipping_minor, currency from commerce.orders where id = ${orderId}::uuid`);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_rev${run}`}, ${Number(o.total_minor)}, ${String(o.currency).trim()}, 'captured')
  `);
  await completeOrderPayment(orderId, `cs_${orderId}`);
  await db().execute(sql`update commerce.orders set email = ${email} where id = ${orderId}::uuid`);
  const [order] = await db().execute<Row>(sql`select number from commerce.orders where id = ${orderId}::uuid`);
  const lines = await db().execute<Row>(sql`select id, quantity, total_minor from commerce.order_lines where order_id = ${orderId}::uuid order by sku`);
  return {
    orderId,
    email,
    number: String(order.number),
    total: Number(o.total_minor),
    shipping: Number(o.shipping_minor),
    lines: lines.map((l) => ({ id: String(l.id), quantity: Number(l.quantity), total: Number(l.total_minor) })),
  };
}

async function withdraw(order: Awaited<ReturnType<typeof paid>>, lines = order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity }))) {
  const started = await w.startWithdrawal(storeId, { orderNumber: order.number, email: order.email, name: "K N", lines }, { floorMs: 0 });
  if (!started.ok || !started.matched || !started.request) throw new Error(`step 1: ${JSON.stringify(started)}`);
  const confirmed = await w.confirmWithdrawal(storeId, { requestId: started.request.id });
  if (!confirmed.ok) throw new Error(`step 2: ${JSON.stringify(confirmed)}`);
  return confirmed.returns[0].id;
}
const received = async (returnId: string) => {
  expect(await r.markInTransit(storeId, { returnId }, null)).toMatchObject({ ok: true });
  expect(await r.markReceived(storeId, { returnId }, null)).toMatchObject({ ok: true });
};

describe("review: money", () => {
  it("F1: a euro-view order that chose a dearer carrier service refunds only the standard delivery (CRD Art. 13(1))", async () => {
    const order = await paid([["DEMO-TOTE", 1]], noInEuro, 2_000);
    expect(order.shipping).toBeGreaterThan(2_000);
    const returnId = await withdraw(order);
    await received(returnId);
    const preview = (await r.previewRefund(storeId, returnId))!;
    const flat = order.shipping - 2_000; // the market's flat rate, shown in euro
    // The docs say the market's flat rate is the standard offer; for a euro view that must be the converted rate.
    expect(preview.refund.shippingRefundMinor).toBe(flat);
  });

  it("F1b (control): the same in the country's own currency does cap the delivery at the flat rate", async () => {
    const order = await paid([["DEMO-TOTE", 1]], no, 20_000);
    const returnId = await withdraw(order);
    await received(returnId);
    const preview = (await r.previewRefund(storeId, returnId))!;
    expect(preview.refund.shippingRefundMinor).toBe(order.shipping - 20_000);
  });

  it("F2: two refunds of one return at once record one refund and put stock back once", async () => {
    const order = await paid([["DEMO-MUG-WHITE", 2]]);
    const returnId = await withdraw(order);
    await received(returnId);
    const preview = (await r.previewRefund(storeId, returnId))!;
    const [before] = await db().execute<Row>(sql`select l.on_hand from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id where v.store_id = ${storeId}::uuid and v.sku = 'DEMO-MUG-WHITE'`);
    const input = { returnId, amountMinor: preview.refund.amountMinor, restock: [{ lineId: order.lines[0].id, quantity: 2 }] };
    const results = await Promise.allSettled([r.refundReturn(storeId, input, null), r.refundReturn(storeId, input, null)]);
    const [after] = await db().execute<Row>(sql`select l.on_hand from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id where v.store_id = ${storeId}::uuid and v.sku = 'DEMO-MUG-WHITE'`);
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.refunds rf join commerce.payments p on p.id = rf.payment_id where p.order_id = ${order.orderId}::uuid`);
    expect(Number(after.on_hand) - Number(before.on_hand)).toBe(2);
    expect(Number(count.n)).toBe(1);
    expect(results.filter((x) => x.status === "fulfilled" && (x.value as { ok: boolean }).ok)).toHaveLength(1);
  });

  it("F3: a retry after Stripe took the refund but the database did not keep it reuses Stripe's key", async () => {
    const order = await paid([["DEMO-TOTE", 2]]);
    const returnId = await withdraw(order, [{ lineId: order.lines[0].id, quantity: 1 }]);
    await received(returnId);
    const preview = (await r.previewRefund(storeId, returnId))!;
    await db().execute(sql`create or replace function commerce.review_break() returns trigger language plpgsql as $$ begin raise exception 'review: db down'; end $$`);
    await db().execute(sql`create trigger review_break before insert on commerce.refunds for each row execute function commerce.review_break()`);
    const sent = fake.refunds.length;
    await expect(r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor }, null)).rejects.toThrow();
    await db().execute(sql`drop trigger review_break on commerce.refunds`);
    expect(fake.refunds.length).toBe(sent + 1);
    const first = String(fake.refunds.at(-1)!.options.idempotencyKey);
    // Meanwhile the order page makes a small goodwill refund: the order has one refunds row more than before.
    const { refundOrder } = await import("./order-admin");
    expect(await refundOrder(storeId, order.orderId, { amountMinor: 100, reason: "goodwill", restock: [] }, null)).toMatchObject({ ok: true });
    const again = (await r.previewRefund(storeId, returnId))!;
    expect(again.refund.amountMinor).toBe(preview.refund.amountMinor);
    expect(await r.refundReturn(storeId, { returnId, amountMinor: again.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const second = String(fake.refunds.at(-1)!.options.idempotencyKey);
    // The same refund asked for again must carry the same key, or Stripe pays it twice.
    expect(second).toBe(first);
  });
});
