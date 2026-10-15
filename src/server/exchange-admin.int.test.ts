import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket, type Market } from "@/lib/markets";

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
const { markSent, getOrderAdmin } = await import("./order-admin");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;
type TestStore = Awaited<ReturnType<typeof support.newStore>>;

const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });

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


const admin = await import("./exchange-admin");
const { listOrdersPage, loadOrderListContext } = await import("./order-list");
const { parseOrderListParams } = await import("@/lib/order-list");

/**
 * The admin's reads of exchanges (wave 3, D239, `docs/wave-3-exchanges.md` 2.2, 5.4) against a real database: the original order's Returns card links the order its
 * return was exchanged for (and nothing of another store), the builder starts from the order's own address, and the order list's `source=exchange` finds the
 * exchange order and only it.
 */

describe("the admin's reads of an exchange", () => {
  it("links a return to its exchange order once processed, finds it with source=exchange, and keeps another store out", async () => {
    const store = await liveStore("ex-admin");
    const order = await paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const returnId = await withdrawal(store, order);
    expect(await admin.exchangeOrdersOfReturns(store.storeId, [returnId])).toEqual({});

    const delivery = await admin.orderDeliveryAddress(store.storeId, order.orderId);
    expect(delivery.country).toBe("NO");
    expect(delivery.email).toBe(true);
    expect(await admin.orderDeliveryAddress(store.storeId, "00000000-0000-4000-8000-000000000000")).toMatchObject({ name: "", email: false });

    const credit = (await r.previewRefund(store.storeId, returnId))!.refund.amountMinor;
    // The return page's builder starts from a preview of nothing: the credit and the original order's market, which the picker searches in.
    const start = await x.previewExchange(store.storeId, returnId, null);
    expect(start).toMatchObject({ ok: false, block: null, marketSlug: "no", currency: "NOK", credit: { amountMinor: credit }, lines: [] });
    const { exchange } = await proposedAndConfirmed(store, returnId, await builder(store, [["DEMO-THERMOS", 1, credit]]));
    // Proposed and confirmed: no order yet, so nothing to link.
    expect(await admin.exchangeOrdersOfReturns(store.storeId, [returnId])).toEqual({});
    const processed = await x.processExchange(store.storeId, staffActor(store.accountId), exchange.id);
    if (!processed.ok) throw new Error(JSON.stringify(processed));
    expect(processed.state).toBe("settled");

    expect(await admin.exchangeOrdersOfReturns(store.storeId, [returnId, "not-an-id"])).toEqual({ [returnId]: { orderId: processed.orderId, orderNumber: processed.orderNumber, settled: true } });
    const other = await liveStore("ex-admin-other");
    expect(await admin.exchangeOrdersOfReturns(other.storeId, [returnId])).toEqual({});

    const context = await loadOrderListContext(store.storeId);
    const exchanges = await listOrdersPage(store.storeId, parseOrderListParams(new URLSearchParams("source=exchange")), context);
    expect(exchanges.rows.map((row) => [row.id, row.source])).toEqual([[processed.orderId, "exchange"]]);
    const checkout = await listOrdersPage(store.storeId, parseOrderListParams(new URLSearchParams("source=checkout")), context);
    expect(checkout.rows.map((row) => row.id)).toEqual([order.orderId]);

    const shown = await getOrderAdmin(store.storeId, processed.orderId);
    expect(shown?.source).toBe("exchange");
    expect(shown?.exchange).toMatchObject({ returnId, originalOrderId: order.orderId, originalOrderNumber: order.number });
  });
});
