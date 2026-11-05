import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

type Row = Record<string, unknown>;

/**
 * PostNord's booking and return labels, DHL Paket and nShift through the shared booking path (D458), with stand-ins for each carrier that answer as
 * their documents say: kept labels, staff-chosen services, a collection asked for, cancelling when a parcel is undone, nShift's own checkout options.
 */
const carriers = vi.hoisted(() => {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const pdf = (text: string) => Buffer.from(`%PDF-1.4 ${text}`).toString("base64");
  const json = (value: unknown, status = 200) => new Response(value === null ? null : JSON.stringify(value), { status });
  const postnordBooked = (itemId: string) => ({
    bookingResponse: { bookingId: "B1", idInformation: [{ status: "OK", ids: [{ idType: "itemId", value: itemId }], urls: [] }] },
    labelPrintout: [{ itemIds: [{ itemIds: itemId, status: "OK" }], printout: { labelFormat: "PDF", encoding: "base64", data: pdf("postnord") } }],
  });
  const points = { servicePointInformationResponse: { servicePoints: [{ servicePointId: "P1", name: "Kiosk Storgata", visitingAddress: { streetName: "Storgata", streetNumber: "1", postalCode: "0155", city: "Oslo", countryCode: "NO" } }] } };
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const raw = typeof init.body === "string" ? init.body : null;
    const body = raw && raw.startsWith("{") || raw?.startsWith("[") ? JSON.parse(raw) : raw;
    const method = init.method ?? "GET";
    calls.push({ url: String(url), method, body });
    const u = String(url);
    // PostNord
    if (u.includes("postnord.com/rest/businesslocation/")) return json(points);
    if (u.includes("postnord.com/rest/shipment/v3/returns/edi/labels/pdf")) return json(postnordBooked(`RET${calls.length}`));
    if (u.includes("postnord.com/rest/shipment/v3/edi/labels/pdf")) return json(postnordBooked(`0037350109305798${String(calls.length).padStart(4, "0")}`));
    // DHL Paket
    if (u.includes("/parcel/de/account/auth/ropc/v1/token")) return json({ access_token: "TOK", token_type: "Bearer", expires_in: 1799 });
    if (u.includes("/parcel/de/shipping/v2/orders") && method === "DELETE") return json({ status: { title: "OK", status: 200 }, items: [{ shipmentNo: "x", sstatus: { title: "OK", status: 200 } }] });
    if (u.includes("/parcel/de/shipping/v2/orders")) {
      return json({ status: { title: "OK", status: 200 }, items: [{ shipmentNo: `0034043416109404${String(calls.length).padStart(4, "0")}`, sstatus: { title: "OK", status: 200 }, label: { b64: pdf("dhl paket"), fileFormat: "PDF" } }] });
    }
    if (u.includes("/parcel/de/transportation/pickup/v1/orders")) return json({ confirmation: { type: "ORDERPICKUP", value: { orderID: "PU-123", pickupDate: "2026-11-06", freeOfCharge: false, pickupType: "EZA", confirmedShipments: [] } } }, 201);
    // nShift
    if (u.includes("api.unifaun.com/rs-extapi/v1/delivery-checkouts/")) {
      return json({
        deliveryCheckoutId: "chk+1",
        options: [
          { id: "opt-home", name: "PostNord Parcel", serviceId: "P18", partnerId: "PLAB", priceValue: 79, subOptions: [], agents: [] },
          {
            id: "opt-collect",
            name: "PostNord MyPack Collect",
            serviceId: "P19",
            partnerId: "PLAB",
            priceValue: 49,
            subOptions: [],
            agents: [{ id: "74383", name: "Kiwi Storgata", address1: "Storgata 1", zipCode: "0155", city: "OSLO", country: "NO" }],
          },
        ],
      });
    }
    if (u.endsWith("/rs-extapi/v1/shipments") && method === "POST") {
      const id = `56663${String(calls.length).padStart(2, "0")}`;
      return json([{ id, serviceId: "P19", shipmentNo: `7072${id}`, parcels: [{ parcelNo: `0037${id}` }], status: "PRINTED", prints: [] }], 201);
    }
    if (u.includes("/rs-extapi/v1/shipments/") && u.includes("/pdfs")) return json([{ id: "2", description: "Label", pdf: pdf("nshift") }]);
    if (u.includes("/rs-extapi/v1/shipments/") && method === "DELETE") return json(null, 204);
    return json({}, 404);
  };
  return { calls, fetcher };
});

vi.mock("./carriers", async () => {
  const fetcher = carriers.fetcher as unknown as typeof fetch;
  const { createPostnordAdapter } = await import("./carriers/postnord");
  const { createDhlPaketAdapter } = await import("./carriers/dhl-paket");
  const { createNshiftAdapter } = await import("./carriers/nshift");
  const made: Record<string, () => unknown> = { postnord: () => createPostnordAdapter(fetcher), dhl_paket: () => createDhlPaketAdapter(fetcher), nshift: () => createNshiftAdapter(fetcher) };
  return { adapterFor: (id: string) => made[id]?.() ?? null };
});
vi.mock("./carriers/nshift", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/nshift")>();
  return { ...original, fetchNshiftLabel: (context: never, url: string) => original.fetchNshiftLabel(context, url, carriers.fetcher as unknown as typeof fetch) };
});
vi.mock("./carriers/dhl-paket", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/dhl-paket")>();
  return { ...original, fetchDhlPaketLabel: (context: never, url: string) => original.fetchDhlPaketLabel(context, url, carriers.fetcher as unknown as typeof fetch) };
});
vi.mock("./stripe", () => ({ platformStripe: () => null, WEBHOOK_EVENTS: [] }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { getOrderAdmin, undoShipment } = await import("./order-admin");
const { saveCarrier } = await import("./shipping-carriers");
const { chooseDelivery, deliveryOptionsFor, quoteDelivery, saveCheckoutSettings } = await import("./delivery-options");
const { bookCarrierDelivery } = await import("./carrier-delivery-booking");
const { carrierLabel } = await import("./carrier-label");
const { cancelAtCarrier } = await import("./carrier-cancel");
const { trackedCarrier } = await import("./carrier-tracking");
const { bookReturnLabel, staffReturnLabel } = await import("./return-labels");
const { getReturnSettings, saveExchangeLabelSettings, saveReturnSettings } = await import("./return-settings");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;

const flat = { label: "Frakt", rate: { amountMinor: 9900, freeOverMinor: null } };
const priceAs = (rate: { amountMinor: number }) => rate.amountMinor;
const parcel = { weightGrams: 800 };
const kari = { name: "Kari Nordmann", line1: "Fjellgata 48", postalCode: "0566", city: "Oslo", country: "NO", phone: "53582094" };
const berlin = { name: "Anna Schmidt", line1: "Hauptstraße 1", postalCode: "10115", city: "Berlin", country: "DE", phone: "+49301234567" };
const pdfText = (bytes: Uint8Array | null) => (bytes ? new TextDecoder().decode(bytes) : null);

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`more-${run}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`more-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`more-${run}`}, 'Test', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.product_variants set weight_grams = 400 where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  const norway = { senderName: "Shop AS", senderStreet: "Akersgata 55", senderPostalCode: "0180", senderCity: "Oslo", senderCountry: "NO", senderPhone: "+4722334455" };
  expect((await saveCarrier(accountId, storeId, "postnord", { environment: "live", countries: ["NO"], fields: { customerNumber: "1111111111", apiKey: "pn-key-000001", applicationId: "1234", ...norway } })).ok).toBe(true);
  expect(
    (await saveCarrier(accountId, storeId, "dhl_paket", {
      environment: "live",
      countries: ["DE"],
      fields: { apiKey: "dhl-key-00001", apiSecret: "dhl-secret-01", username: "user-valid", password: "pw-0000000001", ekp: "3333333333", senderName: "Shop GmbH", senderStreet: "Sträßchensweg 10", senderPostalCode: "53113", senderCity: "Bonn", senderCountry: "DE", senderPhone: "+492281234", collectionHours: "09:00-17:00" },
    })).ok,
  ).toBe(true);
  expect((await saveCarrier(accountId, storeId, "nshift", { environment: "live", countries: ["NO"], fields: { apiKeyId: "kid", apiKey: "nshift-secret-01", senderQuickId: "1", checkoutId: "chk", defaultService: "P18", ...norway } })).ok).toBe(true);
  const none = { markup: { percent: 0, minor: 0 }, freeOverMinor: null, defaultWeightGrams: 1000 };
  expect(await saveCheckoutSettings(accountId, storeId, "postnord", { ...none, enabled: true, services: ["19", "17"], prices: { NO: { freeOverMinor: null, services: { "19": 4_900, "17": 6_900 } } } })).toEqual({ ok: true });
  expect(await saveCheckoutSettings(accountId, storeId, "nshift", { ...none, enabled: true, services: ["checkout"], prices: {} })).toEqual({ ok: true });
});

afterAll(async () => {
  await closeDb();
});

async function newCart(): Promise<string> {
  const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
  await db().execute(sql`insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) select ${storeId}::uuid, ${String(cart.id)}::uuid, id, 2 from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  return String(cart.id);
}

type Listed = { id: string; carrier: string; label: string; priceMinor: number; pickupPoints: { id: string }[] };

/** A paid order whose shopper chose the option `pick` finds (none: the flat rate), sent to `address`. */
async function paidOrder(pick?: (options: Listed[]) => { id: string; point?: string }, address: Record<string, unknown> = kari): Promise<string> {
  const cartId = await newCart();
  if (pick) {
    expect(await quoteDelivery({ storeId, market: no }, cartId, "0566")).toEqual({ ok: true });
    const chosen = pick((await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs)).options);
    expect(await chooseDelivery({ storeId, market: no }, cartId, chosen.id, chosen.point)).toEqual({ ok: true });
  }
  const result = await placeOrder({ storeId, market: no }, cartId);
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  await db().execute(sql`insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status) values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_${run}`}, ${totalMinor}, 'NOK', 'captured')`);
  await completeOrderPayment(orderId, `cs_${orderId}`);
  await db().execute(sql`update commerce.orders set email = 'kari@example.com', shipping_address = ${JSON.stringify(address)}::jsonb where id = ${orderId}::uuid`);
  return orderId;
}

describe("PostNord's booking and labels (D458)", () => {
  it("books MyPack Collect (19) to the shopper's service point at the store's price, and prints the label kept from the answer", async () => {
    const orderId = await paidOrder((options) => {
      const collect = options.find((o) => o.carrier === "postnord" && o.label.includes("Collect"))!;
      expect(collect.priceMinor).toBe(4_900);
      return { id: collect.id, point: collect.pickupPoints[0].id };
    });
    const booked = await bookCarrierDelivery(accountId, storeId, orderId, "postnord", { parcel });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "PostNord", carrierId: "postnord", hasLabel: true });
    const sent = carriers.calls.filter((c) => c.url.includes("/rest/shipment/v3/edi/labels/pdf")).at(-1)!;
    expect(sent.url.startsWith("https://api2.postnord.com/")).toBe(true);
    expect(JSON.stringify(sent.body)).toContain('"basicServiceCode":"19"');
    const shipment = (await getOrderAdmin(storeId, orderId))!.shipments[0];
    expect(pdfText(await carrierLabel(storeId, orderId, shipment.id))).toBe("%PDF-1.4 postnord");
    expect(trackedCarrier({ carrierId: shipment.carrierId, carrier: shipment.carrier })).toBe("postnord");
  });

  it("books MyPack Home (17) on a flat-rate order with the service staff choose, and refuses Collect there", async () => {
    const plain = await paidOrder();
    expect(await bookCarrierDelivery(accountId, storeId, plain, "postnord", { parcel, serviceId: "19" })).toEqual({ ok: false, problem: expect.stringMatching(/needs the customer's pickup point/) });
    const booked = await bookCarrierDelivery(accountId, storeId, plain, "postnord", { parcel, serviceId: "17" });
    expect(booked.ok && !booked.test).toBe(true);
    expect(JSON.stringify(carriers.calls.filter((c) => c.url.includes("/edi/labels/pdf")).at(-1)!.body)).toContain('"basicServiceCode":"17"');
  });

  it("books a return label (24), keeps it with the return and prints it from the copy", async () => {
    await db().execute(sql`update commerce.shipping_carriers set checked_at = now(), check_ok = true where store_id = ${storeId}::uuid and carrier = 'postnord'`);
    const settings = await getReturnSettings(storeId);
    expect(await saveReturnSettings(storeId, { ...settings, whoPaysReturn: "shopper", returnAddress: { name: "Lager AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO" } }, accountId)).toMatchObject({ ok: true });
    expect(await saveExchangeLabelSettings(storeId, { exchanges: true, labelCarrier: "postnord", labelAuto: false }, accountId)).toMatchObject({ ok: true });
    // A Bring return service is never one of PostNord's.
    expect(await saveExchangeLabelSettings(storeId, { exchanges: true, labelCarrier: "postnord", labelService: "9300", labelAuto: false }, accountId)).toMatchObject({ ok: false });
    const orderId = await paidOrder();
    const [line] = await db().execute<Row>(sql`select id from commerce.order_lines where order_id = ${orderId}::uuid limit 1`);
    const [ret] = await db().execute<Row>(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${storeId}::uuid, ${orderId}::uuid, 'return', 'approved') returning id`);
    await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values (${storeId}::uuid, ${String(ret.id)}::uuid, ${String(line.id)}::uuid, 1, 'accept')`);
    const done = await bookReturnLabel(storeId, String(ret.id), { weightGrams: 900 });
    expect(done).toMatchObject({ ok: true, test: false });
    const [kept] = await db().execute<Row>(sql`select label_carrier_id, label_service from commerce.returns where id = ${String(ret.id)}::uuid`);
    expect(kept).toMatchObject({ label_carrier_id: "postnord", label_service: "24" });
    const fetched = await staffReturnLabel(storeId, String(ret.id));
    expect(fetched.ok && pdfText(fetched.pdf)).toBe("%PDF-1.4 postnord");
  });
});

describe("DHL Paket (D458)", () => {
  it("books a parcel from Germany on a flat-rate order, asks DHL to collect it, keeps the label, and cancels it when the parcel is undone", async () => {
    const orderId = await paidOrder(undefined, berlin);
    // Thursday 5 November 2026, 09:00 in Berlin: today's window from the next quarter hour.
    const booked = await bookCarrierDelivery(accountId, storeId, orderId, "dhl_paket", { parcel, serviceId: "paket", collect: { timeZone: "Europe/Berlin", now: new Date("2026-11-05T08:00:00Z") } });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "DHL Paket", carrierId: "dhl_paket", hasLabel: true });
    expect(booked.ok && booked.collection).toEqual({ booked: true, date: "2026-11-05", confirmation: "PU-123", problem: null });
    const shipment = (await getOrderAdmin(storeId, orderId))!.shipments[0];
    expect(shipment.trackingUrl).toMatch(/^https:\/\/www\.dhl\.de\//);
    expect(pdfText(await carrierLabel(storeId, orderId, shipment.id))).toBe("%PDF-1.4 dhl paket");
    expect(trackedCarrier({ carrierId: shipment.carrierId, carrier: shipment.carrier })).toBe("dhl_paket");
    // Undone: the booking is cancelled at DHL, and the label kept for it goes.
    const undone = await undoShipment(storeId, orderId, shipment.id, accountId, "Wrong parcel");
    expect(undone).toMatchObject({ ok: true, bookedWith: "DHL Paket" });
    expect(await cancelAtCarrier(storeId, orderId, shipment.id, accountId)).toEqual({ ok: true });
    expect(carriers.calls.filter((c) => c.method === "DELETE" && c.url.includes("/parcel/de/shipping/v2/orders")).at(-1)!.url).toContain(`shipment=${shipment.trackingNumber}`);
    const [left] = await db().execute<Row>(sql`select count(*)::int as n from commerce.carrier_labels where store_id = ${storeId}::uuid and shipment_id = ${shipment.id}::uuid`);
    expect(left.n).toBe(0);
  });
});

describe("nShift (D458)", () => {
  it("offers the store's own nShift checkout at its prices with VAT, each option with its own pickup points, named by the carrier that delivers", async () => {
    const cartId = await newCart();
    expect(await quoteDelivery({ storeId, market: no }, cartId, "0566")).toEqual({ ok: true });
    const listed = (await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs)).options.filter((o) => o.carrier === "nshift");
    expect(listed.map((o) => [o.label, o.priceMinor, o.pickupPoints.map((p) => p.id)])).toEqual([
      ["PostNord MyPack Collect", 4_900, ["74383"]],
      ["PostNord Parcel", 7_900, []],
    ]);
  });

  it("books the shopper's option with its pickup point, prints the label made again, and cancels it when the parcel is undone", async () => {
    const orderId = await paidOrder((options) => {
      const collect = options.find((o) => o.carrier === "nshift" && o.label.includes("Collect"))!;
      return { id: collect.id, point: collect.pickupPoints[0].id };
    });
    const booked = await bookCarrierDelivery(accountId, storeId, orderId, "nshift", { parcel });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "nShift", carrierId: "nshift", hasLabel: true });
    const sent = carriers.calls.filter((c) => c.url.endsWith("/rs-extapi/v1/shipments")).at(-1)!;
    expect(JSON.stringify(sent.body)).toContain('"P19"');
    expect(JSON.stringify(sent.body)).toContain('"74383"');
    const shipment = (await getOrderAdmin(storeId, orderId))!.shipments[0];
    expect(pdfText(await carrierLabel(storeId, orderId, shipment.id))).toBe("%PDF-1.4 nshift");
    expect(await undoShipment(storeId, orderId, shipment.id, accountId, null)).toMatchObject({ ok: true });
    expect(await cancelAtCarrier(storeId, orderId, shipment.id, accountId)).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select consignment_number from commerce.shipments where id = ${shipment.id}::uuid`);
    expect(carriers.calls.filter((c) => c.method === "DELETE").at(-1)!.url).toBe(`https://api.unifaun.com/rs-extapi/v1/shipments/${String(row.consignment_number)}`);
  });

  it("books a flat-rate order with the service set on nShift's page, and only that one", async () => {
    const plain = await paidOrder();
    expect(await bookCarrierDelivery(accountId, storeId, plain, "nshift", { parcel, serviceId: "P19" })).toEqual({ ok: false, problem: "Choose the nShift service to book." });
    const booked = await bookCarrierDelivery(accountId, storeId, plain, "nshift", { parcel, serviceId: "P18" });
    expect(booked.ok && !booked.test).toBe(true);
    expect(JSON.stringify(carriers.calls.filter((c) => c.url.endsWith("/rs-extapi/v1/shipments")).at(-1)!.body)).toContain('"P18"');
  });
});
