import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { lineValue } from "@/lib/return-refund";

type Row = Record<string, unknown>;

/**
 * Withdrawals and returns (D153), server side, against a real database: the shopper's two steps, the acknowledgement
 * kept as an email, the store's steps to a refund through Stripe (faked), stock, the order's history, the limits and the
 * guards. Orders are placed by `placeOrder()` as a shopper's cart makes them, then paid as Stripe's webhook would leave them.
 */

const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }) },
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        refunds.push({ params, options });
        return { id: `re_ret_${refunds.length}_${Math.random().toString(36).slice(2, 8)}`, status: "succeeded" };
      },
    },
  };
  return { client, refunds };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

// An email provider that accepts everything: an acknowledgement only counts as sent once it was handed to one (a kept
// email, "logged", has not reached the shopper).
process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "butikk@example.com";
let emailCount = 0;
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: `em_ret_${++emailCount}` }), { status: 200, headers: { "content-type": "application/json" } }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { getOrderAdmin, markSent } = await import("./order-admin");
const { sendOrderConfirmation, sendShipped } = await import("./shopper-emails");
const w = await import("./withdrawals");
const r = await import("./returns");
const jobs = await import("./return-jobs");
const { getReturnSettings, saveReturnSettings } = await import("./return-settings");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let otherStoreId: string;
let seq = 0;

/** A Stripe account id: letters and digits only. */
const accountOf = (slug: string) => `acct_${slug.replace(/[^a-z0-9]/gi, "")}`;

async function makeStore(slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  const id = String(store.id);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${id}::uuid, 'test', ${accountOf(slug)}, 'active', false)
  `);
  await db().execute(sql`update commerce.stores set contact_email = ${`butikk-${slug}@example.com`} where id = ${id}::uuid`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${id}::uuid`);
  return id;
}

beforeAll(async () => {
  storeId = await makeStore(`ret-${run}`);
  otherStoreId = await makeStore(`ret2-${run}`);
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

const onHand = async (sku: string, store = storeId) => {
  const [row] = await db().execute<Row>(sql`
    select l.on_hand from commerce.inventory_levels l join commerce.product_variants v on v.id = l.variant_id
    where v.store_id = ${store}::uuid and v.sku = ${sku}
  `);
  return Number(row.on_hand);
};

type Placed = { orderId: string; number: string; email: string; lines: { id: string; sku: string; quantity: number; total: number }[]; total: number; shipping: number };

/** A paid order, as a Checkout session leaves it, for a shopper with this email. */
async function paidOrder(
  items: [sku: string, quantity: number][],
  options: { store?: string; customerId?: string | null; code?: string; credits?: number; provider?: "stripe" | "venue"; email?: string; ship?: boolean; beforePay?: (orderId: string) => Promise<void> } = {},
): Promise<Placed> {
  const store = options.store ?? storeId;
  const email = options.email ?? `shopper${++seq}-${run}@example.com`;
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, discount_code, bonus_request_minor, bonus_request_currency)
    values (${store}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day', ${options.code ?? null}, ${options.credits ?? 0}, ${options.credits ? "NOK" : null}) returning id
  `);
  for (const [sku, quantity] of items) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${store}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${store}::uuid and sku = ${sku}
    `);
  }
  const result = await placeOrder({ storeId: store, market: no }, String(cart.id), {}, { customerId: options.customerId ?? null });
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  await options.beforePay?.(orderId);
  const provider = options.provider ?? "stripe";
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${store}::uuid, ${orderId}::uuid, ${provider}, ${`${provider === "venue" ? "venue" : "cs"}_${orderId}`},
            ${provider === "stripe" ? accountOf(String((await db().execute<Row>(sql`select slug from commerce.stores where id = ${store}::uuid`))[0].slug)) : null},
            ${totalMinor}, 'NOK', 'captured')
  `);
  await completeOrderPayment(orderId, `${provider === "venue" ? "venue" : "cs"}_${orderId}`);
  await db().execute(sql`update commerce.orders set email = ${email} where id = ${orderId}::uuid`);
  // Sent, as most withdrawals are made after the parcel left (a withdrawal before it is its own case).
  if (options.ship !== false) await markSent(store, orderId, { carrier: "other", trackingNumber: `T-${orderId.slice(0, 8)}`, trackingUrl: null }, null);
  const [order] = await db().execute<Row>(sql`select number, total_minor, shipping_minor from commerce.orders where id = ${orderId}::uuid`);
  const lines = await db().execute<Row>(sql`select id, sku, quantity, total_minor from commerce.order_lines where order_id = ${orderId}::uuid order by sku`);
  return {
    orderId,
    number: String(order.number),
    email,
    total: Number(order.total_minor),
    shipping: Number(order.shipping_minor),
    lines: lines.map((l) => ({ id: String(l.id), sku: String(l.sku), quantity: Number(l.quantity), total: Number(l.total_minor) })),
  };
}

const opts = { floorMs: 0 };
const statement = (order: Placed, lines: { lineId: string; quantity: number }[], over: Record<string, unknown> = {}) => ({
  orderNumber: order.number,
  email: order.email,
  name: "Kari Nordmann",
  lines,
  ...over,
});
const allOf = (order: Placed) => order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity }));

/** Step 1 and 2 for what is declared; the confirmation. */
async function withdraw(order: Placed, lines = allOf(order), store = storeId) {
  const started = await w.startWithdrawal(store, statement(order, lines), opts);
  if (!started.ok || !started.matched || !started.request) throw new Error(`step 1 failed: ${JSON.stringify(started)}`);
  const confirmed = await w.confirmWithdrawal(store, { requestId: started.request.id });
  if (!confirmed.ok) throw new Error(`step 2 failed: ${JSON.stringify(confirmed)}`);
  return { started, confirmed, returnId: confirmed.returns[0].id };
}

/** The store works the return to received. */
async function received(returnId: string, store = storeId) {
  expect(await r.markInTransit(store, { returnId }, null)).toMatchObject({ ok: true });
  expect(await r.markReceived(store, { returnId }, null)).toMatchObject({ ok: true });
}

const events = async (orderId: string, like = 'return.%') =>
  (await db().execute<Row>(sql`select type, data, actor from commerce.order_events where order_id = ${orderId}::uuid and type like ${like} order by id`)).map((e) => ({
    type: String(e.type),
    data: e.data as Record<string, unknown>,
    actor: String(e.actor),
  }));

describe("the withdrawal function", () => {
  it("goes from the statement to a refund: withdraw, confirm, acknowledge, receive, inspect, refund, restock", async () => {
    const order = await paidOrder([["DEMO-MUG-WHITE", 2]]);
    const before = await onHand("DEMO-MUG-WHITE");

    // Step 1 keeps a pending request and nothing else: no return, no event.
    const started = await w.startWithdrawal(storeId, statement(order, allOf(order)), opts);
    expect(started).toMatchObject({ ok: true, matched: true, problems: [], order: { number: order.number, right: "withdrawal" } });
    if (!started.ok || !started.matched || !started.request) throw new Error("no request");
    expect(started.request.lines).toEqual([{ lineId: order.lines[0].id, title: expect.any(String), sku: "DEMO-MUG-WHITE", quantity: 2 }]);
    expect((await r.listOrderReturns(storeId, order.orderId)).length).toBe(0);
    expect(await events(order.orderId)).toEqual([]);
    // The same statement again is the same request, not a second one.
    const again = await w.startWithdrawal(storeId, statement(order, allOf(order)), opts);
    expect(again.ok && again.matched && again.request?.id).toBe(started.request.id);

    // Step 2: the legal act.
    const confirmed = await w.confirmWithdrawal(storeId, { requestId: started.request.id });
    if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
    expect(confirmed).toMatchObject({ already: false, orderNumber: order.number, acknowledgement: { sent: true, reference: `${order.number}-R1` } });
    expect(confirmed.acknowledgement.text).toContain(`${order.number}-R1`);
    expect(confirmed.acknowledgement.text).toContain("2 × ");
    expect(confirmed.acknowledgement.text).toMatch(/UTC\+0[12]:00, Europe\/Oslo/);
    expect(Date.parse(confirmed.refundBy) - Date.parse(confirmed.confirmedAt)).toBe(14 * 86_400_000);

    // The acknowledgement is kept as an email in the order's language, and recorded on the request.
    const [email] = await db().execute<Row>(sql`select id, subject, text, status from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.acknowledgement'`);
    expect(String(email.subject)).toBe(`Vi har mottatt angringen din for ordre ${order.number} hos Test`);
    expect(String(email.text)).toContain("uten ugrunnet opphold og senest");
    expect(["sent", "logged"]).toContain(String(email.status));
    const [request] = await db().execute<Row>(sql`select status, confirmed_at, acknowledged_at, acknowledgement_reference from commerce.withdrawal_requests where id = ${started.request.id}::uuid`);
    expect(request).toMatchObject({ status: "confirmed", acknowledgement_reference: String(email.id) });
    expect(request.acknowledged_at).not.toBeNull();

    // Confirming again changes nothing and sends nothing.
    const twice = await w.confirmWithdrawal(storeId, { requestId: started.request.id });
    expect(twice).toMatchObject({ ok: true, already: true, returns: [{ id: confirmed.returns[0].id }] });
    expect((await db().execute<Row>(sql`select 1 from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.acknowledgement'`)).length).toBe(1);
    expect((await r.listOrderReturns(storeId, order.orderId)).length).toBe(1);

    // The return starts approved, with the order's history saying so.
    const returnId = confirmed.returns[0].id;
    const detail = await r.getReturn(storeId, returnId);
    expect(detail).toMatchObject({
      kind: "withdrawal",
      status: "approved",
      number: `${order.number}-R1`,
      request: { name: "Kari Nordmann", acknowledgement: "sent" },
      due: { state: "waiting" },
      lines: [{ quantity: 2, decision: "accept" }],
    });
    // Closed without a refund, never cancelled: a withdrawal is effective on the statement.
    expect(detail!.actions).toEqual(expect.arrayContaining(["set_instructions", "mark_in_transit", "mark_received", "close"]));
    expect(detail!.actions).not.toContain("cancel");
    expect(detail!.actions).not.toContain("refund");
    expect((await events(order.orderId)).map((e) => e.type)).toEqual(["return.confirmed", "return.approved"]);

    // Refunding before the goods are back is refused: the store refunds when received.
    expect(await r.refundReturn(storeId, { returnId, amountMinor: 1 }, null)).toMatchObject({ ok: false, code: "not_received" });
    // A withdrawal is never declined.
    expect(await r.declineReturn(storeId, { returnId, reason: "No" }, null)).toMatchObject({ ok: false, code: "withdrawal_not_declinable" });

    await received(returnId);
    expect((await db().execute<Row>(sql`select kind from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.received'`)).length).toBe(1);
    const inspected = await r.inspectReturn(
      storeId,
      { returnId, lines: [{ lineId: order.lines[0].id, condition: "opened", restock: true, deductionMinor: 1000, deductionNote: "Used" }] },
      null,
    );
    expect(inspected).toMatchObject({ ok: true, status: "inspected" });

    // The working: what was paid for both mugs, less the deduction, plus the standard delivery (the whole order is back).
    const preview = await r.previewRefund(storeId, returnId);
    const paid = order.lines[0].total;
    expect(preview!.refund).toMatchObject({ goodsMinor: paid, deductionsMinor: 1000, wholeOrder: true, shippingRefundMinor: order.shipping });
    expect(preview!.refund.amountMinor).toBe(paid - 1000 + order.shipping);
    expect(preview!.canRefund).toBe(true);

    const refundsBefore = fake.refunds.length;
    const done = await r.refundReturn(storeId, { returnId, amountMinor: preview!.refund.amountMinor }, null);
    expect(done).toMatchObject({ ok: true, amountMinor: preview!.refund.amountMinor, outside: false, adjusted: false });
    // Through the one refundOrder(): Stripe on the store's account, Kaizen's fee back with it.
    expect(fake.refunds.length).toBe(refundsBefore + 1);
    expect(fake.refunds.at(-1)!.params).toMatchObject({ payment_intent: `pi_for_cs_${order.orderId}`, amount: preview!.refund.amountMinor, refund_application_fee: true });
    expect(fake.refunds.at(-1)!.options).toMatchObject({ stripeAccount: accountOf(`ret-${run}`) });
    // The stock went back, once.
    expect(await onHand("DEMO-MUG-WHITE")).toBe(before + 2);
    const admin = await getOrderAdmin(storeId, order.orderId);
    expect(admin).toMatchObject({ refundedMinor: preview!.refund.amountMinor });
    expect(admin!.lines[0].restocked).toBe(2);
    // The return records the refund against Stripe's refund row.
    const [row] = await db().execute<Row>(sql`select refund_id, refund_minor, refund_computed_minor, refund_outside, refunded_at from commerce.returns where id = ${returnId}::uuid`);
    expect(row).toMatchObject({ refund_minor: String(preview!.refund.amountMinor), refund_computed_minor: String(preview!.refund.amountMinor), refund_outside: false });
    expect(row.refund_id).toBe(admin!.refunds[0].id);
    // One refund email to the shopper (the order's own refund email is not sent as well).
    expect((await db().execute<Row>(sql`select 1 from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.refunded'`)).length).toBe(1);
    expect((await db().execute<Row>(sql`select 1 from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'order.refunded'`)).length).toBe(0);
    // Refunded once.
    expect(await r.refundReturn(storeId, { returnId, amountMinor: 1 }, null)).toMatchObject({ ok: false, code: "refunded" });

    expect(await r.closeReturn(storeId, { returnId }, null)).toMatchObject({ ok: true, status: "closed", outcome: "refunded" });
    expect((await events(order.orderId)).map((e) => e.type)).toEqual([
      "return.confirmed",
      "return.approved",
      "return.in_transit",
      "return.received",
      "return.inspected",
      "return.refunded",
      "return.closed",
    ]);
    expect((await events(order.orderId, "order.refunded"))[0].data).toMatchObject({ returnId, returnNumber: `${order.number}-R1` });
    // A closed return is not changed.
    expect(await r.cancelReturn(storeId, { returnId }, null)).toMatchObject({ ok: false, code: "ended" });
    expect((await r.getReturn(storeId, returnId))!.actions).toEqual([]);
    // The shopper's status page shows its steps and the refund, never an address or an email.
    const shopper = await r.getShopperReturn(storeId, confirmed.returns[0].token);
    expect(shopper).toMatchObject({ number: `${order.number}-R1`, status: "closed", refundMinor: preview!.refund.amountMinor, orderNumber: order.number });
    expect(JSON.stringify(shopper)).not.toContain(order.email);
    expect(await r.getShopperReturn(otherStoreId, confirmed.returns[0].token)).toBeNull();
  });

  it("takes a partial quantity, then a second withdrawal for the remainder, which carries the delivery", async () => {
    const order = await paidOrder([["DEMO-MUG-WHITE", 3]]);
    const line = order.lines[0];
    const first = await withdraw(order, [{ lineId: line.id, quantity: 1 }]);
    // One of three: not the whole order, no delivery refunded.
    await received(first.returnId);
    await r.inspectReturn(storeId, { returnId: first.returnId, lines: [{ lineId: line.id, condition: "as_new", restock: true, deductionMinor: 0 }] }, null);
    const p1 = await r.previewRefund(storeId, first.returnId);
    expect(p1!.refund).toMatchObject({ wholeOrder: false, shippingRefundMinor: 0, goodsMinor: lineValue({ quantity: 3, totalMinor: line.total, priorQuantity: 0, returnQuantity: 1 }) });

    // What is left is two: asking for three is refused, with the code, and nothing is kept.
    const tooMany = await w.startWithdrawal(storeId, statement(order, [{ lineId: line.id, quantity: 3 }]), opts);
    expect(tooMany).toMatchObject({ ok: true, matched: true, request: null, problems: [{ lineId: line.id, code: "too_many" }] });

    const second = await withdraw(order, [{ lineId: line.id, quantity: 2 }]);
    await received(second.returnId);
    await r.inspectReturn(storeId, { returnId: second.returnId, lines: [{ lineId: line.id, condition: "as_new", restock: true, deductionMinor: 0 }] }, null);
    const p2 = await r.previewRefund(storeId, second.returnId);
    // The odd minor units fall to the last units: the two returns together are exactly what was paid for the line.
    expect(p1!.refund.goodsMinor + p2!.refund.goodsMinor).toBe(line.total);
    expect(p2!.refund).toMatchObject({ wholeOrder: true, shippingRefundMinor: order.shipping });
    expect(second.confirmed.returns[0].number).toBe(`${order.number}-R2`);
    // Nothing left to withdraw.
    const view = await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number, email: order.email }, opts);
    expect(view!.lines[0]).toMatchObject({ right: "none", refusal: "already_returned", remaining: 0 });
  });

  it("refuses a line the law excludes with its reason, while the rest of the order can still be withdrawn", async () => {
    const order = await paidOrder([["DEMO-MUG-WHITE", 1], ["DEMO-TOTE", 1]]);
    const tote = order.lines.find((l) => l.sku === "DEMO-TOTE")!;
    const mug = order.lines.find((l) => l.sku === "DEMO-MUG-WHITE")!;
    await db().execute(sql`update commerce.order_lines set withdrawal_exclusion = 'custom_made' where id = ${tote.id}::uuid`);
    const refused = await w.startWithdrawal(storeId, statement(order, allOf(order)), opts);
    expect(refused).toMatchObject({ ok: true, matched: true, request: null, problems: [{ lineId: tote.id, code: "no_right" }] });
    if (!refused.ok || !refused.matched) throw new Error();
    // Listed with the plain reason, never left out.
    expect(refused.order.lines.find((l) => l.lineId === tote.id)).toMatchObject({ right: "none", refusal: "excluded_by_law", exclusion: "custom_made" });
    expect(refused.order.lines.find((l) => l.lineId === mug.id)).toMatchObject({ right: "withdrawal", maxQuantity: 1 });

    const { returnId } = await withdraw(order, [{ lineId: mug.id, quantity: 1 }]);
    // The excluded line stays with the shopper, so the withdrawal is partial and no delivery is refunded.
    await received(returnId);
    await r.inspectReturn(storeId, { returnId, lines: [{ lineId: mug.id, condition: "as_new", restock: false, deductionMinor: 0 }] }, null);
    expect((await r.previewRefund(storeId, returnId))!.refund).toMatchObject({ wholeOrder: false, shippingRefundMinor: 0 });
    // A line with the right is not declined as a line; one the law excludes is.
    expect(await r.declineReturnLine(storeId, { returnId, lineId: mug.id, reason: "No" }, null)).toMatchObject({ ok: false, code: "withdrawal_line" });
  });

  it("says the period is over after 14 days, and offers the store's own window as a return", async () => {
    const order = await paidOrder([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set delivered_at = now() - interval '30 days' where id = ${order.orderId}::uuid`);
    const late = await w.startWithdrawal(storeId, statement(order, allOf(order)), opts);
    expect(late).toMatchObject({ ok: true, matched: true, request: null, order: { right: "none", window: { state: "closed" } } });
    if (!late.ok || !late.matched) throw new Error();
    expect(late.order.lines[0]).toMatchObject({ right: "none", refusal: "period_over" });

    // With a 60 day window the store takes it back as a return it may decline.
    const saved = await saveReturnSettings(storeId, { ...(await getReturnSettings(storeId)), windowDays: 60 }, null);
    expect(saved).toMatchObject({ ok: true });
    try {
      const request = await w.startReturnRequest(storeId, { ...statement(order, []), lines: [{ lineId: order.lines[0].id, quantity: 1, reason: "changed_mind" }], reason: "changed_mind", note: "Too small" }, opts);
      expect(request).toMatchObject({ ok: true, matched: true, problems: [], created: { number: `${order.number}-R1` } });
      if (!request.ok || !request.matched || !request.created) throw new Error();
      const returnId = (await r.listOrderReturns(storeId, order.orderId))[0].id;
      expect(await r.getReturn(storeId, returnId)).toMatchObject({ kind: "return", status: "requested", reason: "changed_mind", reasonNote: "Too small" });
      // A statutory withdrawal is not what is asked for here.
      expect(await w.startWithdrawal(storeId, statement(order, allOf(order)), opts)).toMatchObject({ matched: true, request: null, problems: [{ code: "no_right" }] });

      // Declined with a reason the shopper is emailed; the units are free again.
      expect(await r.declineReturn(storeId, { returnId, reason: "Not in the window" }, null)).toMatchObject({ ok: true, status: "declined" });
      const [mail] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.declined'`);
      expect(String(mail.text)).toContain("Begrunnelse: Not in the window");
      expect(await r.declineReturn(storeId, { returnId, reason: "again" }, null)).toMatchObject({ ok: false, code: "ended" });
      const again = await w.startReturnRequest(storeId, { ...statement(order, []), lines: [{ lineId: order.lines[0].id, quantity: 1 }] }, opts);
      expect(again).toMatchObject({ ok: true, matched: true, created: { number: `${order.number}-R2` } });
      // Approved: instructions, address and label, and the shopper is emailed.
      const second = (await r.listOrderReturns(storeId, order.orderId))[1].id;
      expect(
        await r.approveReturn(
          storeId,
          { returnId: second, instructions: "Pack it well.", labelUrl: "https://labels.example.com/abc", returnAddress: { name: "Butikken", street: "Gata 1", postalCode: "0150", city: "Oslo", country: "no" } },
          null,
        ),
      ).toMatchObject({ ok: true, status: "approved" });
      expect(await r.setReturnInstructions(storeId, { returnId: second, labelUrl: "http://insecure.example.com" }, null)).toMatchObject({ ok: false });
      const [approved] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.approved'`);
      expect(String(approved.text)).toContain("Pack it well.");
      expect(String(approved.text)).toContain("https://labels.example.com/abc");
      expect(String(approved.text)).toContain("Gata 1");
    } finally {
      await saveReturnSettings(storeId, { ...(await getReturnSettings(storeId)), windowDays: 14 }, null);
    }
  });

  it("gives a company, digital content and a copied order no statutory right, and says why", async () => {
    const company = await paidOrder([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set company_name = 'Acme AS', organisation_number = '123456785' where id = ${company.orderId}::uuid`);
    const business = await w.startWithdrawal(storeId, statement(company, allOf(company)), opts);
    expect(business).toMatchObject({ ok: true, matched: true, request: null, order: { business: true, right: "none" } });
    if (!business.ok || !business.matched) throw new Error();
    expect(business.order.lines[0]).toMatchObject({ refusal: "business_order" });

    const digital = await paidOrder([["DEMO-TOTE", 1]]);
    // A paid order's line changes only inside an order change (D174, `order_lines_settled_guard()`): the fixture sets the edit context for its own order to make the line a download.
    await db().transaction(async (tx) => {
      await tx.execute(sql`select set_config('kaizen.order_edit', ${digital.orderId}, true)`);
      await tx.execute(sql`update commerce.order_lines set delivery = 'digital' where id = ${digital.lines[0].id}::uuid`);
    });
    await db().execute(sql`update commerce.orders set digital_consent_at = now() where id = ${digital.orderId}::uuid`);
    const download = await w.lookupWithdrawableOrder(storeId, { orderNumber: digital.number, email: digital.email }, opts);
    expect(download!.lines[0]).toMatchObject({ right: "none", refusal: "digital_content" });

    // A copied order (D129) is history: it is never found, so nothing can be withdrawn from it.
    const source = await paidOrder([["DEMO-TOTE", 1]]);
    await db().execute(sql`
      insert into commerce.orders
      select (jsonb_populate_record(null::commerce.orders, to_jsonb(o) || jsonb_build_object(
        'id', gen_random_uuid(), 'number', 'C-' || o.number, 'copied_from', o.id, 'cart_id', null, 'balance_minor', 0))).*
      from commerce.orders o where o.id = ${source.orderId}::uuid
    `);
    expect(await w.startWithdrawal(storeId, statement({ ...source, number: `C-${source.number}` }, allOf(source)), opts)).toEqual({ ok: true, matched: false });
  });

  it("answers the same to a wrong email, an unknown number and another store's order", async () => {
    const order = await paidOrder([["DEMO-TOTE", 1]]);
    const wrongEmail = await w.startWithdrawal(storeId, statement(order, allOf(order), { email: "someone-else@example.com" }), opts);
    const unknown = await w.startWithdrawal(storeId, statement(order, allOf(order), { orderNumber: "NOPE-1" }), opts);
    const otherStore = await w.startWithdrawal(otherStoreId, statement(order, allOf(order)), opts);
    expect(wrongEmail).toEqual({ ok: true, matched: false });
    expect(unknown).toEqual(wrongEmail);
    expect(otherStore).toEqual(wrongEmail);
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number, email: "someone-else@example.com" }, opts)).toBeNull();
    // The number is matched without spaces or case, and a signed-in customer or the order page's key can stand for the email.
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: ` ${order.number.toLowerCase()} `, email: order.email.toUpperCase() }, opts)).toMatchObject({ number: order.number });
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number, email: "x@example.com", orderKey: `cs_${order.orderId}` }, opts)).toMatchObject({ number: order.number });
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number, email: "x@example.com", orderKey: "cs_wrong" }, opts)).toBeNull();
    // From the order page's own link (its key, no email): the form is prefilled with the order's email. A stranger who typed
    // the email already knows it, so none is handed back.
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number, orderKey: `cs_${order.orderId}` }, opts)).toMatchObject({ email: order.email });
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number, email: order.email }, opts)).toMatchObject({ email: null });
    expect(await w.shopperCanAccessOrder(storeId, order.orderId, { sessionId: `cs_${order.orderId}` })).toBe(true);
    expect(await w.shopperCanAccessOrder(storeId, order.orderId, { sessionId: "cs_other" })).toBe(false);
    expect(await w.shopperCanAccessOrder(otherStoreId, order.orderId, { sessionId: `cs_${order.orderId}` })).toBe(false);
    // Bad input is a problem list of codes, not a match.
    expect(await w.startWithdrawal(storeId, { ...statement(order, []), email: "not an email" }, opts)).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("keeps a pending request for 24 hours only", async () => {
    const order = await paidOrder([["DEMO-TOTE", 1]]);
    const started = await w.startWithdrawal(storeId, statement(order, allOf(order)), opts);
    if (!started.ok || !started.matched || !started.request) throw new Error();
    // Time passes: the request's own trigger is what keeps its words fixed, so a test steps round it.
    await db().execute(sql`alter table commerce.withdrawal_requests disable trigger withdrawal_requests_rules`);
    await db().execute(sql`
      update commerce.withdrawal_requests set submitted_at = now() - interval '30 hours', expires_at = now() - interval '6 hours' where id = ${started.request.id}::uuid
    `);
    await db().execute(sql`alter table commerce.withdrawal_requests enable trigger withdrawal_requests_rules`);
    expect(await w.confirmWithdrawal(storeId, { requestId: started.request.id })).toMatchObject({ ok: false, code: "lapsed" });
    expect((await r.listOrderReturns(storeId, order.orderId)).length).toBe(0);
    expect(await jobs.expireWithdrawalRequests()).toBeGreaterThanOrEqual(1);
    expect(await w.getWithdrawalRequest(storeId, started.request.id)).toBeNull();
    // A confirmed withdrawal is never deleted by it.
    const kept = await withdraw(await paidOrder([["DEMO-TOTE", 1]]));
    await jobs.expireWithdrawalRequests();
    expect(await w.getWithdrawalRequest(storeId, kept.started.request!.id)).toMatchObject({ status: "confirmed" });
  });

  it("limits requests per order, per email and per store by their own keys, never by who sent them", async () => {
    const order = await paidOrder([["DEMO-MUG-WHITE", 6]]);
    const line = order.lines[0];
    // Different quantities make different requests: the fifth is the last the order takes in an hour.
    for (let quantity = 1; quantity <= w.WITHDRAWAL_LIMITS.perOrder; quantity++) {
      expect(await w.startWithdrawal(storeId, statement(order, [{ lineId: line.id, quantity }]), opts)).toMatchObject({ ok: true, matched: true, problems: [] });
    }
    expect(await w.startWithdrawal(storeId, statement(order, [{ lineId: line.id, quantity: 6 }]), opts)).toEqual({ ok: false, reason: "limited" });
    // Another order of the same shopper is held by the shopper's email.
    const second = await paidOrder([["DEMO-TOTE", 1]], { email: order.email });
    for (let n = w.WITHDRAWAL_LIMITS.perOrder; n < w.WITHDRAWAL_LIMITS.perEmail; n++) {
      await db().execute(sql`
        insert into commerce.withdrawal_requests (store_id, order_id, name, email, channel) values (${storeId}::uuid, ${second.orderId}::uuid, 'x', ${order.email}, 'web')
      `);
    }
    expect(await w.startWithdrawal(storeId, statement(second, allOf(second)), opts)).toEqual({ ok: false, reason: "limited" });
    // Another shopper is not held.
    const stranger = await paidOrder([["DEMO-TOTE", 1]]);
    expect(await w.startWithdrawal(storeId, statement(stranger, allOf(stranger)), opts)).toMatchObject({ ok: true, matched: true });
  });
});

describe("the acknowledgement when the email provider fails", () => {
  const original = { key: process.env.RESEND_API_KEY, from: process.env.EMAIL_FROM, fetch: globalThis.fetch };
  afterEach(() => {
    process.env.RESEND_API_KEY = original.key;
    process.env.EMAIL_FROM = original.from;
    if (original.key === undefined) delete process.env.RESEND_API_KEY;
    if (original.from === undefined) delete process.env.EMAIL_FROM;
    globalThis.fetch = original.fetch;
  });

  it("stands as a withdrawal, shows as not sent, and goes out when sent again", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "butikk@example.com";
    globalThis.fetch = (async () => new Response(JSON.stringify({ name: "application_error", message: "down" }), { status: 400 })) as typeof fetch;
    const order = await paidOrder([["DEMO-TOTE", 1]]);
    const { confirmed, returnId } = await withdraw(order);
    // The confirmation is the legal act and stands; the page still has the text; staff see it was not sent.
    expect(confirmed.acknowledgement).toMatchObject({ sent: false, reference: `${order.number}-R1` });
    expect(confirmed.acknowledgement.text).toContain(order.number);
    const detail = await r.getReturn(storeId, returnId);
    expect(detail).toMatchObject({ status: "approved", request: { acknowledgement: "not_sent", acknowledgedAt: null } });
    expect(detail!.actions).toContain("send_acknowledgement");
    expect((await r.returnCounts(storeId)).acknowledgementPending).toBeGreaterThanOrEqual(1);

    globalThis.fetch = (async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 })) as typeof fetch;
    expect(await w.resendAcknowledgement(storeId, detail!.request!.id)).toEqual({ ok: true, sent: true });
    const after = await r.getReturn(storeId, returnId);
    expect(after!.request).toMatchObject({ acknowledgement: "sent" });
    expect(after!.request!.acknowledgementReference).not.toBeNull();
    expect(after!.actions).not.toContain("send_acknowledgement");
    // A repeated confirmation after that sends nothing more.
    const before = (await db().execute<Row>(sql`select 1 from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.acknowledgement'`)).length;
    await w.confirmWithdrawal(storeId, { requestId: detail!.request!.id });
    expect((await db().execute<Row>(sql`select 1 from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.acknowledgement'`)).length).toBe(before);
  }, 30_000);

  it("is tried again by the job when the first email never got out", async () => {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "butikk@example.com";
    globalThis.fetch = (async () => new Response("{}", { status: 400 })) as typeof fetch;
    const order = await paidOrder([["DEMO-TOTE", 1]]);
    const { started } = await withdraw(order);
    globalThis.fetch = (async () => new Response(JSON.stringify({ id: "msg_2" }), { status: 200 })) as typeof fetch;
    // Younger than five minutes: left alone. Then older (the request keeps its words, so a test steps round the trigger).
    // (The job reads every store's requests, so this one is judged by its own row, not by the job's count.)
    await jobs.runReturnJobs();
    const [young] = await db().execute<Row>(sql`select acknowledged_at from commerce.withdrawal_requests where id = ${started.request!.id}::uuid`);
    expect(young.acknowledged_at).toBeNull();
    await db().execute(sql`alter table commerce.withdrawal_requests disable trigger withdrawal_requests_rules`);
    await db().execute(sql`
      update commerce.withdrawal_requests set submitted_at = submitted_at - interval '2 hours', confirmed_at = confirmed_at - interval '1 hour'
      where id = ${started.request!.id}::uuid
    `);
    await db().execute(sql`alter table commerce.withdrawal_requests enable trigger withdrawal_requests_rules`);
    await db().execute(sql`update commerce.email_messages set created_at = created_at - interval '1 hour' where idempotency_key like ${`return.ack:${started.request!.id}%`}`);
    expect((await jobs.runReturnJobs()).acknowledgementsRetried).toBeGreaterThanOrEqual(1);
    const [request] = await db().execute<Row>(sql`select acknowledged_at from commerce.withdrawal_requests where id = ${started.request!.id}::uuid`);
    expect(request.acknowledged_at).not.toBeNull();
  }, 30_000);
});

describe("what a return refunds", () => {
  /** The refund the Stripe fake was asked for last. */
  const lastRefund = () => Number(fake.refunds.at(-1)!.params.amount);

  async function refundWhole(order: Placed, extra: Record<string, unknown> = {}) {
    const { returnId } = await withdraw(order);
    await received(returnId);
    const preview = await r.previewRefund(storeId, returnId, Number(extra.returnShippingMinor ?? 0));
    const done = await r.refundReturn(storeId, { returnId, amountMinor: preview!.refund.amountMinor, ...extra }, null);
    return { returnId, preview: preview!, done };
  }

  it("refunds what was paid with a discount code, not the list price, and the delivery for a whole order", async () => {
    await db().execute(sql`
      insert into commerce.discount_codes (store_id, code, kind, percent) values (${storeId}::uuid, ${`RET${run}`.toUpperCase()}, 'percent', 10)
    `);
    const order = await paidOrder([["DEMO-MUG-WHITE", 3]], { code: `RET${run}`.toUpperCase() });
    const [row] = await db().execute<Row>(sql`select discount_minor, subtotal_minor from commerce.orders where id = ${order.orderId}::uuid`);
    expect(Number(row.discount_minor)).toBeGreaterThan(0);
    // The shopper paid less than the list price for the goods.
    expect(order.lines[0].total).toBeLessThan(Number(row.subtotal_minor));

    // One mug of three: its share of what was paid (the cumulative rule), no delivery.
    const first = await withdraw(order, [{ lineId: order.lines[0].id, quantity: 1 }]);
    await received(first.returnId);
    const part = await r.previewRefund(storeId, first.returnId);
    expect(part!.refund).toMatchObject({ goodsMinor: Math.floor(order.lines[0].total / 3), shippingRefundMinor: 0 });
    expect(await r.refundReturn(storeId, { returnId: first.returnId, amountMinor: part!.refund.amountMinor }, null)).toMatchObject({ ok: true });
    expect(lastRefund()).toBe(Math.floor(order.lines[0].total / 3));

    // The other two: with the first, everything paid for the goods plus the delivery, to the minor unit.
    const second = await withdraw(order, [{ lineId: order.lines[0].id, quantity: 2 }]);
    await received(second.returnId);
    const rest = await r.previewRefund(storeId, second.returnId);
    expect(rest!.refund.wholeOrder).toBe(true);
    expect(await r.refundReturn(storeId, { returnId: second.returnId, amountMinor: rest!.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const admin = await getOrderAdmin(storeId, order.orderId);
    expect(admin!.refundedMinor).toBe(order.total);
    expect(admin!.refundableMinor).toBe(0);
  });

  it("refunds what a group member paid, and never above what was captured", async () => {
    const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'Retail', 10) returning id`);
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, tier_id) values (${storeId}::uuid, ${`member-${run}@example.com`}, ${String(tier.id)}::uuid) returning id
    `);
    const [stranger] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`stranger-${run}@example.com`}) returning id`);
    const otherCustomer = String(stranger.id);
    const order = await paidOrder([["DEMO-MUG-WHITE", 2]], { customerId: String(customer.id), email: `member-${run}@example.com` });
    const [row] = await db().execute<Row>(sql`select member_discount_minor from commerce.orders where id = ${order.orderId}::uuid`);
    expect(Number(row.member_discount_minor)).toBeGreaterThan(0);
    // The signed-in customer's own order needs no email; someone else's customer id does not open it.
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number }, { ...opts, customerId: String(customer.id) })).toMatchObject({ number: order.number });
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number }, { ...opts, customerId: otherCustomer })).toBeNull();
    expect(await w.shopperCanAccessOrder(storeId, order.orderId, { customerId: String(customer.id) })).toBe(true);
    const { done, preview } = await refundWhole(order);
    expect(done).toMatchObject({ ok: true, amountMinor: order.total });
    expect(preview.refund.amountMinor).toBe(order.total);
    expect(lastRefund()).toBe(order.total);
    // An adjusted amount is bounded by what is left, and needs a reason.
    const [ret] = await r.listOrderReturns(storeId, order.orderId);
    expect(await r.refundReturn(storeId, { returnId: ret.id, amountMinor: 1 }, null)).toMatchObject({ ok: false, code: "refunded" });
  });

  it("refunds what was paid in cash when bonus credits paid part of the goods", async () => {
    await db().execute(sql`
      insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, currency)
      values (${storeId}::uuid, true, 500, 14, 50, 0, 'NOK')
      on conflict (store_id) do update set enabled = true, max_redeem_percent = 50, min_redeem_minor = 0
    `);
    const email = `credits-${run}@example.com`;
    const [customer] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${email}) returning id`);
    await db().execute(sql`select commerce.bonus_adjust(${storeId}::uuid, ${String(customer.id)}::uuid, 500000, 'test credits', null, ${`test-${String(customer.id)}`})`);
    try {
      const order = await paidOrder([["DEMO-MUG-WHITE", 2]], { customerId: String(customer.id), credits: 10_000, email });
      const [row] = await db().execute<Row>(sql`select credit_minor from commerce.orders where id = ${order.orderId}::uuid`);
      expect(Number(row.credit_minor)).toBeGreaterThan(0);
      const { done } = await refundWhole(order);
      // The credits paid part of the goods: what is refunded is what the shopper paid in cash, the credits go back by the ledger.
      expect(done).toMatchObject({ ok: true, amountMinor: order.total });
      expect(lastRefund()).toBe(order.total);
    } finally {
      await db().execute(sql`update commerce.bonus_settings set enabled = false where store_id = ${storeId}::uuid`);
    }
  });

  it("takes off return shipping when the shopper pays it, and not when the store does", async () => {
    const one = await paidOrder([["DEMO-TOTE", 1]]);
    const shopperPays = await refundWhole(one, { returnShippingMinor: 5_000 });
    expect(shopperPays.preview.refund).toMatchObject({ returnShippingMinor: 5_000 });
    expect(shopperPays.done).toMatchObject({ ok: true, amountMinor: one.lines[0].total + one.shipping - 5_000 });
    expect(lastRefund()).toBe(one.lines[0].total + one.shipping - 5_000);
    const [row] = await db().execute<Row>(sql`select return_shipping_minor from commerce.returns where id = ${shopperPays.returnId}::uuid`);
    expect(Number(row.return_shipping_minor)).toBe(5_000);

    await saveReturnSettings(storeId, { ...(await getReturnSettings(storeId)), whoPaysReturn: "store" }, null);
    try {
      const two = await paidOrder([["DEMO-TOTE", 1]]);
      const storePays = await refundWhole(two, { returnShippingMinor: 5_000 });
      expect(storePays.preview.refund.returnShippingMinor).toBe(0);
      expect(storePays.done).toMatchObject({ ok: true, amountMinor: two.lines[0].total + two.shipping });
    } finally {
      await saveReturnSettings(storeId, { ...(await getReturnSettings(storeId)), whoPaysReturn: "shopper" }, null);
    }
  });

  it("lets staff raise a withdrawal's refund inside its bounds with a reason, logs it, and never lets them lower it (Art. 13, 14(2))", async () => {
    // Two totes, one withdrawn: there is room above the working.
    const order = await paidOrder([["DEMO-TOTE", 2]]);
    const { returnId } = await withdraw(order, [{ lineId: order.lines[0].id, quantity: 1 }]);
    await received(returnId);
    const preview = (await r.previewRefund(storeId, returnId))!;
    // Lower, with or without a reason: the only things that take from a withdrawal are the inspection's deductions and return shipping.
    expect(await r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor - 100 }, null)).toMatchObject({ ok: false, code: "below_working" });
    expect(await r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor - 100, reason: "Scuffed box" }, null)).toMatchObject({ ok: false, code: "below_working" });
    expect(await r.refundReturn(storeId, { returnId, amountMinor: 0, reason: "No" }, null)).toMatchObject({ ok: false, code: "below_working" });
    // Higher needs its reason and stays inside what is left.
    expect(await r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor + 100 }, null)).toMatchObject({ ok: false, code: "reason_needed" });
    expect(await r.refundReturn(storeId, { returnId, amountMinor: order.total + 1, reason: "Goodwill" }, null)).toMatchObject({ ok: false, code: "over_refundable" });
    const done = await r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor + 100, reason: "Goodwill for the wait" }, null);
    expect(done).toMatchObject({ ok: true, amountMinor: preview.refund.amountMinor + 100, computedMinor: preview.refund.amountMinor, adjusted: true });
    const log = await events(order.orderId);
    expect(log.find((e) => e.type === "return.refund_overridden")!.data).toMatchObject({
      computedMinor: preview.refund.amountMinor,
      requestedMinor: preview.refund.amountMinor + 100,
      reason: "Goodwill for the wait",
    });
    const [row] = await db().execute<Row>(sql`select refund_note, refund_computed_minor, refund_minor from commerce.returns where id = ${returnId}::uuid`);
    expect(row).toMatchObject({ refund_note: "Goodwill for the wait" });
    expect(Number(row.refund_minor) - Number(row.refund_computed_minor)).toBe(100);
    // The shopper is told how the amount was made: the working, with the adjustment as a row of its own and its reason.
    const [mail] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.refunded'`);
    expect(String(mail.text)).toContain("Justering fra butikken");
    expect(String(mail.text)).toContain("Merknad fra butikken: Goodwill for the wait");
  });

  it("shows the shopper each deduction with the store's note, and lets a voluntary return's refund be set lower with a reason", async () => {
    const order = await paidOrder([["DEMO-TOTE", 2]]);
    const { returnId } = await withdraw(order, [{ lineId: order.lines[0].id, quantity: 2 }]);
    await received(returnId);
    expect(
      await r.inspectReturn(storeId, { returnId, lines: [{ lineId: order.lines[0].id, condition: "used", restock: false, deductionMinor: 1500, deductionNote: "Worn and washed" }] }, null),
    ).toMatchObject({ ok: true });
    const worked = (await r.previewRefund(storeId, returnId))!;
    expect(await r.refundReturn(storeId, { returnId, amountMinor: worked.refund.amountMinor }, null)).toMatchObject({ ok: true, adjusted: false });
    const [mail] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.refunded'`);
    expect(String(mail.text)).toContain("Fradrag for ");
    expect(String(mail.text)).toContain("Worn and washed");

    // A voluntary return is the store's own offer: its refund can be lower, with the reason.
    const later = await paidOrder([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set delivered_at = now() - interval '30 days' where id = ${later.orderId}::uuid`);
    const saved = await saveReturnSettings(storeId, { ...(await getReturnSettings(storeId)), windowDays: 60 }, null);
    expect(saved).toMatchObject({ ok: true });
    try {
      const request = await w.startReturnRequest(storeId, { ...statement(later, []), lines: [{ lineId: later.lines[0].id, quantity: 1 }] }, opts);
      if (!request.ok || !request.matched || !request.created) throw new Error(JSON.stringify(request));
      const voluntary = (await r.listOrderReturns(storeId, later.orderId))[0].id;
      expect(await r.approveReturn(storeId, { returnId: voluntary }, null)).toMatchObject({ ok: true });
      await received(voluntary);
      const preview = (await r.previewRefund(storeId, voluntary))!;
      expect(await r.refundReturn(storeId, { returnId: voluntary, amountMinor: preview.refund.amountMinor - 500 }, null)).toMatchObject({ ok: false, code: "reason_needed" });
      expect(await r.refundReturn(storeId, { returnId: voluntary, amountMinor: preview.refund.amountMinor - 500, reason: "Used" }, null)).toMatchObject({ ok: true, adjusted: true });
    } finally {
      await saveReturnSettings(storeId, { ...(await getReturnSettings(storeId)), windowDays: 14 }, null);
    }
  });

  it("records a refund made outside Stripe when the order was paid another way, and still restocks", async () => {
    const order = await paidOrder([["DEMO-MUG-WHITE", 1]], { provider: "venue" });
    const before = await onHand("DEMO-MUG-WHITE");
    const stripeBefore = fake.refunds.length;
    const { returnId } = await withdraw(order);
    await received(returnId);
    const preview = (await r.previewRefund(storeId, returnId))!;
    expect(preview.canRefund).toBe(false);
    expect(preview.refund.amountMinor).toBeGreaterThan(0);
    const done = await r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor, restock: [{ lineId: order.lines[0].id, quantity: 1 }] }, null);
    expect(done).toMatchObject({ ok: true, outside: true, amountMinor: preview.refund.amountMinor });
    expect(fake.refunds.length).toBe(stripeBefore);
    expect(await onHand("DEMO-MUG-WHITE")).toBe(before + 1);
    const [row] = await db().execute<Row>(sql`select refund_outside, refund_id, refund_minor from commerce.returns where id = ${returnId}::uuid`);
    expect(row).toMatchObject({ refund_outside: true, refund_id: null, refund_minor: String(preview.refund.amountMinor) });
    expect((await events(order.orderId)).find((e) => e.type === "return.refunded")!.data).toMatchObject({ outside: true });
  });

  it("puts back only what a short draw took, so a return of the whole line is not refused (review)", async () => {
    // The checkout's hold ran out and the stock was sold meanwhile: paying drew the one unit that was left and wrote `stock.short` for the other.
    const order = await paidOrder([["DEMO-MUG-WHITE", 2]], {
      beforePay: async (orderId) => {
        await db().execute(sql`update commerce.inventory_reservations set expires_at = now() - interval '1 minute' where order_id = ${orderId}::uuid`);
        await db().execute(sql`
          update commerce.inventory_levels set on_hand = 1
          where store_id = ${storeId}::uuid and variant_id = (select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE')
        `);
      },
    });
    expect(await events(order.orderId, "stock.short")).toHaveLength(1);
    expect(await onHand("DEMO-MUG-WHITE")).toBe(0);
    const admin = await getOrderAdmin(storeId, order.orderId);
    expect(admin!.lines[0]).toMatchObject({ quantity: 2, restocked: 0, restockable: 1 });
    const { returnId } = await withdraw(order);
    await received(returnId);
    expect(await r.inspectReturn(storeId, { returnId, lines: [{ lineId: order.lines[0].id, condition: "as_new", restock: true, deductionMinor: 0 }] }, null)).toMatchObject({ ok: true });
    const preview = (await r.previewRefund(storeId, returnId))!;
    // The money is for both units; the stock that goes back is the one that left.
    const done = await r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor }, null);
    expect(done).toMatchObject({ ok: true });
    expect(await onHand("DEMO-MUG-WHITE")).toBe(1);
    expect((await getOrderAdmin(storeId, order.orderId))!.lines[0]).toMatchObject({ restocked: 1, restockable: 0 });
  });

  it("closes a return with nothing to refund as no refund, after asking once for a withdrawal", async () => {
    const order = await paidOrder([["DEMO-TOTE", 1]]);
    const { returnId } = await withdraw(order);
    expect(await r.closeReturn(storeId, { returnId }, null)).toMatchObject({ ok: false, code: "confirm_no_refund" });
    expect(await r.closeReturn(storeId, { returnId }, null, { confirmNoRefund: true })).toMatchObject({ ok: true, outcome: "no_refund" });
  });

  it("checks every step against the lifecycle, the line's value and what is left to put back", async () => {
    const order = await paidOrder([["DEMO-TOTE", 2]]);
    const { returnId } = await withdraw(order);
    const lineId = order.lines[0].id;
    expect(await r.inspectReturn(storeId, { returnId, lines: [{ lineId, condition: "as_new", restock: false, deductionMinor: 0 }] }, null)).toMatchObject({ ok: false, code: "lifecycle" });
    expect(await r.markReceived(storeId, { returnId, on: "2999-01-01" }, null)).toMatchObject({ ok: true });
    expect(await r.markInTransit(storeId, { returnId }, null)).toMatchObject({ ok: false, code: "lifecycle" });
    expect(await r.inspectReturn(storeId, { returnId, lines: [{ lineId, condition: "used", restock: false, deductionMinor: order.lines[0].total + 1, deductionNote: "x" }] }, null)).toMatchObject({ ok: false, code: "deduction" });
    expect(await r.inspectReturn(storeId, { returnId, lines: [{ lineId: "11111111-1111-4111-8111-111111111111", condition: "used", restock: false, deductionMinor: 0 }] }, null)).toMatchObject({ ok: false, code: "not_found" });
    expect(await r.inspectReturn(storeId, { returnId, lines: [{ lineId, condition: "used", restock: true, deductionMinor: 0 }] }, null)).toMatchObject({ ok: true });
    // Restocking more than was returned is refused.
    const worked = (await r.previewRefund(storeId, returnId))!;
    expect(await r.refundReturn(storeId, { returnId, amountMinor: worked.refund.amountMinor, restock: [{ lineId, quantity: 3 }] }, null)).toMatchObject({ ok: false, code: "restock" });
    // A withdrawal is never cancelled (it is effective on the statement): it is closed, and an inspected one can only be closed.
    expect(await r.cancelReturn(storeId, { returnId, note: "Shopper kept it" }, null)).toMatchObject({ ok: false, code: "withdrawal_not_cancellable" });
    expect(await r.closeReturn(storeId, { returnId }, null, { confirmNoRefund: true })).toMatchObject({ ok: true, outcome: "no_refund" });
  });

  it("never cancels a withdrawal, from any step, and says to close it without a refund instead; the withdrawal and its deadline stay on record", async () => {
    const order = await paidOrder([["DEMO-TOTE", 2]]);
    const { returnId } = await withdraw(order);
    const refused = await r.cancelReturn(storeId, { returnId, note: "Goods never came back" }, null);
    expect(refused).toMatchObject({ ok: false, code: "withdrawal_not_cancellable" });
    await received(returnId);
    expect(await r.cancelReturn(storeId, { returnId }, null)).toMatchObject({ ok: false, code: "withdrawal_not_cancellable" });
    // The deadline alert stays: the refund is still owed. "Goods never came back" is a close with no refund the store confirms.
    expect((await r.getReturn(storeId, returnId))!.status).toBe("received");
    expect(await r.closeReturn(storeId, { returnId, note: "Goods never came back" }, null)).toMatchObject({ ok: false, code: "confirm_no_refund" });
    expect(await r.closeReturn(storeId, { returnId, note: "Goods never came back" }, null, { confirmNoRefund: true })).toMatchObject({ ok: true, outcome: "no_refund" });
    expect((await r.getReturn(storeId, returnId))!.staffNote).toBe("Goods never came back");
    // The units stay taken: a withdrawal that was made is not given back by closing it.
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number, email: order.email }, opts)).toMatchObject({ lines: [{ remaining: 0, right: "none" }] });
  });

  it("frees the units of a cancelled voluntary return for a new request", async () => {
    const order = await paidOrder([["DEMO-TOTE", 2]]);
    await db().execute(sql`update commerce.orders set delivered_at = now() - interval '30 days' where id = ${order.orderId}::uuid`);
    const saved = await saveReturnSettings(storeId, { ...(await getReturnSettings(storeId)), windowDays: 60 }, null);
    expect(saved).toMatchObject({ ok: true });
    try {
      const request = await w.startReturnRequest(storeId, { ...statement(order, []), lines: [{ lineId: order.lines[0].id, quantity: 2 }] }, opts);
      if (!request.ok || !request.matched || !request.created) throw new Error(JSON.stringify(request));
      const returnId = request.created.id;
      expect(await r.cancelReturn(storeId, { returnId, note: "Shopper kept it" }, null)).toMatchObject({ ok: true, status: "cancelled" });
      expect((await r.getReturn(storeId, returnId))!.staffNote).toBe("Shopper kept it");
      expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: order.number, email: order.email }, opts)).toMatchObject({ lines: [{ remaining: 2, right: "return" }] });
    } finally {
      await saveReturnSettings(storeId, { ...(await getReturnSettings(storeId)), windowDays: 14 }, null);
    }
  });
});

describe("the store's queue", () => {
  it("lists returns oldest first, filtered and searched, with the overdue mark and counts", async () => {
    const order = await paidOrder([["DEMO-TOTE", 1]]);
    const { returnId, confirmed } = await withdraw(order);
    const number = confirmed.returns[0].number;
    const open = await r.listReturns(storeId, {}, {});
    expect(open.rows.map((x) => x.id)).toContain(returnId);
    // Oldest first.
    const times = open.rows.map((x) => Date.parse(x.createdAt));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect((await r.listReturns(storeId, { q: number })).rows).toMatchObject([{ id: returnId, kind: "withdrawal", status: "approved", orderNumber: order.number, email: order.email, overdue: false }]);
    expect((await r.listReturns(storeId, { q: order.email.toUpperCase().slice(0, 12), kind: "return" })).rows).toEqual([]);
    expect((await r.listReturns(storeId, { status: "closed", q: number })).rows).toEqual([]);
    expect((await r.listReturns(otherStoreId, { q: number })).rows).toEqual([]);
    expect((await r.listReturns(storeId, { q: "100%_" })).rows).toEqual([]);

    // Past the legal deadline: marked overdue, counted, and the store is emailed once.
    await db().execute(sql`update commerce.returns set refund_deadline = now() - interval '1 day' where id = ${returnId}::uuid`);
    expect((await r.listReturns(storeId, { q: number })).rows[0]).toMatchObject({ overdue: true, due: { state: "waiting_late" } });
    expect((await r.listReturns(storeId, { overdue: true })).rows.map((x) => x.id)).toContain(returnId);
    expect((await r.returnCounts(storeId)).overdue).toBeGreaterThanOrEqual(1);
    expect((await jobs.runReturnJobs()).overdueReminders).toBeGreaterThanOrEqual(1);
    const [mail] = await db().execute<Row>(sql`select to_address, subject from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.overdue'`);
    expect(String(mail.to_address)).toBe(`butikk-ret-${run}@example.com`);
    expect(String(mail.subject)).toContain(number);
    await jobs.runReturnJobs();
    expect((await db().execute<Row>(sql`select 1 from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.overdue'`)).length).toBe(1);
  });

  it("never lets another store read or change a return", async () => {
    const order = await paidOrder([["DEMO-TOTE", 1]]);
    const { returnId } = await withdraw(order);
    expect(await r.getReturn(otherStoreId, returnId)).toBeNull();
    expect(await r.previewRefund(otherStoreId, returnId)).toBeNull();
    for (const outcome of [
      await r.markReceived(otherStoreId, { returnId }, null),
      await r.markInTransit(otherStoreId, { returnId }, null),
      await r.cancelReturn(otherStoreId, { returnId }, null),
      await r.closeReturn(otherStoreId, { returnId }, null, { confirmNoRefund: true }),
      await r.refundReturn(otherStoreId, { returnId, amountMinor: 1 }, null),
      await r.setReturnNote(otherStoreId, { returnId, note: "hi" }),
    ]) {
      expect(outcome).toMatchObject({ ok: false, code: "not_found" });
    }
    expect(await w.confirmWithdrawal(otherStoreId, { requestId: (await db().execute<Row>(sql`select id from commerce.withdrawal_requests where order_id = ${order.orderId}::uuid`))[0].id })).toMatchObject({ ok: false });
    expect((await r.getReturn(storeId, returnId))!.status).toBe("approved");
  });
});

describe("the withdrawal link and the settings", () => {
  it("is in the order confirmation and the shipped email of a consumer's goods, with the order page's key", async () => {
    const order = await paidOrder([["DEMO-TOTE", 1]], { ship: false });
    await sendOrderConfirmation(storeId, order.orderId);
    const sent = await markSent(storeId, order.orderId, { carrier: "bring", trackingNumber: "370722", trackingUrl: null }, null);
    if (!sent.ok) throw new Error(sent.reason);
    await sendShipped(storeId, order.orderId, sent.shipment);
    for (const kind of ["order.confirmation", "order.sent"]) {
      const [mail] = await db().execute<Row>(sql`select text, html from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = ${kind}`);
      expect(String(mail.text), kind).toContain("Angre avtalen");
      expect(String(mail.html), kind).toContain(`/withdraw?order=${encodeURIComponent(order.number)}&amp;key=cs_${order.orderId}`);
    }
    // A company's order has no statutory right, so it carries no such link.
    const company = await paidOrder([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set company_name = 'Acme AS' where id = ${company.orderId}::uuid`);
    await sendOrderConfirmation(storeId, company.orderId);
    const [mail] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${company.orderId}::uuid and kind = 'order.confirmation'`);
    expect(String(mail.text)).not.toContain("/withdraw");
  });

  it("keeps the store's rules, with the legal defaults when it has none, never below 14 days", async () => {
    const fresh = await getReturnSettings(otherStoreId);
    expect(fresh).toMatchObject({ windowDays: 14, transitDays: 3, whoPaysReturn: "shopper", refundWhen: "received", acceptExcluded: false, b2bReturns: false });
    expect(await saveReturnSettings(otherStoreId, { ...fresh, windowDays: 10 }, null)).toMatchObject({ ok: false });
    const saved = await saveReturnSettings(
      otherStoreId,
      { ...fresh, windowDays: 30, refundWhen: "request", instructions: "Use the box.", returnAddress: { name: "Lager", street: "Vei 2", postalCode: "0150", city: "Oslo", country: "no" } },
      null,
    );
    expect(saved).toMatchObject({ ok: true, settings: { windowDays: 30, refundWhen: "request", returnAddress: { country: "NO", city: "Oslo" } } });
    expect((await getReturnSettings(storeId)).windowDays).toBe(14);
  });
});
