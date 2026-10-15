import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod, todayIn } from "@/lib/analytics-period";
import { EXCHANGE_CHANNEL } from "@/lib/analytics-traffic";
import { conversionFor, localizationOf } from "@/lib/localization";
import { formatMoney } from "@/lib/money";
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
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {}, after: () => {} }));

/** Kaizen's platform Stripe client, faked: refunds succeed and are recorded. */
const fake = vi.hoisted(() => {
  let next = 0;
  const client = {
    refunds: { create: async () => ({ id: `re_ax_${++next}`, status: "succeeded" }) },
    coupons: { create: async () => ({ id: `coupon_${++next}` }) },
    checkout: { sessions: { create: async () => ({ id: `cs_ax_${++next}`, url: "https://checkout.stripe.test/x" }), retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }), expire: async (id: string) => ({ id }) } },
  };
  return { client };
});
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test", "live"], WEBHOOK_EVENTS: [] }));

process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "butikk@example.com";
let emailCount = 0;
vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: `em_ax_${++emailCount}` }), { status: 200, headers: { "content-type": "application/json" } }));

const support = await import("./inventory-test-support");
const x = await import("./exchanges");
const { proposeForTest } = await import("./exchange-test-support");
const pay = await import("./exchange-pay");
const w = await import("./withdrawals");
const r = await import("./returns");
const { staffActor } = await import("./order-actor");
const { markSent } = await import("./order-admin");
const { getStore } = await import("./stores");
const { marketingReport, trafficReport } = await import("./analytics-traffic-data");
const { returnsReport } = await import("./analytics-returns-data");
const { periodTotals } = await import("./analytics-totals");
const { toMainOne } = await import("./analytics-sql");
const ownerTools = await import("./owner-tools");
const { runTool } = await import("./support-tools");
const supportCore = await import("./support");
const { systemDesk } = await import("./support-desk");

type Row = Record<string, unknown>;
/** A tool's answer, read loosely: each test checks the shape it expects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Loose = Record<string, any>;
type TestStore = Awaited<ReturnType<typeof support.newStore>>;
type Store = NonNullable<Awaited<ReturnType<typeof getStore>>>;

/**
 * Exchanges in the analytics, the AI manager and the support tools (wave 3, D239, `docs/wave-3-exchanges.md` 2.6 and 5.5, `docs/analytics.md` "Exchange order",
 * "Transfer", "Exchanged return"), against a real database and the real exchange flow: two withdrawals of a shopper's orders, one in kroner and one shown in
 * euro, each exchanged for a cheaper replacement (the transfer pays the new order, the rest goes back through Stripe, faked), and a third withdrawal with a
 * proposal still out. The exchange orders are paid orders like any, in their own channel row and in no conversion; the Returns section counts the exchanged
 * returns and the credit kept as replacements, converted from euro once; a store with no exchange says what is missing; the tools repeat the store's own
 * words and amounts. Every expectation is worked out here from the rows, never by the code under test.
 */

const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const noInEuro = showMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }, {
  currency: "EUR",
  conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]), "NOK", "EUR")!,
});

let shop: TestStore;
let store: Store;
let empty: Store;
let customerId: string;
const exchanged: { returnId: string; returnNumber: string; originalId: string; originalNumber: string; exchangeOrderId: string; exchangeOrderNumber: string; credit: number; currency: string }[] = [];
let proposedReturn = "";
let period: ReturnType<typeof customPeriod>;

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

beforeEach(() => jar.clear());

async function liveStore(label: string): Promise<TestStore> {
  const s = await support.newStore(label);
  await db().execute(sql`update commerce.stripe_accounts set mode = 'live' where store_id = ${s.storeId}::uuid`);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'live' where store_id = ${s.storeId}::uuid`);
  await db().execute(sql`update commerce.stores set features = features || array['countries', 'currencies'], legal_name = 'Bytte AS', organisation_number = '923456789',
    postal_address = 'Storgata 1, 0155 Oslo', country = 'NO', contact_email = ${`butikk-${s.slug}@example.com`}, visit_counting = true where id = ${s.storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${s.storeId}::uuid, true, 'NO923456789MVA')
    on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923456789MVA'
  `);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${s.storeId}::uuid, 'NOK', 11.5, 1, 0), (${s.storeId}::uuid, 'EUR', 1, 1, 1) on conflict do nothing
  `);
  await db().execute(sql`insert into commerce.invoice_settings (store_id, enabled) values (${s.storeId}::uuid, true) on conflict (store_id) do update set enabled = true`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${s.storeId}::uuid`);
  return s;
}

/** An order placed from a cart, paid on the store's live account, the customer's own (signed in), sent with a full address. */
async function paidOrder(s: TestStore, lines: [string, number][], market: Market) {
  const placed = await support.place(s.storeId, lines, market);
  await support.pay(s.storeId, placed, s.account);
  await db().execute(sql`
    update commerce.orders set shipping_address = shipping_address || '{"country": "NO"}'::jsonb, billing_address = '{"name": "Kari Nordmann"}'::jsonb,
      customer_id = ${customerId}::uuid
    where id = ${placed.orderId}::uuid
  `);
  await markSent(s.storeId, placed.orderId, { carrier: "other", trackingNumber: `T-${placed.orderId.slice(0, 6)}`, trackingUrl: null }, null);
  const [o] = await db().execute<Row>(sql`select number from commerce.orders where id = ${placed.orderId}::uuid`);
  const ls = await db().execute<Row>(sql`select id, quantity from commerce.order_lines where order_id = ${placed.orderId}::uuid order by sku`);
  return { orderId: placed.orderId, number: String(o.number), lines: ls.map((l) => ({ id: String(l.id), quantity: Number(l.quantity) })) };
}

async function withdrawal(s: TestStore, order: Awaited<ReturnType<typeof paidOrder>>): Promise<string> {
  const started = await w.startWithdrawal(s.storeId, { orderNumber: order.number, email: "kari@example.com", name: "Kari Nordmann", lines: order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })) }, { floorMs: 0 });
  if (!started.ok || !started.matched || !started.request) throw new Error(`withdrawal failed: ${JSON.stringify(started)}`);
  const confirmed = await w.confirmWithdrawal(s.storeId, { requestId: started.request.id });
  if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
  const returnId = confirmed.returns[0].id;
  expect(await r.markInTransit(s.storeId, { returnId }, null)).toMatchObject({ ok: true });
  return returnId;
}

const address = { name: "Kari Nordmann", street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" };

/** One mug at its list price in the market's view, free shipping. */
async function oneMug(s: TestStore, market: Market) {
  const [row] = await db().execute<Row>(sql`
    select v.id, cp.amount_minor from commerce.product_variants v join commerce.current_prices cp on cp.variant_id = v.id and cp.market_code = 'NO'
    where v.store_id = ${s.storeId}::uuid and v.sku = 'DEMO-MUG-WHITE'
  `);
  const { shown } = await import("@/lib/markets");
  return { lines: [{ variantId: String(row.id), quantity: 1, unitPriceMinor: shown(market, Number(row.amount_minor)) }], shipping: { kind: "free" as const }, deliveryAddress: address };
}

const shopOf = async (market: Market) => ({ store: (await getStore(shop.slug))!, market });

beforeAll(async () => {
  shop = await liveStore("ax");
  const [c] = await db().execute<Row>(sql`insert into commerce.customers (store_id, email, email_verified_at) values (${shop.storeId}::uuid, 'kari@example.com', now()) returning id`);
  customerId = String(c.id);
  // One counted visit today, so the channel table covers the day.
  await db().execute(sql`
    insert into commerce.visits (store_id, day, visitor, market_code, device, channel, landing_path)
    values (${shop.storeId}::uuid, (now() at time zone 'Europe/Oslo')::date, ${"a1b2".padEnd(24, "0")}, 'NO', 'mobile', 'direct', '/')
  `);

  for (const market of [no, noInEuro]) {
    const order = await paidOrder(shop, [["DEMO-THERMOS", 2]], market);
    const returnId = await withdrawal(shop, order);
    const proposed = await proposeForTest(x.proposeExchange, shop.storeId, staffActor(shop.accountId), returnId, await oneMug(shop, market));
    if (!proposed.ok) throw new Error(JSON.stringify(proposed));
    expect(await pay.confirmExchange(await shopOf(market), proposed.link!.split("/").at(-1)!, { termsTicked: true })).toEqual({ ok: true, state: "confirmed" });
    const processed = await x.processExchange(shop.storeId, staffActor(shop.accountId), proposed.exchange.id);
    if (!processed.ok || processed.state !== "settled") throw new Error(JSON.stringify(processed));
    const [ret] = await db().execute<Row>(sql`select number, refund_minor from commerce.returns where id = ${returnId}::uuid`);
    exchanged.push({
      returnId,
      returnNumber: String(ret.number),
      originalId: order.orderId,
      originalNumber: order.number,
      exchangeOrderId: processed.orderId!,
      exchangeOrderNumber: String(processed.orderNumber),
      credit: Number(ret.refund_minor),
      currency: market.currency,
    });
  }

  // A third withdrawal with a proposal still out: not exchanged yet.
  const third = await paidOrder(shop, [["DEMO-THERMOS", 1]], no);
  proposedReturn = await withdrawal(shop, third);
  const out = await proposeForTest(x.proposeExchange, shop.storeId, staffActor(shop.accountId), proposedReturn, await oneMug(shop, no));
  if (!out.ok) throw new Error(JSON.stringify(out));

  store = (await getStore(shop.slug))!;
  const today = todayIn(new Date(), store.timeZone);
  period = customPeriod(today, today);
  const other = await support.newStore("ax-empty");
  empty = (await getStore(other.slug))!;
});

describe("the exchange orders in the analytics (docs/analytics.md, Exchange order)", () => {
  it("are paid orders like any: the period has five, and the original orders' credit is a refund", async () => {
    const { totals } = await periodTotals(store, period);
    expect(totals.orders).toBe(5);
    // Conversion's orders are the shopper's checkouts only: the three originals.
    expect(totals.checkoutOrders).toBe(3);
    // Every succeeded refund, the transfers among them, scaled to without VAT by its order and converted once.
    const refunds = await db().execute<Row>(sql`
      select rf.amount_minor, o.total_minor, o.tax_minor, o.currency from commerce.refunds rf
      join commerce.payments p on p.id = rf.payment_id join commerce.orders o on o.id = p.order_id
      where o.store_id = ${store.id}::uuid and rf.status = 'succeeded'
    `);
    expect(refunds.length).toBe(4);
    const expected = refunds.reduce((sum, f) => {
      const exVat = Math.round((Number(f.amount_minor) * (Number(f.total_minor) - Number(f.tax_minor))) / Number(f.total_minor));
      return sum + (toMainOne(store, String(f.currency), exVat) ?? 0);
    }, 0);
    expect(Math.abs(totals.refundsMinor - expected)).toBeLessThanOrEqual(2);
  });

  it("are their own row in the channel table, with no sessions and no conversion, and left out of the blended conversion", async () => {
    const report = await marketingReport(store, period, new Date());
    const row = report.table!.rows.find((x) => x.channel === EXCHANGE_CHANNEL)!;
    expect(row.label).toBe("Exchanges");
    expect(row.orders).toBe(2);
    expect(row.sessions).toBeNull();
    expect(row.conversion).toBeNull();
    const made = await db().execute<Row>(sql`select currency, total_minor - tax_minor as revenue from commerce.orders where store_id = ${store.id}::uuid and source = 'exchange'`);
    expect(row.revenueMinor).toBe(made.reduce((sum, o) => sum + (toMainOne(store, String(o.currency), Number(o.revenue)) ?? 0), 0));
    // One session; the three originals have no visit (their carts were not counted), so they are Unknown; the exchange orders are no visit's.
    expect(report.table!.blended.orders).toBe(5);
    expect(report.table!.blended.conversion).toBe(3);
  });

  it("are left out of the visit tables of the Traffic page and named apart", async () => {
    const report = await trafficReport(store, period, new Date());
    expect(report.exchangeOrders.orders).toBe(2);
    expect(report.conversion.orders).toBe(3);
    expect(report.notes.some((n) => n.includes("2 paid exchange orders"))).toBe(true);
  });
});

describe("the Returns section's exchanges (docs/analytics.md, Exchanged return)", () => {
  it("counts the exchanged returns by kind, gives no share under the minimum, and the credit kept as replacements converted once", async () => {
    const report = await returnsReport(store, period, new Date());
    expect(report.made.returns).toBe(3);
    expect(report.exchanges.tracked).toBe(true);
    expect(report.exchanges.returns).toBe(2);
    expect(report.kinds.find((k) => k.kind === "withdrawal")!.exchanged).toBe(2);
    expect(report.exchanges.share.value).toBeNull();
    expect(report.exchanges.share.missing).toContain("Only 3 returns made in this period");
    const transfers = await db().execute<Row>(sql`
      select rf.amount_minor, o.total_minor, o.tax_minor, o.currency from commerce.refunds rf
      join commerce.payments p on p.id = rf.payment_id join commerce.orders o on o.id = p.order_id
      where o.store_id = ${store.id}::uuid and rf.kind = 'transfer'
    `);
    expect(transfers.length).toBe(2);
    expect(new Set(transfers.map((t) => String(t.currency).trim()))).toEqual(new Set(["NOK", "EUR"]));
    const kept = transfers.reduce(
      (sum, t) => sum + (toMainOne(store, String(t.currency), Math.round((Number(t.amount_minor) * (Number(t.total_minor) - Number(t.tax_minor))) / Number(t.total_minor))) ?? 0),
      0,
    );
    expect(report.exchanges.keptMinor).toBe(kept);
    expect(report.exchanges.transfers).toBe(2);
  });

  it("says what is missing for a store that has never exchanged, never 0 %, and never reads another store's", async () => {
    const report = await returnsReport(empty, period, new Date());
    expect(report.exchanges).toMatchObject({ returns: 0, keptMinor: 0, transfers: 0, tracked: false });
    expect(report.exchanges.share.value).toBeNull();
    expect(report.exchanges.share.missing).toContain("No return has been exchanged in Kaizena Flow yet");
  });
});

describe("the AI manager reads exchanges and does none (2.6)", () => {
  const ctx = () => ({ account: { id: shop.accountId, email: shop.accountEmail, name: "Owner", platformAdmin: false }, store, invalidate: () => {} });

  it("explain_return says the exchange's state and amounts as the store worked them out, and the label", async () => {
    const [nok] = exchanged;
    const out = (await ownerTools.runOwnerTool(ctx() as never, "explain_return", { return: nok.returnNumber })) as Loose;
    const [xr] = await db().execute<Row>(sql`select total_minor, difference_minor from commerce.return_exchanges where return_id = ${nok.returnId}::uuid and status = 'settled'`);
    const m = (minor: number) => formatMoney(minor, "NOK", store.markets[0].locale);
    expect(out.exchange).toMatchObject({ status: "Exchanged", credit: m(nok.credit), replacements: m(Number(xr.total_minor)), exchange_order: nok.exchangeOrderNumber });
    expect(Number(xr.difference_minor)).toBeLessThan(0);
    expect(out.exchange.difference).toBe(`The customer gets ${m(-Number(xr.difference_minor))} back`);
    expect(out.return_label).toMatchObject({ label: "No return label yet" });
    expect(out.note).toContain("never proposes, confirms or processes an exchange");
  });

  it("list_returns marks the return whose proposal is out", async () => {
    const out = (await ownerTools.runOwnerTool(ctx() as never, "list_returns", { which: "all" })) as { returns: Row[] };
    const [ret] = await db().execute<Row>(sql`select number from commerce.returns where id = ${proposedReturn}::uuid`);
    expect(out.returns.find((x) => x.number === String(ret.number))).toMatchObject({ exchange: "Exchange proposed, waiting for the customer" });
  });

  it("get_order says an exchange order is one, of which return and order; an ordinary order says nothing of it", async () => {
    const [nok] = exchanged;
    const made = (await ownerTools.runOwnerTool(ctx() as never, "get_order", { order: nok.exchangeOrderNumber })) as Loose;
    expect(made.exchange_for).toMatchObject({ return: nok.returnNumber, original_order: nok.originalNumber });
    const original = (await ownerTools.runOwnerTool(ctx() as never, "get_order", { order: nok.originalNumber })) as Loose;
    expect(original.exchange_for).toBeUndefined();
  });
});

describe("the support tools tell the AI where an exchange stands, never a price (2.6)", () => {
  it("order_details gives each return's exchange state and the exchange order its return, for the signed-in customer's own orders", async () => {
    await db().execute(sql`insert into commerce.support_settings (store_id, mode, tone_on, summaries_on, partner) values (${store.id}::uuid, 'ai_first', false, false, false) on conflict (store_id) do update set mode = 'ai_first'`);
    const market = store.markets.find((m) => m.code === "NO")!;
    const [conversation] = await db().execute<Row>(sql`insert into commerce.support_conversations (store_id, source, handler, token_hash, locale) values (${store.id}::uuid, 'site', 'ai', ${`t-ax-${Date.now()}`}, 'nb-NO') returning id`);
    const toolCtx = {
      site: { kind: "store", store, market },
      settings: (await supportCore.deskSettings(systemDesk(store.id)))!,
      customer: { id: customerId, email: "kari@example.com" },
      desk: systemDesk(store.id),
      conversationId: String(conversation.id),
    } as never;
    const [nok] = exchanged;
    const original = JSON.parse((await runTool(toolCtx, "order_details", { number: nok.originalNumber })).result) as Loose;
    expect(original.returns).toEqual([expect.objectContaining({ number: nok.returnNumber, exchange: expect.stringContaining("Exchanged"), exchangeOrder: nok.exchangeOrderNumber })]);
    const made = JSON.parse((await runTool(toolCtx, "order_details", { number: nok.exchangeOrderNumber })).result) as Loose;
    expect(made.exchangeFor).toMatchObject({ return: nok.returnNumber, originalOrder: nok.originalNumber });
    // The proposal still out is said as such, with no amount.
    const [third] = await db().execute<Row>(sql`select o.number from commerce.returns r join commerce.orders o on o.id = r.order_id where r.id = ${proposedReturn}::uuid`);
    const pending = JSON.parse((await runTool(toolCtx, "order_details", { number: String(third.number) })).result) as Loose;
    expect(pending.returns[0].exchange).toContain("confirms or declines it");
    expect(pending.returns[0].exchange).not.toMatch(/\d/);
  });
});
