import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

/** A stand-in for Bring that answers as its documentation says and records what it is asked. */
const bring = vi.hoisted(() => {
  const calls: { url: string; body: { consignments: { packages: { grossWeight: number }[] }[] } }[] = [];
  const state = { down: false, noServices: false, noPickupPoints: false };
  const product = (id: string, name: string, price: string, days: string, currency = "NOK") => ({
    id,
    guiInformation: { displayName: name },
    price: { listPrice: { currencyCode: currency, priceWithoutAdditionalServices: { amountWithoutVAT: price } } },
    expectedDelivery: { workingDays: days },
  });
  const fetcher = async (url: string, init: RequestInit) => {
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), body: body as (typeof calls)[number]["body"] });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (state.down) return json({}, 503);
    if (String(url).includes("/pickuppoint/")) {
      return json({
        pickupPoint: state.noPickupPoints
          ? []
          : [
              { id: "PP1", name: "Kiwi Sentrum", address: "Storgata 9", postalCode: "0155", city: "OSLO", countryCode: "NO", distance: "0.3" },
              { id: "PP2", name: "Joker Hjørnet", address: "Lillegata 2", postalCode: "0156", city: "OSLO", countryCode: "NO", distance: "1.4" },
            ],
      });
    }
    if (String(url).includes("/shippingguide/")) {
      return json({
        consignments: [
          {
            products: state.noServices
              ? []
              : [
                  product("5800", "Pakke til hentested", "79.00", "3"),
                  product("5600", "Pakke levert hjem", "99.00", "2"),
                  product("3584", "Brevpakke", "40.00", "4"),
                  product("4850", "Sweden, priced in another currency", "50.00", "5", "SEK"),
                ],
          },
        ],
      });
    }
    return json({}, 404);
  };
  return { calls, state, fetcher };
});

vi.mock("./carriers", async () => {
  const { createBringAdapter } = await import("./carriers/bring");
  return { adapterFor: (id: string) => (id === "bring" ? createBringAdapter(bring.fetcher as unknown as typeof fetch) : null) };
});

const { changeLine, getCart } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { saveCarrier } = await import("./shipping-carriers");
const { chooseDelivery, chosenDelivery, deliveryChoiceOn, deliveryOptionsFor, quoteDelivery, saveCheckoutSettings } = await import("./delivery-options");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;
const variant: Record<string, string> = {};
const shop = () => ({ storeId, market: no });
const cartId = () => jar.get(`cart_${storeId}_${no.slug}`)!;

const details = { customerNumber: "12345", apiUid: "me@shop.no", apiKey: "secret-key-0001", senderName: "Shop AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo" };
const settings = { enabled: true, services: ["5800", "5600"], markup: { percent: 10, minor: 500 }, freeOverMinor: null, defaultWeightGrams: 1000 };

const latestGuideBody = () => bring.calls.filter((c) => c.url.includes("/shippingguide/")).at(-1)!.body;
const flat = { label: "Frakt", rate: { amountMinor: 9900, freeOverMinor: null } };
const priceAs = (rate: { amountMinor: number }) => rate.amountMinor;

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`dopt-${run}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`dopt-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`dopt-${run}`}, 'Test', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.product_variants set weight_grams = 400 where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  await db().execute(sql`update commerce.product_variants set weight_grams = null where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
  const rows = await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${storeId}::uuid`);
  for (const row of rows) variant[String(row.sku)] = String(row.id);
  const saved = await saveCarrier(accountId, storeId, "bring", { environment: "test", countries: ["NO"], fields: details });
  expect(saved).toEqual({ ok: true });
});

afterAll(async () => {
  await closeDb();
});

async function newCart(sku = "DEMO-TOTE", quantity = 2) {
  jar.clear();
  expect(await changeLine(shop(), variant[sku], quantity, "add")).toMatchObject({ outcome: "added" });
  return cartId();
}

describe("the store's settings for a carrier at checkout", () => {
  it("are off until saved, and cannot be switched on before the agreement is complete", async () => {
    expect(await deliveryChoiceOn(storeId, "NO")).toBe(false);
    const [other] = await db().execute<Row>(sql`select commerce.approve_access_request(${String((await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`dopt2-${run}@example.com`}, 'T', 'T') returning id`))[0].id)}::uuid, ${`dopt2-${run}`}, 'T', null) as id`);
    expect(await saveCheckoutSettings(accountId, String(other.id), "bring", settings)).toMatchObject({ ok: false });
    expect(await saveCheckoutSettings(accountId, storeId, "bring", { ...settings, services: ["9999"] })).toMatchObject({ ok: false });
    expect(await saveCheckoutSettings(accountId, storeId, "bring", settings)).toEqual({ ok: true });
    expect(await deliveryChoiceOn(storeId, "NO")).toBe(true);
    // Only for the countries the store chose for the carrier.
    expect(await deliveryChoiceOn(storeId, "SE")).toBe(false);
  });
});

describe("asking the carrier for a postal code", () => {
  it("keeps the services the store offers, priced with VAT and its markup, cheapest first", async () => {
    const cart = await newCart("DEMO-TOTE", 2);
    expect(await quoteDelivery(shop(), cart, " 0150 ")).toEqual({ ok: true });
    // The parcel: two totes of 400 g, to the postal code given, from the store's own address.
    expect(latestGuideBody().consignments[0]).toMatchObject({ fromPostalCode: "0150", toCountryCode: "NO", toPostalCode: "0150", packages: [{ grossWeight: 800 }] });
    const listed = await deliveryOptionsFor(shop(), cart, flat, priceAs);
    // The mailbox parcel is not switched on and the SEK price is not in the country's currency.
    expect(listed.options.map((o) => o.label)).toEqual(["Frakt", "Pakke til hentested", "Pakke levert hjem"]);
    // 79 kr -> 98.75 with 25 % VAT -> +10 % = 108.63 -> +5 kr = 113.63; 99 kr -> 123.75 -> 136.13 -> 141.13.
    expect(listed.options.map((o) => o.priceMinor)).toEqual([9900, 11363, 14113]);
    expect(listed.options[1]).toMatchObject({ carrier: "bring", needsPickupPoint: true, estimate: { min: 3, max: 3 }, selected: false });
    expect(listed.options[1].pickupPoints.map((p) => p.name)).toEqual(["Kiwi Sentrum", "Joker Hjørnet"]);
    expect(listed.options[2]).toMatchObject({ needsPickupPoint: false, pickupPoints: [] });
    // The flat rate is what the order has until something is chosen.
    expect(listed.options.find((o) => o.selected)?.id).toBe("flat");
    expect(listed.postalCode).toBe("0150");
  });

  it("counts goods without a weight at the store's default, once", async () => {
    const cart = await newCart("DEMO-MUG-WHITE", 3);
    await quoteDelivery(shop(), cart, "0150");
    expect(latestGuideBody().consignments[0].packages[0].grossWeight).toBe(1000);
    // With goods that have a weight too: what is known, and the default for the rest.
    expect(await changeLine(shop(), variant["DEMO-TOTE"], 1, "add")).toMatchObject({ outcome: "added" });
    await quoteDelivery(shop(), cart, "0150");
    expect(latestGuideBody().consignments[0].packages[0].grossWeight).toBe(1400);
  });

  it("refuses what is not a postal code, and leaves the flat rate when the carrier has nothing or does not answer", async () => {
    const cart = await newCart();
    expect(await quoteDelivery(shop(), cart, "12")).toEqual({ ok: false, problem: "postal_code" });
    bring.state.noServices = true;
    expect(await quoteDelivery(shop(), cart, "0150")).toEqual({ ok: false, problem: "none" });
    bring.state.noServices = false;
    bring.state.noPickupPoints = true;
    // Both switched-on services: the home delivery does not need a pickup point, so it is still offered.
    expect(await quoteDelivery(shop(), cart, "0150")).toEqual({ ok: true });
    expect((await deliveryOptionsFor(shop(), cart, flat, priceAs)).options.map((o) => o.label)).toEqual(["Frakt", "Pakke levert hjem"]);
    bring.state.noPickupPoints = false;
    bring.state.down = true;
    expect(await quoteDelivery(shop(), cart, "0150")).toEqual({ ok: false, problem: "unavailable" });
    bring.state.down = false;
    // Whatever happened, the cart still ships at the flat rate.
    expect(await chosenDelivery(db(), storeId, cart, no)).toBeNull();
    const summary = await cartSummary(shop(), await getCart(shop()));
    expect(summary.delivery).toBeNull();
  });

  it("is not offered for another country's cart", async () => {
    const cart = await newCart();
    expect(await quoteDelivery({ storeId, market: toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" }) }, cart, "11455")).toEqual({ ok: false, problem: "unavailable" });
  });
});

describe("choosing", () => {
  it("puts the service on the cart, which then ships at its price", async () => {
    const cart = await newCart("DEMO-TOTE", 2);
    await quoteDelivery(shop(), cart, "0150");
    const home = (await deliveryOptionsFor(shop(), cart, flat, priceAs)).options.find((o) => o.label === "Pakke levert hjem")!;
    expect(await chooseDelivery(shop(), cart, home.id)).toEqual({ ok: true });
    const chosen = await chosenDelivery(db(), storeId, cart, no);
    expect(chosen).toMatchObject({ rate: { amountMinor: 14113 }, delivery: { carrier: "bring", serviceId: "5600", label: "Pakke levert hjem", postalCode: "0150", pickupPoint: null } });
    const summary = await cartSummary(shop(), await getCart(shop()));
    expect(summary.shipping).toBe(14113);
    // Asking again for another postal code keeps what was chosen until the shopper chooses again.
    await quoteDelivery(shop(), cart, "0250");
    expect((await chosenDelivery(db(), storeId, cart, no))?.delivery.postalCode).toBe("0150");
    const again = await deliveryOptionsFor(shop(), cart, flat, priceAs);
    expect(again.options.filter((o) => o.selected)).toHaveLength(1);
    expect(again.options.find((o) => o.selected)?.id).toBe(home.id);
    // The flat rate again.
    expect(await chooseDelivery(shop(), cart, "flat")).toEqual({ ok: true });
    expect(await chosenDelivery(db(), storeId, cart, no)).toBeNull();
    expect((await cartSummary(shop(), await getCart(shop()))).shipping).not.toBe(14113);
  });

  it("needs a pickup point from the list for a service that has them", async () => {
    const cart = await newCart();
    await quoteDelivery(shop(), cart, "0150");
    const pickup = (await deliveryOptionsFor(shop(), cart, flat, priceAs)).options.find((o) => o.needsPickupPoint)!;
    expect(await chooseDelivery(shop(), cart, pickup.id)).toEqual({ ok: false, problem: "pickup_point" });
    expect(await chooseDelivery(shop(), cart, pickup.id, "PP-made-up")).toEqual({ ok: false, problem: "pickup_point" });
    expect(await chooseDelivery(shop(), cart, pickup.id, "PP2")).toEqual({ ok: true });
    expect((await chosenDelivery(db(), storeId, cart, no))?.delivery.pickupPoint).toEqual({ id: "PP2", name: "Joker Hjørnet", street: "Lillegata 2", postalCode: "0156", city: "OSLO" });
  });

  it("is refused for an option that is gone, another cart's or not an id", async () => {
    const first = await newCart();
    await quoteDelivery(shop(), first, "0150");
    const option = (await deliveryOptionsFor(shop(), first, flat, priceAs)).options.find((o) => o.carrier === "bring" && !o.needsPickupPoint)!;
    const second = await newCart();
    expect(await chooseDelivery(shop(), second, option.id)).toEqual({ ok: false, problem: "gone" });
    expect(await chooseDelivery(shop(), second, "not-an-id")).toEqual({ ok: false, problem: "gone" });
    // One that has run out is gone too, and a cart holding it ships at the flat rate again.
    expect(await chooseDelivery(shop(), first, option.id)).toEqual({ ok: true });
    await db().execute(sql`update commerce.delivery_quotes set expires_at = now() - interval '1 minute' where id = ${option.id}::uuid`);
    expect(await chosenDelivery(db(), storeId, first, no)).toBeNull();
    expect(await chooseDelivery(shop(), first, option.id)).toEqual({ ok: false, problem: "gone" });
    jar.set(`cart_${storeId}_${no.slug}`, first);
    expect((await deliveryOptionsFor(shop(), first, flat, priceAs)).options.map((o) => o.id)).not.toContain(option.id);
  });

  it("forgets answers that ran out long ago", async () => {
    const cart = await newCart();
    await quoteDelivery(shop(), cart, "0150");
    await db().execute(sql`update commerce.delivery_quotes set expires_at = now() - interval '2 days' where cart_id = ${cart}::uuid`);
    await quoteDelivery(shop(), cart, "0150");
    const [row] = await db().execute<Row>(sql`select count(*)::int as n from commerce.delivery_quotes where cart_id = ${cart}::uuid and expires_at < now()`);
    expect(Number(row.n)).toBe(0);
  });
});
