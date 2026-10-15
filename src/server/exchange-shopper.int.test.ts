import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./refresh", () => ({ refreshTag: () => {}, refreshTagNow: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "butikk@example.com";
const sent = vi.hoisted(() => ({ bodies: [] as string[] }));
vi.stubGlobal("fetch", async (_input: string | URL, init?: RequestInit) => {
  sent.bodies.push(typeof init?.body === "string" ? init.body : "");
  return new Response(JSON.stringify({ id: `em_s_${sent.bodies.length}` }), { status: 200, headers: { "content-type": "application/json" } });
});

const support = await import("./inventory-test-support");
const x = await import("./exchanges");
const w = await import("./withdrawals");
const r = await import("./returns");
const { markSent } = await import("./order-admin");
const { saveExchangeLabelSettings } = await import("./return-settings");

type Row = Record<string, unknown>;

/**
 * The shopper's side of the exchange wish against a real database (wave 3, D239, `docs/wave-3-exchanges.md` 2.1): the status page offers the field only while
 * the return can be exchanged and nothing was asked or proposed; a wish is kept once and tells the store; a voluntary return request's own field is taken while
 * the request is still `requested` (and only then); the store's setting turns the offer off. Nothing is applied from a wish.
 */

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

async function shopStore(label: string) {
  const store = await support.newStore(label);
  await db().execute(sql`update commerce.stores set contact_email = ${`butikk-${store.slug}@example.com`} where id = ${store.storeId}::uuid`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 50 where store_id = ${store.storeId}::uuid`);
  return store;
}

async function paidSent(store: Awaited<ReturnType<typeof shopStore>>) {
  const placed = await support.place(store.storeId, [["DEMO-THERMOS", 1]]);
  await support.pay(store.storeId, placed, store.account);
  await db().execute(sql`update commerce.orders set shipping_address = shipping_address || '{"country": "NO"}'::jsonb where id = ${placed.orderId}::uuid`);
  await markSent(store.storeId, placed.orderId, { carrier: "other", trackingNumber: `T-${placed.orderId.slice(0, 6)}`, trackingUrl: null }, null);
  const [o] = await db().execute<Row>(sql`select number from commerce.orders where id = ${placed.orderId}::uuid`);
  const lines = await db().execute<Row>(sql`select id, quantity from commerce.order_lines where order_id = ${placed.orderId}::uuid`);
  return { orderId: placed.orderId, number: String(o.number), lines: lines.map((l) => ({ lineId: String(l.id), quantity: Number(l.quantity) })) };
}

async function withdrawn(store: Awaited<ReturnType<typeof shopStore>>) {
  const order = await paidSent(store);
  const started = await w.startWithdrawal(store.storeId, { orderNumber: order.number, email: "kari@example.com", name: "Kari Nordmann", lines: order.lines }, { floorMs: 0 });
  if (!started.ok || !started.matched || !started.request) throw new Error(JSON.stringify(started));
  const confirmed = await w.confirmWithdrawal(store.storeId, { requestId: started.request.id });
  if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
  const [ret] = await db().execute<Row>(sql`select id, public_token from commerce.returns where id = ${confirmed.returns[0].id}::uuid`);
  return { order, returnId: String(ret.id), token: String(ret.public_token) };
}

describe("the exchange wish on a return's status page (D239 2.1)", () => {
  it("is offered while the return can be exchanged, kept once, told to the store, and then offered no more", async () => {
    const store = await shopStore("ex-wish");
    const { token, returnId } = await withdrawn(store);
    expect(await x.wishOfferedFor(store.storeId, token)).toBe(true);
    // Another store, or a token that is no return's, is never offered anything.
    const other = await shopStore("ex-wish-other");
    expect(await x.wishOfferedFor(other.storeId, token)).toBe(false);
    expect(await x.wishOfferedFor(store.storeId, "f".repeat(64))).toBe(false);
    expect(await x.wishOfferedFor(store.storeId, "not a token")).toBe(false);

    // The words are checked as the field checks them.
    expect(await x.recordExchangeWish(store.storeId, token, { note: "   " })).toMatchObject({ ok: false, problem: "invalid", message: "empty" });
    expect(await x.recordExchangeWish(store.storeId, token, { note: "x".repeat(501) })).toMatchObject({ ok: false, problem: "invalid", message: "too_long" });

    const before = sent.bodies.length;
    expect(await x.recordExchangeWish(store.storeId, token, { note: "Size M instead, please" })).toEqual({ ok: true });
    const [kept] = await db().execute<Row>(sql`select exchange_wish_at, exchange_wish_note from commerce.returns where id = ${returnId}::uuid`);
    expect(kept.exchange_wish_note).toBe("Size M instead, please");
    expect(kept.exchange_wish_at).not.toBeNull();
    // The store hears of it once, and the alert never carries the shopper's words.
    expect(sent.bodies.length).toBe(before + 1);
    expect(sent.bodies.at(-1)).not.toContain("Size M instead");
    expect(await x.recordExchangeWish(store.storeId, token, { note: "Again" })).toMatchObject({ ok: false, problem: "wish_made" });
    expect(sent.bodies.length).toBe(before + 1);

    // The status page now says it was sent, and does not offer the field again; the words are not shown back.
    expect(await x.wishOfferedFor(store.storeId, token)).toBe(false);
    const shopper = await r.getShopperReturn(store.storeId, token);
    expect(shopper?.exchangeWishAt).not.toBeNull();
    expect(JSON.stringify(shopper)).not.toContain("Size M instead");
    // Nothing is applied from a wish: no exchange exists, the refund is untouched.
    const [n] = await db().execute<Row>(sql`select count(*)::int as n from commerce.return_exchanges where return_id = ${returnId}::uuid`);
    expect(Number(n.n)).toBe(0);
  });

  it("is not offered when the store has turned exchanges off", async () => {
    const store = await shopStore("ex-wish-off");
    const { token } = await withdrawn(store);
    expect(await saveExchangeLabelSettings(store.storeId, { exchanges: false, labelCarrier: null, labelService: null, labelAuto: false }, store.accountId)).toMatchObject({ ok: true });
    expect(await x.wishOfferedFor(store.storeId, token)).toBe(false);
    expect(await x.recordExchangeWish(store.storeId, token, { note: "Size M" })).toMatchObject({ ok: false, problem: "wish_off" });
  });

  it("is taken with a voluntary return request while it is still requested, and only by the request's own field", async () => {
    const store = await shopStore("ex-wish-req");
    const order = await paidSent(store);
    const [ret] = await db().execute<Row>(sql`
      insert into commerce.returns (store_id, order_id, kind, status) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'return', 'requested') returning id, public_token
    `);
    await db().execute(sql`
      insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values (${store.storeId}::uuid, ${String(ret.id)}::uuid, ${order.lines[0].lineId}::uuid, 1, 'accept')
    `);
    const token = String(ret.public_token);
    // A request not yet approved is not offered the status page's field…
    expect(await x.wishOfferedFor(store.storeId, token)).toBe(false);
    expect(await x.recordExchangeWish(store.storeId, token, { note: "Blue instead" })).toMatchObject({ ok: false, problem: "wish_off" });
    // …but the request form's own field, sent with the request, is kept.
    expect(await x.recordExchangeWish(store.storeId, token, { note: "Blue instead" }, { atRequest: true })).toEqual({ ok: true });
    const [kept] = await db().execute<Row>(sql`select exchange_wish_note from commerce.returns where id = ${String(ret.id)}::uuid`);
    expect(kept.exchange_wish_note).toBe("Blue instead");
  });
});
