import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { attentionFor } from "@/lib/control-center";
import { formatMoney } from "@/lib/money";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
const fake = vi.hoisted(() => ({
  client: {
    checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_for_${id}`, invoice: null }) } },
    refunds: { create: async () => ({ id: `re_${Math.random().toString(36).slice(2)}`, status: "succeeded" }) },
  },
}));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const ownerTools = await import("./owner-tools");
const sm = await import("./shipping-methods");
const { savePickupOption, markReadyForPickup } = await import("./pickup");
const { saveLocalArea, markOutForDelivery } = await import("./local-delivery");
const { archiveOrder } = await import("./order-archive");
const { staffActor } = await import("./order-actor");
const { getStore } = await import("./stores");
const { controlCenter } = await import("./control-center");
const { fxStore } = await import("./fulfilment-test-fixture");
const { placeOf, deliveryOrder } = await import("./shipping-test-fixture");

type Row = Record<string, unknown>;
type Answer = Record<string, unknown>;
type Fx = Awaited<ReturnType<typeof fxStore>>;

/**
 * The AI manager's shipping tools and the control center's handover figures against a real database (D237, `docs/wave-3-shipping-methods.md` 2.6, 5.5):
 * `shipping_overview` repeats the Shipping pages per country, every amount in the country's own currency as `formatMoney()` writes it (kroner, and euro
 * for a country that keeps euros: never converted), and refuses a country the store does not sell to; `pickup_orders` counts the *To hand over* and *Local
 * deliveries* views by place and area with numbers only (never a customer's name, email or address), leaves out parcels, archived orders and other stores'
 * orders; both refuse a member whose role lacks their permission. The control center says the same counts apart from the orders to send. A store with
 * nothing set up gets "none set" and empty lists, never an invented price.
 */

let store: Fx;
let other: Fx;
let empty: Fx;
let pickupId: string;
let areaId: string;

const accountOf = async (fx: Fx): Promise<Account> => {
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where id = ${fx.accountId}::uuid`);
  return { id: String(row.id), email: String(row.email), name: "Owner", platformAdmin: false } as Account;
};
const run = async (fx: Fx, name: string, input: unknown = {}, holder?: { role: "owner" | "admin"; permissions?: string[] | null }) =>
  (await ownerTools.runOwnerTool({ account: await accountOf(fx), store: (await getStore(fx.slug))!, invalidate: () => {}, ...(holder ? { holder } : {}) } as never, name, input)) as Answer;
const nb = (minor: number, currency: string) => formatMoney(minor, currency, "nb-NO");

async function saved<T extends { ok: boolean }>(result: Promise<T>): Promise<T & { ok: true; id: string }> {
  const r = await result;
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as T & { ok: true; id: string };
}

beforeAll(async () => {
  store = await fxStore("shiptools");
  other = await fxStore("shiptools-other");
  empty = await fxStore("shiptools-empty");
  // Finland keeps euros: its amounts are written in euros, never converted from kroner.
  await db().execute(sql`insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values (${store.storeId}::uuid, 'FI', 'EUR', 'fi-FI', array['fi-FI'], true) on conflict do nothing`);
  await db().execute(sql`
    insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor) values (${store.storeId}::uuid, 'NO', 'NOK', 9900, 99900)
    on conflict (store_id, market_code) do update set amount_minor = 9900, free_over_minor = 99900
  `);
  const [mug] = await db().execute<Row>(sql`select product_id from commerce.product_variants where store_id = ${store.storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
  const zone = await saved(sm.saveShippingZone(store.accountId, store.storeId, { id: null, marketCode: "NO", name: "Nord-Norge", patterns: ["8*", "9*"] }));
  const profile = await saved(sm.saveShippingProfile(store.accountId, store.storeId, { id: null, name: "Bulky", productIds: [String(mug.product_id)] }));
  await saved(
    sm.saveShippingMethod(store.accountId, store.storeId, {
      id: null,
      marketCode: "NO",
      name: "Standard",
      names: {},
      estimate: { min: 1, max: 3 },
      freeOverMinor: null,
      active: true,
      groups: [
        { zoneId: null, profileId: null, tiers: [{ basis: "weight", minValue: 0, maxValue: 1000, amountMinor: 4900 }, { basis: "weight", minValue: 1000, maxValue: null, amountMinor: 9900 }] },
        { zoneId: zone.id, profileId: profile.id, tiers: [{ basis: "flat", minValue: 0, maxValue: null, amountMinor: 14900 }] },
      ],
    }),
  );
  await saved(
    sm.saveShippingMethod(store.accountId, store.storeId, {
      id: null,
      marketCode: "FI",
      name: "Posti",
      names: {},
      estimate: null,
      freeOverMinor: 10000,
      active: true,
      groups: [{ zoneId: null, profileId: null, tiers: [{ basis: "value", minValue: 0, maxValue: 5000, amountMinor: 690 }, { basis: "value", minValue: 5000, maxValue: null, amountMinor: 390 }] }],
    }),
  );
  const shop = await placeOf(store, { name: "Butikken Grünerløkka" });
  pickupId = (await saved(savePickupOption(store.accountId, store.storeId, { locationId: shop, active: true, amountMinor: 2900, readyInHours: 4, instructions: "Ring på.", instructionsT: {} }))).id;
  areaId = (
    await saved(
      saveLocalArea(store.accountId, store.storeId, {
        id: null,
        marketCode: "NO",
        locationId: null,
        name: "Oslo sentrum",
        names: {},
        kind: "postal",
        patterns: ["01*", "05*"],
        radiusKm: null,
        amountMinor: 7900,
        minBasketMinor: null,
        freeOverMinor: 80000,
        info: "",
        infoT: {},
        active: true,
      }),
    )
  ).id;
});
afterAll(async () => {
  await closeDb();
});

describe("shipping_overview", () => {
  it("repeats the Shipping pages per country, in each country's own currency", async () => {
    const answer = await run(store, "shipping_overview");
    const countries = answer.countries as Answer[];
    const no = countries.find((c) => c.country === "NO")!;
    expect(no.flat_rate).toEqual({ price: nb(9900, "NOK"), free_over: nb(99900, "NOK") });
    expect(no.methods).toEqual([
      {
        name: "Standard",
        active: true,
        delivery_days: "1 to 3",
        rates: [
          { zone: "Rest of country", profile: "General", by: "weight", prices: [`weight from 0 g to under 1 kg: ${nb(4900, "NOK")}`, `weight 1 kg and more: ${nb(9900, "NOK")}`] },
          { zone: "Nord-Norge", profile: "Bulky", by: "flat", prices: [`${nb(14900, "NOK")} for any basket`] },
        ],
      },
    ]);
    expect(no.zones).toEqual([{ name: "Nord-Norge", postal_patterns: 2, first_patterns: ["8*", "9*"] }]);
    expect(no.pickup_places).toEqual([{ place: "Butikken Grünerløkka", town: "Oslo", active: true, price: nb(2900, "NOK"), ready: "usually within 4 hours" }]);
    expect(no.local_delivery_areas).toEqual([{ name: "Oslo sentrum", active: true, covers: "2 postal codes and prefixes", first_patterns: ["01*", "05*"], price: nb(7900, "NOK"), free_over: nb(80000, "NOK") }]);
    expect(answer.profiles).toEqual([{ name: "General", note: expect.any(String) }, { name: "Bulky", products: 1 }]);
    expect(answer.default_weight_per_unit).toBe("500 g");
    // Euro: Finland's method is written in euros as stored, never converted from kroner; with no flat rate there, the page's warning says so.
    const fi = countries.find((c) => c.country === "FI")!;
    expect(fi.flat_rate).toBe("none set");
    expect((fi.methods as Answer[])[0]).toMatchObject({
      name: "Posti",
      free_over: nb(10000, "EUR"),
      rates: [{ zone: "Rest of country", profile: "General", by: "basket value", prices: [`basket value from ${nb(0, "EUR")} to under ${nb(5000, "EUR")}: ${nb(690, "EUR")}`, `basket value ${nb(5000, "EUR")} and more: ${nb(390, "EUR")}`] }],
    });
    expect(answer.warnings).toEqual(expect.arrayContaining([expect.stringContaining("there is no flat rate")]));
  });

  it("reads one country, refuses one the store does not sell to, and gives an empty store nothing invented", async () => {
    const one = await run(store, "shipping_overview", { market: "fi" });
    expect((one.countries as Answer[]).map((c) => c.country)).toEqual(["FI"]);
    await expect(run(store, "shipping_overview", { market: "DE" })).rejects.toThrow(/does not sell to DE/);
    const bare = await run(empty, "shipping_overview", { market: "NO" });
    const no = (bare.countries as Answer[])[0];
    expect(no).toMatchObject({ methods: [], zones: [], pickup_places: [], local_delivery_areas: [] });
    // Another store's methods, places and areas never appear.
    expect(JSON.stringify(await run(other, "shipping_overview"))).not.toMatch(/Nord-Norge|Grünerløkka|Oslo sentrum|Posti/);
  });

  it("needs settings:read", async () => {
    await expect(run(store, "shipping_overview", {}, { role: "admin", permissions: ["orders:read"] })).rejects.toThrow();
    await expect(run(store, "shipping_overview", {}, { role: "admin", permissions: ["settings:read"] })).resolves.toBeDefined();
  });
});

describe("pickup_orders and the control center", () => {
  it("counts the orders to collect and to deliver locally by place and area, numbers only, never parcels, archived or another store's", async () => {
    const ready = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { choose: `pickup:${pickupId}`, email: "kari.nordmann@example.com" });
    const waiting = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { choose: `pickup:${pickupId}` });
    // Taken out for local delivery (fulfilled) and archived: left out, as the Orders page's view leaves it out. A paid pickup order cannot be archived.
    const archived = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150", choose: `local:${areaId}` });
    const out = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0150", choose: `local:${areaId}` });
    const local = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], { postalCode: "0555", choose: `local:${areaId}` });
    const parcel = await deliveryOrder(store, [["DEMO-MUG-WHITE", 1]], {});
    await deliveryOrder(other, [["DEMO-MUG-WHITE", 1]], {});
    expect(await markReadyForPickup(store.storeId, { orderId: ready.orderId }, store.accountId)).toMatchObject({ ok: true });
    expect(await markOutForDelivery(store.storeId, { orderId: out.orderId }, store.accountId)).toMatchObject({ ok: true });
    expect(await markOutForDelivery(store.storeId, { orderId: archived.orderId }, store.accountId)).toMatchObject({ ok: true });
    expect(await archiveOrder(store.storeId, archived.orderId, staffActor(store.accountId))).toMatchObject({ ok: true });

    const answer = await run(store, "pickup_orders");
    expect(answer).toMatchObject({ to_be_collected: 2, local_deliveries_not_delivered: 2 });
    expect(answer.groups).toEqual([
      { kind: "pickup", place: "Butikken Grünerløkka", orders: 2, marked_ready: 1, not_marked_ready: 1, numbers: [ready.number, waiting.number], oldest_placed: expect.any(String) },
      { kind: "local", area: "Oslo sentrum", orders: 2, out_for_delivery: 1, not_taken_out: 1, numbers: [out.number, local.number], oldest_placed: expect.any(String) },
    ]);
    const text = JSON.stringify(answer);
    expect(text).not.toContain(parcel.number);
    expect(text).not.toContain(archived.number);
    expect(text).not.toMatch(/kari|nordmann|0150|0555|Thorvald/i);
    expect(await run(store, "pickup_orders", { kind: "local" })).toMatchObject({ to_be_collected: 0, local_deliveries_not_delivered: 2, pages: { local_deliveries: `/admin/${store.slug}/orders?show=local` } });
    expect(await run(other, "pickup_orders")).toMatchObject({ to_be_collected: 0, local_deliveries_not_delivered: 0, groups: [], note: expect.any(String) });
    await expect(run(store, "pickup_orders", {}, { role: "admin", permissions: ["settings:read"] })).rejects.toThrow();

    // The control center: the parcel is the only order waiting to be sent; the handovers are said apart.
    const center = (await controlCenter(await accountOf(store), store.slug)).stores[0];
    expect(center.toSend).toBe(1);
    expect(center.handOver).toMatchObject({ pickup: 2, local: 2 });
    const texts = attentionFor([center]).map((i) => [i.text, i.href]);
    expect(texts).toContainEqual([expect.stringContaining("2 orders are waiting to be collected"), `/admin/${store.slug}/orders?show=to-hand-over`]);
    expect(texts).toContainEqual([expect.stringContaining("2 local deliveries are not delivered yet"), `/admin/${store.slug}/orders?show=local`]);
    // Another store with no handovers gets no figure, never a 0.
    expect((await controlCenter(await accountOf(other), other.slug)).stores[0].handOver).toBeUndefined();

    // The store checkup says them apart from the orders to send too.
    const checkup = await run(store, "store_checkup");
    const findings = JSON.stringify(checkup);
    expect(findings).toContain("1 paid order(s) are waiting to be sent");
    expect(findings).toContain("2 paid order(s) are waiting to be collected");
    expect(findings).toContain("2 local deliveries are not delivered yet");
  });
});
