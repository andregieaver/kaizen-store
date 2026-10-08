import { sql } from "drizzle-orm";
import { isValidElement } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { featureOn } from "@/lib/store-features";
import { addCalendarDays, noonOf } from "@/lib/work-dates";

import { storeToday } from "./test-days";

vi.mock("server-only", () => ({}));
// 'use cache' needs Next's cache outside a request: run the functions as they are.
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));
const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    refunds: { create: async () => ({ id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const features = await import("./store-features");
const { afterSaleOf, afterSaleOpen } = await import("./after-sale");
const { getStore } = await import("./stores");
const { listProducts, getProduct } = await import("./catalog");
const { listIndexedProducts, listPublicStores, storeSitemap, storeLlms } = await import("./seo");
const { changeLine } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { markSent } = await import("./order-admin");
const { markDelivered } = await import("./order-delivery");
const { closeReturn } = await import("./returns");
const w = await import("./withdrawals");
const { storeFor, storesOf } = await import("./wordpress");
const { resolveSellingShop, resolveShop, resolveAfterSaleShop } = await import("./shop");
const { ownerSells } = await import("./content-grid");
const { requireShopOrAfterSale } = await import("@/components/admin/after-sale-gate");
const { requireFeature } = await import("@/components/admin/feature-off");
const { fxStore, paidOrder, NO } = await import("./fulfilment-test-fixture");
const { membershipOf } = await import("./trust-fixtures");

type Row = Record<string, unknown>;

/**
 * Website mode (D178 step 5, `docs/store-features.md` 4e): the online shop switched off. Nothing is offered or sold (the catalogue, the cart,
 * `placeOrder()` and the database's own `orders_store_open()`), WordPress and recommendations see no store, the sitemap and llms.txt list no
 * products, the shop's admin pages are hidden, and what was sold stays reachable while an order can still be withdrawn from or a return is
 * open (`afterSaleOf()`, judged by the withdrawal function's own `lineEligibility()`). Nothing is deleted: switching the shop on restores it.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let sold: Awaited<ReturnType<typeof paidOrder>>;
const parcel = { carrier: "posten", trackingNumber: "", trackingUrl: null };
const ZONE = "Europe/Oslo";

const fresh = async () => (await getStore(store.slug))!;
const owner = async () => membershipOf(store.slug, { id: store.accountId, email: "o@example.com", name: "O", platformAdmin: false }, "owner");
const switchShop = async (on: boolean) => features.setFeature(await owner(), "shop", on, { confirmed: true });
const deliveredOn = async (orderId: string, day: string) => {
  await db().execute(sql`update commerce.orders set delivered_at = ${noonOf(day, ZONE).toISOString()}::timestamptz where id = ${orderId}::uuid`);
};
const goodsSku = async () => {
  const [row] = await db().execute<Row>(sql`
    select v.sku from commerce.product_variants v join commerce.products p on p.id = v.product_id
    where p.store_id = ${store.storeId}::uuid and p.kind = 'goods' and p.status = 'active' and v.active and not p.subscription_only order by v.sku limit 1
  `);
  return String(row.sku);
};

async function refused(work: PromiseLike<unknown>, code: RegExp): Promise<void> {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause?.message ?? "";
    expect(`${(error as Error).message} ${cause}`).toMatch(code);
    return;
  }
  throw new Error("The database took it, and should have refused.");
}

beforeAll(async () => {
  store = await fxStore("website");
  // Open, so the store is in the sitemap and llms.txt.
  await db().execute(sql`update commerce.stores set setup_completed_at = now(), country = 'NO' where id = ${store.storeId}::uuid`);
});
afterAll(async () => {
  await closeDb();
});

describe("what is open after the sale (afterSaleOf)", () => {
  it("is nothing in a store without orders", async () => {
    expect(await afterSaleOf(store.storeId)).toEqual({ withdrawable: 0, openReturns: 0 });
    expect(await afterSaleOpen(store.storeId)).toBe(false);
  });

  it("counts a paid order not yet sent (the right is open before delivery), and the shop cannot be switched off while goods wait", async () => {
    sold = await paidOrder(store, [[await goodsSku(), 1]]);
    expect(await afterSaleOf(store.storeId)).toEqual({ withdrawable: 1, openReturns: 0 });
    const result = await switchShop(false);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(" ")).toMatch(/goods still to send/);
  });

  it("counts an order sent and received inside the 14 store days, the 14th day included, and not the day after", async () => {
    expect(await markSent(store.storeId, sold.orderId, parcel, store.accountId)).toMatchObject({ ok: true });
    expect(await markDelivered(store.storeId, { orderId: sold.orderId }, store.accountId)).toMatchObject({ ok: true });
    expect((await afterSaleOf(store.storeId)).withdrawable).toBe(1);
    const today = storeToday(ZONE);
    await deliveredOn(sold.orderId, addCalendarDays(today, -14));
    expect((await afterSaleOf(store.storeId)).withdrawable).toBe(1);
    await deliveredOn(sold.orderId, addCalendarDays(today, -15));
    expect(await afterSaleOf(store.storeId)).toEqual({ withdrawable: 0, openReturns: 0 });
    // The store's own longer window keeps it open as a return.
    await db().execute(sql`insert into commerce.return_settings (store_id, window_days) values (${store.storeId}::uuid, 30) on conflict (store_id) do update set window_days = 30`);
    expect((await afterSaleOf(store.storeId)).withdrawable).toBe(1);
    await db().execute(sql`update commerce.return_settings set window_days = 14 where store_id = ${store.storeId}::uuid`);
    expect((await afterSaleOf(store.storeId)).withdrawable).toBe(0);
  });

  it("keeps an open return open after the window, until it is closed", async () => {
    const today = storeToday(ZONE);
    await deliveredOn(sold.orderId, addCalendarDays(today, -5));
    const lines = (await db().execute<Row>(sql`select id, quantity from commerce.order_lines where order_id = ${sold.orderId}::uuid`)).map((l) => ({ lineId: String(l.id), quantity: Number(l.quantity) }));
    const done = await w.registerWithdrawal(store.storeId, { orderNumber: sold.number, name: "Kari Nordmann", channel: "email", informedOn: null, lines }, null);
    if (!done.ok) throw new Error(JSON.stringify(done));
    // Everything on the order is withdrawn now: no line has a right left, but the return is open.
    expect(await afterSaleOf(store.storeId)).toEqual({ withdrawable: 0, openReturns: 1 });
    await deliveredOn(sold.orderId, addCalendarDays(today, -40));
    expect(await afterSaleOpen(store.storeId)).toBe(true);
    expect(await closeReturn(store.storeId, { returnId: done.returnId }, null, { confirmNoRefund: true })).toMatchObject({ ok: true });
    expect(await afterSaleOf(store.storeId)).toEqual({ withdrawable: 0, openReturns: 0 });
  });

  it("never counts another store's orders", async () => {
    const other = await fxStore("website-other");
    await paidOrder(other, [[await goodsSku(), 1]]);
    expect(await afterSaleOf(store.storeId)).toEqual({ withdrawable: 0, openReturns: 0 });
    expect((await afterSaleOf(other.storeId)).withdrawable).toBe(1);
  });
});

describe("the shop switched off (website mode)", () => {
  let recent: Awaited<ReturnType<typeof paidOrder>>;

  it("switches off once nothing waits to be sent, and nothing is deleted", async () => {
    recent = await paidOrder(store, [[await goodsSku(), 1]]);
    expect(await markSent(store.storeId, recent.orderId, parcel, store.accountId)).toMatchObject({ ok: true });
    const products = (await db().execute<Row>(sql`select count(*)::int as n from commerce.products where store_id = ${store.storeId}::uuid`))[0].n;
    expect(await switchShop(false)).toMatchObject({ ok: true });
    const s = await fresh();
    expect(featureOn(s, "shop")).toBe(false);
    expect((await db().execute<Row>(sql`select count(*)::int as n from commerce.products where store_id = ${store.storeId}::uuid`))[0].n).toBe(products);
  });

  it("offers no product to shoppers: the catalogue, a product's page, the sitemap's products and llms.txt", async () => {
    const s = await fresh();
    expect(await listProducts(s.id, s.markets[0])).toEqual([]);
    expect(await getProduct(s.id, s.markets[0], "demo-keramikkopp")).toBeNull();
    expect(await listIndexedProducts(s.id)).toEqual([]);
    expect((await listPublicStores()).find((p) => p.slug === s.slug)).toMatchObject({ selling: false, indexable: true });
    const sitemap = (await storeSitemap(s.slug))!;
    expect(sitemap).not.toContain("/p/");
    expect(sitemap).not.toContain("/category/");
    const llms = (await storeLlms(s.slug))!;
    expect(llms).toContain("## About");
    expect(llms).not.toContain("Shopping here");
    expect(llms).not.toContain("/p/");
    expect(await ownerSells(s.id)).toBe(false);
  });

  it("refuses the cart, placing an order and the database's own insert", async () => {
    const shop = { storeId: store.storeId, market: NO };
    const [variant] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = ${await goodsSku()}`);
    expect(await changeLine(shop, String(variant.id), 1, "add")).toMatchObject({ outcome: "unavailable", quantity: 0 });
    // A cart from before the switch, as a stale page would send it to checkout.
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${store.storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
    `);
    await db().execute(sql`insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) values (${store.storeId}::uuid, ${String(cart.id)}::uuid, ${String(variant.id)}::uuid, 1)`);
    expect(await placeOrder(shop, String(cart.id), {}, { customerId: null })).toEqual({ ok: false, problem: "unavailable" });
    await refused(
      db().execute(sql`
        insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
        values (${store.storeId}::uuid, ${`W-${Date.now()}`}, 'NO', 'NOK', 'nb-NO', 'w@example.com', 'pending_payment', 100, 0, 0, 20, 100, '{"name":"A"}'::jsonb, '{"name":"A"}'::jsonb)
      `),
      /orders\.shop_off/,
    );
  });

  it("is no store to WordPress or the shop's own routes and actions, and keeps its after-sale pages", async () => {
    expect(await storeFor(store.accountId, store.slug)).toBeNull();
    expect((await storesOf(store.accountId)).map((s) => s.slug)).not.toContain(store.slug);
    expect(await resolveSellingShop(store.slug, "no")).toBeNull();
    expect(await resolveShop(store.slug, "no")).not.toBeNull();
    expect(await resolveAfterSaleShop(store.slug, "no")).not.toBeNull();
  });

  it("hides the shop's admin pages, and keeps the orders and returns while an order can still be withdrawn from", async () => {
    const member = membershipOf(store.slug, { id: store.accountId, email: "o@example.com", name: "O", platformAdmin: false }, "owner");
    const m = await member;
    expect(isValidElement(requireFeature(m, "shop"))).toBe(true);
    // The order sent a moment ago is not recorded as received: its right is open, so Orders stays.
    expect(await afterSaleOpen(store.storeId)).toBe(true);
    expect(await requireShopOrAfterSale(m)).toBeNull();
    await db().execute(sql`update commerce.orders set delivered_at = now() - interval '60 days' where store_id = ${store.storeId}::uuid`);
    expect(await afterSaleOpen(store.storeId)).toBe(false);
    expect(isValidElement(await requireShopOrAfterSale(m))).toBe(true);
  });

  it("brings everything back when it is switched on again", async () => {
    expect(await switchShop(true)).toMatchObject({ ok: true });
    const s = await fresh();
    expect(featureOn(s, "shop")).toBe(true);
    expect((await listProducts(s.id, s.markets[0])).length).toBeGreaterThan(0);
    expect(await storeFor(store.accountId, store.slug)).not.toBeNull();
    expect(await resolveSellingShop(store.slug, "no")).not.toBeNull();
    const m = await membershipOf(store.slug, { id: store.accountId, email: "o@example.com", name: "O", platformAdmin: false }, "owner");
    expect(requireFeature(m, "shop")).toBeNull();
    expect(await requireShopOrAfterSale(m)).toBeNull();
    expect((await storeSitemap(s.slug))!).toContain("/p/");
  });
});
