import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const cookieCart = vi.hoisted(() => ({ name: "", value: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === cookieCart.name ? { name, value: cookieCart.value } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const rewards = await import("./bonus-rewards");
const { passMembership } = await import("./auth");
const { cartSummary } = await import("./cart-summary");
const { getCart } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { findUsableDiscount, listDiscounts, saveDiscount } = await import("./discounts");
const { fxStore, NO, NO_EUR } = await import("./fulfilment-test-fixture");
const { cartOf } = await import("./shipping-test-fixture");

type Row = Record<string, unknown>;
type Market = typeof NO;

/**
 * Loyalty rewards and the birthday credit (wave 13 unit A, D401) on a real database: the owner makes rewards whose codes are the store's own (hidden
 * from the codes list); a customer spends credits on one and gets a code only they can use, once; the code takes off what the reward says, the
 * same in the cart and the order, in kroner and in euro; a customer short of credits is refused and keeps them; the birthday credit comes once a
 * year on the store's own day, never for a birthday given less than 30 days ago.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let member: NonNullable<Awaited<ReturnType<typeof passMembership>>>;
let mugProduct: string;
let mugPrice: number;

const customer = async (label: string) => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name, email_verified_at) values (${store.storeId}::uuid, ${`${label}-${store.slug}@example.com`}, ${label}, now())
    returning id
  `);
  return String(row.id);
};
const grant = (customerId: string, amount: number) =>
  db().execute(sql`select commerce.bonus_adjust(${store.storeId}::uuid, ${customerId}::uuid, ${amount}, 'test', null, ${`t-${customerId}-${Math.random()}`})`);
const available = async (customerId: string) => {
  const [row] = await db().execute<Row>(sql`select available_minor from commerce.bonus_balance(${store.storeId}::uuid, ${customerId}::uuid)`);
  return Number(row.available_minor);
};
const shopOf = (market: Market) => ({ storeId: store.storeId, market });
async function summaryOf(cartId: string, market: Market, customerId: string) {
  cookieCart.name = `cart_${store.storeId}_${market.code.toLowerCase()}`;
  cookieCart.value = cartId;
  return cartSummary(shopOf(market), await getCart(shopOf(market)), { cartId, customerId });
}

beforeAll(async () => {
  store = await fxStore("rewards");
  await db().execute(sql`update commerce.stores set features = features || array['bonus'] where id = ${store.storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.bonus_settings (store_id, enabled, currency, birthday_minor) values (${store.storeId}::uuid, true, 'NOK', 5000)
    on conflict (store_id) do update set enabled = true, birthday_minor = 5000
  `);
  member = (await passMembership(store.slug, store.accountId))!;
  const [mug] = await db().execute<Row>(sql`
    select v.product_id, p.amount_minor from commerce.product_variants v
    join commerce.current_prices p on p.variant_id = v.id and p.market_code = 'NO'
    where v.store_id = ${store.storeId}::uuid and v.sku = 'DEMO-MUG-WHITE'
  `);
  mugProduct = String(mug.product_id);
  mugPrice = Number(mug.amount_minor);
});

afterAll(async () => {
  await closeDb();
});

describe("rewards (D401)", () => {
  let freeMug: string;

  it("makes rewards whose codes are hidden from the codes list and changed only with them", async () => {
    expect(await rewards.saveReward(member, null, { name: "Free mug", costMinor: 20_000, kind: "product" })).toMatchObject({ ok: false });
    expect(await rewards.saveReward(member, null, { name: "Ten off", costMinor: 5_000, kind: "amount", amounts: { ZZ: 100 } })).toMatchObject({ ok: false });
    const made = await rewards.saveReward(member, null, { name: "Free mug", names: { "nb-NO": "Gratis kopp" }, costMinor: 20_000, kind: "product", productId: mugProduct });
    if (!made.ok) throw new Error(made.problems.join("; "));
    freeMug = made.id;
    const ship = await rewards.saveReward(member, null, { name: "Free shipping", costMinor: 5_000, kind: "free_shipping" });
    expect(ship.ok).toBe(true);
    expect((await rewards.listRewards(store.storeId)).map((r) => r.name)).toEqual(["Free mug", "Free shipping"]);
    expect((await listDiscounts(store.storeId)).some((d) => d.reward)).toBe(false);
    const [own] = await db().execute<Row>(sql`select discount_id from commerce.bonus_rewards where id = ${freeMug}::uuid`);
    expect(await saveDiscount(member, String(own.discount_id), { code: "HACK", kind: "percent", percent: 100 })).toMatchObject({ ok: false });
  });

  it("spends the cost and hands the customer a code only they can use, once, taking one unit off in the cart and the order alike, in kroner and euro", async () => {
    const buyer = await customer("buyer");
    const other = await customer("other");
    await grant(buyer, 50_000);
    const listed = await rewards.shopperRewards(shopOf(NO), buyer);
    expect(listed.find((r) => r.id === freeMug)).toMatchObject({ name: "Gratis kopp", costMinor: 20_000, affordable: true });

    for (const market of [NO, NO_EUR]) {
      const before = await available(buyer);
      const redeemed = await rewards.redeemReward(shopOf(market), buyer, freeMug);
      if (!redeemed.ok) throw new Error(redeemed.reason);
      expect(await available(buyer)).toBe(before - 20_000);
      const [entry] = await db().execute<Row>(sql`
        select kind, amount_minor from commerce.bonus_entries where store_id = ${store.storeId}::uuid and customer_id = ${buyer}::uuid order by created_at desc, id desc limit 1
      `);
      expect(entry).toMatchObject({ kind: "reward" });
      expect(Number(entry.amount_minor)).toBe(-20_000);

      // Only the customer it was redeemed by, signed in.
      expect(await findUsableDiscount(db(), store.storeId, redeemed.code, { market, customerId: null })).toEqual({ ok: false, problem: "sign_in" });
      expect(await findUsableDiscount(db(), store.storeId, redeemed.code, { market, customerId: other })).toEqual({ ok: false, problem: "not_eligible" });

      // Two mugs: one comes off, the dearest unit, in the cart and the order alike.
      const cartId = await cartOf(store, [["DEMO-MUG-WHITE", 2]], market);
      await db().execute(sql`update commerce.carts set discount_code = ${redeemed.code}, customer_id = ${buyer}::uuid where id = ${cartId}::uuid`);
      const summary = await summaryOf(cartId, market, buyer);
      const unit = market === NO ? mugPrice : summary.subtotal / 2;
      expect(summary.discountMinor).toBe(unit);
      const placed = await placeOrder(shopOf(market), cartId, {}, { customerId: buyer });
      if (!placed.ok) throw new Error(placed.problem);
      const [order] = await db().execute<Row>(sql`select discount_minor, total_minor from commerce.orders where id = ${placed.order.orderId}::uuid`);
      expect(Number(order.discount_minor)).toBe(summary.discountMinor);
      expect(Number(order.total_minor)).toBe(summary.total);
      // Once.
      expect(await findUsableDiscount(db(), store.storeId, redeemed.code, { market, customerId: buyer })).toEqual({ ok: false, problem: "used_up" });
    }
    expect((await rewards.redeemedCodes(shopOf(NO), buyer)).map((c) => c.used)).toEqual([true, true]);
  });

  it("refuses a customer short of credits and keeps what they have, and a reward switched off", async () => {
    const poor = await customer("poor");
    await grant(poor, 1_000);
    expect(await rewards.redeemReward(shopOf(NO), poor, freeMug)).toEqual({ ok: false, reason: "short" });
    expect(await available(poor)).toBe(1_000);
    expect(await rewards.switchReward(member, freeMug, false)).toBe(true);
    await grant(poor, 50_000);
    expect(await rewards.redeemReward(shopOf(NO), poor, freeMug)).toEqual({ ok: false, reason: "gone" });
    expect((await rewards.shopperRewards(shopOf(NO), poor)).map((r) => r.id)).not.toContain(freeMug);
    expect(await rewards.switchReward(member, freeMug, true)).toBe(true);
  });
});

describe("the birthday credit (D401)", () => {
  const todayInOslo = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Oslo", month: "2-digit", day: "2-digit" }).format(new Date());

  it("is given once a year on the store's day, never for a birthday given less than 30 days ago", async () => {
    await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo' where id = ${store.storeId}::uuid`);
    const born = await customer("born");
    const late = await customer("late");
    expect(await rewards.saveBirthday(store.storeId, born, "02-30")).toBe(false);
    expect(await rewards.saveBirthday(store.storeId, born, todayInOslo())).toBe(true);
    expect(await rewards.saveBirthday(store.storeId, late, todayInOslo())).toBe(true);
    await db().execute(sql`update commerce.customers set birthday_set_at = now() - interval '31 days' where id = ${born}::uuid`);
    const given = async (id: string) =>
      (await db().execute<Row>(sql`select amount_minor from commerce.bonus_entries where customer_id = ${id}::uuid and kind = 'birthday'`)).map((r) => Number(r.amount_minor));
    await db().execute(sql`select commerce.bonus_birthday_grants()`);
    await db().execute(sql`select commerce.bonus_birthday_grants()`);
    expect(await given(born)).toEqual([5000]);
    expect(await given(late)).toEqual([]);
  });
});
