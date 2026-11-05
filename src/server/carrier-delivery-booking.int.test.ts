import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

type Row = Record<string, unknown>;

const PDF = (text: string) => Buffer.from(`%PDF-1.4 ${text}`).toString("base64");

/** Stand-ins for UPS, DHL Express and Instabee that answer as their documents say and record what they are asked (D457). */
const carriers = vi.hoisted(() => {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  const state = { upsCurrency: "NOK" };
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const body = typeof init.body === "string" && init.body.startsWith("{") ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", body });
    const u = String(url);
    // UPS
    if (u.endsWith("/security/v1/oauth/token")) return json({ access_token: "TOK", expires_in: "14399" });
    if (u.includes("/api/rating/")) {
      return json({
        RateResponse: {
          RatedShipment: [
            { Service: { Code: "11" }, TotalCharges: { CurrencyCode: state.upsCurrency, MonetaryValue: state.upsCurrency === "EUR" ? "20.00" : "200.00" }, GuaranteedDelivery: { BusinessDaysInTransit: "2" } },
            { Service: { Code: "65" }, TotalCharges: { CurrencyCode: state.upsCurrency, MonetaryValue: state.upsCurrency === "EUR" ? "40.00" : "400.00" } },
          ],
        },
      });
    }
    if (u.includes("/api/shipments/")) return json({ ShipmentResponse: { ShipmentResults: { ShipmentIdentificationNumber: `1ZTEST${calls.length}`, PackageResults: [{ TrackingNumber: `1ZTEST${calls.length}` }] } } });
    if (u.includes("/api/labels/v1/recovery")) return json({ LabelRecoveryResponse: { LabelResults: [{ LabelImage: { GraphicImage: PDF("ups") } }] } });
    // DHL Express
    if (u.includes("/address-validate")) return json({ address: [{ cityName: "OSLO" }] });
    if (u.includes("/mydhlapi") && u.endsWith("/rates")) {
      return json({ products: [{ productCode: "N", totalPrice: [{ currencyType: "BILLC", priceCurrency: "NOK", price: 250 }], totalPriceBreakdown: [{ currencyType: "BILLC", priceBreakdown: [{ typeCode: "STTXA", price: 50 }] }] }] });
    }
    if (u.includes("/mydhlapi") && u.endsWith("/shipments")) return json({ shipmentTrackingNumber: `99${calls.length}`, documents: [{ typeCode: "label", imageFormat: "PDF", content: PDF("dhl") }] }, 201);
    // Instabee
    if (u.includes("/delivery-options")) {
      return json(
        {
          availabilityToken: "tok-14d",
          deliveryOptions: [{ sortCode: "IN123abc", type: "LOCKER", deliveryOption: "Kiwi Grünerløkka", address: { street: "Thorvald Meyers gate 1", postalCode: "0555", city: "Oslo", countryCode: "NO" }, distance: { unit: "meter", value: 200 } }],
        },
        201,
      );
    }
    if (u.endsWith("/orders") && init.method === "PUT") return json({ orderId: `ib-${calls.length}`, parcelId: `SHOP0000000${calls.length}`, links: { tracking: `https://track.instabox.com/SHOP0000000${calls.length}` }, state: "FINALIZED" });
    if (u.includes("/labels?fileFormat=pdf")) return new Response("%PDF-1.4 instabox", { status: 200 });
    return json({}, 404);
  };
  return { calls, state, fetcher };
});

vi.mock("./carriers", async () => {
  const fetcher = carriers.fetcher as unknown as typeof fetch;
  const { createUpsAdapter } = await import("./carriers/ups");
  const { createDhlAdapter } = await import("./carriers/dhl");
  const { createInstaboxAdapter } = await import("./carriers/instabox");
  const made: Record<string, () => unknown> = { ups: () => createUpsAdapter(fetcher), dhl: () => createDhlAdapter(fetcher), instabox: () => createInstaboxAdapter(fetcher) };
  return { adapterFor: (id: string) => made[id]?.() ?? null };
});
vi.mock("./carriers/ups", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/ups")>();
  return { ...original, fetchUpsLabel: (context: never, url: string) => original.fetchUpsLabel(context, url, carriers.fetcher as unknown as typeof fetch) };
});
vi.mock("./carriers/instabox", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/instabox")>();
  return { ...original, fetchInstaboxLabel: (context: never, url: string) => original.fetchInstaboxLabel(context, url, carriers.fetcher as unknown as typeof fetch) };
});
vi.mock("./stripe", () => ({ platformStripe: () => null, WEBHOOK_EVENTS: [] }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { getOrderAdmin } = await import("./order-admin");
const { saveCarrier } = await import("./shipping-carriers");
const { chooseDelivery, deliveryOptionsFor, quoteDelivery, saveCheckoutSettings } = await import("./delivery-options");
const { bookCarrierDelivery } = await import("./carrier-delivery-booking");
const { carrierLabel } = await import("./carrier-label");
const { labelsToPrint } = await import("./bulk-labels");
const { trackedCarrier } = await import("./carrier-tracking");
const { runRetention } = await import("./retention");
const { forgetUpsTokens } = await import("./carriers/ups");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;

const sender = { senderName: "Shop AS", senderStreet: "Akersgata 55", senderPostalCode: "0180", senderCity: "Oslo", senderCountry: "NO", senderPhone: "+4722334455" };
const flat = { label: "Frakt", rate: { amountMinor: 9900, freeOverMinor: null } };
const priceAs = (rate: { amountMinor: number }) => rate.amountMinor;
const parcel = { weightGrams: 800 };
const kari = { name: "Kari Nordmann", line1: "Fjellgata 48", postalCode: "0566", city: "Oslo", country: "NO", phone: "53582094" };

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`cdb-${run}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`cdb-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`cdb-${run}`}, 'Test', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.product_variants set weight_grams = 400 where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  expect((await saveCarrier(accountId, storeId, "ups", { environment: "live", countries: ["NO"], fields: { clientId: "cid", clientSecret: "ups-secret-01", accountNumber: "A1B2C3", ...sender } })).ok).toBe(true);
  expect((await saveCarrier(accountId, storeId, "dhl", { environment: "live", countries: ["NO"], fields: { apiKey: "dhl-key-0001", apiSecret: "dhl-secret-01", accountNumber: "123456789", ...sender } })).ok).toBe(true);
  expect((await saveCarrier(accountId, storeId, "instabox", { environment: "live", countries: ["NO"], fields: { apiKey: "ib-key-000001" } })).ok).toBe(true);
  const carrierPriced = { enabled: true, markup: { percent: 0, minor: 0 }, freeOverMinor: null, defaultWeightGrams: 1000, prices: {} };
  expect(await saveCheckoutSettings(accountId, storeId, "ups", { ...carrierPriced, services: ["11", "65"] })).toEqual({ ok: true });
  expect(await saveCheckoutSettings(accountId, storeId, "instabox", { ...carrierPriced, services: ["locker"], prices: { NO: { freeOverMinor: null, services: { locker: 4_900 } } } })).toEqual({ ok: true });
});

afterAll(async () => {
  await closeDb();
});

async function newCart(quantity = 2): Promise<string> {
  const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
  await db().execute(sql`insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) select ${storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  return String(cart.id);
}

/** A paid order whose shopper chose the option `pick` finds among those listed (none: the flat rate). */
async function paidOrder(pick?: (options: { id: string; carrier: string; label: string; pickupPoints: { id: string }[] }[]) => { id: string; point?: string }): Promise<string> {
  const cartId = await newCart();
  if (pick) {
    expect(await quoteDelivery({ storeId, market: no }, cartId, "0566")).toEqual({ ok: true });
    const listed = await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs);
    const chosen = pick(listed.options);
    expect(await chooseDelivery({ storeId, market: no }, cartId, chosen.id, chosen.point)).toEqual({ ok: true });
  }
  const result = await placeOrder({ storeId, market: no }, cartId);
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  await db().execute(sql`insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status) values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_${run}`}, ${totalMinor}, 'NOK', 'captured')`);
  await completeOrderPayment(orderId, `cs_${orderId}`);
  await db().execute(sql`update commerce.orders set email = 'kari@example.com', shipping_address = ${JSON.stringify(kari)}::jsonb where id = ${orderId}::uuid`);
  return orderId;
}

describe("UPS at checkout and from the order (D457)", () => {
  it("offers UPS's services at its price with VAT, cheapest first", async () => {
    forgetUpsTokens();
    const cartId = await newCart();
    expect(await quoteDelivery({ storeId, market: no }, cartId, "0566")).toEqual({ ok: true });
    const listed = await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs);
    // 200 and 400 kroner without VAT, with Norway's 25 %; the names already say UPS, so none is prefixed with the carrier.
    expect(listed.options.filter((o) => o.carrier === "ups").map((o) => [o.label, o.priceMinor])).toEqual([
      ["UPS Standard", 25_000],
      ["UPS Express Saver", 50_000],
    ]);
    const rating = carriers.calls.filter((c) => c.url.includes("/api/rating/")).at(-1)!;
    expect(rating.url).toBe("https://onlinetools.ups.com/api/rating/v2409/Shop");
  });

  it("converts a price in the account's currency at the store's rates, and leaves it out without one", async () => {
    carriers.state.upsCurrency = "EUR";
    const without = await newCart();
    expect(await quoteDelivery({ storeId, market: no }, without, "0566")).toEqual({ ok: true });
    expect((await deliveryOptionsFor({ storeId, market: no }, without, flat, priceAs)).options.some((o) => o.carrier === "ups")).toBe(false);
    await db().execute(sql`insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1) on conflict do nothing`);
    const cartId = await newCart();
    expect(await quoteDelivery({ storeId, market: no }, cartId, "0566")).toEqual({ ok: true });
    const ups = (await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs)).options.filter((o) => o.carrier === "ups");
    carriers.state.upsCurrency = "NOK";
    await db().execute(sql`delete from commerce.store_currencies where store_id = ${storeId}::uuid`);
    // 20 euro is 230 kroner at 11.5, with 25 % VAT.
    expect(ups.map((o) => o.priceMinor)).toEqual([28_750, 57_500]);
  });

  it("books the shopper's UPS service, marks the order sent with UPS's page and prints the label from Label Recovery", async () => {
    const orderId = await paidOrder((options) => ({ id: options.find((o) => o.carrier === "ups" && o.label === "UPS Standard")!.id }));
    const booked = await bookCarrierDelivery(accountId, storeId, orderId, "ups", { parcel });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "UPS", carrierId: "ups", hasLabel: true });
    const shipment = (await getOrderAdmin(storeId, orderId))!.shipments[0];
    expect(shipment.trackingUrl).toBe(`https://www.ups.com/track?tracknum=${shipment.trackingNumber}`);
    expect(new TextDecoder().decode((await carrierLabel(storeId, orderId, shipment.id))!)).toBe("%PDF-1.4 ups");
    expect(trackedCarrier({ carrierId: shipment.carrierId, carrier: shipment.carrier })).toBe("ups");
    const sent = carriers.calls.filter((c) => c.url.includes("/api/shipments/")).at(-1)!;
    expect((sent.body as { ShipmentRequest: { Shipment: { Service: unknown } } }).ShipmentRequest.Shipment.Service).toEqual({ Code: "11" });
  });

  it("books a flat-rate order with the service staff choose, and refuses an order whose shopper chose another carrier", async () => {
    const plain = await paidOrder();
    expect(await bookCarrierDelivery(accountId, storeId, plain, "ups", { parcel })).toEqual({ ok: false, problem: "Choose the UPS service to book." });
    expect(await bookCarrierDelivery(accountId, storeId, plain, "ups", { parcel, serviceId: "AP" })).toEqual({ ok: false, problem: expect.stringMatching(/pickup point/) });
    const booked = await bookCarrierDelivery(accountId, storeId, plain, "ups", { parcel, serviceId: "65" });
    expect(booked.ok && !booked.test).toBe(true);
    const sent = carriers.calls.filter((c) => c.url.includes("/api/shipments/")).at(-1)!;
    expect((sent.body as { ShipmentRequest: { Shipment: { Service: unknown } } }).ShipmentRequest.Shipment.Service).toEqual({ Code: "65" });
    const lockerOrder = await paidOrder((options) => {
      const locker = options.find((o) => o.carrier === "instabox")!;
      return { id: locker.id, point: locker.pickupPoints[0].id };
    });
    expect(await bookCarrierDelivery(accountId, storeId, lockerOrder, "ups", { parcel, serviceId: "11" })).toEqual({ ok: false, problem: "The customer did not choose a UPS delivery." });
  });
});

describe("DHL Express's label, kept because DHL gives it once (D457)", () => {
  it("is kept with the parcel, printed from there, and deleted by the retention run after 30 days", async () => {
    const orderId = await paidOrder();
    const booked = await bookCarrierDelivery(accountId, storeId, orderId, "dhl", { parcel, serviceId: "express" });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "DHL", carrierId: "dhl", hasLabel: true });
    const shipment = (await getOrderAdmin(storeId, orderId))!.shipments[0];
    expect(new TextDecoder().decode((await carrierLabel(storeId, orderId, shipment.id))!)).toBe("%PDF-1.4 dhl");
    expect((await labelsToPrint(storeId, [shipment.id])).labels.map((l) => l.carrier)).toEqual(["DHL"]);
    // The lane's product (N, within Norway) was asked of Rates before booking.
    expect(carriers.calls.filter((c) => c.url.endsWith("/shipments")).at(-1)!.body).toMatchObject({ productCode: "N", accounts: [{ typeCode: "shipper", number: "123456789" }] });
    await db().execute(sql`update commerce.carrier_labels set created_at = now() - interval '31 days' where store_id = ${storeId}::uuid and shipment_id = ${shipment.id}::uuid`);
    const result = await runRetention(new Date(), { steps: Object.fromEntries(["documents", "orders"].map((s) => [s, async () => ({ count: 0 })])) });
    expect(result.counts.carrier_labels).toBeGreaterThanOrEqual(1);
    expect(await carrierLabel(storeId, orderId, shipment.id)).toBeNull();
    // The parcel and its tracking number stay with the order.
    expect((await getOrderAdmin(storeId, orderId))!.shipments[0].trackingNumber).toBe(shipment.trackingNumber);
  });
});

describe("Instabox's lockers (D457)", () => {
  it("are offered at the store's price, and the chosen one is booked with its token, printed and not polled", async () => {
    const orderId = await paidOrder((options) => {
      const locker = options.find((o) => o.carrier === "instabox")!;
      expect([locker.label, locker.pickupPoints.map((p) => p.id)]).toEqual(["Instabox locker", ["IN123abc~tok-14d"]]);
      return { id: locker.id, point: locker.pickupPoints[0].id };
    });
    const booked = await bookCarrierDelivery(accountId, storeId, orderId, "instabox", { parcel });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "Instabox", carrierId: "instabox", hasLabel: true });
    const put = carriers.calls.filter((c) => c.url.endsWith("/orders") && c.method === "PUT").at(-1)!;
    expect(put.url).toBe("https://api.integration.instabee.com/orders");
    expect(put.body).toMatchObject({ availabilityToken: "tok-14d", deliveryOption: { sortCode: "IN123abc" }, recipient: { name: "Kari Nordmann", phone: "53582094", email: "kari@example.com" } });
    const shipment = (await getOrderAdmin(storeId, orderId))!.shipments[0];
    expect(shipment.trackingUrl).toMatch(/^https:\/\/track\.instabox\.com\//);
    expect(new TextDecoder().decode((await carrierLabel(storeId, orderId, shipment.id))!)).toBe("%PDF-1.4 instabox");
    expect(trackedCarrier({ carrierId: shipment.carrierId, carrier: shipment.carrier })).toBeNull();
    expect(await bookCarrierDelivery(accountId, storeId, await paidOrder(), "instabox", { parcel })).toEqual({ ok: false, problem: "The customer did not choose an Instabox delivery." });
  });
});
