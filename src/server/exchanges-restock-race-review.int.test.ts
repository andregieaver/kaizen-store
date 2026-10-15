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
  const byKey = new Map<string, { id: string; status: string }>();
  const client = {
    refunds: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        if (state.refundThrows) throw Object.assign(new Error("Your card was declined"), { type: "StripeCardError" });
        // As Stripe: the same idempotency key gives back the same refund.
        const key = String(options.idempotencyKey ?? "");
        if (key && byKey.has(key)) return byKey.get(key)!;
        refunds.push({ params, options });
        const made = { id: `re_x_${++next}`, status: state.refundStatus };
        if (key) byKey.set(key, made);
        return made;
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
const { markSent, refundOrder, getOrderAdmin } = await import("./order-admin");
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


describe("review (money/stock): settling the same exchange twice at once", () => {
  it("puts the returned unit back in stock once when two settles of one exchange run together", async () => {
    const store = await liveStore("ex-race");
    const order = await paidOrder(store, [["DEMO-THERMOS", 3]]);
    const returnId = await voluntary(store, order);
    await db().execute(sql`update commerce.return_lines set restock = true where return_id = ${returnId}::uuid`);
    // A refund due: a cheap replacement for one thermos.
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-MUG-WHITE", 1]]));
    expect(exchange.outcome.kind).toBe("refund_due");
    const before = (await support.movementsOf(store.storeId, "DEMO-THERMOS")).filter((m) => m.reason === "return_restock").length;
    // The first try's refund is reported failed by Stripe, so the exchange waits processed with *Try again*.
    fake.state.refundStatus = "failed";
    const first = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    expect(first).toMatchObject({ ok: true, state: "refund_failed" });
    fake.state.refundStatus = "succeeded";
    // Two presses of *Try again* (or two staff) at the same moment.
    const both = await Promise.all([
      x.processExchange(store.storeId, staffActor(store.accountId), exchange.id),
      x.processExchange(store.storeId, staffActor(store.accountId), exchange.id),
    ]);
    expect(both.some((b) => b.ok && b.state === "settled")).toBe(true);
    const restocks = (await support.movementsOf(store.storeId, "DEMO-THERMOS")).filter((m) => m.reason === "return_restock" && m.orderId === order.orderId);
    expect(restocks.length - before).toBe(1);
  });
});

describe("review (money/stock): a refund Stripe reports failed, then Try again", () => {
  it("puts the returned unit back in stock once over a failed try and its retry", async () => {
    const store = await liveStore("ex-retry");
    const order = await paidOrder(store, [["DEMO-THERMOS", 3]]);
    const returnId = await voluntary(store, order);
    await db().execute(sql`update commerce.return_lines set restock = true where return_id = ${returnId}::uuid`);
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-MUG-WHITE", 1]]));
    fake.state.refundStatus = "failed";
    expect(await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id)).toMatchObject({ ok: true, state: "refund_failed" });
    const afterFail = (await support.movementsOf(store.storeId, "DEMO-THERMOS")).filter((m) => m.reason === "return_restock" && m.orderId === order.orderId).length;
    fake.state.refundStatus = "succeeded";
    expect(await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id)).toMatchObject({ ok: true, state: "settled" });
    const restocks = (await support.movementsOf(store.storeId, "DEMO-THERMOS")).filter((m) => m.reason === "return_restock" && m.orderId === order.orderId);
    expect({ afterFail, total: restocks.length }).toEqual({ afterFail: 0, total: 1 });
  });
});
