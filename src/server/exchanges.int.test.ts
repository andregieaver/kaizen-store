import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { conversionFor, localizationOf } from "@/lib/localization";
import { showMarket, toMarket, type Market } from "@/lib/markets";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./refresh", () => ({ refreshTag: () => {}, refreshTagNow: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

/** Kaizen's platform Stripe client, faked: refunds (which can be made to fail) and hosted sessions, recorded. */
const fake = vi.hoisted(() => {
  const refunds: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const sessions = new Map<string, Record<string, unknown>>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const state = { refundStatus: "succeeded" as "succeeded" | "failed" | "pending", refundThrows: false };
  let next = 0;
  const client = {
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        if (state.refundThrows) throw Object.assign(new Error("Your card was declined"), { type: "StripeCardError" });
        refunds.push({ params, options });
        return { id: `re_x_${++next}`, status: state.refundStatus };
      },
    },
    coupons: { create: async () => ({ id: `coupon_${++next}` }) },
    invoices: { retrieve: async (id: string) => ({ id, payments: { data: [{ status: "paid", payment: { payment_intent: `pi_for_${id}` } }] } }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_ex_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", payment_intent: `pi_for_${id}`, metadata: params.metadata });
          created.push({ params, options });
          return { id, url: `https://checkout.stripe.test/${id}`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null, ...sessions.get(id) }),
        expire: async (id: string) => {
          const found = sessions.get(id);
          if (found) found.status = "expired";
          return { id };
        },
      },
    },
  };
  return { client, refunds, sessions, created, state };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test", "live"], WEBHOOK_EVENTS: [] }));

process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "butikk@example.com";
let emailCount = 0;
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: `em_x_${++emailCount}` }), { status: 200, headers: { "content-type": "application/json" } }));

const support = await import("./inventory-test-support");
const x = await import("./exchanges");
const { proposeForTest } = await import("./exchange-test-support");
const pay = await import("./exchange-pay");
const w = await import("./withdrawals");
const r = await import("./returns");
const { staffActor } = await import("./order-actor");
const { markSent, refundOrder, getOrderAdmin, updateOrderContact } = await import("./order-admin");
const { getCart } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { orderNumberAudit } = await import("./order-numbers");
const { getStore } = await import("./stores");
const { applySession } = await import("./stripe-webhooks");

type Row = Record<string, unknown>;
type TestStore = Awaited<ReturnType<typeof support.newStore>>;

/**
 * Exchanges against a real database (wave 3, D239, `docs/wave-3-exchanges.md` 6.1): replacements priced as the checkout prices a cart, in kroner and in a euro
 * view; a proposal that holds nothing; the customer's own confirmation; processing that makes a numbered order and holds its stock only then; the credit moved
 * as a transfer and an `exchange` payment, the rest refunded through `refundOrder()` or paid by a link; one credit note for the return and none for its
 * refunds; every refusal; another store's exchange out of reach; a failed refund settled on the retry; a late payment given back; a later refund of the
 * exchange order made at the original order's Stripe payment. Stripe is the fake above.
 */

const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const noInEuro = showMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }, {
  currency: "EUR",
  conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]), "NOK", "EUR")!,
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

beforeEach(() => {
  jar.clear();
  fake.state.refundStatus = "succeeded";
  fake.state.refundThrows = false;
});

/**
 * A live store (its invoices get legal numbers, D159): Stripe on in live mode, the seller's details, euro offered at 11.5, and plenty of stock. Orders are paid
 * on its live account, so the original and the exchange order are invoiced and a return is credited.
 */
async function liveStore(label: string): Promise<TestStore> {
  const store = await support.newStore(label);
  await db().execute(sql`update commerce.stripe_accounts set mode = 'live' where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'live' where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`update commerce.stores set features = features || array['countries', 'currencies'], legal_name = 'Bytte AS', organisation_number = '923456789',
    postal_address = 'Storgata 1, 0155 Oslo', country = 'NO', contact_email = ${`butikk-${store.slug}@example.com`} where id = ${store.storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${store.storeId}::uuid, true, 'NO923456789MVA')
    on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923456789MVA'
  `);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${store.storeId}::uuid, 'NOK', 11.5, 1, 0), (${store.storeId}::uuid, 'EUR', 1, 1, 1) on conflict do nothing
  `);
  await db().execute(sql`insert into commerce.invoice_settings (store_id, enabled) values (${store.storeId}::uuid, true) on conflict (store_id) do update set enabled = true`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${store.storeId}::uuid`);
  return store;
}

type Original = { orderId: string; number: string; totalMinor: number; lines: { id: string; sku: string; quantity: number }[]; currency: string };

/** An order placed from a cart and paid on the store's live account, sent, with a full address. */
async function paidOrder(store: TestStore, lines: [string, number][], market: Market = no): Promise<Original> {
  const placed = await support.place(store.storeId, lines, market);
  await support.pay(store.storeId, placed, store.account);
  await db().execute(sql`
    update commerce.orders set shipping_address = shipping_address || '{"country": "NO"}'::jsonb, billing_address = '{"name": "Kari Nordmann"}'::jsonb
    where id = ${placed.orderId}::uuid
  `);
  await markSent(store.storeId, placed.orderId, { carrier: "other", trackingNumber: `T-${placed.orderId.slice(0, 6)}`, trackingUrl: null }, null);
  const [o] = await db().execute<Row>(sql`select number, total_minor, currency from commerce.orders where id = ${placed.orderId}::uuid`);
  const ls = await db().execute<Row>(sql`select id, sku, quantity from commerce.order_lines where order_id = ${placed.orderId}::uuid order by sku`);
  return {
    orderId: placed.orderId,
    number: String(o.number),
    totalMinor: Number(o.total_minor),
    currency: String(o.currency).trim(),
    lines: ls.map((l) => ({ id: String(l.id), sku: String(l.sku), quantity: Number(l.quantity) })),
  };
}

/** A withdrawal of the whole order (the customer's two steps), then the goods marked on their way, so the refund (and so the exchange) may be made. */
async function withdrawal(store: TestStore, order: Original): Promise<string> {
  const started = await w.startWithdrawal(store.storeId, { orderNumber: order.number, email: "kari@example.com", name: "Kari Nordmann", lines: order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })) }, { floorMs: 0 });
  if (!started.ok || !started.matched || !started.request) throw new Error(`withdrawal failed: ${JSON.stringify(started)}`);
  const confirmed = await w.confirmWithdrawal(store.storeId, { requestId: started.request.id });
  if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
  const returnId = confirmed.returns[0].id;
  expect(await r.markInTransit(store.storeId, { returnId }, null)).toMatchObject({ ok: true });
  return returnId;
}

/** A voluntary return of one line, approved by the store and on its way. */
async function voluntary(store: TestStore, order: Original): Promise<string> {
  const [ret] = await db().execute<Row>(sql`
    insert into commerce.returns (store_id, order_id, kind, status) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'return', 'approved') returning id
  `);
  await db().execute(sql`
    insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values (${store.storeId}::uuid, ${String(ret.id)}::uuid, ${order.lines[0].id}::uuid, 1, 'accept')
  `);
  expect(await r.markInTransit(store.storeId, { returnId: String(ret.id) }, null)).toMatchObject({ ok: true });
  return String(ret.id);
}

const address = { name: "Kari Nordmann", street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" };
async function builder(store: TestStore, lines: [string, number, number?][], shipping: { kind: "free" } | { kind: "standard" } | { kind: "set"; amountMinor: number } = { kind: "free" }, market: Market = no) {
  const out = [];
  for (const [sku, quantity, price] of lines) {
    const [row] = await db().execute<Row>(sql`
      select v.id, cp.amount_minor from commerce.product_variants v left join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = 'NO'
      where v.store_id = ${store.storeId}::uuid and v.sku = ${sku}
    `);
    const list = market.currency === "NOK" ? Number(row.amount_minor) : null;
    out.push({ variantId: String(row.id), quantity, unitPriceMinor: price ?? list ?? 0 });
  }
  return { lines: out, shipping, deliveryAddress: address };
}

/** The list price of a SKU as the view shows it (`shown()` of the market's price). */
async function listIn(store: TestStore, sku: string, market: Market) {
  const [row] = await db().execute<Row>(sql`
    select cp.amount_minor from commerce.product_variants v join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = 'NO'
    where v.store_id = ${store.storeId}::uuid and v.sku = ${sku}
  `);
  const { shown } = await import("@/lib/markets");
  return shown(market, Number(row.amount_minor));
}

const tokenOf = (link: string) => link.split("/").at(-1)!;
const shopOf = async (store: TestStore, market: Market = no) => ({ store: (await getStore(store.slug))!, market });

/** Proposes (as a shared link) and confirms on the customer's page; returns the exchange and the token. */
async function proposedAndConfirmed(store: TestStore, returnId: string, input: Awaited<ReturnType<typeof builder>>, market: Market = no) {
  const proposed = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), returnId, input);
  if (!proposed.ok) throw new Error(JSON.stringify(proposed));
  const token = tokenOf(proposed.link!);
  expect(await pay.confirmExchange(await shopOf(store, market), token, { termsTicked: true })).toEqual({ ok: true, state: "confirmed" });
  return { exchange: proposed.exchange, token };
}

const docsOf = async (orderId: string) => ({
  invoices: (await db().execute<Row>(sql`select kind, total_minor, currency from commerce.invoices where order_id = ${orderId}::uuid order by number`)).map((d) => ({ kind: String(d.kind), total: Number(d.total_minor) })),
  credits: (await db().execute<Row>(sql`select c.source, c.total_minor from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id where i.order_id = ${orderId}::uuid order by c.number`)).map((d) => ({ source: String(d.source), total: Number(d.total_minor) })),
});

// ---------------------------------------------------------------------------------------------------------------------

describe("pricing is the checkout's (6.1 criterion 1)", () => {
  it("prices replacements at list price with standard shipping as cartSummary() prices the same goods, in kroner and in a euro view", async () => {
    const store = await liveStore("ex-price");
    for (const market of [no, noInEuro]) {
      const order = await paidOrder(store, [["DEMO-THERMOS", 3]], market);
      const returnId = await withdrawal(store, order);
      const goods: [string, number][] = [["DEMO-MUG-WHITE", 2], ["DEMO-NOTEBOOK-LINED", 3]];
      const lines = await builder(store, goods.map(([sku, q]) => [sku, q] as [string, number]), { kind: "standard" }, market);
      for (const [i, [sku]] of goods.entries()) lines.lines[i].unitPriceMinor = await listIn(store, sku, market);
      const preview = await x.previewExchange(store.storeId, returnId, lines);
      if (!("lines" in preview)) throw new Error(JSON.stringify(preview));
      const cartId = await support.cartOf(store.storeId, goods, no);
      jar.set(`cart_${store.storeId}_no`, cartId);
      const summary = await cartSummary({ storeId: store.storeId, market }, await getCart({ storeId: store.storeId, market }));
      expect(preview.currency, market.slug).toBe(market.currency);
      expect({ subtotal: preview.subtotalMinor, shipping: preview.shippingMinor, vat: preview.taxMinor, total: preview.totalMinor }, market.slug).toEqual({
        subtotal: summary.subtotal,
        shipping: summary.shipping,
        vat: summary.vat,
        total: summary.total,
      });
      // The credit is the refund the return would get, and the outcome nets the two.
      const refund = await r.previewRefund(store.storeId, returnId);
      expect(preview.credit?.amountMinor).toBe(refund!.refund.amountMinor);
      expect(preview.outcome?.differenceMinor).toBe(preview.totalMinor - refund!.refund.amountMinor);
    }
  });

  it("refuses a price above the list price, too many units, and an address in another country, with nothing stored", async () => {
    const store = await liveStore("ex-refuse");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const up = await builder(store, [["DEMO-MUG-WHITE", 1, 99_999]]);
    expect(await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, up)).toMatchObject({ ok: false, problem: "price_up" });
    const many = await builder(store, [["DEMO-MUG-WHITE", 100]]);
    expect(await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, many)).toMatchObject({ ok: false, problem: "invalid" });
    const away = { ...(await builder(store, [["DEMO-MUG-WHITE", 1]])), deliveryAddress: { ...address, country: "SE" } };
    expect(await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, away)).toMatchObject({ ok: false, problem: "address_country" });
    const service = await builder(store, [["DEMO-MASSAGE-60", 1, 100]]);
    expect(await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, service)).toMatchObject({ ok: false });
    expect((await db().execute<Row>(sql`select 1 from commerce.return_exchanges where return_id = ${returnId}::uuid`)).length).toBe(0);
  });
});

describe("processing makes a numbered order and holds stock only then (6.1 criterion 2), and a refund due goes back through refundOrder() (criterion 3)", () => {
  it("refund due: the transfer and the remainder, one credit note for the return, none for its refunds, the order paid and invoiced", async () => {
    const store = await liveStore("ex-refund-due");
    const order = await paidOrder(store, [["DEMO-THERMOS", 2]]);
    const returnId = await withdrawal(store, order);
    const holdsBefore = await support.holdsOf(store.storeId, "DEMO-MUG-WHITE");
    const { exchange, token } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-MUG-WHITE", 1]]));
    // A proposal and a confirmation hold nothing.
    expect(await support.holdsOf(store.storeId, "DEMO-MUG-WHITE")).toEqual(holdsBefore);
    const credit = (await r.previewRefund(store.storeId, returnId))!.refund.amountMinor;
    expect(exchange.outcome.kind).toBe("refund_due");

    fake.refunds.length = 0;
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    if (!processed.ok) throw new Error(JSON.stringify(processed));
    expect(processed.state).toBe("settled");
    // The new order: source exchange, linked, numbered by the store's sequence with no gap, paid.
    const [made] = await db().execute<Row>(sql`select source, exchange_id, status::text as status, total_minor, number, made_by from commerce.orders where id = ${processed.orderId}::uuid`);
    expect(made).toMatchObject({ source: "exchange", exchange_id: exchange.id, status: "paid", made_by: store.accountId });
    expect(Number(String(made.number).replace(/\D/g, ""))).toBe(Number(order.number.replace(/\D/g, "")) + 1);
    expect((await orderNumberAudit(store.storeId)).ok).toBe(true);
    // Its stock was drawn at payment (a sale movement of the exchange order).
    const drawn = (await support.movementsOf(store.storeId, "DEMO-MUG-WHITE")).filter((m) => m.orderId === processed.orderId);
    expect(drawn.map((m) => m.delta)).toEqual([-1]);
    // Stripe was asked for the remainder only, on the original's payment, with the exchange's key.
    const total = Number(made.total_minor);
    expect(fake.refunds.map((f) => f.params.amount)).toEqual([credit - total]);
    expect(String(fake.refunds[0].options.idempotencyKey)).toBe(`exchange-refund:${exchange.id}:0`);
    // The refunds of the original: the transfer (no provider) and the remainder, both naming the exchange.
    const refunds = await db().execute<Row>(sql`
      select rf.kind, rf.amount_minor, rf.provider_reference, rf.exchange_id from commerce.refunds rf join commerce.payments p on p.id = rf.payment_id
      where p.order_id = ${order.orderId}::uuid order by rf.kind
    `);
    expect(refunds.map((f) => [f.kind, Number(f.amount_minor), f.provider_reference === null])).toEqual([["money", credit - total, false], ["transfer", total, true]]);
    // The return: refunded by the exchange, the credit as its refund.
    const [ret] = await db().execute<Row>(sql`select outcome, refund_minor, refund_claimed_at from commerce.returns where id = ${returnId}::uuid`);
    expect(ret).toMatchObject({ outcome: "exchanged", refund_claimed_at: null });
    expect(Number(ret.refund_minor)).toBe(credit);
    // Documents: the original keeps its invoice and gets one return_exchange credit note for C; the new order its own invoice.
    const original = await docsOf(order.orderId);
    expect(original.credits).toEqual([{ source: "return_exchange", total: credit }]);
    expect((await docsOf(processed.orderId)).invoices).toEqual([{ kind: "order", total }]);
    // The emails: the exchange done, the new order's confirmation with the exchange sentence; no return.refunded.
    const kinds = (await db().execute<Row>(sql`select kind from commerce.email_messages where order_id in (${order.orderId}::uuid, ${processed.orderId}::uuid) order by created_at`)).map((m) => String(m.kind));
    expect(kinds).toContain("return.exchanged");
    expect(kinds).toContain("order.confirmation");
    expect(kinds).not.toContain("return.refunded");
    const [confirmation] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${processed.orderId}::uuid and kind = 'order.confirmation'`);
    expect(String(confirmation.text)).toContain(`${order.number}-R1`);
    // The customer's page says it is done; the order page opens by its payment.
    expect((await pay.exchangePageFor(await shopOf(store), token)).state).toBe("done");
    // Processing again is a no-op.
    expect(await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id)).toMatchObject({ ok: false, problem: "lifecycle" });
  });

  it("even: nothing at Stripe, the credit pays the order exactly", async () => {
    const store = await liveStore("ex-even");
    const order = await paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const returnId = await withdrawal(store, order);
    const credit = (await r.previewRefund(store.storeId, returnId))!.refund.amountMinor;
    // The thermos costs more than the credit (a mug and its shipping): sold at the credit, a lower price staff may give.
    expect(credit).toBeLessThanOrEqual(34_900);
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-THERMOS", 1, credit]]));
    expect(exchange.outcome.kind).toBe("even");
    fake.refunds.length = 0;
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    expect(processed).toMatchObject({ ok: true, state: "settled" });
    expect(fake.refunds).toEqual([]);
    const payments = await db().execute<Row>(sql`select provider, amount_minor from commerce.payments where order_id = ${processed.ok ? processed.orderId : ""}::uuid`);
    expect(payments.map((p) => [p.provider, Number(p.amount_minor)])).toEqual([["exchange", credit]]);
  });

  it("refuses to process an exchange the customer has not confirmed, and one whose replacement stopped at zero (nothing made)", async () => {
    const store = await liveStore("ex-unconfirmed");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const proposed = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), returnId, await builder(store, [["DEMO-TOTE", 1]]));
    if (!proposed.ok) throw new Error(JSON.stringify(proposed));
    expect(await x.processExchange(store.storeId, staffActor(store.accountId), proposed.exchange.id)).toMatchObject({ ok: false, problem: "not_confirmed" });
    expect(await pay.confirmExchange(await shopOf(store), tokenOf(proposed.link!), { termsTicked: true })).toMatchObject({ ok: true });
    await db().execute(sql`update commerce.inventory_levels l set on_hand = 0 from commerce.product_variants v where v.id = l.variant_id and v.store_id = ${store.storeId}::uuid and v.sku = 'DEMO-TOTE'`);
    const ordersBefore = (await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`))[0].n;
    expect(await x.processExchange(store.storeId, staffActor(store.accountId), proposed.exchange.id)).toMatchObject({ ok: false, problem: "stock_short" });
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where store_id = ${store.storeId}::uuid`))[0].n).toBe(ordersBefore);
    const [ret] = await db().execute<Row>(sql`select refund_claimed_at from commerce.returns where id = ${returnId}::uuid`);
    expect(ret.refund_claimed_at).toBeNull();
    // The full refund stays available.
    expect((await r.getReturn(store.storeId, returnId))!.actions).toContain("process_exchange");
  });

  it("refuses a staff-recorded agreement for a withdrawal return, and accepts one for a voluntary return", async () => {
    const store = await liveStore("ex-agreement");
    const order = await paidOrder(store, [["DEMO-THERMOS", 2]]);
    const returnId = await withdrawal(store, order);
    const proposed = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), returnId, await builder(store, [["DEMO-TOTE", 1]]));
    if (!proposed.ok) throw new Error(JSON.stringify(proposed));
    expect(await x.recordExchangeAgreement(store.storeId, staffActor(store.accountId), proposed.exchange.id, { channel: "phone", day: "2026-10-15", note: "Called" })).toMatchObject({ ok: false, problem: "lifecycle" });
    // Even straight in the database, a staff confirmation of a withdrawal's exchange is refused.
    const raw = await db()
      .execute(sql`update commerce.return_exchanges set status = 'confirmed', confirmed_by = 'staff', confirmed_channel = 'phone' where id = ${proposed.exchange.id}::uuid`)
      .then(() => null, (error: { cause?: { message?: string } }) => error.cause?.message ?? "");
    expect(raw).toMatch(/withdrawal_needs_customer/);

    const other = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const voluntaryId = await voluntary(store, other);
    const v = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), voluntaryId, await builder(store, [["DEMO-TOTE", 1]]));
    if (!v.ok) throw new Error(JSON.stringify(v));
    expect(await x.recordExchangeAgreement(store.storeId, staffActor(store.accountId), v.exchange.id, { channel: "phone", day: "2026-10-15", note: "Called" })).toEqual({ ok: true });
    const after = await x.exchangeView(store.storeId, v.exchange.id);
    expect(after).toMatchObject({ status: "confirmed", confirmedBy: "staff", confirmedChannel: "phone" });
    // The note is in the history event only.
    const [event] = await db().execute<Row>(sql`select data from commerce.order_events where order_id = ${other.orderId}::uuid and type = 'return.exchange_confirmed'`);
    expect((event.data as Record<string, unknown>).note).toBe("Called");
  });

  it("never hands staff a link to a withdrawal's proposal (only the email to the order's own address), so the press on it is the customer's (review finding)", async () => {
    const store = await liveStore("ex-nolink");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const input = await builder(store, [["DEMO-TOTE", 1]]);
    expect(await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, input, { createLink: true })).toMatchObject({ ok: false, problem: "link_withdrawal" });
    expect(await db().execute(sql`select 1 from commerce.return_exchanges where store_id = ${store.storeId}::uuid and return_id = ${returnId}::uuid and status <> 'draft'`)).toEqual([]);
    const emailed = await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, input);
    if (!emailed.ok) throw new Error(JSON.stringify(emailed));
    expect(emailed.link).toBeNull();
    const [mail] = await db().execute<Row>(sql`select to_address, text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.exchange_proposed'`);
    expect(String(mail.text)).toMatch(/\/account\/exchange\//);
    // Send again as a link: refused too while the proposal waits for the customer.
    expect(await x.resendExchange(store.storeId, staffActor(store.accountId), emailed.exchange.id, { createLink: true })).toMatchObject({ ok: false, problem: "link_withdrawal" });
    // A voluntary return may still be shared.
    const other = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const voluntaryId = await voluntary(store, other);
    const shared = await x.proposeExchange(store.storeId, staffActor(store.accountId), voluntaryId, input, { createLink: true });
    expect(shared).toMatchObject({ ok: true });
    if (shared.ok) expect(shared.link).toMatch(/\/account\/exchange\//);
  });

  it("refuses a withdrawal's exchange once staff changed the order's email after the withdrawal (only the address the customer gave confirms it)", async () => {
    const store = await liveStore("ex-mail");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const input = await builder(store, [["DEMO-TOTE", 1]]);
    // Proposed first to the customer's own address, then staff change the email: sending again is refused, as is a new proposal.
    const emailed = await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, input);
    if (!emailed.ok) throw new Error(JSON.stringify(emailed));
    await new Promise((done) => setTimeout(done, 5));
    expect(await updateOrderContact(store.storeId, order.orderId, { email: "someone-else@example.com", shippingAddress: address })).toBe(true);
    expect(await x.resendExchange(store.storeId, staffActor(store.accountId), emailed.exchange.id)).toMatchObject({ ok: false, problem: "email_changed" });
    expect(await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, input)).toMatchObject({ ok: false, problem: "email_changed" });
    const sent = await db().execute<Row>(sql`select to_address from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.exchange_proposed'`);
    expect(sent.map((m) => m.to_address)).not.toContain("someone-else@example.com");
    // A voluntary return of an order whose email changed is still proposed (staff may record that customer's agreement anyway).
    const other = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    expect(await updateOrderContact(store.storeId, other.orderId, { email: "new@example.com", shippingAddress: address })).toBe(true);
    const voluntaryId = await voluntary(store, other);
    expect(await x.proposeExchange(store.storeId, staffActor(store.accountId), voluntaryId, input, { createLink: true })).toMatchObject({ ok: true });
  });

  it("exports a proposal's delivery address and replacements to the customer even when no exchange order was made (review finding, GDPR Art. 15)", async () => {
    const store = await liveStore("ex-export");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await voluntary(store, order);
    const input = { ...(await builder(store, [["DEMO-TOTE", 1]])), deliveryAddress: { ...address, street: "Fjellveien 9", phone: "+4791234567" } };
    const proposed = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), returnId, input);
    if (!proposed.ok) throw new Error(JSON.stringify(proposed));
    // The customer says no: no exchange order exists, the address stays on the proposal.
    expect(await pay.declineExchange(await shopOf(store), tokenOf(proposed.link!))).toEqual({ ok: true });
    const [o] = await db().execute<Row>(sql`select email from commerce.orders where id = ${order.orderId}::uuid`);
    const { exportCustomerData } = await import("./privacy-export");
    const result = await exportCustomerData(store.storeId, { email: String(o.email) }, { channel: "staff", accountId: store.accountId });
    if (!result.ok) throw new Error(JSON.stringify(result));
    const file = JSON.stringify(result.file);
    expect(file).toContain("Fjellveien 9");
    expect(file).toContain("+4791234567");
    expect(file).toMatch(/"replacementLines":\[\{"sku":"DEMO-TOTE"/);
  });

  it("tells a business buyer nothing of a statutory right of withdrawal for the new goods (review finding)", async () => {
    const store = await liveStore("ex-b2b-words");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await voluntary(store, order);
    const proposed = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), returnId, await builder(store, [["DEMO-TOTE", 1]]));
    if (!proposed.ok) throw new Error(JSON.stringify(proposed));
    const consumer = await pay.exchangePageFor(await shopOf(store), tokenOf(proposed.link!));
    expect(consumer).toMatchObject({ state: "proposed", withdrawalRight: true });
    await db().execute(sql`update commerce.orders set company_name = 'Firma AS' where id = ${order.orderId}::uuid`);
    expect(await pay.exchangePageFor(await shopOf(store), tokenOf(proposed.link!))).toMatchObject({ state: "proposed", withdrawalRight: false });
    await db().execute(sql`update commerce.orders set company_name = null where id = ${order.orderId}::uuid`);
    // Goods the law excludes carry no right either.
    await db().execute(sql`
      update commerce.products p set withdrawal_exclusion = 'sealed_hygiene' from commerce.product_variants v
      where v.store_id = p.store_id and v.product_id = p.id and p.store_id = ${store.storeId}::uuid and v.sku = 'DEMO-TOTE'
    `);
    expect(await pay.exchangePageFor(await shopOf(store), tokenOf(proposed.link!))).toMatchObject({ state: "proposed", withdrawalRight: false });
  });
});

describe("a difference to pay goes out as a pay link (6.1 criterion 3)", () => {
  it("processing waits with the stock held; the completed session settles: the transfer and the payment add up to the order's total", async () => {
    const store = await liveStore("ex-to-pay");
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const returnId = await withdrawal(store, order);
    const { exchange, token } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-THERMOS", 1]]));
    expect(exchange.outcome.kind).toBe("to_pay");
    // The proposal email says the customer pays the difference, and never that it "costs nothing extra" (review finding).
    const [proposal] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.exchange_proposed'`);
    expect(String(proposal.text)).toContain("du betaler selv mellomlegget");
    expect(String(proposal.text)).not.toContain("ingenting ekstra");
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    if (!processed.ok) throw new Error(JSON.stringify(processed));
    expect(processed.state).toBe("waiting");
    expect(await support.holdsOf(store.storeId, "DEMO-THERMOS")).not.toEqual({});
    // The pay email went out with a new link; the old one is dead.
    const [mail] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.exchange_to_pay'`);
    expect(mail).toBeTruthy();
    expect((await pay.exchangePageFor(await shopOf(store), token)).state).toBe("not_found");
    const link = /\/account\/exchange\/([A-Za-z0-9_-]{43})/.exec(String(mail.text))![1];
    const shop = await shopOf(store);
    const page = await pay.exchangePageFor(shop, link);
    expect(page.state).toBe("to_pay");
    expect((await r.listReturns(store.storeId, {}, { exchange: "waiting_payment" })).rows.map((q) => q.id)).toEqual([returnId]);
    // A refund of the return meanwhile is refused (the exchange holds the credit).
    expect(await r.refundReturn(store.storeId, { returnId, amountMinor: 1 }, null)).toMatchObject({ ok: false, code: "exchange_pending" });
    // The press opens a hosted session for Δ only, naming the exchange.
    const started = await pay.startExchangePayment(shop, link, { origin: "https://shop.example" });
    expect(started).toMatchObject({ ok: true });
    const session = fake.created.at(-1)!;
    expect((session.params.line_items as { price_data: { unit_amount: number } }[]).map((l) => l.price_data.unit_amount)).toEqual([processed.exchange.outcome.toPayMinor]);
    expect((session.params.metadata as Record<string, string>).exchange_id).toBe(exchange.id);
    expect(session.params.invoice_creation).toBeUndefined();
    // Stripe's webhook: the session is paid.
    const sessionId = [...fake.sessions.keys()].at(-1)!;
    fake.sessions.get(sessionId)!.status = "complete";
    fake.sessions.get(sessionId)!.payment_status = "paid";
    await applySession(store.storeId, { id: sessionId, status: "complete", payment_status: "paid" } as never, "checkout.session.completed");
    const after = await x.exchangeView(store.storeId, exchange.id);
    expect(after?.status).toBe("settled");
    const payments = await db().execute<Row>(sql`select provider, status, amount_minor from commerce.payments where order_id = ${processed.orderId}::uuid and status = 'captured' order by provider`);
    const [made] = await db().execute<Row>(sql`select total_minor, status::text as status from commerce.orders where id = ${processed.orderId}::uuid`);
    expect(payments.reduce((s, p) => s + Number(p.amount_minor), 0)).toBe(Number(made.total_minor));
    expect(payments.map((p) => p.provider)).toEqual(["exchange", "stripe"]);
    expect(made.status).toBe("paid");
    // The webhook again is a no-op.
    await applySession(store.storeId, { id: sessionId, status: "complete", payment_status: "paid" } as never, "checkout.session.completed");
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.refunds where exchange_id = ${exchange.id}::uuid`))[0].n).toBe(1);
    // The new order's invoice names the credit as a payment of its own.
    const [invoice] = await db().execute<Row>(sql`select snapshot from commerce.invoices where order_id = ${processed.orderId}::uuid`);
    const kinds = ((invoice.snapshot as { payments: { kind: string }[] }).payments ?? []).map((p) => p.kind);
    expect(kinds).toContain("settled_by_return");
  });

  it("records the difference as paid outside Kaizen and settles at once", async () => {
    const store = await liveStore("ex-outside");
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const returnId = await withdrawal(store, order);
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-THERMOS", 1]]));
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    expect(processed).toMatchObject({ ok: true, state: "waiting" });
    expect(await x.recordExchangePaidOutside(store.member, exchange.id, { method: "bank_transfer" })).toMatchObject({ ok: true });
    expect((await x.exchangeView(store.storeId, exchange.id))?.status).toBe("settled");
  });

  it("expires an unpaid pay step: the order cancelled with its number kept, the stock released, the return refundable as usual", async () => {
    const store = await liveStore("ex-expire");
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const returnId = await withdrawal(store, order);
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-THERMOS", 1]]));
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    if (!processed.ok) throw new Error(JSON.stringify(processed));
    const due = new Date(Date.now() + 30 * 86_400_000);
    const run = await x.expireExchanges(due);
    expect(run.expired).toBeGreaterThanOrEqual(1);
    expect((await x.exchangeView(store.storeId, exchange.id))?.status).toBe("expired");
    const [made] = await db().execute<Row>(sql`select status::text as status, number from commerce.orders where id = ${processed.orderId}::uuid`);
    expect(made.status).toBe("cancelled");
    expect((await orderNumberAudit(store.storeId)).ok).toBe(true);
    expect((await db().execute<Row>(sql`select 1 from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.exchange_lapsed'`)).length).toBe(1);
    // The return is refunded as usual, in full.
    const detail = await r.getReturn(store.storeId, returnId);
    expect(detail!.actions).toContain("refund");
    expect(await r.refundReturn(store.storeId, { returnId, amountMinor: detail!.working!.amountMinor }, null)).toMatchObject({ ok: true });
  });

  it("refunds in full a payment that arrives for an exchange that ended", async () => {
    const store = await liveStore("ex-late");
    const order = await paidOrder(store, [["DEMO-TOTE", 1]]);
    const returnId = await withdrawal(store, order);
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-THERMOS", 1]]));
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    if (!processed.ok) throw new Error(JSON.stringify(processed));
    const page = await pay.exchangePageFor(await shopOf(store), (await (async () => {
      const [mail] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.exchange_to_pay'`);
      return /\/account\/exchange\/([A-Za-z0-9_-]{43})/.exec(String(mail.text))![1];
    })()));
    expect(page.state).toBe("to_pay");
    // A pending session row as the press would leave it, then staff cancel (the session is closed: not found at Stripe here), then the money arrives.
    const sessionId = `cs_late_${Date.now()}`;
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status, exchange_id)
      values (${store.storeId}::uuid, ${processed.orderId}::uuid, 'stripe', ${sessionId}, ${store.account}, ${processed.exchange.outcome.toPayMinor}, 'NOK', 'cancelled', ${exchange.id}::uuid)
    `);
    expect(await x.cancelExchange(store.storeId, staffActor(store.accountId), exchange.id)).toEqual({ ok: true });
    fake.refunds.length = 0;
    expect(await x.completeExchangePayment(store.storeId, sessionId)).toBe("refunded");
    expect(fake.refunds.map((f) => f.params.amount)).toEqual([processed.exchange.outcome.toPayMinor]);
  });
});

describe("failures and retries", () => {
  it("a Stripe refund that fails settles nothing; the retry settles once", async () => {
    const store = await liveStore("ex-retry");
    const order = await paidOrder(store, [["DEMO-THERMOS", 2]]);
    const returnId = await withdrawal(store, order);
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-TOTE", 1]]));
    fake.state.refundThrows = true;
    const first = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    expect(first).toMatchObject({ ok: true, state: "refund_failed" });
    expect((await x.exchangeView(store.storeId, exchange.id))?.status).toBe("processed");
    const [made] = await db().execute<Row>(sql`select status::text as status from commerce.orders where exchange_id = ${exchange.id}::uuid`);
    expect(made.status).toBe("pending_payment");
    expect((await db().execute<Row>(sql`select 1 from commerce.refunds where exchange_id = ${exchange.id}::uuid`)).length).toBe(0);
    fake.state.refundThrows = false;
    const again = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    expect(again).toMatchObject({ ok: true, state: "settled" });
    expect(String(fake.refunds.at(-1)!.options.idempotencyKey)).toBe(`exchange-refund:${exchange.id}:1`);
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.refunds where exchange_id = ${exchange.id}::uuid and kind = 'money'`))[0].n).toBe(1);
  });

  it("refuses credit_changed when the inspection would make the customer pay more than they confirmed", async () => {
    const store = await liveStore("ex-credit");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-TOTE", 1]]));
    await r.markReceived(store.storeId, { returnId }, null);
    const line = order.lines[0];
    expect(await r.inspectReturn(store.storeId, { returnId, lines: [{ lineId: line.id, condition: "used", restock: true, deductionMinor: 30_000, deductionNote: "Scratched" }] }, null)).toMatchObject({ ok: true });
    expect(await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id)).toMatchObject({ ok: false, problem: "credit_changed" });
  });

  it("ends a proposal as superseded when staff refund instead, and the page says the money was refunded", async () => {
    const store = await liveStore("ex-supersede");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const proposed = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), returnId, await builder(store, [["DEMO-TOTE", 1]]));
    if (!proposed.ok) throw new Error(JSON.stringify(proposed));
    const detail = await r.getReturn(store.storeId, returnId);
    expect(await r.refundReturn(store.storeId, { returnId, amountMinor: detail!.working!.amountMinor }, null)).toMatchObject({ ok: true });
    expect((await x.exchangeView(store.storeId, proposed.exchange.id))?.status).toBe("superseded");
    expect((await pay.exchangePageFor(await shopOf(store), tokenOf(proposed.link!))).state).toBe("refunded");
  });

  it("the customer declines: the proposal ends and the return is refunded as usual", async () => {
    const store = await liveStore("ex-decline");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const proposed = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), returnId, await builder(store, [["DEMO-TOTE", 1]]));
    if (!proposed.ok) throw new Error(JSON.stringify(proposed));
    expect(await pay.declineExchange(await shopOf(store), tokenOf(proposed.link!))).toEqual({ ok: true });
    expect((await x.exchangeView(store.storeId, proposed.exchange.id))?.status).toBe("declined_by_customer");
    expect((await r.getReturn(store.storeId, returnId))!.actions).toContain("refund");
  });
});

describe("guards", () => {
  it("keeps another store's exchange out of reach: its id, its token and its return", async () => {
    const store = await liveStore("ex-own");
    const other = await liveStore("ex-other");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const proposed = await proposeForTest(x.proposeExchange, store.storeId, staffActor(store.accountId), returnId, await builder(store, [["DEMO-TOTE", 1]]));
    if (!proposed.ok) throw new Error(JSON.stringify(proposed));
    expect(await x.exchangeView(other.storeId, proposed.exchange.id)).toBeNull();
    expect(await x.processExchange(other.storeId, staffActor(other.accountId), proposed.exchange.id)).toMatchObject({ ok: false, problem: "not_found" });
    expect(await x.cancelExchange(other.storeId, staffActor(other.accountId), proposed.exchange.id)).toMatchObject({ ok: false, problem: "not_found" });
    expect((await pay.exchangePageFor(await shopOf(other), tokenOf(proposed.link!))).state).toBe("not_found");
    expect(await x.proposeExchange(other.storeId, staffActor(other.accountId), returnId, await builder(store, [["DEMO-TOTE", 1]]))).toMatchObject({ ok: false, problem: "not_found" });
    // A malformed token is the same not-found.
    expect((await pay.exchangePageFor(await shopOf(store), "nope")).state).toBe("not_found");
  });

  it("does not exchange a host's, restricted or reverse-charge order; the reason is said", async () => {
    const store = await liveStore("ex-blocks");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    await db().execute(sql`update commerce.return_settings set exchanges = false where store_id = ${store.storeId}::uuid`);
    await db().execute(sql`insert into commerce.return_settings (store_id, exchanges) values (${store.storeId}::uuid, false) on conflict (store_id) do update set exchanges = false`);
    expect(await x.exchangeBlockFor(store.storeId, returnId)).toBe("off");
    expect(await x.proposeExchange(store.storeId, staffActor(store.accountId), returnId, await builder(store, [["DEMO-TOTE", 1]]))).toMatchObject({ ok: false, problem: "off" });
    await db().execute(sql`update commerce.return_settings set exchanges = true where store_id = ${store.storeId}::uuid`);
    expect(await x.exchangeBlockFor(store.storeId, returnId)).toBeNull();
    // A store in another Stripe mode than the original's payment.
    await db().execute(sql`update commerce.payment_providers set active_mode = 'test' where store_id = ${store.storeId}::uuid`);
    expect(await x.exchangeBlockFor(store.storeId, returnId)).toBe("test_mode");
  });

  it("keeps the wish once and alerts the store's address, never with the wish's words", async () => {
    const store = await liveStore("ex-wish");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await withdrawal(store, order);
    const [ret] = await db().execute<Row>(sql`select public_token from commerce.returns where id = ${returnId}::uuid`);
    expect(await x.recordExchangeWish(store.storeId, String(ret.public_token), { note: "Size M instead, please" })).toEqual({ ok: true });
    expect(await x.recordExchangeWish(store.storeId, String(ret.public_token), { note: "Again" })).toMatchObject({ ok: false, problem: "wish_made" });
    const [mail] = await db().execute<Row>(sql`select to_address, text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.exchange_wished'`);
    expect(String(mail.to_address)).toContain(`butikk-${store.slug}`);
    expect(String(mail.text)).not.toContain("Size M");
    expect((await r.getReturn(store.storeId, returnId))!.exchangeWish?.note).toBe("Size M instead, please");
    // The queue marks it and filters by it.
    const wished = await r.listReturns(store.storeId, {}, { exchange: "wished" });
    expect(wished.rows.map((q) => [q.id, q.exchange])).toEqual([[returnId, "wished"]]);
  });
});

describe("money of an exchange order later (4.6)", () => {
  it("refunds the exchange order's credit at the original order's Stripe payment, and a goodwill refund of the original cannot take it", async () => {
    const store = await liveStore("ex-later");
    const order = await paidOrder(store, [["DEMO-THERMOS", 2]]);
    const returnId = await withdrawal(store, order);
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-TOTE", 1]]));
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    if (!processed.ok) throw new Error(JSON.stringify(processed));
    // The original has nothing left: the transfer and the remainder took all the credit, which was the whole order.
    const original = await getOrderAdmin(store.storeId, order.orderId);
    const [ret] = await db().execute<Row>(sql`select refund_minor from commerce.returns where id = ${returnId}::uuid`);
    expect(original!.refundableMinor).toBe(order.totalMinor - Number(ret.refund_minor));
    expect((await refundOrder(store.storeId, order.orderId, { amountMinor: original!.refundableMinor + 1, reason: "Goodwill", restock: [] }, store.accountId)).ok).toBe(false);
    // A refund of the exchange order is made at Stripe on the original's payment intent.
    const made = await getOrderAdmin(store.storeId, processed.orderId);
    expect(made!.canRefund).toBe(true);
    fake.refunds.length = 0;
    const back = await refundOrder(store.storeId, processed.orderId, { amountMinor: made!.refundableMinor, reason: "Goodwill", restock: [] }, store.accountId);
    expect(back).toMatchObject({ ok: true });
    expect(fake.refunds.map((f) => f.params.payment_intent)).toEqual([`pi_for_cs_${order.orderId}`]);
  });
});

describe("an exchange shown in euro (D109): every amount in the order's own currency", () => {
  it("prices, transfers, refunds and documents in euro, never converted again", async () => {
    const store = await liveStore("ex-euro");
    const order = await paidOrder(store, [["DEMO-THERMOS", 2]], noInEuro);
    expect(order.currency).toBe("EUR");
    const returnId = await withdrawal(store, order);
    const input = await builder(store, [["DEMO-TOTE", 1]], { kind: "standard" }, noInEuro);
    input.lines[0].unitPriceMinor = await listIn(store, "DEMO-TOTE", noInEuro);
    const { exchange } = await proposedAndConfirmed(store, returnId, input, noInEuro);
    expect(exchange.currency).toBe("EUR");
    expect(exchange.marketSlug).toBe(noInEuro.slug);
    const credit = (await r.previewRefund(store.storeId, returnId))!.refund.amountMinor;
    // The credit is the euro order's own refund: what was paid in euro.
    expect(credit).toBe(order.totalMinor);
    fake.refunds.length = 0;
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    if (!processed.ok) throw new Error(JSON.stringify(processed));
    expect(processed.state).toBe("settled");
    const [made] = await db().execute<Row>(sql`select currency, total_minor, market_code from commerce.orders where id = ${processed.orderId}::uuid`);
    expect(String(made.currency).trim()).toBe("EUR");
    expect(Number(made.total_minor)).toBe(exchange.totalMinor);
    // Stripe was asked for the euro remainder; the transfer and the exchange payment are in euro.
    expect(fake.refunds.map((f) => f.params.amount)).toEqual([credit - exchange.totalMinor]);
    const [transfer] = await db().execute<Row>(sql`select p.currency, p.amount_minor from commerce.payments p where p.order_id = ${processed.orderId}::uuid and p.provider = 'exchange'`);
    expect(String(transfer.currency).trim()).toBe("EUR");
    expect(Number(transfer.amount_minor)).toBe(exchange.totalMinor);
    const docs = await db().execute<Row>(sql`
      select c.source, c.currency, c.total_minor from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id where i.order_id = ${order.orderId}::uuid
    `);
    expect(docs.map((d) => [d.source, String(d.currency).trim(), Number(d.total_minor)])).toEqual([["return_exchange", "EUR", credit]]);
    const [invoice] = await db().execute<Row>(sql`select currency, total_minor from commerce.invoices where order_id = ${processed.orderId}::uuid`);
    expect([String(invoice.currency).trim(), Number(invoice.total_minor)]).toEqual(["EUR", exchange.totalMinor]);
  });
});
