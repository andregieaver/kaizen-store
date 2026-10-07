import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { conversionFor, localizationOf } from "@/lib/localization";
import { showMarket, toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

/**
 * Regression tests for the review of D153 (`docs/returns.md`): one scenario for each finding, against a real database. The
 * withdrawal period starts from the receipt and never from an estimate, a refund is there from "on its way", a withdrawal
 * before sending has nothing to send back, a withdrawal is never cancelled, sealed goods keep the right, staff register a
 * withdrawal made outside the form, a withdrawal is refunded in full, who pays for return shipping is what the order was sold
 * with, an acknowledgement that was only kept is not sent, nothing is ever emailed to an address a visitor typed, guessing is
 * counted, two refunds at once pay once, and the delivery is given back once and at the standard cost.
 */

const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const state = { fail: 0 };
  const client = {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }) },
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        refunds.push({ params, options });
        const failed = state.fail > 0;
        if (failed) state.fail -= 1;
        return { id: `re_fix_${refunds.length}`, status: failed ? "failed" : "succeeded" };
      },
    },
  };
  return { client, refunds, state };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, WEBHOOK_EVENTS: [] }));

// Email: on for most tests (a provider that accepts everything), off where a kept-only ("logged") email is the point.
let emailCount = 0;
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: `em_fix_${++emailCount}` }), { status: 200, headers: { "content-type": "application/json" } }));
const provider = (on: boolean) => {
  if (on) {
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.EMAIL_FROM = "butikk@example.com";
  } else {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
  }
};
provider(true);

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { markSent } = await import("./order-admin");
const { markDelivered } = await import("./order-delivery");
const { orderReturnsOverview } = await import("./order-returns");
const { sendOrderConfirmation } = await import("./shopper-emails");
const w = await import("./withdrawals");
const r = await import("./returns");
const { getReturnSettings, saveReturnSettings } = await import("./return-settings");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const noInEuro = showMarket(
  { code: "NO", currency: "NOK", defaultLocale: "nb-NO" },
  {
    currency: "EUR",
    conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]), "NOK", "EUR")!,
  },
);
const opts = { floorMs: 0 };
let storeId: string;
let seq = 0;

beforeAll(async () => {
  const slug = `fix-${run}`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'T', 'Fix') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Fix', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_fix${run}`}, 'active', false)`);
  await db().execute(sql`update commerce.stores set contact_email = ${`butikk-${slug}@example.com`} where id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
  `);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

type Placed = { orderId: string; number: string; email: string; total: number; shipping: number; lines: { id: string; sku: string; quantity: number; total: number }[] };

/** A paid order as Checkout leaves it, optionally sent (default) and with a discount code. */
async function paid(
  items: [string, number][],
  over: { market?: typeof no; ship?: boolean; code?: string; customerId?: string | null; extraShipping?: number } = {},
): Promise<Placed> {
  const market = over.market ?? no;
  const email = `s${++seq}-${run}@example.com`;
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at, discount_code)
    values (${storeId}::uuid, 'NO', ${market.currency}, 'nb-NO', now() + interval '1 day', ${over.code ?? null}) returning id
  `);
  for (const [sku, quantity] of items) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      select ${storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
    `);
  }
  const result = await placeOrder({ storeId, market }, String(cart.id), {}, { customerId: over.customerId ?? null });
  if (!result.ok) throw new Error(result.problem);
  const { orderId } = result.order;
  if (over.extraShipping) {
    // A carrier's dearer service the shopper chose (D135): the order says so, and its delivery costs more than the flat rate.
    await db().execute(sql`
      update commerce.orders set delivery = '{"label":"Express home"}'::jsonb, shipping_minor = shipping_minor + ${over.extraShipping},
        total_minor = total_minor + ${over.extraShipping} where id = ${orderId}::uuid
    `);
  }
  const [o] = await db().execute<Row>(sql`select total_minor, shipping_minor, currency from commerce.orders where id = ${orderId}::uuid`);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status)
    values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_fix${run}`}, ${Number(o.total_minor)}, ${String(o.currency).trim()}, 'captured')
  `);
  await completeOrderPayment(orderId, `cs_${orderId}`);
  await db().execute(sql`update commerce.orders set email = ${email} where id = ${orderId}::uuid`);
  if (over.ship !== false) await markSent(storeId, orderId, { carrier: "other", trackingNumber: `T-${orderId.slice(0, 8)}`, trackingUrl: null }, null);
  const [order] = await db().execute<Row>(sql`select number from commerce.orders where id = ${orderId}::uuid`);
  const lines = await db().execute<Row>(sql`select id, sku, quantity, total_minor from commerce.order_lines where order_id = ${orderId}::uuid order by sku`);
  return {
    orderId,
    email,
    number: String(order.number),
    total: Number(o.total_minor),
    shipping: Number(o.shipping_minor),
    lines: lines.map((l) => ({ id: String(l.id), sku: String(l.sku), quantity: Number(l.quantity), total: Number(l.total_minor) })),
  };
}

const allOf = (o: Placed) => o.lines.map((l) => ({ lineId: l.id, quantity: l.quantity }));
const statement = (o: Placed, lines = allOf(o), over: Record<string, unknown> = {}) => ({ orderNumber: o.number, email: o.email, name: "K N", lines, ...over });

async function withdraw(o: Placed, lines = allOf(o)) {
  const started = await w.startWithdrawal(storeId, statement(o, lines), opts);
  if (!started.ok || !started.matched || !started.request) throw new Error(`step 1: ${JSON.stringify(started)}`);
  const confirmed = await w.confirmWithdrawal(storeId, { requestId: started.request.id });
  if (!confirmed.ok) throw new Error(`step 2: ${JSON.stringify(confirmed)}`);
  return { started, confirmed, returnId: confirmed.returns[0].id, requestId: started.request.id };
}

const ago = (days: number) => sql`now() - ${`${days} days`}::interval`;
/** Dates an order's parcels back (a parcel's details are a record the database freezes, D174 follow-up: a test may move its date around the rules). */
const backdateParcels = (orderId: string, days: number) =>
  db().transaction(async (tx) => {
    await tx.execute(sql`set local session_replication_role = replica`);
    await tx.execute(sql`update commerce.shipments set created_at = ${ago(days)} where order_id = ${orderId}::uuid`);
  });
const mails = async (orderId: string, kind?: string) =>
  (await db().execute<Row>(sql`select kind, to_address, status, text from commerce.email_messages where order_id = ${orderId}::uuid order by created_at`)).filter((m) => !kind || m.kind === kind);

describe("the 14 days start when the goods are received, never from an estimate", () => {
  it("lets a consumer withdraw on day 19 after sending when the parcel took 8 days, and closes only from the recorded receipt", async () => {
    // Sent 19 days ago, received 9 days ago: by the estimate (sent + 3 days) the right would be over, but it runs to 5 days from now.
    const order = await paid([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set placed_at = ${ago(25)} where id = ${order.orderId}::uuid`);
    await backdateParcels(order.orderId, 19);
    const unknown = await orderReturnsOverview(storeId, order.orderId);
    expect(unknown!.window).toMatchObject({ state: "statutory", basis: "sent", startDay: null, statutoryEndDay: null });
    expect(unknown!.window!.estimatedEndDay).toBeTruthy();
    // The statement is accepted: the right is open while the receipt is not recorded.
    const started = await w.startWithdrawal(storeId, statement(order), opts);
    expect(started).toMatchObject({ ok: true, matched: true, problems: [], order: { right: "withdrawal", window: { state: "statutory", basis: "sent" } } });
    // Staff record the day the parcel arrived: 9 days ago. The period counts from it.
    const day = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10);
    expect(await markDelivered(storeId, { orderId: order.orderId, on: day }, null)).toMatchObject({ ok: true });
    const received = await orderReturnsOverview(storeId, order.orderId);
    expect(received!.window).toMatchObject({ state: "statutory", basis: "delivered", startDay: day });
    expect(received!.deliveredOn).toBe(day);
    // And a receipt recorded 20 days ago closes it: the records, not an estimate, say the period is over.
    const old = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    expect(await markDelivered(storeId, { orderId: order.orderId, on: old }, null)).toMatchObject({ ok: true });
    expect(await w.startWithdrawal(storeId, statement(order), opts)).toMatchObject({ ok: true, matched: true, request: null, problems: [{ code: "no_right" }] });
  });

  it("counts goods sent in parts from the last: the receipt waits for the last parcel (D174, CRD Art. 9(2)(b))", async () => {
    const order = await paid([["DEMO-TOTE", 2]], { ship: false });
    const [line] = order.lines;
    await db().execute(sql`update commerce.orders set placed_at = ${ago(35)} where id = ${order.orderId}::uuid`);
    // The first part is sent: the order is partly sent, still paid, and no receipt can be recorded yet.
    expect(await markSent(storeId, order.orderId, { carrier: "other", trackingNumber: "PART-1", trackingUrl: null }, null, null, { lines: [{ lineId: line.id, quantity: 1 }] })).toMatchObject({ ok: true, left: 1 });
    await backdateParcels(order.orderId, 30);
    const day = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
    expect(await markDelivered(storeId, { orderId: order.orderId, on: day }, null)).toMatchObject({ ok: false });
    const partly = await orderReturnsOverview(storeId, order.orderId);
    expect(partly!.deliveredOn).toBeNull();
    // The last part is sent: now the receipt can be recorded, and it is the last parcel's that counts.
    expect(await markSent(storeId, order.orderId, { carrier: "other", trackingNumber: "PART-2", trackingUrl: null }, null)).toMatchObject({ ok: true, left: 0 });
    expect(await markDelivered(storeId, { orderId: order.orderId, on: "" }, null)).toMatchObject({ ok: true });
    // Nothing is left, so no later parcel can take the receipt back.
    expect(await markSent(storeId, order.orderId, { carrier: "other", trackingNumber: "PART-3", trackingUrl: null }, null)).toEqual({ ok: false, reason: "nothing_to_send" });
  });

  it("only records a receipt for an order that was sent, never in the future, never before the order", async () => {
    const unsent = await paid([["DEMO-TOTE", 1]], { ship: false });
    expect(await markDelivered(storeId, { orderId: unsent.orderId, on: null }, null)).toMatchObject({ ok: false, code: "not_sent" });
    const sent = await paid([["DEMO-TOTE", 1]]);
    expect(await markDelivered(storeId, { orderId: sent.orderId, on: "2999-01-01" }, null)).toMatchObject({ ok: false, code: "future" });
    expect(await markDelivered(storeId, { orderId: sent.orderId, on: "2001-01-01" }, null)).toMatchObject({ ok: false, code: "before_order" });
    expect(await markDelivered(storeId, { orderId: sent.orderId, on: "not a day" }, null)).toMatchObject({ ok: false, code: "invalid" });
    expect(await markDelivered(storeId, { orderId: sent.orderId, on: null }, null)).toMatchObject({ ok: true });
  });
});

describe("a refund is there from the proof of sending, and a withdrawal before sending has nothing to wait for", () => {
  it("refunds a return that is on its way without marking it received (Art. 13(3))", async () => {
    const order = await paid([["DEMO-TOTE", 1]]);
    const { returnId } = await withdraw(order);
    // Shown the proof of sending: the refund is offered and the queue says it is due.
    expect(await r.markInTransit(storeId, { returnId }, null)).toMatchObject({ ok: true });
    const detail = await r.getReturn(storeId, returnId);
    expect(detail!.actions).toContain("refund");
    expect(detail!.due.state).toBe("due");
    const preview = (await r.previewRefund(storeId, returnId))!;
    expect(await r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor }, null)).toMatchObject({ ok: true });
    // Nothing false was recorded: the goods have not arrived, so there is no received time and no "arrived" email.
    const [row] = await db().execute<Row>(sql`select status, received_at, refund_minor from commerce.returns where id = ${returnId}::uuid`);
    expect(row.received_at).toBeNull();
    expect(Number(row.refund_minor)).toBe(preview.refund.amountMinor);
    expect(await mails(order.orderId, "return.received")).toHaveLength(0);
    expect(await mails(order.orderId, "return.refunded")).toHaveLength(1);
    // Still refused while the goods are not even on their way and the store waits for them.
    const other = await paid([["DEMO-TOTE", 1]]);
    const second = await withdraw(other);
    expect(await r.refundReturn(storeId, { returnId: second.returnId, amountMinor: 1 }, null)).toMatchObject({ ok: false, code: "not_received" });
  });

  it("makes a withdrawal before the goods were sent due at once: nothing to send back, no hold, no false received", async () => {
    const order = await paid([["DEMO-TOTE", 1]], { ship: false });
    const { confirmed, returnId } = await withdraw(order);
    expect(confirmed.nothingSent).toBe(true);
    // The acknowledgement says nothing to send back, no return cost and no hold; the page and the shopper's status say the same.
    const text = confirmed.acknowledgement.text!;
    expect(text).toContain("Varene var ikke sendt da du angret");
    expect(text).not.toContain("Send varene tilbake");
    expect(text).not.toContain("holde tilbake pengene");
    expect(text).not.toContain("kostnaden ved å sende varene tilbake");
    const detail = await r.getReturn(storeId, returnId);
    expect(detail).toMatchObject({ nothingSent: true, due: { state: "due" } });
    expect(detail!.actions).toContain("refund");
    expect(await r.getShopperReturn(storeId, detail!.publicToken)).toMatchObject({ nothingSent: true });
    // The refund is made without anything marked received.
    const preview = (await r.previewRefund(storeId, returnId))!;
    expect(await r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const [row] = await db().execute<Row>(sql`select received_at from commerce.returns where id = ${returnId}::uuid`);
    expect(row.received_at).toBeNull();
    expect(await mails(order.orderId, "return.received")).toHaveLength(0);
    // For goods that were sent, the same shopper-facing text still sends back and holds the refund.
    const sent = await paid([["DEMO-TOTE", 1]]);
    const { confirmed: sentConfirmed } = await withdraw(sent);
    expect(sentConfirmed.nothingSent).toBe(false);
    expect(sentConfirmed.acknowledgement.text).toContain("Send varene tilbake");
    expect(sentConfirmed.acknowledgement.text).toContain("holde tilbake pengene");
  });

  it("does not send a parcel whose every unit was withdrawn, and tells staff to leave out what was withdrawn of a part", async () => {
    const whole = await paid([["DEMO-TOTE", 1]], { ship: false });
    await withdraw(whole);
    expect(await markSent(storeId, whole.orderId, { carrier: "other", trackingNumber: "T", trackingUrl: null }, null)).toEqual({ ok: false, reason: "withdrawn_in_full" });
    const [shipments] = await db().execute<Row>(sql`select count(*)::int as n from commerce.shipments where order_id = ${whole.orderId}::uuid`);
    expect(shipments.n).toBe(0);

    const partial = await paid([["DEMO-TOTE", 1], ["DEMO-MUG-WHITE", 1]], { ship: false });
    const tote = partial.lines.find((l) => l.sku === "DEMO-TOTE")!;
    await withdraw(partial, [{ lineId: tote.id, quantity: 1 }]);
    const overview = await orderReturnsOverview(storeId, partial.orderId);
    expect(overview!.sent).toBe(false);
    expect(overview!.heldBack).toEqual([{ title: expect.any(String), quantity: 1 }]);
    // The rest can still be sent.
    expect(await markSent(storeId, partial.orderId, { carrier: "other", trackingNumber: "T2", trackingUrl: null }, null)).toMatchObject({ ok: true, left: 0 });
  });
});

describe("sealed goods keep the right until they are unsealed", () => {
  it("accepts the withdrawal of sealed hygiene goods with the condition said, and leaves the seal to the inspection", async () => {
    const order = await paid([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.order_lines set withdrawal_exclusion = 'sealed_hygiene' where order_id = ${order.orderId}::uuid`);
    const started = await w.startWithdrawal(storeId, statement(order), opts);
    if (!started.ok || !started.matched) throw new Error(JSON.stringify(started));
    expect(started.order.lines[0]).toMatchObject({ right: "withdrawal", sealed: true, refusal: null });
    expect(started.problems).toEqual([]);
    const confirmed = await w.confirmWithdrawal(storeId, { requestId: started.request!.id });
    if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
    expect(confirmed.acknowledgement.text).toContain("forseglingen ikke er brutt");
    const returnId = confirmed.returns[0].id;
    expect(confirmed.returns[0].lines[0]).toMatchObject({ decision: "accept" });
    await r.markInTransit(storeId, { returnId }, null);
    await r.markReceived(storeId, { returnId }, null);
    // The goods came back opened: the inspection takes the whole value off (a deduction with its note), or declines the line.
    const line = confirmed.returns[0].lines[0].lineId;
    expect(await r.declineReturnLine(storeId, { returnId, lineId: line, reason: "The seal was broken" }, null)).toMatchObject({ ok: true });
    // Other exclusions are still refused at step 1.
    const perishable = await paid([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.order_lines set withdrawal_exclusion = 'perishable' where order_id = ${perishable.orderId}::uuid`);
    expect(await w.startWithdrawal(storeId, statement(perishable), opts)).toMatchObject({ ok: true, matched: true, request: null, problems: [{ code: "no_right" }] });
  });
});

describe("staff register a withdrawal made outside the function", () => {
  it("records it as the two steps would, with the day the store was told starting the 14 days, and the acknowledgement to the order's address", async () => {
    const order = await paid([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set delivered_at = ${ago(5)} where id = ${order.orderId}::uuid`);
    const told = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const done = await w.registerWithdrawal(
      storeId,
      { orderNumber: ` ${order.number.toLowerCase()} `, name: "Kari Nordmann", channel: "email", informedOn: told, lines: allOf(order), note: "Wrote to butikk@ with the wrong order number" },
      null,
    );
    if (!done.ok) throw new Error(JSON.stringify(done));
    expect(done).toMatchObject({ number: `${order.number}-R1`, acknowledged: true });
    const [row] = await db().execute<Row>(sql`
      select w.channel, w.email, w.confirmed_at, w.submitted_at, r.kind, r.status, r.refund_deadline, r.staff_note, w.acknowledged_at
      from commerce.returns r join commerce.withdrawal_requests w on w.id = r.withdrawal_request_id where r.id = ${done.returnId}::uuid
    `);
    expect(row).toMatchObject({ channel: "email", email: order.email, kind: "withdrawal", status: "approved" });
    // The store was told 3 days ago (noon, the store's day): that moment starts the refund's 14 days and is what the acknowledgement states.
    expect(Date.parse(String(row.confirmed_at))).toBeLessThan(Date.now() - 2 * 86_400_000);
    expect(Date.parse(String(row.refund_deadline)) - Date.parse(String(row.confirmed_at))).toBe(14 * 86_400_000);
    expect(String(row.staff_note)).toContain("Registered by staff (email)");
    expect(row.acknowledged_at).not.toBeNull();
    const [ack] = await mails(order.orderId, "return.acknowledgement");
    expect(String(ack.to_address)).toBe(order.email);
    const [event] = await db().execute<Row>(sql`select data, actor from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'return.confirmed'`);
    expect(event.actor).toBe("staff");
    expect(event.data).toMatchObject({ registered: { channel: "email", late: false } });
    // The queue has it: the deadline clock and the overdue alert exist for a withdrawal made by email.
    expect((await r.getReturn(storeId, done.returnId))!.due.deadline).toBeTruthy();
  });

  it("judges the period as it stood when the store was told, and takes a late statement only with the reason", async () => {
    const order = await paid([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set delivered_at = ${ago(40)} where id = ${order.orderId}::uuid`);
    const base = { orderNumber: order.number, name: "Kari", channel: "letter", informedOn: null, lines: allOf(order) };
    expect(await w.registerWithdrawal(storeId, base, null)).toMatchObject({ ok: false, code: "line_no_right" });
    expect(await w.registerWithdrawal(storeId, { ...base, late: true }, null)).toMatchObject({ ok: false, code: "invalid" });
    // Told 35 days ago, when the period was still open, needs no excuse.
    const earlier = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
    const late = await w.registerWithdrawal(storeId, { ...base, late: true, lateReason: "We never gave the information about the right of withdrawal" }, null);
    expect(late).toMatchObject({ ok: true });
    if (!late.ok) return;
    expect((await r.getReturn(storeId, late.returnId))!.staffNote).toContain("never gave the information");
    // A statement that was in time when the store was told is accepted without it.
    const another = await paid([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set delivered_at = ${ago(40)} where id = ${another.orderId}::uuid`);
    expect(await w.registerWithdrawal(storeId, { ...base, orderNumber: another.number, informedOn: earlier, lines: allOf(another) }, null)).toMatchObject({ ok: true });
  });

  it("refuses an unknown order, another store's, a future day, a line with no right, and more than is left", async () => {
    const order = await paid([["DEMO-TOTE", 2]]);
    const base = { orderNumber: order.number, name: "Kari", channel: "phone", informedOn: null, lines: [{ lineId: order.lines[0].id, quantity: 1 }] };
    expect(await w.registerWithdrawal(storeId, { ...base, orderNumber: "NO-SUCH-1" }, null)).toMatchObject({ ok: false, code: "not_found" });
    expect(await w.registerWithdrawal(storeId, { ...base, informedOn: "2999-01-01" }, null)).toMatchObject({ ok: false, code: "future" });
    expect(await w.registerWithdrawal(storeId, { ...base, channel: "carrier pigeon" }, null)).toMatchObject({ ok: false, code: "invalid" });
    expect(await w.registerWithdrawal(storeId, { ...base, lines: [{ lineId: order.lines[0].id, quantity: 3 }] }, null)).toMatchObject({ ok: false, code: "line_too_many" });
    expect(await w.registerWithdrawal(storeId, { ...base, lines: [{ lineId: "11111111-1111-4111-8111-111111111111", quantity: 1 }] }, null)).toMatchObject({ ok: false, code: "line_unknown_line" });
    expect(await w.registerWithdrawal(storeId, base, null)).toMatchObject({ ok: true });
    expect(await w.registerWithdrawal(storeId, { ...base, lines: [{ lineId: order.lines[0].id, quantity: 2 }] }, null)).toMatchObject({ ok: false, code: "line_too_many" });
  });
});

describe("a withdrawal is refunded in full, and its costs are the ones it was sold with", () => {
  it("shows who pays for return shipping as the order was sold, not as the store has it now", async () => {
    const before = await getReturnSettings(storeId);
    try {
      await saveReturnSettings(storeId, { ...before, whoPaysReturn: "store" }, null);
      const soldStorePays = await paid([["DEMO-TOTE", 1]]);
      await saveReturnSettings(storeId, { ...before, whoPaysReturn: "shopper" }, null);
      const soldShopperPays = await paid([["DEMO-TOTE", 1]]);
      const [snap] = await db().execute<Row>(sql`select return_cost_payer from commerce.orders where id = ${soldStorePays.orderId}::uuid`);
      expect(snap.return_cost_payer).toBe("store");
      // The setting now says the shopper pays; the order sold under "store pays" keeps saying the store does.
      const a = await withdraw(soldStorePays);
      expect(a.confirmed.acknowledgement.text).toContain("Butikken dekker kostnaden ved å sende varene tilbake");
      expect(await r.getShopperReturn(storeId, (await r.getReturn(storeId, a.returnId))!.publicToken)).toMatchObject({ whoPaysReturn: "store" });
      await r.markInTransit(storeId, { returnId: a.returnId }, null);
      expect((await r.previewRefund(storeId, a.returnId, 5_000))!.refund.returnShippingMinor).toBe(0);
      const b = await withdraw(soldShopperPays);
      expect(b.confirmed.acknowledgement.text).toContain("Du dekker selv kostnaden ved å sende varene tilbake");
      await r.markInTransit(storeId, { returnId: b.returnId }, null);
      expect((await r.previewRefund(storeId, b.returnId, 5_000))!.refund.returnShippingMinor).toBe(5_000);
      // An order with no record of it was not told of the cost: it is the store's.
      const unrecorded = await paid([["DEMO-TOTE", 1]]);
      await db().execute(sql`update commerce.orders set return_cost_payer = null where id = ${unrecorded.orderId}::uuid`);
      const c = await withdraw(unrecorded);
      await r.markInTransit(storeId, { returnId: c.returnId }, null);
      expect((await r.previewRefund(storeId, c.returnId, 5_000))!.refund.returnShippingMinor).toBe(0);
      // And the order confirmation tells the shopper who pays, in words, when the order is placed.
      await sendOrderConfirmation(storeId, soldShopperPays.orderId);
      expect(String((await mails(soldShopperPays.orderId, "order.confirmation"))[0].text)).toContain("Angrer du kjøpet, betaler du selv kostnaden ved å sende varene tilbake");
    } finally {
      await saveReturnSettings(storeId, { ...before, whoPaysReturn: "shopper" }, null);
    }
  });
});

describe("an acknowledgement that was only kept has not been sent", () => {
  it("is not recorded as sent while no email provider is set up, says so on the page, and is sent and recorded once there is one", async () => {
    provider(false);
    try {
      const order = await paid([["DEMO-TOTE", 1]]);
      const { confirmed, requestId } = await withdraw(order);
      expect(confirmed.acknowledgement.sent).toBe(false);
      expect(confirmed.acknowledgement.text).toBeTruthy(); // the page still shows it
      const [message] = await mails(order.orderId, "return.acknowledgement");
      expect(message.status).toBe("logged");
      const [request] = await db().execute<Row>(sql`select acknowledged_at, acknowledgement_reference from commerce.withdrawal_requests where id = ${requestId}::uuid`);
      expect(request.acknowledged_at).toBeNull();
      expect(request.acknowledgement_reference).toBeNull();
      expect((await r.listReturns(storeId, { q: confirmed.returns[0].number })).rows[0].acknowledgementPending).toBe(true);
      expect((await r.getReturn(storeId, confirmed.returns[0].id))!.request!.acknowledgement).toBe("not_sent");
      // With a provider, sending again hands it over and records it.
      provider(true);
      expect(await w.resendAcknowledgement(storeId, requestId)).toMatchObject({ ok: true, sent: true });
      const [after] = await db().execute<Row>(sql`select acknowledged_at from commerce.withdrawal_requests where id = ${requestId}::uuid`);
      expect(after.acknowledged_at).not.toBeNull();
    } finally {
      provider(true);
    }
  });
});

describe("a withdrawal's emails go to the order's own address, never to one a visitor typed", () => {
  it("keeps the order's address when the order is proven by its page's key, and sends everything there", async () => {
    const order = await paid([["DEMO-TOTE", 1]]);
    const victim = `victim-${run}@example.org`;
    const started = await w.startWithdrawal(storeId, { orderNumber: order.number, email: victim, name: "Mallory", lines: allOf(order), orderKey: `cs_${order.orderId}` }, opts);
    if (!started.ok || !started.matched || !started.request) throw new Error(JSON.stringify(started));
    expect(started.request.email).toBe(order.email);
    const confirmed = await w.confirmWithdrawal(storeId, { requestId: started.request.id });
    if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
    expect(confirmed.acknowledgement.to).toBe(order.email);
    await r.markInTransit(storeId, { returnId: confirmed.returns[0].id }, null);
    await r.markReceived(storeId, { returnId: confirmed.returns[0].id }, null);
    const preview = (await r.previewRefund(storeId, confirmed.returns[0].id))!;
    await r.refundReturn(storeId, { returnId: confirmed.returns[0].id, amountMinor: preview.refund.amountMinor }, null);
    const sent = await mails(order.orderId);
    const returns = sent.filter((m) => String(m.kind).startsWith("return."));
    expect(returns.map((m) => m.kind)).toEqual(expect.arrayContaining(["return.acknowledgement", "return.received", "return.refunded"]));
    expect(returns.filter((m) => String(m.to_address) !== order.email)).toEqual([]);
    // A typed address that matches the order is no different.
    const same = await paid([["DEMO-TOTE", 1]]);
    const again = await withdraw(same);
    expect(again.started.request?.email).toBe(same.email);
  });
});

describe("guesses at an order are counted, by what the request supplies", () => {
  it("stops a walk through order numbers with one email, keeping only hashes, and does not count a match", async () => {
    const email = `walker-${run}@example.com`;
    const real = await paid([["DEMO-TOTE", 1]]);
    await db().execute(sql`update commerce.orders set email = ${email} where id = ${real.orderId}::uuid`);
    for (let i = 0; i < 10; i++) {
      expect(await w.startWithdrawal(storeId, { orderNumber: `9${i}${run}`, email, name: "X", lines: allOf(real) }, opts)).toMatchObject({ ok: true, matched: false });
    }
    // The eleventh is refused, whatever the number: the real one is not given away by being answered differently.
    expect(await w.startWithdrawal(storeId, { orderNumber: real.number, email, name: "X", lines: allOf(real) }, opts)).toMatchObject({ ok: false, reason: "limited" });
    expect(await w.startWithdrawal(storeId, { orderNumber: "424242", email, name: "X", lines: allOf(real) }, opts)).toMatchObject({ ok: false, reason: "limited" });
    // The page's own lookup is counted too.
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: real.number, email }, opts)).toBeNull();
    // Only hashes of the supplied values are kept: neither the email nor a number is in the table.
    const kept = await db().execute<Row>(sql`select key_kind, key_hash from commerce.withdrawal_attempts where store_id = ${storeId}::uuid`);
    expect(kept.length).toBeGreaterThanOrEqual(10);
    for (const row of kept) {
      expect(String(row.key_hash)).toMatch(/^[0-9a-f]{64}$/);
      expect(String(row.key_hash)).not.toContain("walker");
    }
    // Another email is not held back by it, and a match records nothing.
    const fine = await paid([["DEMO-TOTE", 1]]);
    const before = (await db().execute<Row>(sql`select count(*)::int as n from commerce.withdrawal_attempts where store_id = ${storeId}::uuid`))[0].n;
    expect(await w.startWithdrawal(storeId, statement(fine), opts)).toMatchObject({ ok: true, matched: true });
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.withdrawal_attempts where store_id = ${storeId}::uuid`))[0].n).toBe(before);
  });

  it("stops one order number being tried with many emails", async () => {
    const real = await paid([["DEMO-TOTE", 1]]);
    for (let i = 0; i < 10; i++) {
      expect(await w.startWithdrawal(storeId, { orderNumber: real.number, email: `guess${i}-${run}@example.com`, name: "X", lines: allOf(real) }, opts)).toMatchObject({ ok: true, matched: false });
    }
    expect(await w.startWithdrawal(storeId, statement(real), opts)).toMatchObject({ ok: false, reason: "limited" });
  });

  it("never locks the consumer out: the order page's key, which cannot be guessed, and being signed in are not turned away by anyone else's guessing", async () => {
    const real = await paid([["DEMO-TOTE", 1]]);
    for (let i = 0; i < 10; i++) await w.startWithdrawal(storeId, { orderNumber: real.number, email: `flood${i}-${run}@example.com`, name: "X", lines: allOf(real) }, opts);
    // By email and number, turned away; by the key from the order's own page, it goes through, and the page's lookup too.
    expect(await w.startWithdrawal(storeId, statement(real), opts)).toMatchObject({ ok: false, reason: "limited" });
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: real.number, email: real.email }, opts)).toBeNull();
    expect(await w.startWithdrawal(storeId, { orderNumber: real.number, email: real.email, name: "K", lines: allOf(real), orderKey: `cs_${real.orderId}` }, opts)).toMatchObject({
      ok: true,
      matched: true,
      request: { orderNumber: real.number },
    });
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: real.number, orderKey: `cs_${real.orderId}` }, opts)).toMatchObject({ number: real.number });
    // A wrong key is only a guess.
    expect(await w.lookupWithdrawableOrder(storeId, { orderNumber: real.number, orderKey: "cs_wrong" }, opts)).toBeNull();
  });
});

describe("two refunds of one return at once pay once", () => {
  it("claims the refund before Stripe is called, whatever the amounts, and releases the claim when Stripe fails", async () => {
    const order = await paid([["DEMO-TOTE", 2]]);
    const { returnId } = await withdraw(order, [{ lineId: order.lines[0].id, quantity: 1 }]);
    await r.markInTransit(storeId, { returnId }, null);
    const preview = (await r.previewRefund(storeId, returnId))!;
    const sent = fake.refunds.length;
    // Two staff at once, one at the working and one raising it with a reason: Stripe is asked for one refund only.
    const results = await Promise.all([
      r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor }, null),
      r.refundReturn(storeId, { returnId, amountMinor: preview.refund.amountMinor + 100, reason: "Goodwill" }, null),
    ]);
    expect(results.filter((x) => x.ok)).toHaveLength(1);
    expect(fake.refunds.length - sent).toBe(1);
    const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.refunds rf join commerce.payments p on p.id = rf.payment_id where p.order_id = ${order.orderId}::uuid`);
    expect(count.n).toBe(1);
    expect(results.find((x) => !x.ok)).toMatchObject({ ok: false });
    const [claim] = await db().execute<Row>(sql`select refund_claimed_at, refund_minor from commerce.returns where id = ${returnId}::uuid`);
    expect(claim.refund_claimed_at).toBeNull();
    expect(claim.refund_minor).not.toBeNull();

    // A refund Stripe reports as failed releases the claim: the next try is a new Stripe refund with its own key.
    const second = await paid([["DEMO-TOTE", 1]]);
    const sec = await withdraw(second);
    await r.markInTransit(storeId, { returnId: sec.returnId }, null);
    const want = (await r.previewRefund(storeId, sec.returnId))!.refund.amountMinor;
    fake.state.fail = 1;
    expect(await r.refundReturn(storeId, { returnId: sec.returnId, amountMinor: want }, null)).toMatchObject({ ok: false, code: "stripe_failed" });
    const firstKey = String(fake.refunds.at(-1)!.options.idempotencyKey);
    expect((await db().execute<Row>(sql`select refund_claimed_at from commerce.returns where id = ${sec.returnId}::uuid`))[0].refund_claimed_at).toBeNull();
    expect(await r.refundReturn(storeId, { returnId: sec.returnId, amountMinor: want }, null)).toMatchObject({ ok: true });
    const retryKey = String(fake.refunds.at(-1)!.options.idempotencyKey);
    expect(retryKey).not.toBe(firstKey);
    expect(firstKey).toBe(`return-refund:${sec.returnId}:0`);
    expect(retryKey).toBe(`return-refund:${sec.returnId}:1`);
  });

  it("refuses a refund while another member's is with Stripe, and takes over a claim that was left behind", async () => {
    const order = await paid([["DEMO-TOTE", 1]]);
    const { returnId } = await withdraw(order);
    await r.markInTransit(storeId, { returnId }, null);
    const want = (await r.previewRefund(storeId, returnId))!.refund.amountMinor;
    await db().execute(sql`update commerce.returns set refund_claimed_at = now() where id = ${returnId}::uuid`);
    expect(await r.refundReturn(storeId, { returnId, amountMinor: want }, null)).toMatchObject({ ok: false, code: "refund_busy" });
    await db().execute(sql`update commerce.returns set refund_claimed_at = now() - interval '5 minutes' where id = ${returnId}::uuid`);
    expect(await r.refundReturn(storeId, { returnId, amountMinor: want }, null)).toMatchObject({ ok: true });
  });
});

describe("the delivery is given back once, at the standard cost", () => {
  it("keeps the standard delivery with the order, so a euro view refunds the market's flat rate, not the dearer service", async () => {
    const order = await paid([["DEMO-TOTE", 1]], { market: noInEuro, extraShipping: 2_000 });
    const [snap] = await db().execute<Row>(sql`select standard_shipping_minor from commerce.orders where id = ${order.orderId}::uuid`);
    const flat = order.shipping - 2_000;
    expect(Number(snap.standard_shipping_minor)).toBe(flat);
    const { returnId } = await withdraw(order);
    await r.markInTransit(storeId, { returnId }, null);
    expect((await r.previewRefund(storeId, returnId))!.refund.shippingRefundMinor).toBe(flat);
  });

  it("judges free delivery on the basket before discounts, as checkout did, so a code that lowers the goods below the limit does not make the dearer service refundable", async () => {
    const probe = await paid([["DEMO-TOTE", 1]], { ship: false });
    const unit = probe.lines[0].total;
    await db().execute(sql`update commerce.shipping_rates set amount_minor = 6900, free_over_minor = ${unit} where store_id = ${storeId}::uuid and market_code = 'NO'`);
    await db().execute(sql`insert into commerce.discount_codes (store_id, code, kind, percent) values (${storeId}::uuid, ${`TWENTY${run}`.toUpperCase()}, 'percent', 20)`);
    try {
      const order = await paid([["DEMO-TOTE", 1]], { code: `TWENTY${run}`.toUpperCase(), extraShipping: 2_000 });
      // The basket before the code reached the limit, so the standard delivery was free; the 2000 is the dearer service's alone.
      const [snap] = await db().execute<Row>(sql`select standard_shipping_minor, shipping_minor from commerce.orders where id = ${order.orderId}::uuid`);
      expect(Number(snap.standard_shipping_minor)).toBe(0);
      const { returnId } = await withdraw(order);
      await r.markInTransit(storeId, { returnId }, null);
      expect((await r.previewRefund(storeId, returnId))!.refund.shippingRefundMinor).toBe(0);
    } finally {
      await db().execute(sql`update commerce.shipping_rates set amount_minor = 9900, free_over_minor = 99900 where store_id = ${storeId}::uuid and market_code = 'NO'`);
    }
  });

  it("gives the delivery back with the withdrawal that completes the order and no other: only settled withdrawals count, earlier or later, and what was given back is kept", async () => {
    const order = await paid([["DEMO-TOTE", 1], ["DEMO-MUG-WHITE", 1]]);
    const tote = order.lines.find((l) => l.sku === "DEMO-TOTE")!;
    const mug = order.lines.find((l) => l.sku === "DEMO-MUG-WHITE")!;
    const first = await withdraw(order, [{ lineId: tote.id, quantity: 1 }]);
    const second = await withdraw(order, [{ lineId: mug.id, quantity: 1 }]);
    await r.markInTransit(storeId, { returnId: first.returnId }, null);
    await r.markInTransit(storeId, { returnId: second.returnId }, null);
    // The second goes first, while the first's goods are only on their way: the order is not yet complete, so no delivery with it.
    const early = (await r.previewRefund(storeId, second.returnId))!;
    expect(early.refund).toMatchObject({ wholeOrder: false, shippingRefundMinor: 0 });
    expect(await r.refundReturn(storeId, { returnId: second.returnId, amountMinor: early.refund.amountMinor }, null)).toMatchObject({ ok: true });
    // The first's goods arrive: with the second refunded, the first completes the order and carries the delivery, once.
    await r.markReceived(storeId, { returnId: first.returnId }, null);
    const preview = (await r.previewRefund(storeId, first.returnId))!;
    expect(preview.refund).toMatchObject({ wholeOrder: true, shippingRefundMinor: order.shipping });
    expect(await r.refundReturn(storeId, { returnId: first.returnId, amountMinor: preview.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const kept = await db().execute<Row>(sql`select id, shipping_refund_minor, refund_minor from commerce.returns where order_id = ${order.orderId}::uuid order by created_at`);
    // The first-made withdrawal carries the delivery (it completed the order); the second was refunded before, without it.
    expect(kept.map((x) => Number(x.shipping_refund_minor))).toEqual([order.shipping, 0]);
    // Together the two refunds are what the order cost, goods and delivery, and never more.
    expect(kept.reduce((sum, x) => sum + Number(x.refund_minor), 0)).toBe(order.total);
  });

  it("gives the delivery back once even when both withdrawals are settled and refunded in turn", async () => {
    const order = await paid([["DEMO-TOTE", 1], ["DEMO-MUG-WHITE", 1]]);
    const tote = order.lines.find((l) => l.sku === "DEMO-TOTE")!;
    const mug = order.lines.find((l) => l.sku === "DEMO-MUG-WHITE")!;
    const first = await withdraw(order, [{ lineId: tote.id, quantity: 1 }]);
    const second = await withdraw(order, [{ lineId: mug.id, quantity: 1 }]);
    for (const id of [first.returnId, second.returnId]) {
      await r.markInTransit(storeId, { returnId: id }, null);
      await r.markReceived(storeId, { returnId: id }, null);
    }
    const a = (await r.previewRefund(storeId, second.returnId))!;
    expect(a.refund.shippingRefundMinor).toBe(order.shipping);
    expect(await r.refundReturn(storeId, { returnId: second.returnId, amountMinor: a.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const b = (await r.previewRefund(storeId, first.returnId))!;
    expect(b.refund.shippingRefundMinor).toBe(0);
    expect(await r.refundReturn(storeId, { returnId: first.returnId, amountMinor: b.refund.amountMinor }, null)).toMatchObject({ ok: true });
    const rows = await db().execute<Row>(sql`select refund_minor, shipping_refund_minor from commerce.returns where order_id = ${order.orderId}::uuid`);
    expect(rows.reduce((sum, x) => sum + Number(x.refund_minor), 0)).toBe(order.total);
    expect(rows.reduce((sum, x) => sum + Number(x.shipping_refund_minor), 0)).toBe(order.shipping);
  });
});
