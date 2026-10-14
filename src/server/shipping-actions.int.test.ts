import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { FormState } from "@/components/admin/action-form";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
// A redirect after a first save is thrown by Next; here it is caught and read.
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { to });
  },
}));
const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    refunds: { create: async () => ({ id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

// The permission layer is the one thing replaced: what an action does with a member is read from the real database.
const access = vi.hoisted(() => ({ member: null as unknown, allow: true, asked: [] as string[] }));
vi.mock("./permissions", async (original) => ({
  ...(await original<typeof import("./permissions")>()),
  checkPermission: async (_slug: string, key: string) => {
    access.asked.push(key);
    return access.allow ? access.member : null;
  },
}));

const actions = await import("@/app/admin/(gated)/[store]/settings/shipping/actions");
const handover = await import("@/app/admin/(gated)/[store]/orders/handover-actions");
const { getShippingSetup } = await import("./shipping-methods");
const { listPickupPlaces } = await import("./pickup");
const { listLocalAreas } = await import("./local-delivery");
const { fxStore, NO } = await import("./fulfilment-test-fixture");
const { placeOf, deliveryOrder, deliveryOf } = await import("./shipping-test-fixture");

type Row = Record<string, unknown>;
type Store = Awaited<ReturnType<typeof fxStore>>;

/**
 * The server actions behind the shipping settings and the order page's handover buttons (D237, `docs/wave-3-shipping-methods.md` 2.1 to 2.3): the layer
 * between a form and the tested server functions. No test clicks the signed-in admin (D158), so this holds what the screens send: the permission each
 * asks, what is done with the text typed (postal codes, amounts in the market's currency, kilometres), and the words a refusal comes back in.
 */

let store: Store;

const form = (fields: Record<string, string | string[]>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) for (const v of Array.isArray(value) ? value : [value]) data.append(key, v);
  return data;
};
const idle: FormState = { status: "idle", messages: [] };
const redirected = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (error) {
    if ((error as { to?: string }).to) return (error as { to: string }).to;
    throw error;
  }
};

beforeAll(async () => {
  store = await fxStore("ship-actions");
  access.member = { account: { id: store.accountId, email: "owner@example.com" }, store: { id: store.storeId, slug: store.slug, markets: [NO] } };
});
beforeEach(() => {
  access.allow = true;
  access.asked = [];
});
afterAll(async () => {
  await closeDb();
});

describe("without the right to change the settings", () => {
  it("every settings action answers that there is no access and writes nothing", async () => {
    access.allow = false;
    expect(await actions.saveZoneAction(store.slug, null, "NO", idle, form({ name: "Nord", patterns: "9*" }))).toMatchObject({ status: "error", messages: ["You do not have access to this."] });
    expect(await actions.saveDefaultWeightAction(store.slug, idle, form({ grams: "700" }))).toMatchObject({ status: "error" });
    expect(await actions.saveMethodAction(store.slug, {})).toMatchObject({ ok: false });
    expect(await actions.checkZoneCodeAction(store.slug, "NO", idle, form({ code: "0150" }))).toMatchObject({ status: "error" });
    expect(access.asked.every((key) => key === "settings:write")).toBe(true);
    expect((await getShippingSetup(store.storeId)).zones).toEqual([]);
    access.allow = true;
    access.asked = [];
    expect(await handover.readyForPickupAction(store.slug, crypto.randomUUID(), idle, form({}))).toMatchObject({ status: "error" });
    expect(access.asked).toEqual(["orders:write"]);
  });
});

describe("zones, methods, profiles and the default weight", () => {
  it("cleans typed postal codes by the country's rule, names entries that are not codes, and refuses a code another zone holds", async () => {
    expect(await actions.saveZoneAction(store.slug, null, "NO", idle, form({ name: "Nord", patterns: "9*, 8* \n 7010; banana" }))).toMatchObject({
      status: "error",
      messages: [expect.stringContaining("banana")],
    });
    expect(await actions.saveZoneAction(store.slug, null, "NO", idle, form({ name: "Nord", patterns: "9*, 8* \n 7010" }))).toMatchObject({ status: "ok" });
    const zone = (await getShippingSetup(store.storeId)).zones.find((z) => z.name === "Nord")!;
    expect(zone.patterns).toEqual(["9*", "8*", "7010"]);
    expect(await actions.saveZoneAction(store.slug, null, "NO", idle, form({ name: "Trondheim", patterns: "7010" }))).toEqual({ status: "error", messages: ["7010 is already in the zone Nord."] });
    expect(await actions.checkZoneCodeAction(store.slug, "NO", idle, form({ code: "9010" }))).toMatchObject({ status: "ok", messages: [expect.stringContaining("9010 is in the zone Nord.")] });
    expect(await actions.checkZoneCodeAction(store.slug, "NO", idle, form({ code: "0150" }))).toMatchObject({ messages: [expect.stringContaining("0150 is in Rest of country.")] });
    expect(await actions.checkZoneCodeAction(store.slug, "NO", idle, form({ code: "xx" }))).toMatchObject({ status: "error" });
    expect(await actions.deleteZoneAction(store.slug, zone.id)).toMatchObject({ status: "ok" });
    expect((await getShippingSetup(store.storeId)).zones.map((z) => z.id)).not.toContain(zone.id);
  });

  it("saves a method sent by the grid, opens a new one on its page, and refuses a ladder with a gap in words", async () => {
    const to = await redirected(async () => {
      const saved = await actions.saveMethodAction(store.slug, {
        id: null,
        marketCode: "NO",
        name: "Ekspress",
        names: {},
        estimate: { min: 1, max: 2 },
        freeOverMinor: null,
        active: true,
        groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "weight", minValue: 0, maxValue: 2000, amountMinor: 14900 }, { basis: "weight", minValue: 2000, maxValue: null, amountMinor: 24900 }] }],
      });
      expect(saved).toMatchObject({ ok: true, message: "Method saved." });
    });
    expect(to).toBeNull();
    const method = (await getShippingSetup(store.storeId)).methods.find((m) => m.name === "Ekspress")!;
    expect(method.rates.map((r) => [r.minValue, r.maxValue, r.amountMinor])).toEqual([
      [0, 2000, 14900],
      [2000, null, 24900],
    ]);
    expect(
      await actions.saveMethodAction(store.slug, {
        id: method.id,
        marketCode: "NO",
        name: "Ekspress",
        names: {},
        estimate: null,
        freeOverMinor: null,
        active: true,
        groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "weight", minValue: 0, maxValue: 2000, amountMinor: 14900 }, { basis: "weight", minValue: 3000, maxValue: null, amountMinor: 24900 }] }],
      }),
    ).toEqual({ ok: false, message: "Rates: no gap between tiers: each starts where the one before ends, the first at 0." });
    expect(await redirected(() => actions.deleteMethodAction(store.slug, method.id, "NO"))).toBe(`/admin/${store.slug}/settings/shipping/methods?market=NO`);
  });

  it("puts ticked products in a profile and moves them back to General when the profile goes", async () => {
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${store.storeId}::uuid order by handle limit 1`);
    expect(await redirected(() => actions.saveProfileAction(store.slug, null, idle, form({ name: "Bulky", product: [String(product.id), "not-a-uuid"] })))).toBe(
      `/admin/${store.slug}/settings/shipping/profiles`,
    );
    const profile = (await getShippingSetup(store.storeId)).profiles.find((p) => p.name === "Bulky")!;
    expect(profile.products).toBe(1);
    expect(await actions.saveProfileAction(store.slug, profile.id, idle, form({ name: "Bulky goods", product: [] }))).toMatchObject({ status: "ok", messages: ["Profile saved with 0 products."] });
    expect(await actions.saveProfileAction(store.slug, profile.id, idle, form({ name: "Bulky goods", product: String(product.id) }))).toMatchObject({ status: "ok" });
    expect(await actions.deleteProfileAction(store.slug, profile.id)).toEqual({ status: "ok", messages: ["Profile deleted. 1 product moved to General."] });
    const [after] = await db().execute<Row>(sql`select shipping_profile_id from commerce.products where id = ${String(product.id)}::uuid`);
    expect(after.shipping_profile_id).toBeNull();
  });

  it("saves the default weight in whole grams and refuses anything else", async () => {
    expect(await actions.saveDefaultWeightAction(store.slug, idle, form({ grams: "750" }))).toMatchObject({ status: "ok" });
    expect((await getShippingSetup(store.storeId)).defaultWeightGrams).toBe(750);
    expect(await actions.saveDefaultWeightAction(store.slug, idle, form({ grams: "0,5" }))).toMatchObject({ status: "error" });
    expect(await actions.saveDefaultWeightAction(store.slug, idle, form({ grams: "40000" }))).toMatchObject({ status: "error", messages: ["Default weight: at most 35000 g."] });
  });
});

describe("pickup and local delivery settings", () => {
  it("saves a place's pickup with a price typed in the market's currency, empty as free, and keeps the instructions' translations", async () => {
    const place = await placeOf(store, { name: "Butikken" });
    await db().execute(sql`
      insert into commerce.pickup_options (store_id, location_id, market_code, currency, instructions, instructions_t, active)
      values (${store.storeId}::uuid, ${place}::uuid, 'NO', 'NOK', 'Ring', '{"en": "Ring the bell"}'::jsonb, false)
    `);
    expect(await actions.savePickupAction(store.slug, place, "NOK", idle, form({ active: "on", amount: "49,50", readyInHours: "4", instructions: "Ring på" }))).toMatchObject({ status: "ok" });
    const option = (await listPickupPlaces(store.storeId)).find((p) => p.locationId === place)!.option!;
    expect(option).toMatchObject({ active: true, amountMinor: 4950, readyInHours: 4, instructions: "Ring på", instructionsT: { en: "Ring the bell" } });
    expect(await actions.savePickupAction(store.slug, place, "NOK", idle, form({ amount: "", readyInHours: "0", instructions: "" }))).toMatchObject({ status: "ok" });
    expect((await listPickupPlaces(store.storeId)).find((p) => p.locationId === place)!.option).toMatchObject({ active: false, amountMinor: 0 });
    expect(await actions.savePickupAction(store.slug, place, "NOK", idle, form({ amount: "fifty" }))).toMatchObject({ status: "error", messages: ["Price: an amount in NOK, or leave it empty for free."] });
  });

  it("saves areas by postal codes and by radius (kilometres with a comma), checks a code, and deletes", async () => {
    const shop = await placeOf(store, { name: "Radiusbutikken", postalCode: "0150" });
    expect(
      await redirected(() =>
        actions.saveAreaAction(store.slug, null, idle, form({ market: "NO", name: "Sentrum", kind: "postal", patterns: "01*, 0250", amount: "79", minBasket: "300", freeOver: "1000", info: "Tirsdager", active: "on" })),
      ),
    ).toBe(`/admin/${store.slug}/settings/shipping/local`);
    expect(await redirected(() => actions.saveAreaAction(store.slug, null, idle, form({ market: "NO", name: "Rundt butikken", kind: "radius", location: shop, radiusKm: "7,5", amount: "", active: "on" })))).toBe(
      `/admin/${store.slug}/settings/shipping/local`,
    );
    const areas = await listLocalAreas(store.storeId);
    expect(areas.find((a) => a.name === "Sentrum")).toMatchObject({ kind: "postal", patterns: ["01*", "0250"], amountMinor: 7900, minBasketMinor: 30000, freeOverMinor: 100000, info: "Tirsdager", active: true });
    const radius = areas.find((a) => a.name === "Rundt butikken")!;
    expect(radius).toMatchObject({ kind: "radius", radiusKm: 7.5, amountMinor: 0, locationId: shop });
    // The place's position was taken from its postal code when the radius area was saved.
    expect(radius.origin).not.toBeNull();
    expect(await actions.checkLocalCodeAction(store.slug, idle, form({ market: "NO", code: "0155" }))).toMatchObject({ status: "ok", messages: [expect.stringMatching(/0155 is covered by: .*Sentrum/)] });
    expect(await actions.saveAreaAction(store.slug, radius.id, idle, form({ market: "NO", name: "Rundt butikken", kind: "radius", location: shop, radiusKm: "far" }))).toMatchObject({
      status: "error",
      messages: ["Radius: kilometres, like 15 or 7.5."],
    });
    expect(await actions.saveAreaAction(store.slug, null, idle, form({ market: "SE", name: "Stockholm", kind: "postal", patterns: "111*" }))).toMatchObject({ status: "error", messages: ["Choose a country you sell to."] });
    expect(await actions.deleteAreaAction(store.slug, radius.id)).toMatchObject({ status: "ok" });
    expect((await listLocalAreas(store.storeId)).map((a) => a.id)).not.toContain(radius.id);
  });
});

describe("the order page's handover buttons", () => {
  it("marks a pickup order ready (with the order's basis), refuses a second press, and records it collected on a day", async () => {
    const place = await placeOf(store, { name: "Hentested" });
    await db().execute(sql`
      insert into commerce.pickup_options (store_id, location_id, market_code, currency, active) values (${store.storeId}::uuid, ${place}::uuid, 'NO', 'NOK', true)
      on conflict (store_id, location_id) do update set active = true
    `);
    const [option] = await db().execute<Row>(sql`select id from commerce.pickup_options where store_id = ${store.storeId}::uuid and location_id = ${place}::uuid`);
    const order = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { choose: `pickup:${String(option.id)}` });
    const ready = await handover.readyForPickupAction(store.slug, order.orderId, idle, form({}));
    expect(ready).toMatchObject({ status: "ok", messages: [expect.stringContaining("Marked ready for pickup")] });
    expect(await handover.readyForPickupAction(store.slug, order.orderId, idle, form({}))).toEqual({ status: "error", messages: ["The order was marked ready already."] });
    expect(await handover.collectedAction(store.slug, order.orderId, idle, form({ on: "2999-01-01" }))).toEqual({ status: "error", messages: ["The order cannot have been collected in the future."] });
    expect(await handover.collectedAction(store.slug, order.orderId, idle, form({ on: "" }))).toMatchObject({ status: "ok" });
    const kept = await deliveryOf(order.orderId);
    expect(kept.status).toBe("fulfilled");
    expect(kept.delivered_at).not.toBeNull();
    // A pickup order is never taken out for local delivery.
    expect(await handover.outForDeliveryAction(store.slug, order.orderId, idle, form({}))).toMatchObject({ status: "error", messages: ["This order is not for local delivery."] });
  });
});
