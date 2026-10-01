import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

type Row = Record<string, unknown>;

/** A stand-in for Porterbuddy that answers as its API reference says and records what it is asked. */
const porter = vi.hoisted(() => {
  const calls: { url: string; method: string; headers: Record<string, string>; body: Record<string, unknown> | null }[] = [];
  const state = { windowGone: false, orderError: false, down: false };
  const at = (days: number, hour: number) => {
    const d = new Date(Date.now() + days * 86_400_000);
    d.setUTCHours(hour, 0, 0, 0);
    return d.toISOString();
  };
  const windows = () => [
    { product: "delivery", start: at(2, 16), end: at(2, 18), price: { fractionalDenomination: 14900, currency: "NOK" }, expiresAt: at(1, 12), token: `tok-a-${calls.length}` },
    { product: "delivery", start: at(2, 18), end: at(2, 20), price: { fractionalDenomination: 14900, currency: "NOK" }, displayPrice: { fractionalDenomination: 19900, currency: "NOK" }, expiresAt: at(1, 12), token: `tok-b-${calls.length}` },
    { product: "large", start: at(3, 16), end: at(3, 18), price: { fractionalDenomination: 29900, currency: "NOK" }, expiresAt: at(2, 12), token: `tok-c-${calls.length}` },
  ];
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", headers, body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (state.down) return json({}, 503);
    if (String(url).endsWith("/availability")) {
      return json({ deliveryWindows: state.windowGone ? windows().slice(1) : windows() });
    }
    if (String(url).endsWith("/order") && init.method === "POST") {
      if (state.orderError) return json({}, 422);
      return json({ orderId: `PB-${calls.length}`, pickupTime: at(1, 14), _links: { labelInfo: { href: "https://api.porterbuddy.com/order/PB/label" }, userInformation: { href: "https://tracking.porterbuddy.com/abc" } } });
    }
    if (String(url).endsWith("/order/PB/label")) return json({ shipmentLabelUrl: "https://api.porterbuddy.com/order/PB/label/tok" });
    if (String(url).endsWith("/label/tok")) return new Response("%PDF-1.4 pb", { status: 200 });
    if (String(url).endsWith("/status")) return json({ orderId: "PB", orderStatus: "ready", statusUpdatedAt: at(0, 10) });
    return json({}, 404);
  };
  return { calls, state, fetcher };
});

vi.mock("./carriers", async () => {
  const { createPorterbuddyAdapter } = await import("./carriers/porterbuddy");
  const fetcher = porter.fetcher as unknown as typeof fetch;
  return { adapterFor: (id: string) => (id === "porterbuddy" ? createPorterbuddyAdapter(fetcher) : null) };
});
vi.mock("./carriers/porterbuddy", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/porterbuddy")>();
  return {
    ...original,
    createPorterbuddyAdapter: (fetcher?: typeof fetch) => original.createPorterbuddyAdapter(fetcher ?? (porter.fetcher as unknown as typeof fetch)),
    fetchPorterbuddyLabel: (context: never, url: string) => original.fetchPorterbuddyLabel(context, url, porter.fetcher as unknown as typeof fetch),
  };
});
vi.mock("./stripe", () => ({ platformStripe: () => null, WEBHOOK_EVENTS: [] }));

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { getOrderAdmin } = await import("./order-admin");
const { saveCarrier } = await import("./shipping-carriers");
const { chooseDelivery, chosenDelivery, deliveryOptionsFor, quoteDelivery, saveCheckoutSettings } = await import("./delivery-options");
const { porterbuddyBook } = await import("./porterbuddy-shipping");
const { carrierLabel } = await import("./carrier-label");
const { carrierTracking, trackedCarrier } = await import("./carrier-tracking");
const { checkCarrier } = await import("./bring-shipping");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;

const details = { senderName: "Shop AS", senderStreet: "Keysers gate 3", senderPostalCode: "0165", senderCity: "Oslo", senderEmail: "shop@example.com", senderPhone: "12345678", pickupHours: "08:00-23:00", pickupDays: "1-7" };
const setUp = (environment: string) => saveCarrier(accountId, storeId, "porterbuddy", { environment, countries: ["NO"], fields: { apiKey: "pb-key-0001", ...details } });
const settings = { enabled: true, services: ["delivery", "large"], markup: { percent: 10, minor: 0 }, freeOverMinor: null, defaultWeightGrams: 1000, prices: {} };
const flat = { label: "Frakt", rate: { amountMinor: 9900, freeOverMinor: null } };
const priceAs = (rate: { amountMinor: number }) => rate.amountMinor;
const parcel = { weightGrams: 800 };

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`pb-${run}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`pb-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`pb-${run}`}, 'Test', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)`);
  await db().execute(sql`update commerce.product_variants set weight_grams = 400 where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  expect((await setUp("test")).ok).toBe(true);
  expect(await saveCheckoutSettings(accountId, storeId, "porterbuddy", settings)).toEqual({ ok: true });
});

afterAll(async () => {
  await closeDb();
});

async function newCart(): Promise<string> {
  const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
  await db().execute(sql`insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) select ${storeId}::uuid, ${String(cart.id)}::uuid, id, 2 from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  return String(cart.id);
}

/** A paid order whose shopper chose the delivery window with this id (the first Porterbuddy window when none is given). */
async function paidOrder(address: Record<string, unknown> = { name: "Kari Nordmann", line1: "Høyenhallveien 25", postalCode: "0678", city: "Oslo", country: "NO", phone: "+47 65789832" }): Promise<string> {
  const cartId = await newCart();
  expect(await quoteDelivery({ storeId, market: no }, cartId, "0678")).toEqual({ ok: true });
  const listed = await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs);
  const option = listed.options.find((o) => o.window)!;
  expect(await chooseDelivery({ storeId, market: no }, cartId, option.id)).toEqual({ ok: true });
  const result = await placeOrder({ storeId, market: no }, cartId);
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  await db().execute(sql`insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status) values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_${run}`}, ${totalMinor}, 'NOK', 'captured')`);
  await completeOrderPayment(orderId, `cs_${orderId}`);
  await db().execute(sql`update commerce.orders set email = 'kari@example.com', shipping_address = ${JSON.stringify(address)}::jsonb where id = ${orderId}::uuid`);
  return orderId;
}

describe("Porterbuddy's delivery windows at checkout (D137)", () => {
  it("are offered by date, each with its price: VAT and the markup on Porterbuddy's price, the shopper's price as it is", async () => {
    const cartId = await newCart();
    expect(await quoteDelivery({ storeId, market: no }, cartId, "0678")).toEqual({ ok: true });
    const asked = porter.calls.filter((c) => c.url.endsWith("/availability")).at(-1)!;
    // The parcel, the products the store offers, where it is collected and to which postal code.
    expect(asked.body).toMatchObject({ products: ["delivery", "large"], parcels: [{ weightGrams: 800 }], destinationAddress: { postalCode: "0678", country: "Norway" }, originAddress: { streetName: "Keysers gate", streetNumber: "3" } });
    expect(asked.headers["x-api-key"]).toBe("pb-key-0001");
    const listed = await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs);
    expect(listed.options.map((o) => o.label)).toEqual(["Frakt", "Porterbuddy delivery", "Porterbuddy delivery", "Porterbuddy large delivery"]);
    // 149 kr + 25 % VAT = 186.25, + 10 % = 204.88 (205); the price made for shoppers, 199 kr, + 10 % = 218.90; the large one, 299 kr + VAT + 10 % = 411.13.
    expect(listed.options.slice(1).map((o) => o.priceMinor)).toEqual([20488, 21890, 41113]);
    expect(listed.options.slice(1).every((o) => o.window !== null && o.carrier === "porterbuddy")).toBe(true);
    // Earliest first.
    expect(listed.options[1].window!.start < listed.options[2].window!.start).toBe(true);
  });

  it("are the cart's shipping once chosen, and the order keeps the window", async () => {
    const orderId = await paidOrder();
    const order = await getOrderAdmin(storeId, orderId);
    expect(order?.delivery).toMatchObject({ carrier: "porterbuddy", serviceId: "delivery", label: "Porterbuddy delivery", postalCode: "0678", window: { start: expect.any(String), end: expect.any(String) } });
    expect(order?.shippingMinor).toBe(20488);
  });

  it("run out with Porterbuddy's hold on them, and the cart ships at the flat rate again", async () => {
    const cartId = await newCart();
    await quoteDelivery({ storeId, market: no }, cartId, "0678");
    const option = (await deliveryOptionsFor({ storeId, market: no }, cartId, flat, priceAs)).options.find((o) => o.window)!;
    await chooseDelivery({ storeId, market: no }, cartId, option.id);
    expect(await chosenDelivery(db(), storeId, cartId, no)).not.toBeNull();
    await db().execute(sql`update commerce.delivery_quotes set expires_at = now() - interval '1 second' where id = ${option.id}::uuid`);
    expect(await chosenDelivery(db(), storeId, cartId, no)).toBeNull();
  });

  it("are left out, not the whole checkout, when Porterbuddy does not answer", async () => {
    const cartId = await newCart();
    porter.state.down = true;
    expect(await quoteDelivery({ storeId, market: no }, cartId, "0678")).toEqual({ ok: false, problem: "unavailable" });
    porter.state.down = false;
  });
});

describe("shipping an order with Porterbuddy", () => {
  it("checks the key and keeps the answer", async () => {
    expect(await checkCarrier(accountId, storeId, "porterbuddy")).toEqual({ ok: true });
    const [row] = await db().execute<Row>(sql`select check_ok from commerce.shipping_carriers where store_id = ${storeId}::uuid and carrier = 'porterbuddy'`);
    expect(row.check_ok).toBe(true);
  });

  it("books a test order for the window the customer chose, with a fresh token, and does not mark the order as sent", async () => {
    await setUp("test");
    await saveCheckoutSettings(accountId, storeId, "porterbuddy", settings);
    const orderId = await paidOrder();
    const booked = await porterbuddyBook(accountId, storeId, orderId, { parcel });
    expect(booked).toMatchObject({ ok: true, test: true, trackingNumber: expect.stringMatching(/^PB-/) });
    const order = await getOrderAdmin(storeId, orderId);
    expect(order?.status).toBe("paid");
    expect(order?.shipments).toEqual([]);
    const sent = porter.calls.filter((c) => c.url === "https://api.porterbuddy-test.com/order").at(-1)!;
    expect(sent.headers["Idempotency-Key"]).toMatch(/^[A-Z0-9-]+$/);
    expect(sent.body).toMatchObject({
      product: "delivery",
      origin: { name: "Shop AS", address: { streetName: "Keysers gate", streetNumber: "3" } },
      destination: { name: "Kari Nordmann", email: "kari@example.com", phoneCountryCode: "+47", phoneNumber: "65789832", address: { streetName: "Høyenhallveien", streetNumber: "25", country: "Norway" } },
    });
    // The token is the one from the availability asked for just before, not the one the shopper was shown.
    expect((sent.body as { destination: { deliveryWindow: { token: string } } }).destination.deliveryWindow.token).toMatch(/^tok-/);
    const lastAvailability = porter.calls.filter((c) => c.url.endsWith("/availability")).at(-1)!;
    expect(porter.calls.indexOf(lastAvailability)).toBeLessThan(porter.calls.indexOf(sent));
  });

  it("books a real order, marks the order as sent with its number and tracking page, and prints the label", async () => {
    await setUp("live");
    await saveCheckoutSettings(accountId, storeId, "porterbuddy", settings);
    const orderId = await paidOrder();
    const booked = await porterbuddyBook(accountId, storeId, orderId, { parcel });
    expect(booked.ok && !booked.test && booked.shipment).toMatchObject({ carrier: "Porterbuddy", trackingUrl: "https://tracking.porterbuddy.com/abc", carrierId: "porterbuddy", hasLabel: true });
    expect(porter.calls.filter((c) => c.method === "POST" && c.url.endsWith("/order")).at(-1)!.url).toBe("https://api.porterbuddy.com/order");
    const order = await getOrderAdmin(storeId, orderId);
    expect(order?.status).toBe("fulfilled");
    const shipment = order!.shipments[0];
    expect(new TextDecoder().decode((await carrierLabel(storeId, orderId, shipment.id))!)).toBe("%PDF-1.4 pb");
    expect(trackedCarrier({ carrierId: shipment.carrierId, carrier: shipment.carrier })).toBe("porterbuddy");
    expect((await carrierTracking(storeId, "porterbuddy", "PB"))[0]).toMatchObject({ status: "ready" });
  });

  it("books nothing when Porterbuddy no longer offers the window, and says so", async () => {
    const orderId = await paidOrder();
    // The window the customer chose is the first one; Porterbuddy has taken it away.
    porter.state.windowGone = true;
    const booked = await porterbuddyBook(accountId, storeId, orderId, { parcel });
    porter.state.windowGone = false;
    expect(booked).toMatchObject({ ok: false, problem: expect.stringMatching(/no longer offers the delivery window/) });
    expect((await getOrderAdmin(storeId, orderId))?.status).toBe("paid");
  });

  it("does not book the same order twice in quick succession", async () => {
    const orderId = await paidOrder();
    expect((await porterbuddyBook(accountId, storeId, orderId, { parcel })).ok).toBe(true);
    expect(await porterbuddyBook(accountId, storeId, orderId, { parcel })).toEqual({ ok: false, problem: "This order was just booked with Porterbuddy. Reload the page to see it." });
  });

  it("refuses an order the customer did not choose Porterbuddy for, an incomplete address and a bad weight", async () => {
    const plain = await paidOrder();
    await db().execute(sql`update commerce.orders set delivery = null where id = ${plain}::uuid`);
    expect(await porterbuddyBook(accountId, storeId, plain, { parcel })).toEqual({ ok: false, problem: "The customer did not choose a Porterbuddy delivery." });
    const noStreetNumber = await paidOrder({ name: "Kari", line1: "Kirkeveien", postalCode: "0678", city: "Oslo", country: "NO", phone: "65789832" });
    expect(await porterbuddyBook(accountId, storeId, noStreetNumber, { parcel })).toMatchObject({ ok: false, problem: expect.stringMatching(/street name and number/) });
    expect(await porterbuddyBook(accountId, storeId, noStreetNumber, { parcel: { weightGrams: 0 } })).toMatchObject({ ok: false });
  });

  it("shows what Porterbuddy objected to and changes nothing", async () => {
    const orderId = await paidOrder();
    porter.state.orderError = true;
    const booked = await porterbuddyBook(accountId, storeId, orderId, { parcel });
    porter.state.orderError = false;
    expect(booked).toMatchObject({ ok: false, problem: expect.stringMatching(/could not use the request/) });
    expect((await getOrderAdmin(storeId, orderId))?.status).toBe("paid");
  });
});
