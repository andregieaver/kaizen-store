import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import { makeStore } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("./refresh", () => ({ refreshTag: () => {}, refreshTagNow: () => {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
// A shopper's cookies, kept between calls as a browser keeps them, so the cart is the same cart.
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { changeLine, choosePlan, readCartId } = await import("./cart");
const { startCheckout } = await import("./checkout");
const { changeSubscription, getSubscriptionForOrder } = await import("./subscriptions");

type Row = Record<string, unknown>;

/**
 * Free orders and subscriptions (D913) in a store with no payment provider at all: a product that costs nothing is confirmed at once with a
 * payment of nothing as its record, and a plan that costs nothing becomes a subscription Kaizena Flow keeps itself (provider `none`), switched on
 * when its order is paid and ended at once when cancelled. Stripe is never asked: the store has no account to ask.
 */

const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let store: { id: string; slug: string };
let freeVariant: string;
let planVariant: string;
let planOption: string;
const payer = { name: "Kari Nordmann", email: "kari-free@example.com" };

async function product(handle: string, kind: string, delivery: string, subscriptionOnly: boolean): Promise<{ product: string; variant: string }> {
  return db().transaction(async (tx) => {
    const [p] = await tx.execute<Row>(sql`
      insert into commerce.products (store_id, handle, tax_code, kind, delivery, subscription_only)
      values (${store.id}::uuid, ${handle}, 'txcd_10000000', ${kind}, ${delivery}, ${subscriptionOnly}) returning id
    `);
    const [v] = await tx.execute<Row>(sql`
      insert into commerce.product_variants (store_id, product_id, sku, delivery)
      values (${store.id}::uuid, ${String(p.id)}::uuid, ${handle.toUpperCase()}, ${delivery}) returning id
    `);
    await tx.execute(sql`select commerce.set_price(${String(v.id)}::uuid, 'NO', 0)`);
    await tx.execute(sql`insert into commerce.product_translations (store_id, product_id, locale, title) values (${store.id}::uuid, ${String(p.id)}::uuid, 'nb-NO', ${handle})`);
    await tx.execute(sql`insert into commerce.product_media (store_id, product_id, url) values (${store.id}::uuid, ${String(p.id)}::uuid, '/demo/lamp.webp')`);
    return { product: String(p.id), variant: String(v.id) };
  });
}

beforeAll(async () => {
  store = await makeStore("free-orders");
  await db().execute(sql`update commerce.stores set features = array_append(features, 'subscriptions') where id = ${store.id}::uuid`);
  const free = await product("free-guide", "goods", "digital", false);
  freeVariant = free.variant;
  await db().execute(sql`update commerce.products set status = 'active' where id = ${free.product}::uuid`);
  const plan = await product("free-plan", "plan", "service", true);
  planVariant = plan.variant;
  const [option] = await db().execute<Row>(sql`
    insert into commerce.selling_plans (store_id, product_id, variant_id, interval, interval_count, discount_percent)
    values (${store.id}::uuid, ${plan.product}::uuid, ${plan.variant}::uuid, 'month', 1, 0) returning id
  `);
  planOption = String(option.id);
  await db().execute(sql`update commerce.products set status = 'active' where id = ${plan.product}::uuid`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

const shop = () => ({ storeId: store.id, market: no });
const checkout = (consent: { digital?: boolean; subscription?: boolean }) =>
  readCartId(shop()).then((cartId) => startCheckout({ ...shop(), storeSlug: store.slug }, cartId!, "https://shop.example", "Frakt", consent, { payer }));

describe("an order that costs nothing (D913)", () => {
  it("is confirmed at once with no payment provider, its record a payment of nothing", async () => {
    jar.clear();
    expect((await changeLine(shop(), freeVariant, 1, "add")).outcome).toBe("added");
    const started = await checkout({ digital: true });
    if (!started.ok) throw new Error(started.problem);
    expect(started.url).toMatch(/\/order\/[0-9a-f-]+\?session_id=free_/);
    const [order] = await db().execute<Row>(sql`
      select o.status, o.email, pay.provider, pay.amount_minor, pay.status as payment
      from commerce.orders o join commerce.payments pay on pay.order_id = o.id
      where o.store_id = ${store.id}::uuid and o.email = ${payer.email} order by o.placed_at desc limit 1
    `);
    // A record, never money (as a venue's or terms' payment is): it stays pending, so no commission or capture runs on it.
    expect(order).toMatchObject({ status: "paid", provider: "free", payment: "pending" });
    expect(Number(order.amount_minor)).toBe(0);
  });

  it("still asks who it is for", async () => {
    jar.clear();
    await changeLine(shop(), freeVariant, 1, "add");
    const cartId = (await readCartId(shop()))!;
    const started = await startCheckout({ ...shop(), storeSlug: store.slug }, cartId, "https://shop.example", "Frakt", { digital: true }, {});
    expect(started).toMatchObject({ ok: false, problem: "payments_off" });
  });
});

describe("a subscription that costs nothing (D913)", () => {
  it("is Kaizena Flow's own, switched on when its order is paid, with no consent to charges asked", async () => {
    jar.clear();
    expect((await choosePlan(shop(), planVariant, planOption)).outcome).toBe("added");
    const started = await checkout({});
    if (!started.ok) throw new Error(started.problem);
    const orderId = started.url.match(/\/order\/([0-9a-f-]+)/)![1];
    const subscription = (await getSubscriptionForOrder(store.id, orderId))!;
    expect(subscription).toMatchObject({ status: "active", free: true, totalMinor: 0, email: payer.email, nextChargeAt: null });
    const [row] = await db().execute<Row>(sql`select provider, provider_reference from commerce.subscriptions where id = ${subscription.id}::uuid`);
    expect(row).toEqual({ provider: "none", provider_reference: null });
  });

  it("can only be ended, and ends at once", async () => {
    const [row] = await db().execute<Row>(sql`
      select s.id from commerce.subscriptions s where s.store_id = ${store.id}::uuid and s.provider = 'none' and s.status = 'active' limit 1
    `);
    const id = String(row.id);
    expect(await changeSubscription(store.id, id, "pause")).toEqual({ ok: false, problem: "not_allowed" });
    const ended = await changeSubscription(store.id, id, "cancel");
    if (!ended.ok) throw new Error(ended.problem);
    expect(ended.subscription).toMatchObject({ status: "cancelled", endsAt: null });
    expect(ended.subscription.cancelledAt).not.toBeNull();
    expect(await changeSubscription(store.id, id, "cancel")).toEqual({ ok: false, problem: "not_allowed" });
  });
});
