import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

type Row = Record<string, unknown>;

/** A stand-in for Helthjem that answers as its API description says and records what it is asked. */
const helthjem = vi.hoisted(() => {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const state = { noCoverage: false, bookingError: false, down: false };
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", headers, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (String(url).endsWith("/auth/oauth2/v1/token")) return json({ token: "TOK", expires_in: 3600, token_type: "Bearer" });
    if (state.down) return json({}, 503);
    if (String(url).includes("/service-points/nearby")) {
      return json({
        freightProducts: [
          {
            freightProductId: 55,
            servicePoints: [
              { servicePointExternalId: "30694", servicePointName: "Joker Toftes Gate", visitingAddress: { streetName: "TOFTES GATE", streetNumber: "12", postalCode: "0556", postalName: "OSLO", countryCode: "NO" } },
              { servicePointExternalId: "30700", servicePointName: "Kiwi Sentrum", visitingAddress: { streetName: "STORGATA", streetNumber: "9", postalCode: "0155", postalName: "OSLO", countryCode: "NO" } },
            ],
          },
        ],
      });
    }
    if (String(url).includes("/addresses/find/single")) return state.noCoverage ? json({ errorKey: "no.carrier.support", statusCode: 400 }, 400) : json({ productName: "HELTHJEM" });
    if (String(url).endsWith("/parcels/v1/bookings")) {
      if (state.bookingError) return json({ errorKey: "address.invalid", statusCode: 400 }, 400);
      return json({ orderId: 1, shipmentId: `(401)7072${calls.length}`, freightProductId: body?.transportSolutionId === 86 ? 55 : 1 });
    }
    if (String(url).includes("/labels/")) return new Response("%PDF-1.4 hj", { status: 200 });
    if (String(url).includes("/tracking/fetch/")) return json([{ items: [{ events: [{ eventTime: "2026-06-05 09:00:00", eventType: { apiKey: "001", description: "Registered" } }] }] }]);
    return json({}, 404);
  };
  return { calls, state, fetcher };
});

vi.mock("./carriers", async () => {
  const { createHelthjemAdapter } = await import("./carriers/helthjem");
  const fetcher = helthjem.fetcher as unknown as typeof fetch;
  return { adapterFor: (id: string) => (id === "helthjem" ? createHelthjemAdapter(fetcher) : null) };
});
vi.mock("./carriers/helthjem", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/helthjem")>();
  return {
    ...original,
    createHelthjemAdapter: (fetcher?: typeof fetch) => original.createHelthjemAdapter(fetcher ?? (helthjem.fetcher as unknown as typeof fetch)),
    fetchHelthjemLabel: (context: never, url: string) => original.fetchHelthjemLabel(context, url, helthjem.fetcher as unknown as typeof fetch),
  };
});
vi.mock("./stripe", () => ({ platformStripe: () => null, WEBHOOK_EVENTS: [] }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { getOrderAdmin } = await import("./order-admin");
const { saveCarrier } = await import("./shipping-carriers");
const { chooseDelivery, deliveryOptionsFor, quoteDelivery, saveCheckoutSettings } = await import("./delivery-options");
const { helthjemBook } = await import("./helthjem-shipping");
const { carrierLabel } = await import("./carrier-label");
const { carrierTracking, trackedCarrier } = await import("./carrier-tracking");
const { checkCarrier } = await import("./bring-shipping");
const { forgetHelthjemTokens } = await import("./carriers/helthjem");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;

const fields = { clientId: "cid", clientSecret: "shh-secret-01", shopId: "16", homeSolutionId: "114", collectSolutionId: "86", senderName: "Shop AS", senderStreet: "Akersgata 55", senderPostalCode: "0180", senderCity: "Oslo", senderPhone: "22334455" };
const setUp = (environment: string, over: Record<string, string> = {}) => saveCarrier(accountId, storeId, "helthjem", { environment, countries: ["NO"], fields: { ...fields, ...over } });
const settings = {
  enabled: true,
  services: ["home", "collect"],
  markup: { percent: 0, minor: 0 },
  freeOverMinor: null,
  defaultWeightGrams: 1000,
  prices: { NO: { freeOverMinor: 100_000, services: { home: 7_900, collect: 4_900 } } },
};
const flat = { label: "Frakt", rate: { amountMinor: 9900, freeOverMinor: null } };
const priceAs = (rate: { amountMinor: number }) => rate.amountMinor;
const parcel = { weightGrams: 800 };

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`hj-${run}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`hj-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`hj-${run}`}, 'Test', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.product_variants set weight_grams = 400 where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  expect((await setUp("test")).ok).toBe(true);
  expect(await saveCheckoutSettings(accountId, storeId, "helthjem", settings)).toEqual({ ok: true });
});

afterAll(async () => {
  await closeDb();
});

async function newCart(quantity = 2): Promise<string> {
  const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
  await db().execute(sql`insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) select ${storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  return String(cart.id);
}

/** A paid order whose shopper chose Helthjem's `service` (with the second service point for a collect). */
async function paidOrder(service: "home" | "collect", address: Record<string, unknown> = { name: "Kari Nordmann", line1: "Fjellgata 48", postalCode: "0566", city: "Oslo", country: "NO", phone: "53582094" }): Promise<string> {
  const cartId = await newCart();
  expect(await quoteDelivery({ storeId, market: no }, cartId, "0566")).toEqual({ ok: true });
  const listed = await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs);
  const option = listed.options.find((o) => o.carrier === "helthjem" && o.needsPickupPoint === (service === "collect"))!;
  expect(await chooseDelivery({ storeId, market: no }, cartId, option.id, service === "collect" ? "30700" : undefined)).toEqual({ ok: true });
  const result = await placeOrder({ storeId, market: no }, cartId);
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  await db().execute(sql`insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status) values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_${run}`}, ${totalMinor}, 'NOK', 'captured')`);
  await completeOrderPayment(orderId, `cs_${orderId}`);
  await db().execute(sql`update commerce.orders set email = 'kari@example.com', shipping_address = ${JSON.stringify(address)}::jsonb where id = ${orderId}::uuid`);
  return orderId;
}

describe("Helthjem's services at checkout, at prices the store enters (D138)", () => {
  it("are offered as entered, with the shopper's service point choice for the one that needs it", async () => {
    forgetHelthjemTokens();
    const cartId = await newCart();
    expect(await quoteDelivery({ storeId, market: no }, cartId, "0566")).toEqual({ ok: true });
    const listed = await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs);
    expect(listed.options.map((o) => [o.label, o.priceMinor, o.freeOverMinor])).toEqual([
      ["Frakt", 9900, null],
      ["Helthjem service point", 4900, 100_000],
      ["Helthjem home delivery", 7900, 100_000],
    ]);
    expect(listed.options[1].pickupPoints.map((p) => p.name)).toEqual(["Joker Toftes Gate", "Kiwi Sentrum"]);
    // The point search is asked with the store's own transport solution, with a bearer token from its credentials.
    const asked = helthjem.calls.filter((c) => c.url.includes("/service-points/")).at(-1)!;
    expect(asked.body).toEqual({ shopId: 16, transportSolutionId: 86, zipCode: "0566", countryCode: "NO" });
    expect(asked.headers.Authorization).toBe("Bearer TOK");
    // No price is asked of Helthjem.
    expect(helthjem.calls.some((c) => c.url.includes("price"))).toBe(false);
  });

  it("leave out home delivery for a cart heavier than it takes (5 kg), and the service point for more than 20 kg", async () => {
    const heavy = await newCart(15); // 15 × 400 g = 6 kg
    expect(await quoteDelivery({ storeId, market: no }, heavy, "0566")).toEqual({ ok: true });
    expect((await deliveryOptionsFor({ storeId, market: no }, heavy, flat, priceAs)).options.map((o) => o.label)).toEqual(["Frakt", "Helthjem service point"]);
    const veryHeavy = await newCart(60); // 24 kg
    expect(await quoteDelivery({ storeId, market: no }, veryHeavy, "0566")).toEqual({ ok: false, problem: "none" });
  });

  it("leave only the flat rate when Helthjem does not answer for service points", async () => {
    const cartId = await newCart();
    helthjem.state.down = true;
    const quoted = await quoteDelivery({ storeId, market: no }, cartId, "0566");
    helthjem.state.down = false;
    // Home delivery needs no point, so it is still offered.
    expect(quoted).toEqual({ ok: true });
    expect((await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs)).options.map((o) => o.label)).toEqual(["Frakt", "Helthjem home delivery"]);
  });
});

describe("shipping an order with Helthjem", () => {
  it("checks the credentials and shop, and keeps the answer", async () => {
    expect(await checkCarrier(accountId, storeId, "helthjem")).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select check_ok from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = 'helthjem'`);
    expect(row.check_ok).toBe(true);
  });

  it("books a test home delivery after a coverage check, without marking the order as sent", async () => {
    const orderId = await paidOrder("home");
    const booked = await helthjemBook(accountId, storeId, orderId, { parcel });
    expect(booked).toMatchObject({ ok: true, test: true, trackingNumber: expect.stringMatching(/^7072/) });
    const order = await getOrderAdmin(storeId, orderId);
    expect(order?.status).toBe("paid");
    expect(order?.shipments).toEqual([]);
    const sent = helthjem.calls.filter((c) => c.url === "https://api.pre.helthjem.no/parcels/v1/bookings").at(-1)!;
    expect(sent.body).toMatchObject({
      shopId: 16,
      transportSolutionId: 114,
      parties: [{ type: "consignee", name: "Kari Nordmann", address: "Fjellgata 48", zipCode: "0566", email: "kari@example.com", phone1: "53582094", reference: expect.any(String) }, { type: "consignor", name: "Shop AS", address: "Akersgata 55" }],
      items: [{ itemNumber: 1, weight: 800 }],
    });
    const coverage = helthjem.calls.filter((c) => c.url.includes("/addresses/find/single")).at(-1)!;
    expect(helthjem.calls.indexOf(coverage)).toBeLessThan(helthjem.calls.indexOf(sent));
  });

  it("books a real service point delivery with the shopper's point, marks the order as sent and prints the label", async () => {
    await setUp("live");
    await saveCheckoutSettings(accountId, storeId, "helthjem", settings);
    const orderId = await paidOrder("collect");
    const booked = await helthjemBook(accountId, storeId, orderId, { parcel });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "Helthjem", carrierId: "helthjem", hasLabel: true });
    const sent = helthjem.calls.filter((c) => c.url === "https://api.helthjem.no/parcels/v1/bookings").at(-1)!;
    expect(sent.body).toMatchObject({ transportSolutionId: 86 });
    expect((sent.body as { parties: unknown[] }).parties.at(-1)).toEqual({ type: "servicePoint", id: "30700", countryCode: "NO" });
    const order = await getOrderAdmin(storeId, orderId);
    expect(order?.status).toBe("fulfilled");
    const shipment = order!.shipments[0];
    expect(new TextDecoder().decode((await carrierLabel(storeId, orderId, shipment.id))!)).toBe("%PDF-1.4 hj");
    expect(trackedCarrier({ carrierId: shipment.carrierId, carrier: shipment.carrier })).toBe("helthjem");
    expect((await carrierTracking(storeId, "helthjem", shipment.trackingNumber))[0]).toMatchObject({ status: "001" });
  });

  it("books nothing when Helthjem does not reach the address, and says so", async () => {
    const orderId = await paidOrder("home");
    helthjem.state.noCoverage = true;
    const booked = await helthjemBook(accountId, storeId, orderId, { parcel });
    helthjem.state.noCoverage = false;
    expect(booked).toEqual({ ok: false, problem: "Helthjem does not deliver to that address with this transport solution." });
    expect(helthjem.calls.filter((c) => c.url.endsWith("/bookings") && c.method === "POST").length).toBeGreaterThan(0);
    expect((await getOrderAdmin(storeId, orderId))?.status).toBe("paid");
  });

  it("does not book the same order twice in quick succession", async () => {
    const orderId = await paidOrder("home");
    expect((await helthjemBook(accountId, storeId, orderId, { parcel })).ok).toBe(true);
    expect(await helthjemBook(accountId, storeId, orderId, { parcel })).toEqual({ ok: false, problem: "This order was just booked with Helthjem. Reload the page to see it." });
  });

  it("refuses an order the customer did not choose Helthjem for, an incomplete address and a bad weight", async () => {
    const plain = await paidOrder("home");
    await db().execute(sql`update commerce.orders set delivery = null where id = ${plain}::uuid`);
    expect(await helthjemBook(accountId, storeId, plain, { parcel })).toEqual({ ok: false, problem: "The customer did not choose a Helthjem delivery." });
    const incomplete = await paidOrder("home", { name: "Kari", line1: "", postalCode: "0566", city: "Oslo", country: "NO" });
    expect(await helthjemBook(accountId, storeId, incomplete, { parcel })).toMatchObject({ ok: false, problem: expect.stringMatching(/address is not complete/) });
    expect(await helthjemBook(accountId, storeId, incomplete, { parcel: { weightGrams: 0 } })).toMatchObject({ ok: false });
  });

  it("shows what Helthjem objected to and changes nothing", async () => {
    const orderId = await paidOrder("home");
    helthjem.state.bookingError = true;
    const booked = await helthjemBook(accountId, storeId, orderId, { parcel });
    helthjem.state.bookingError = false;
    expect(booked).toMatchObject({ ok: false, problem: expect.stringContaining("address.invalid") });
    expect((await getOrderAdmin(storeId, orderId))?.status).toBe("paid");
  });
});
