import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

type Row = Record<string, unknown>;

/** A stand-in for Bring that answers as its documentation says and records what it is asked. */
const bring = vi.hoisted(() => {
  const calls: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  const state = { bookingError: false };
  const guide = {
    consignments: [
      {
        products: [
          { id: "5600", guiInformation: { displayName: "Pakke levert hjem" }, price: { listPrice: { currencyCode: "NOK", priceWithoutAdditionalServices: { amountWithoutVAT: "99.00" } } }, expectedDelivery: { workingDays: "2" } },
          { id: "5800", guiInformation: { displayName: "Pakke til hentested" }, price: { listPrice: { currencyCode: "NOK", priceWithoutAdditionalServices: { amountWithoutVAT: "79.00" } } } },
        ],
      },
    ],
  };
  const fetcher = async (url: string, init: RequestInit) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), headers, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (String(url).includes("/pickuppoint/")) return json({ pickupPoint: [{ id: "PP1", name: "Kiwi Sentrum", address: "Storgata 9", postalCode: "0155", city: "OSLO", countryCode: "NO", distance: "0.3" }] });
    if (String(url).includes("/shippingguide/")) return json(guide);
    if (String(url).includes("/booking/api/create")) {
      if (state.bookingError) return json({ consignments: [{ errors: [{ code: "1", messages: [{ message: "Unknown customer number" }] }] }] });
      return json({ consignments: [{ confirmation: { consignmentNumber: "C-100" }, packages: [{ packageNumber: "P-100" }], links: { labels: "https://api.bring.com/labels/C-100", tracking: "https://tracking.bring.com/P-100" }, errors: [] }] });
    }
    if (String(url).includes("/tracking/")) return json({ consignmentSet: [{ packageSet: [{ eventSet: [{ status: "IN_TRANSIT", description: "On its way", displayDate: "01.10.2026", displayTime: "09:00", city: "OSLO" }] }] }] });
    if (String(url).includes("/labels/")) return new Response("%PDF-1.4 label", { status: 200 });
    return json({}, 404);
  };
  return { calls, state, fetcher };
});

vi.mock("./carriers", async () => {
  const { createBringAdapter } = await import("./carriers/bring");
  return { adapterFor: (id: string) => (id === "bring" ? createBringAdapter(bring.fetcher as unknown as typeof fetch) : null) };
});
vi.mock("./carriers/bring", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/bring")>();
  return { ...original, fetchBringLabel: (context: never, url: string) => original.fetchBringLabel(context, url, bring.fetcher as unknown as typeof fetch) };
});
vi.mock("./stripe", () => ({ platformStripe: () => null, WEBHOOK_EVENTS: [] }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { getOrderAdmin } = await import("./order-admin");
const { saveCarrier } = await import("./shipping-carriers");
const { bringBook, bringLabel, bringOptionsFor, bringTracking, checkBring, estimateWeightGrams } = await import("./bring-shipping");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;

const details = { customerNumber: "12345", apiUid: "me@shop.no", apiKey: "secret-key-0001", senderName: "Shop AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo" };
const setUp = (environment: string) =>
  saveCarrier(accountId, storeId, "bring", { environment, countries: ["NO"], fields: details });

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`bring-${run}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`bring-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`bring-${run}`}, 'Test', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)`);
  await db().execute(sql`update commerce.product_variants set weight_grams = 400 where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
});

afterAll(async () => {
  await closeDb();
});

async function paidOrder(address: Record<string, unknown> = { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" }): Promise<string> {
  const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
  await db().execute(sql`insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) select ${storeId}::uuid, ${String(cart.id)}::uuid, id, 2 from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  const result = await placeOrder({ storeId, market: no }, String(cart.id));
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  await db().execute(sql`insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status) values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_${run}`}, ${totalMinor}, 'NOK', 'captured')`);
  await completeOrderPayment(orderId, `cs_${orderId}`);
  await db().execute(sql`update commerce.orders set email = 'kari@example.com', shipping_address = ${JSON.stringify(address)}::jsonb where id = ${orderId}::uuid`);
  return orderId;
}

const parcel = { weightGrams: 800 };

describe("shipping an order with Posten / Bring", () => {
  it("guesses the parcel's weight from its products", async () => {
    const orderId = await paidOrder();
    expect(await estimateWeightGrams(storeId, orderId)).toBe(800);
  });

  it("refuses until the agreement is saved, then checks it and keeps the answer", async () => {
    const orderId = await paidOrder();
    expect(await bringOptionsFor(storeId, orderId, parcel)).toEqual({ ok: false, problem: "Posten / Bring is not set up: save your agreement details first." });
    expect((await setUp("test")).ok).toBe(true);
    expect(await checkBring(accountId, storeId)).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select check_ok, checked_at from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = 'bring'`);
    expect(row.check_ok).toBe(true);
    expect(row.checked_at).not.toBeNull();
    // Saving the details again asks for a new check.
    await setUp("test");
    const [again] = await db().execute<Row>(sql`select check_ok from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = 'bring'`);
    expect(again.check_ok).toBeNull();
  });

  it("offers Bring's services for the order's recipient, with pickup points for the one that needs one", async () => {
    const orderId = await paidOrder();
    const answer = await bringOptionsFor(storeId, orderId, parcel);
    expect(answer).toMatchObject({ ok: true, test: true });
    if (!answer.ok) return;
    expect(answer.options.map((o) => [o.serviceId, o.priceMinor])).toEqual([["5600", 9900], ["5800", 7900]]);
    expect(answer.pickupPoints.map((p) => p.id)).toEqual(["PP1"]);
    const asked = bring.calls.filter((c) => c.url.includes("/shippingguide/")).at(-1)!;
    expect(asked.headers["X-Mybring-API-Key"]).toBe("secret-key-0001");
    expect(asked.body).toMatchObject({ consignments: [{ fromPostalCode: "0150", toPostalCode: "0155", toCountryCode: "NO" }] });
  });

  it("refuses an incomplete address, another country and a weight that is not one", async () => {
    const incomplete = await paidOrder({ name: "Kari", line1: "", postalCode: "0155", city: "Oslo", country: "NO" });
    expect(await bringOptionsFor(storeId, incomplete, parcel)).toMatchObject({ ok: false, problem: expect.stringMatching(/address is not complete/) });
    const sweden = await paidOrder({ name: "Kari", line1: "Gatan 1", postalCode: "11122", city: "Stockholm", country: "SE" });
    expect(await bringOptionsFor(storeId, sweden, parcel)).toMatchObject({ ok: false, problem: expect.stringMatching(/to Norway/) });
    expect(await bringOptionsFor(storeId, incomplete, { weightGrams: 0 })).toMatchObject({ ok: false });
  });

  it("books a test shipment without marking the order as sent", async () => {
    const orderId = await paidOrder();
    const booked = await bringBook(accountId, storeId, orderId, { serviceId: "5600", parcel });
    expect(booked).toEqual({ ok: true, test: true, trackingNumber: "P-100" });
    const order = await getOrderAdmin(storeId, orderId);
    expect(order?.status).toBe("paid");
    expect(order?.shipments).toEqual([]);
    expect(bring.calls.filter((c) => c.url.includes("/booking/")).at(-1)!.headers["X-Bring-Test-Indicator"]).toBe("true");
  });

  it("books a real shipment, marks the order as sent with its tracking, and keeps the label", async () => {
    await setUp("live");
    const orderId = await paidOrder();
    const booked = await bringBook(accountId, storeId, orderId, { serviceId: "5800", pickupPointId: "PP1", parcel });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "Bring", trackingNumber: "P-100", trackingUrl: "https://tracking.bring.com/P-100", carrierId: "bring", hasLabel: true });
    const sent = bring.calls.filter((c) => c.url.includes("/booking/")).at(-1)!;
    expect(sent.headers["X-Bring-Test-Indicator"]).toBe("false");
    expect(sent.body).toMatchObject({ consignments: [{ product: { id: "5800", customerNumber: "12345" }, parties: { pickupPoint: { id: "PP1", countryCode: "NO" }, recipient: { name: "Kari Nordmann", contact: { email: "kari@example.com" } } } }] });
    const order = await getOrderAdmin(storeId, orderId);
    expect(order?.status).toBe("fulfilled");
    const shipmentId = order!.shipments[0].id;
    expect(new TextDecoder().decode((await bringLabel(storeId, orderId, shipmentId))!)).toBe("%PDF-1.4 label");
    expect((await bringTracking(storeId, "P-100"))[0]).toMatchObject({ status: "IN_TRANSIT" });
  });

  it("does not book the same order twice in quick succession", async () => {
    const orderId = await paidOrder();
    expect((await bringBook(accountId, storeId, orderId, { serviceId: "5600", parcel })).ok).toBe(true);
    const again = await bringBook(accountId, storeId, orderId, { serviceId: "5600", parcel });
    expect(again).toEqual({ ok: false, problem: "This order was just booked with Bring. Reload the page to see it." });
  });

  it("shows what Bring objected to and changes nothing", async () => {
    const orderId = await paidOrder();
    bring.state.bookingError = true;
    const booked = await bringBook(accountId, storeId, orderId, { serviceId: "5600", parcel });
    bring.state.bookingError = false;
    expect(booked).toEqual({ ok: false, problem: "Unknown customer number" });
    expect((await getOrderAdmin(storeId, orderId))?.status).toBe("paid");
  });

  it("only gives a label to the store's own shipments of Bring", async () => {
    const orderId = await paidOrder();
    const other = await db().execute<Row>(sql`insert into commerce.shipments (store_id, order_id, carrier, tracking_number) values (${storeId}::uuid, ${orderId}::uuid, 'DHL', '1') returning id`);
    expect(await bringLabel(storeId, orderId, String(other[0].id))).toBeNull();
  });
});
