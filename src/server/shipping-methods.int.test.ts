import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const cookieCart = vi.hoisted(() => ({ name: "", value: "" }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === cookieCart.name ? { name, value: cookieCart.value } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    refunds: { create: async () => ({ id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const sm = await import("./shipping-methods");
const { resolveDelivery, setDeliveryPostalCode, chooseDelivery, deliveryReady, flagDeliveryMismatch } = await import("./delivery-options");
const { cartSummary } = await import("./cart-summary");
const { getCart } = await import("./cart");
const { placeOrder } = await import("./checkout");
const { getShippingFacts } = await import("./seo");
const { fxStore, NO, NO_EUR } = await import("./fulfilment-test-fixture");
const { deliveryOrder, deliveryOf, cartOf } = await import("./shipping-test-fixture");

type Row = Record<string, unknown>;

/**
 * Shipping methods, zones and profiles against a real database (D237, `docs/wave-3-shipping-methods.md` 2.1, 4.1 to 4.3, 6.1): the owner's saves through
 * the same validation as the screens, every refusal with its reason, another store's rows refused; tiers by weight and by basket value (minimum counts,
 * maximum does not), a basket in no tier falling to the flat rate or refused (`no_shipping`), zones by postal patterns (a zone without a rate offers no
 * method), profiles summed, the store's default weight per unit, all charged the same by `cartSummary()` and `placeOrder()`, in kroner and in euro.
 */

let store: Awaited<ReturnType<typeof fxStore>>;
let other: Awaited<ReturnType<typeof fxStore>>;
let profile: string;
let mugProduct: string;

beforeAll(async () => {
  store = await fxStore("ship");
  other = await fxStore("ship-other");
  const [mug] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
  mugProduct = String(mug.product_id);
});
afterAll(async () => {
  await closeDb();
});
afterEach(async () => {
  // Each test sets up its own methods and zones; the market's flat rate (99 kr, free over 999 kr) is the template's.
  await db().execute(sql`delete from commerce.shipping_methods where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`delete from commerce.shipping_zones where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`update commerce.products set shipping_profile_id = null where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`delete from commerce.shipping_profiles where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`delete from commerce.shipping_settings where store_id = ${store.storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor) values (${store.storeId}::uuid, 'NO', 'NOK', 9900, 99900)
    on conflict (store_id, market_code) do update set amount_minor = 9900, free_over_minor = 99900
  `);
});

const method = (over: Record<string, unknown>) => ({ id: null, marketCode: "NO", name: "Standard", names: {}, estimate: { min: 1, max: 3 }, freeOverMinor: null, active: true, groups: [], ...over });
const tiers = (basis: "weight" | "value", rows: [number, number | null, number][]) => rows.map(([minValue, maxValue, amountMinor]) => ({ basis, minValue, maxValue, amountMinor }));

async function saved<T extends { ok: boolean }>(result: Promise<T>): Promise<T & { ok: true; id: string }> {
  const r = await result;
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as T & { ok: true; id: string };
}

/** What the cart page charges for shipping and what the order placed from the same cart charges, in a market's view. */
async function bothCharge(cartId: string, market = NO) {
  cookieCart.name = `cart_${store.storeId}_${NO.slug}`;
  cookieCart.value = cartId;
  const summary = await cartSummary({ storeId: store.storeId, market }, await getCart({ storeId: store.storeId, market }), { cartId, customerId: null });
  const placed = await placeOrder({ storeId: store.storeId, market }, cartId, {}, { customerId: null });
  if (!placed.ok) return { cart: summary.shipping, order: placed.problem, total: summary.total, orderTotal: null, orderId: null };
  return { cart: summary.shipping, order: placed.order.shippingMinor, total: summary.total, orderTotal: placed.order.totalMinor, orderId: placed.order.orderId };
}

describe("saving", () => {
  it("saves a method with rate groups, replaces them on the next save, and audits counts, never patterns", async () => {
    const zone = await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Nord-Norge", patterns: ["8*", "9*"] }));
    const m = await saved(
      sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, 1000, 4900], [1000, null, 9900]]) }, { zoneId: zone.id, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 14900 }] }] })),
    );
    const setup = await sm.getShippingSetup(store.storeId);
    expect(setup.methods.find((x) => x.id === m.id)?.rates).toHaveLength(3);
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ id: m.id, groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 5900 }] }] })));
    expect((await sm.getShippingSetup(store.storeId)).methods.find((x) => x.id === m.id)?.rates).toEqual([{ zoneId: null, profileId: null, basis: "flat", minValue: 0, maxValue: null, amountMinor: 5900 }]);
    const audits = await db().execute<Row>(sql`select action, details from commerce.audit_log where store_id = ${store.storeId}::uuid and action like 'shipping.%' order by created_at`);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["shipping.zone_saved", "shipping.method_saved"]));
    expect(JSON.stringify(audits.map((a) => a.details))).not.toContain("8*");
  });

  it("refuses gaps and overlaps, mixed measures, a zone taken by another zone, a country not sold to and another store's rows", async () => {
    expect(await sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, 1000, 4900], [1500, null, 9900]]) }] }))).toMatchObject({ ok: false, problem: "invalid" });
    expect(await sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, 1000, 4900], [500, null, 9900]]) }] }))).toMatchObject({ ok: false, problem: "invalid" });
    expect(await sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: [...tiers("weight", [[0, 1000, 4900]]), ...tiers("value", [[1000, null, 9900]])] }] }))).toMatchObject({
      ok: false,
      problem: "invalid",
    });
    expect(await sm.saveShippingMethod(store.accountId, store.storeId, method({ marketCode: "DE" }))).toMatchObject({ ok: false, problem: "not_market" });
    const zone = await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Oslo", patterns: ["0*", "1*"] }));
    expect(await sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Østlandet", patterns: ["1*", "2*"] })).toEqual({ ok: false, problem: "taken", message: "1* is already in the zone Oslo." });
    expect(await sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Bad", patterns: ["abc def"] })).toMatchObject({ ok: false, problem: "invalid" });
    // Another store's zone cannot price this store's method, nor be renamed by it.
    const theirs = await saved(sm.saveShippingZone(other.accountId, other.storeId, { id: null, marketCode: "NO", name: "Theirs", patterns: ["5*"] }));
    expect(await sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: theirs.id, profileId: null, tiers: tiers("weight", [[0, null, 100]]) }] }))).toMatchObject({ ok: false, problem: "not_found" });
    expect(await sm.saveShippingZone(store.accountId, store.storeId, { id: theirs.id, marketCode: "NO", name: "Mine now", patterns: ["5*"] })).toMatchObject({ ok: false, problem: "not_found" });
    expect(await sm.deleteShippingZone(store.accountId, store.storeId, theirs.id)).toBe(false);
    expect(await sm.deleteShippingZone(store.accountId, store.storeId, zone.id)).toBe(true);
    // More than ten methods in a market: the database's limit.
    for (let i = 0; i < 10; i++) await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ name: `M${i}` })));
    expect(await sm.saveShippingMethod(store.accountId, store.storeId, method({ name: "Eleventh" }))).toMatchObject({ ok: false, problem: "shipping_methods.limit" });
  });

  it("saves a profile with its products, moves them back to General when it is deleted, and refuses a name taken", async () => {
    const p = await saved(sm.saveShippingProfile(store.accountId, store.storeId, { id: null, name: "Bulky", productIds: [mugProduct] }));
    expect(await sm.saveShippingProfile(store.accountId, store.storeId, { id: null, name: "bulky", productIds: [] })).toMatchObject({ ok: false, problem: "taken" });
    const [row] = await db().execute<Row>(sql`select shipping_profile_id from commerce.products where id = ${mugProduct}::uuid`);
    expect(String(row.shipping_profile_id)).toBe(p.id);
    // Another store's product named in it is not moved.
    const [theirs] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${other.storeId}::uuid and sku = 'DEMO-TOTE'`);
    await saved(sm.saveShippingProfile(store.accountId, store.storeId, { id: p.id, name: "Bulky", productIds: [mugProduct, String(theirs.product_id)] }));
    expect((await db().execute<Row>(sql`select shipping_profile_id from commerce.products where id = ${String(theirs.product_id)}::uuid`))[0].shipping_profile_id).toBeNull();
    expect((await sm.getShippingSetup(store.storeId)).profiles).toEqual([{ id: p.id, name: "Bulky", position: 0, products: 1 }]);
    expect(await sm.deleteShippingProfile(store.accountId, store.storeId, p.id)).toEqual({ ok: true, moved: 1 });
    expect((await db().execute<Row>(sql`select shipping_profile_id from commerce.products where id = ${mugProduct}::uuid`))[0].shipping_profile_id).toBeNull();
  });

  it("keeps the default weight between 1 g and 35 kg", async () => {
    expect(await sm.saveDefaultWeight(store.accountId, store.storeId, { grams: 0 })).toMatchObject({ ok: false });
    expect(await sm.saveDefaultWeight(store.accountId, store.storeId, { grams: 35_001 })).toMatchObject({ ok: false });
    expect(await sm.saveDefaultWeight(store.accountId, store.storeId, { grams: 750 })).toEqual({ ok: true });
    expect((await sm.getShippingSetup(store.storeId)).defaultWeightGrams).toBe(750);
  });

  it("warns of a market with methods and no flat rate, and zones without a Rest of country rate", async () => {
    await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Nord", patterns: ["9*"] }));
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [] })));
    await db().execute(sql`delete from commerce.shipping_rates where store_id = ${store.storeId}::uuid and market_code = 'NO'`);
    const warnings = await sm.shippingWarningsFor(store.storeId, ["NO"]);
    expect(warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["no_flat_with_methods", "zones_without_rest"]));
  });
});

describe("pricing a basket (4.1, 4.2)", () => {
  it("charges the weight tier that matches (minimum counts, maximum does not), the same in the cart and the order, in kroner and in euro", async () => {
    // Mugs weigh 380 g: two are 760 g, three 1,140 g.
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, 1140, 4900], [1140, null, 7900]]) }] })));
    for (const market of [NO, NO_EUR]) {
      const show = (minor: number) => (market === NO ? minor : Math.round(minor / 11.5));
      const two = await bothCharge(await cartOf(store, [["DEMO-MUG-WHITE", 2]], market), market);
      expect(two).toMatchObject({ cart: show(4900), order: show(4900) });
      expect(two.total).toBe(two.orderTotal);
      const three = await bothCharge(await cartOf(store, [["DEMO-MUG-WHITE", 3]], market), market);
      expect(three).toMatchObject({ cart: show(7900), order: show(7900) });
      const kept = await deliveryOf(three.orderId!);
      expect(kept.delivery).toMatchObject({ kind: "method", label: "Standard", zone: null, estimate: { min: 1, max: 3 } });
    }
  });

  it("charges value tiers on the basket as shown, each bound converted on its own, and the method's free-above", async () => {
    await saved(
      sm.saveShippingMethod(store.accountId, store.storeId, method({ freeOverMinor: 100000, groups: [{ zoneId: null, profileId: null, tiers: tiers("value", [[0, 50000, 6900], [50000, null, 3900]]) }] })),
    );
    for (const market of [NO, NO_EUR]) {
      const show = (minor: number) => (market === NO ? minor : Math.round(minor / 11.5));
      // One mug, 249 kr: below 500 kr.
      expect(await bothCharge(await cartOf(store, [["DEMO-MUG-WHITE", 1]], market), market)).toMatchObject({ cart: show(6900), order: show(6900) });
      // Three, 747 kr: from 500 kr.
      expect(await bothCharge(await cartOf(store, [["DEMO-MUG-WHITE", 3]], market), market)).toMatchObject({ cart: show(3900), order: show(3900) });
      // Five, 1,245 kr: above the method's 1,000 kr.
      expect(await bothCharge(await cartOf(store, [["DEMO-MUG-WHITE", 5]], market), market)).toMatchObject({ cart: 0, order: 0 });
    }
  });

  it("falls to the flat rate when no tier matches, and refuses the basket when there is none", async () => {
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, 1000, 4900]]) }] })));
    // Four mugs, 1,520 g: above the last tier's maximum, so the flat 99 kr.
    const heavy = await bothCharge(await cartOf(store, [["DEMO-MUG-WHITE", 4]]));
    expect(heavy).toMatchObject({ cart: 9900, order: 9900 });
    expect((await deliveryOf(heavy.orderId!)).delivery).toMatchObject({ kind: "flat" });
    await db().execute(sql`delete from commerce.shipping_rates where store_id = ${store.storeId}::uuid and market_code = 'NO'`);
    const cart = await cartOf(store, [["DEMO-MUG-WHITE", 4]]);
    expect(await bothCharge(cart)).toMatchObject({ cart: null, order: "no_shipping" });
    expect(await deliveryReady({ storeId: store.storeId, market: NO }, cart)).toEqual({ ok: false, problem: "no_shipping" });
  });

  it("prices a zone by its own rates, Rest of country for the rest, and offers no method in a zone with no rate for the profile", async () => {
    const north = await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Nord-Norge", patterns: ["8*", "9*"] }));
    const m = await saved(
      sm.saveShippingMethod(
        store.accountId,
        store.storeId,
        method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, null, 4900]]) }, { zoneId: north.id, profileId: null, tiers: tiers("weight", [[0, null, 12900]]) }] }),
      ),
    );
    const at = async (code: string | null) => {
      const cart = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
      if (code) await setDeliveryPostalCode({ storeId: store.storeId, market: NO }, cart, code);
      return cart;
    };
    expect(await bothCharge(await at(null))).toMatchObject({ cart: 4900, order: 4900 });
    expect(await bothCharge(await at("0150"))).toMatchObject({ cart: 4900, order: 4900 });
    const tromso = await bothCharge(await at("9008"));
    expect(tromso).toMatchObject({ cart: 12900, order: 12900 });
    expect((await deliveryOf(tromso.orderId!)).delivery).toMatchObject({ kind: "method", methodId: m.id, zone: { id: north.id, name: "Nord-Norge" }, postalCode: "9008" });
    // The zone loses its rate: the method is not offered there (no fall back to Rest of country), so the flat rate.
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ id: m.id, groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, null, 4900]]) }] })));
    expect(await bothCharge(await at("9008"))).toMatchObject({ cart: 9900, order: 9900 });
  });

  it("sums the profiles' tiers for a mixed basket, the same in the cart and the order, in kroner and in euro", async () => {
    const bulky = await saved(sm.saveShippingProfile(store.accountId, store.storeId, { id: null, name: "Bulky", productIds: [mugProduct] }));
    profile = bulky.id;
    await saved(
      sm.saveShippingMethod(
        store.accountId,
        store.storeId,
        method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, null, 3900]]) }, { zoneId: null, profileId: profile, tiers: tiers("weight", [[0, null, 8900]]) }] }),
      ),
    );
    for (const market of [NO, NO_EUR]) {
      const mixed = await bothCharge(await cartOf(store, [["DEMO-MUG-WHITE", 1], ["DEMO-TOTE", 1]], market), market);
      // Each part converted on its own, then added.
      const expected = market === NO ? 3900 + 8900 : Math.round(3900 / 11.5) + Math.round(8900 / 11.5);
      expect(mixed).toMatchObject({ cart: expected, order: expected });
      expect(mixed.total).toBe(mixed.orderTotal);
    }
    // The bulky profile without a rate: the method is not offered to a basket holding it.
    await db().execute(sql`delete from commerce.shipping_method_rates where store_id = ${store.storeId}::uuid and profile_id = ${profile}::uuid`);
    expect(await bothCharge(await cartOf(store, [["DEMO-MUG-WHITE", 1], ["DEMO-TOTE", 1]]))).toMatchObject({ cart: 9900, order: 9900 });
  });

  it("weighs goods without a weight at the store's default weight per unit", async () => {
    await db().execute(sql`update commerce.product_variants set weight_grams = null where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE'`);
    try {
      await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, 1000, 4900], [1000, null, 7900]]) }] })));
      // Two totes at 500 g each by default: 1,000 g, the second tier.
      expect(await bothCharge(await cartOf(store, [["DEMO-TOTE", 2]]))).toMatchObject({ cart: 7900, order: 7900 });
      await sm.saveDefaultWeight(store.accountId, store.storeId, { grams: 400 });
      expect(await bothCharge(await cartOf(store, [["DEMO-TOTE", 2]]))).toMatchObject({ cart: 4900, order: 4900 });
    } finally {
      await db().execute(sql`update commerce.product_variants set weight_grams = 180 where store_id = ${store.storeId}::uuid and sku = 'DEMO-TOTE'`);
    }
  });

  it("offers the cheapest method by default, keeps a dearer one chosen, and keeps the cheapest as the standard delivery for refunds (4.3)", async () => {
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ name: "Standard", groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 4900 }] }] })));
    const express = await saved(
      sm.saveShippingMethod(store.accountId, store.storeId, method({ name: "Express", estimate: { min: 1, max: 1 }, groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 14900 }] }] })),
    );
    const cart = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    const resolved = await resolveDelivery(db(), store.storeId, cart, NO);
    expect(resolved?.offer.ship.map((d) => d.priceMinor)).toEqual([4900, 14900]);
    expect(resolved?.delivery).toMatchObject({ kind: "method", label: "Standard" });
    for (const market of [NO, NO_EUR]) {
      const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { market, choose: `method:${express.id}`, paid: false });
      const kept = await deliveryOf(order.orderId);
      const show = (minor: number) => (market === NO ? minor : Math.round(minor / 11.5));
      expect(Number(kept.shipping_minor)).toBe(show(14900));
      expect(Number(kept.standard_shipping_minor)).toBe(show(4900));
    }
    // An inactive method is never offered, and its choice is void.
    const chosen = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    expect(await chooseDelivery({ storeId: store.storeId, market: NO }, chosen, `method:${express.id}`)).toEqual({ ok: true });
    await db().execute(sql`update commerce.shipping_methods set active = false where id = ${express.id}::uuid`);
    expect(await resolveDelivery(db(), store.storeId, chosen, NO)).toMatchObject({ changed: true, delivery: { label: "Standard" } });
  });

  it("gives a subscription the flat rate only (D25)", async () => {
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 100 }] }] })));
    const [plan] = await db().execute<Row>(sql`insert into commerce.selling_plans (store_id, product_id, interval) values (${store.storeId}::uuid, ${mugProduct}::uuid, 'month') returning id`);
    const cart = await cartOf(store, [["DEMO-MUG-WHITE", 1]]);
    await db().execute(sql`update commerce.cart_lines set selling_plan_id = ${String(plan.id)}::uuid where cart_id = ${cart}::uuid`);
    const resolved = await resolveDelivery(db(), store.storeId, cart, NO);
    expect(resolved).toMatchObject({ delivery: { kind: "flat" }, rate: { amountMinor: 9900 } });
    expect(resolved?.offer.ship.map((d) => d.kind)).toEqual(["flat"]);
    await db().execute(sql`delete from commerce.cart_lines where cart_id = ${cart}::uuid`);
    await db().execute(sql`delete from commerce.selling_plans where id = ${String(plan.id)}::uuid`);
  });
});

describe("structured data (2.6) and the mismatch (2.7)", () => {
  it("names one price only when it is unambiguous", async () => {
    expect(await getShippingFacts(store.storeId, NO)).toEqual({ amountMinor: 9900, freeOverMinor: 99900, currency: "NOK" });
    const m = await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ freeOverMinor: 50000, groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 5900 }] }] })));
    expect(await getShippingFacts(store.storeId, NO)).toEqual({ amountMinor: 5900, freeOverMinor: 50000, currency: "NOK" });
    expect(await getShippingFacts(store.storeId, NO_EUR)).toEqual({ amountMinor: Math.round(5900 / 11.5), freeOverMinor: Math.round(50000 / 11.5), currency: "EUR" });
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ id: m.id, groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, 1000, 4900], [1000, null, 7900]]) }] })));
    expect(await getShippingFacts(store.storeId, NO)).toBeNull();
  });

  it("names no price when a zone or a profile sends some baskets to the flat rate (review)", async () => {
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 5900 }] }] })));
    expect(await getShippingFacts(store.storeId, NO)).toMatchObject({ amountMinor: 5900 });
    // A zone with no rows of the method: an address there pays the flat rate (99 kr), so 59 kr is not the price.
    const zone = await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Nord", patterns: ["9*"] }));
    expect(await getShippingFacts(store.storeId, NO)).toBeNull();
    expect(await sm.deleteShippingZone(store.accountId, store.storeId, zone.id)).toBe(true);
    expect(await getShippingFacts(store.storeId, NO)).toMatchObject({ amountMinor: 5900 });
    // A profile: its products are not priced by the General rate.
    await db().execute(sql`insert into commerce.shipping_profiles (store_id, name) values (${store.storeId}::uuid, 'Bulky')`);
    expect(await getShippingFacts(store.storeId, NO)).toBeNull();
  });

  it("flags a method's order whose address is in another zone, once, and never changes the charge", async () => {
    const north = await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Nord", patterns: ["9*"] }));
    await saved(
      sm.saveShippingMethod(
        store.accountId,
        store.storeId,
        method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, null, 4900]]) }, { zoneId: north.id, profileId: null, tiers: tiers("weight", [[0, null, 12900]]) }] }),
      ),
    );
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150" });
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ postalCode: "9008", city: "Tromsø" })}::jsonb where id = ${order.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, order.orderId)).toEqual({ priced: "0150", address: "9008" });
    expect(Number((await deliveryOf(order.orderId)).shipping_minor)).toBe(4900);
    // Another code in the same zone (Rest of country) is no difference that matters.
    const same = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150" });
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ postalCode: "5003", city: "Bergen" })}::jsonb where id = ${same.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, same.orderId)).toBeNull();
  });

  it("flags an order paid without a postal code (the gate skipped, or the hosted page) whose address is in a dearer zone (review)", async () => {
    const north = await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Nord", patterns: ["9*"] }));
    await saved(
      sm.saveShippingMethod(
        store.accountId,
        store.storeId,
        method({ groups: [{ zoneId: null, profileId: null, tiers: tiers("weight", [[0, null, 9900]]) }, { zoneId: north.id, profileId: null, tiers: tiers("weight", [[0, null, 29900]]) }] }),
      ),
    );
    // No postal code: priced at Rest of country, 99 kr.
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]]);
    expect(Number((await deliveryOf(order.orderId)).shipping_minor)).toBe(9900);
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ postalCode: "9008", city: "Tromsø" })}::jsonb where id = ${order.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, order.orderId)).toEqual({ priced: null, address: "9008" });
    const kept = await deliveryOf(order.orderId);
    expect(kept.delivery_mismatch_at).not.toBeNull();
    expect(Number(kept.shipping_minor)).toBe(9900);
    // An address in Rest of country is what it was priced for.
    const rest = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]]);
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ postalCode: "5003", city: "Bergen" })}::jsonb where id = ${rest.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, rest.orderId)).toBeNull();
  });

  it("flags a flat-rate order whose address is in a zone a method prices, and not one in a zone no method prices", async () => {
    const north = await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Nord", patterns: ["9*"] }));
    await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Vest", patterns: ["5*"] }));
    // The method prices Nord only: Rest of country (no code) falls to the flat rate.
    await saved(sm.saveShippingMethod(store.accountId, store.storeId, method({ groups: [{ zoneId: north.id, profileId: null, tiers: tiers("weight", [[0, null, 29900]]) }] })));
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]]);
    expect((await deliveryOf(order.orderId)).delivery).toMatchObject({ kind: "flat" });
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ postalCode: "9008", city: "Tromsø" })}::jsonb where id = ${order.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, order.orderId)).toEqual({ priced: null, address: "9008" });
    const west = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]]);
    await db().execute(sql`update commerce.orders set shipping_address = ${JSON.stringify({ postalCode: "5003", city: "Bergen" })}::jsonb where id = ${west.orderId}::uuid`);
    expect(await flagDeliveryMismatch(store.storeId, west.orderId)).toBeNull();
  });
});
