import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => null, platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

type Row = Record<string, unknown>;

/** Stand-ins for Bring and Helthjem that answer as their documentation says and record what they are asked (as in their own tests). */
const carriers = vi.hoisted(() => {
  const calls: { url: string; method: string; body: Record<string, unknown> | null }[] = [];
  let next = 100;
  const fetcher = async (url: string, init: RequestInit = {}) => {
    const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    calls.push({ url: String(url), method: init.method ?? "GET", body });
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
    if (String(url).includes("/booking/api/create")) {
      if (JSON.stringify(body).includes("Refuse Me")) return json({ consignments: [{ errors: [{ code: "1", messages: [{ message: "The recipient's postal code does not exist" }] }] }] });
      next += 1;
      return json({ consignments: [{ confirmation: { consignmentNumber: `C-${next}` }, packages: [{ packageNumber: `P-${next}` }], links: { labels: `https://api.bring.com/labels/C-${next}`, tracking: `https://tracking.bring.com/P-${next}` }, errors: [] }] });
    }
    if (String(url).includes("/labels/")) return new Response(`%PDF-1.4 ${String(url).split("/").at(-1)}`, { status: 200 });
    if (String(url).endsWith("/auth/oauth2/v1/token")) return json({ token: "TOK", expires_in: 3600, token_type: "Bearer" });
    if (String(url).includes("/addresses/find/single")) return json({ productName: "HELTHJEM" });
    if (String(url).endsWith("/parcels/v1/bookings")) {
      next += 1;
      return json({ orderId: 1, shipmentId: `(401)7072${next}`, freightProductId: 1 });
    }
    return json({}, 404);
  };
  return { calls, fetcher };
});

vi.mock("./carriers", async () => {
  const { createBringAdapter } = await import("./carriers/bring");
  const { createHelthjemAdapter } = await import("./carriers/helthjem");
  const fetcher = carriers.fetcher as unknown as typeof fetch;
  return { adapterFor: (id: string) => (id === "bring" ? createBringAdapter(fetcher) : id === "helthjem" ? createHelthjemAdapter(fetcher) : null) };
});
vi.mock("./carriers/bring", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/bring")>();
  return { ...original, fetchBringLabel: (context: never, url: string) => original.fetchBringLabel(context, url, carriers.fetcher as unknown as typeof fetch) };
});
vi.mock("./carriers/helthjem", async (importOriginal) => {
  const original = await importOriginal<typeof import("./carriers/helthjem")>();
  return {
    ...original,
    createHelthjemAdapter: (fetcher?: typeof fetch) => original.createHelthjemAdapter(fetcher ?? (carriers.fetcher as unknown as typeof fetch)),
    fetchHelthjemLabel: (context: never, url: string) => original.fetchHelthjemLabel(context, url, carriers.fetcher as unknown as typeof fetch),
  };
});

const { placeOrder, completeOrderPayment } = await import("./checkout");
const { getOrderAdmin, markSent } = await import("./order-admin");
const { saveCarrier } = await import("./shipping-carriers");
const { runBulk } = await import("./order-bulk");
const { staffActor } = await import("./order-actor");
const { labelsToPrint } = await import("./bulk-labels");
const { carrierLabel } = await import("./carrier-label");

/**
 * *Book labels* on the Orders list (wave 10 unit K, D374) against a real database with faked carriers: each order's remaining units booked with its
 * carrier through the order page's own booking functions, one order after another; each refusal named by order number with its reason (the carrier's
 * own sentence for a refusal of its own); the labels booked handed back to print together, each fetched from the carrier when printed; the carrier's
 * test environment respected; one audit entry with counts.
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let accountId: string;

const bringFields = { customerNumber: "12345", apiUid: "me@shop.no", apiKey: "secret-key-0001", senderName: "Shop AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo" };
const helthjemFields = { clientId: "cid", clientSecret: "shh-secret-01", shopId: "16", homeSolutionId: "114", collectSolutionId: "86", senderName: "Shop AS", senderStreet: "Akersgata 55", senderPostalCode: "0180", senderCity: "Oslo", senderPhone: "22334455" };
const address = { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO", phone: "53582094" };

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`insert into commerce.accounts (email, name) values (${`labels-${run}@example.com`}, 'Owner') returning id`);
  accountId = String(account.id);
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`labels-${run}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`labels-${run}`}, 'Test', null) as id`);
  storeId = String(store.id);
  await db().execute(sql`update commerce.stores set status = 'active' where id = ${storeId}::uuid and status <> 'active'`);
  await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.product_variants set weight_grams = 400 where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  await db().execute(sql`update commerce.product_variants set weight_grams = null where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-BLACK'`);
  expect((await saveCarrier(accountId, storeId, "bring", { environment: "live", countries: ["NO"], fields: bringFields })).ok).toBe(true);
  expect((await saveCarrier(accountId, storeId, "helthjem", { environment: "live", countries: ["NO"], fields: helthjemFields })).ok).toBe(true);
});

afterAll(async () => {
  await closeDb();
});

/** An order of two totes (and what `also` names), paid unless `unpaid`, to `to`, with the customer's delivery choice `delivery` (set before it is paid, D237). */
async function order(options: { also?: string; unpaid?: boolean; to?: Record<string, unknown>; delivery?: Record<string, unknown> } = {}): Promise<{ id: string; number: string }> {
  const [cart] = await db().execute<Row>(sql`insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id`);
  await db().execute(sql`insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) select ${storeId}::uuid, ${String(cart.id)}::uuid, id, 2 from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-TOTE'`);
  if (options.also) await db().execute(sql`insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity) select ${storeId}::uuid, ${String(cart.id)}::uuid, id, 1 from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${options.also}`);
  const result = await placeOrder({ storeId, market: no }, String(cart.id));
  if (!result.ok) throw new Error(result.problem);
  const { orderId, totalMinor } = result.order;
  if (options.delivery) await db().execute(sql`update commerce.orders set delivery = ${JSON.stringify(options.delivery)}::jsonb where id = ${orderId}::uuid`);
  if (!options.unpaid) {
    await db().execute(sql`insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status) values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_${orderId}`}, ${`acct_${run}`}, ${totalMinor}, 'NOK', 'captured')`);
    await completeOrderPayment(orderId, `cs_${orderId}`);
  }
  await db().execute(sql`update commerce.orders set email = 'kari@example.com', shipping_address = ${JSON.stringify(options.to ?? address)}::jsonb where id = ${orderId}::uuid`);
  const [row] = await db().execute<Row>(sql`select number from commerce.orders where id = ${orderId}::uuid`);
  return { id: orderId, number: String(row.number) };
}

const bookings = () => carriers.calls.filter((c) => c.method === "POST" && (c.url.includes("/booking/api/create") || c.url.endsWith("/parcels/v1/bookings")));

describe("Book labels on the Orders list (D374)", () => {
  it("books each order's remaining units with its carrier, one at a time, names every refusal and hands back the labels to print", async () => {
    const plain = await order();
    const partly = await order();
    const helthjem = await order({ delivery: { carrier: "helthjem", serviceId: "home", label: "Helthjem home delivery", postalCode: "0155", pickupPoint: null, window: null } });
    const postnord = await order({ delivery: { carrier: "postnord", serviceId: "19", label: "PostNord", postalCode: "0155", pickupPoint: null, window: null } });
    const unweighed = await order({ also: "DEMO-MUG-BLACK" });
    const refused = await order({ to: { ...address, name: "Refuse Me" } });
    const unpaid = await order({ unpaid: true });
    // One tote of `partly` went earlier in a parcel of its own: the label is for the one left.
    const tote = (await getOrderAdmin(storeId, partly.id))!.fulfilment.lines.find((l) => l.sku === "DEMO-TOTE")!;
    expect((await markSent(storeId, partly.id, { carrier: "other", trackingNumber: "", trackingUrl: null }, accountId, null, { lines: [{ lineId: tote.lineId, quantity: 1 }] })).ok).toBe(true);
    const start = bookings().length;

    const outcome = await runBulk(storeId, staffActor(accountId), {
      action: "book_labels",
      selection: { kind: "ids", ids: [plain.id, partly.id, helthjem.id, postnord.id, unweighed.id, refused.id, unpaid.id] },
    });
    if (!outcome.ok) throw new Error(outcome.problem);
    const { result } = outcome;
    expect(result).toMatchObject({ action: "book_labels", requested: 7, applied: 3, emailed: 0 });
    expect(result.refused).toEqual([
      { id: postnord.id, number: postnord.number, reason: "carrier_cannot_book" },
      { id: unweighed.id, number: unweighed.number, reason: "no_weight" },
      { id: refused.id, number: refused.number, reason: "carrier_refused", detail: "The recipient's postal code does not exist" },
      { id: unpaid.id, number: unpaid.number, reason: "unpaid" },
    ]);
    // One booking per order that could be booked (and the one Bring refused), in the order chosen.
    expect(bookings().length - start).toBe(4);

    // The flat-rate order went with Bring's home parcel, at the weight of its two totes.
    const plainAfter = (await getOrderAdmin(storeId, plain.id))!;
    expect(plainAfter.status).toBe("fulfilled");
    expect(plainAfter.shipments[0]).toMatchObject({ carrierId: "bring", hasLabel: true });
    const toBring = bookings().slice(start).filter((c) => c.url.includes("/booking/"));
    expect(toBring[0].body).toMatchObject({ consignments: [{ product: { id: "5600" }, packages: [{ weightInKg: 0.8 }] }] });
    // The partly sent order's parcel names only the unit that was left, at its weight.
    const partlyAfter = (await getOrderAdmin(storeId, partly.id))!;
    expect(partlyAfter.status).toBe("fulfilled");
    const booked = partlyAfter.shipments.find((s) => s.carrierId === "bring")!;
    expect(booked.lines.map((l) => [l.lineId, l.quantity])).toEqual([[tote.lineId, 1]]);
    expect(toBring[1].body).toMatchObject({ consignments: [{ packages: [{ weightInKg: 0.4 }] }] });
    // The customer who chose Helthjem got Helthjem.
    expect((await getOrderAdmin(storeId, helthjem.id))!.shipments[0]).toMatchObject({ carrierId: "helthjem" });
    // Nothing was sent of the refused ones.
    for (const o of [postnord, unweighed, refused]) expect((await getOrderAdmin(storeId, o.id))!.status).toBe("paid");

    // The labels, in the order they were booked, each fetched from its carrier when printed and never kept.
    expect(result.labels?.map((l) => [l.number, l.carrier])).toEqual([
      [plain.number, "Posten / Bring"],
      [partly.number, "Posten / Bring"],
      [helthjem.number, "Helthjem"],
    ]);
    const ids = result.labels!.map((l) => l.shipmentId);
    const sheet = await labelsToPrint(storeId, [...ids, crypto.randomUUID(), "not-an-id"]);
    expect(sheet.labels.map((l) => l.shipmentId)).toEqual(ids);
    expect(sheet.missing).toBe(2);
    const first = result.labels![0];
    expect(new TextDecoder().decode((await carrierLabel(storeId, first.orderId, first.shipmentId))!)).toMatch(/^%PDF-1\.4 C-/);

    // One audit entry for the batch, with counts and never an order number.
    const [entry] = await db().execute<Row>(sql`select details from commerce.audit_log where store_id = ${storeId}::uuid and action = 'order.bulk_labels_booked' order by id desc limit 1`);
    expect(entry.details).toMatchObject({ action: "book_labels", requested: 7, applied: 3, refused: 4, labels: 3 });
    expect(JSON.stringify(entry.details)).not.toContain(plain.number);
  });

  it("refuses an order already sent and books nothing twice when run again", async () => {
    const o = await order();
    const actor = staffActor(accountId);
    expect(await runBulk(storeId, actor, { action: "book_labels", selection: { kind: "ids", ids: [o.id] } })).toMatchObject({ ok: true, result: { applied: 1 } });
    const start = bookings().length;
    const again = await runBulk(storeId, actor, { action: "book_labels", selection: { kind: "ids", ids: [o.id] } });
    expect(again).toMatchObject({ ok: true, result: { applied: 0, refused: [{ id: o.id, number: o.number, reason: "already_sent" }], labels: [] } });
    expect(bookings().length).toBe(start);
  });

  it("books a test shipment in the carrier's test environment, as the order page does: nothing is sent and no label is offered", async () => {
    expect((await saveCarrier(accountId, storeId, "bring", { environment: "test", countries: ["NO"], fields: bringFields })).ok).toBe(true);
    const o = await order();
    const outcome = await runBulk(storeId, staffActor(accountId), { action: "book_labels", selection: { kind: "ids", ids: [o.id] } });
    expect(outcome).toMatchObject({ ok: true, result: { applied: 0, refused: [{ id: o.id, number: o.number, reason: "test_booking" }], labels: [] } });
    const order_ = (await getOrderAdmin(storeId, o.id))!;
    expect(order_.status).toBe("paid");
    expect(order_.shipments).toEqual([]);
    expect((await saveCarrier(accountId, storeId, "bring", { environment: "live", countries: ["NO"], fields: bringFields })).ok).toBe(true);
  });

  it("refuses an order whose carrier is not connected, and a request of more than a printed set", async () => {
    await db().execute(sql`update commerce.shipping_carriers set complete = false where store_id = ${storeId}::uuid and carrier = 'helthjem'`);
    const o = await order({ delivery: { carrier: "helthjem", serviceId: "home", label: "Helthjem home delivery", postalCode: "0155", pickupPoint: null, window: null } });
    const outcome = await runBulk(storeId, staffActor(accountId), { action: "book_labels", selection: { kind: "ids", ids: [o.id] } });
    expect(outcome).toMatchObject({ ok: true, result: { applied: 0, refused: [{ id: o.id, reason: "no_carrier" }] } });
    await db().execute(sql`update commerce.shipping_carriers set complete = true where store_id = ${storeId}::uuid and carrier = 'helthjem'`);
    const many = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    expect(await runBulk(storeId, staffActor(accountId), { action: "book_labels", selection: { kind: "ids", ids: many } })).toEqual({ ok: false, problem: "too_many" });
  });
});
