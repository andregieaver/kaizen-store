import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { conversionFor, localizationOf } from "@/lib/localization";
import { showMarket, toMarket, type Market } from "@/lib/markets";
import type { ReturnBookingRequest, ShippingCarrierAdapter } from "@/lib/shipping-carriers";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.RESEND_API_KEY = "re_test_key";
process.env.EMAIL_FROM = "butikk@example.com";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./refresh", () => ({ refreshTag: () => {}, refreshTagNow: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));

/** A faked carrier: books returns as told (or refuses, or times out) and prices the return service; every request kept. */
const carrier = vi.hoisted(() => {
  const booked: ReturnBookingRequest[] = [];
  const state = {
    mode: "ok" as "ok" | "refuse" | "timeout",
    test: false as boolean,
    delayMs: 0,
    labelUrl: "https://api.bring.com/labels/test-123.pdf" as string | null,
    price: { priceMinor: 8000, currency: "NOK", includesVat: false } as { priceMinor: number; currency: string; includesVat: boolean } | null,
  };
  const adapter: Partial<ShippingCarrierAdapter> = {
    id: "bring",
    check: async () => ({ ok: true }),
    rates: async () => (state.price ? [{ serviceId: "9300", carrier: "bring", name: "Return", priceMinor: state.price.priceMinor, currency: state.price.currency, includesVat: state.price.includesVat }] : []),
    bookReturn: async (_context, request) => {
      booked.push(request);
      if (state.delayMs > 0) await new Promise((r) => setTimeout(r, state.delayMs));
      if (state.mode === "refuse") throw new Error("Bring says the store has no return agreement for this country or service. Ask Bring to add returns to your agreement, or paste a label address.");
      if (state.mode === "timeout") throw new Error("Bring did not answer. Try again in a moment.");
      return { trackingNumber: `RT${booked.length}NO`, trackingUrl: `https://sporing.bring.no/sporing/RT${booked.length}NO`, consignmentNumber: `C${booked.length}`, labelUrl: state.labelUrl, test: state.test };
    },
  };
  return { adapter, booked, state };
});
vi.mock("./carriers", () => ({ adapterFor: (id: string) => (id === "bring" ? carrier.adapter : null) }));
vi.mock("./stripe", () => ({ platformStripe: () => ({ refunds: { create: async () => ({ id: `re_l_${Date.now()}${Math.random()}`, status: "succeeded" }) }, checkout: { sessions: { retrieve: async (id: string) => ({ id, payment_intent: `pi_${id}` }) } } }), platformPublishableKey: () => "pk_test_l", platformModes: () => ["test", "live"], WEBHOOK_EVENTS: [] }));

/** The network: the email provider, and Bring's label host (anything else is recorded and refused). */
const net = vi.hoisted(() => ({ calls: [] as { url: string; headers: Record<string, string>; body: string }[] }));
vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
  const url = String(input);
  const headers = Object.fromEntries(new Headers(init?.headers ?? {}).entries());
  net.calls.push({ url, headers, body: typeof init?.body === "string" ? init.body : "" });
  if (url.startsWith("https://api.bring.com/labels/")) return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]), { status: 200, headers: { "content-type": "application/pdf" } });
  if (url.includes("resend")) return new Response(JSON.stringify({ id: `em_${net.calls.length}` }), { status: 200, headers: { "content-type": "application/json" } });
  return new Response("no", { status: 500 });
});

const support = await import("./inventory-test-support");
const labels = await import("./return-labels");
const w = await import("./withdrawals");
const r = await import("./returns");
const { saveCarrier } = await import("./shipping-carriers");
const { saveExchangeLabelSettings, saveReturnSettings, getReturnSettings } = await import("./return-settings");
const { staffActor } = await import("./order-actor");

type Row = Record<string, unknown>;
type TestStore = Awaited<ReturnType<typeof support.newStore>>;

/**
 * Return labels against a real database (wave 3, D239, `docs/wave-3-exchanges.md` 6.2): a label booked through a faked carrier from the order's shipping
 * address to the return address and kept on the return; the label reaching the shopper by an email button and the label route, fetched from the carrier's
 * own host with the store's keys and never stored; its cost taken off the refund only when the shopper pays, never above the cost, converted once for a euro
 * order; a carrier that refuses or does not answer leaving the pasted path working.
 */

const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const noInEuro = showMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" }, {
  currency: "EUR",
  conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]), "NOK", "EUR")!,
});
const RETURN_ADDRESS = { name: "Lager AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO" };

afterAll(async () => {
  vi.unstubAllGlobals();
  await closeDb();
});

beforeEach(() => {
  carrier.state.mode = "ok";
  carrier.state.test = false;
  carrier.state.delayMs = 0;
  carrier.state.labelUrl = "https://api.bring.com/labels/test-123.pdf";
  carrier.state.price = { priceMinor: 8000, currency: "NOK", includesVat: false };
  net.calls.length = 0;
});

/** A store with Bring connected (checked), a return address, euro offered and the shopper paying return shipping. */
async function labelStore(label: string, options: { auto?: boolean } = {}): Promise<TestStore> {
  const store = await support.newStore(label);
  await db().execute(sql`update commerce.stores set features = features || array['countries', 'currencies'], contact_email = ${`butikk-${store.slug}@example.com`} where id = ${store.storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${store.storeId}::uuid, 'NOK', 11.5, 1, 0), (${store.storeId}::uuid, 'EUR', 1, 1, 1) on conflict do nothing
  `);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${store.storeId}::uuid`);
  const saved = await saveCarrier(store.accountId, store.storeId, "bring", {
    environment: "live",
    countries: ["NO"],
    fields: { customerNumber: "12345", apiUid: "me@shop.no", apiKey: "secret-key-0001", senderName: "Shop AS", senderStreet: "Lagerveien 2", senderPostalCode: "0150", senderCity: "Oslo" },
  });
  expect(saved).toMatchObject({ ok: true });
  await db().execute(sql`update commerce.shipping_carriers set checked_at = now(), check_ok = true where store_id = ${store.storeId}::uuid and carrier = 'bring'`);
  const settings = await getReturnSettings(store.storeId);
  expect(await saveReturnSettings(store.storeId, { ...settings, whoPaysReturn: "shopper", returnAddress: RETURN_ADDRESS }, store.accountId)).toMatchObject({ ok: true });
  expect(await saveExchangeLabelSettings(store.storeId, { exchanges: true, labelCarrier: "bring", labelAuto: options.auto ?? false }, store.accountId)).toMatchObject({ ok: true });
  return store;
}

async function paidOrder(store: TestStore, lines: [string, number][], market: Market = no) {
  const placed = await support.place(store.storeId, lines, market);
  await support.pay(store.storeId, placed, store.account);
  await db().execute(sql`update commerce.orders set shipping_address = shipping_address || '{"country": "NO", "phone": "+4790000000"}'::jsonb where id = ${placed.orderId}::uuid`);
  const [o] = await db().execute<Row>(sql`select number, return_cost_payer from commerce.orders where id = ${placed.orderId}::uuid`);
  const ls = await db().execute<Row>(sql`select id, quantity from commerce.order_lines where order_id = ${placed.orderId}::uuid`);
  return { orderId: placed.orderId, number: String(o.number), payer: o.return_cost_payer, lines: ls.map((l) => ({ id: String(l.id), quantity: Number(l.quantity) })) };
}

async function voluntaryReturn(store: TestStore, order: Awaited<ReturnType<typeof paidOrder>>): Promise<string> {
  const [ret] = await db().execute<Row>(sql`insert into commerce.returns (store_id, order_id, kind, status) values (${store.storeId}::uuid, ${order.orderId}::uuid, 'return', 'approved') returning id`);
  await db().execute(sql`insert into commerce.return_lines (store_id, return_id, order_line_id, quantity, decision) values (${store.storeId}::uuid, ${String(ret.id)}::uuid, ${order.lines[0].id}::uuid, 1, 'accept')`);
  return String(ret.id);
}

async function withdrawalReturn(store: TestStore, order: Awaited<ReturnType<typeof paidOrder>>): Promise<string> {
  const started = await w.startWithdrawal(store.storeId, { orderNumber: order.number, email: "kari@example.com", name: "Kari Nordmann", lines: order.lines.map((l) => ({ lineId: l.id, quantity: l.quantity })) }, { floorMs: 0 });
  if (!started.ok || !started.matched || !started.request) throw new Error(JSON.stringify(started));
  const confirmed = await w.confirmWithdrawal(store.storeId, { requestId: started.request.id });
  if (!confirmed.ok) throw new Error(JSON.stringify(confirmed));
  return confirmed.returns[0].id;
}

const tokenOf = async (returnId: string) => String((await db().execute<Row>(sql`select public_token from commerce.returns where id = ${returnId}::uuid`))[0].public_token);

describe("booking a return label (6.2 criterion 1)", () => {
  it("books from the order's shipping address to the return address and keeps the booking on the return", async () => {
    const store = await labelStore("lbl-book");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await voluntaryReturn(store, order);
    const before = carrier.booked.length;
    const done = await labels.bookReturnLabel(store.storeId, returnId, {}, staffActor(store.accountId));
    if (!done.ok) throw new Error(JSON.stringify(done));
    const request = carrier.booked.at(-1)!;
    expect(carrier.booked.length).toBe(before + 1);
    expect(request).toMatchObject({
      serviceId: "9300",
      from: { name: "Kari Nordmann", street: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
      to: { name: "Lager AS", street: "Lagerveien 2", postalCode: "0150", city: "Oslo", country: "NO" },
    });
    expect(request.parcels[0].weightGrams).toBe(420);
    const [ret] = await db().execute<Row>(sql`select * from commerce.returns where id = ${returnId}::uuid`);
    expect(ret).toMatchObject({
      label_source: "carrier",
      label_carrier_id: "bring",
      label_service: "9300",
      label_carrier_url: "https://api.bring.com/labels/test-123.pdf",
      label_url: null,
      label_test: false,
    });
    expect(String(ret.label_tracking_number)).toMatch(/^RT\d+NO$/);
    // The cost with VAT (80,00 + 25 %). Nothing is taken off at booking (review finding): the label may never be used.
    expect(Number(ret.label_cost_minor)).toBe(10_000);
    expect(Number(ret.return_shipping_minor)).toBe(0);
    expect(done).toMatchObject({ costMinor: 10_000 });
    // Booked once: a second booking of a real label is refused.
    expect(await labels.bookReturnLabel(store.storeId, returnId)).toMatchObject({ ok: false, problem: "booked" });
    const events = await db().execute<Row>(sql`select type from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'return.label_booked'`);
    expect(events.length).toBe(1);
  });

  it("books a withdrawal return's label in the five-minute job when the owner turned automatic labels on, never in the confirmation", async () => {
    const store = await labelStore("lbl-auto", { auto: true });
    const order = await paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const before = carrier.booked.length;
    const returnId = await withdrawalReturn(store, order);
    // The shopper's confirmation called no carrier.
    expect(carrier.booked.length).toBe(before);
    // Too soon for the first try (5 minutes after), then booked.
    expect((await labels.bookPendingLabels(new Date())).booked).toBe(0);
    const run = await labels.bookPendingLabels(new Date(Date.now() + 6 * 60_000));
    expect(run.booked).toBeGreaterThanOrEqual(1);
    const [ret] = await db().execute<Row>(sql`select label_source from commerce.returns where id = ${returnId}::uuid`);
    expect(ret.label_source).toBe("carrier");
  });

  it("refuses without a complete shipping address or a return address, and outside the carrier's return countries", async () => {
    const store = await labelStore("lbl-blocks");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await voluntaryReturn(store, order);
    await db().execute(sql`update commerce.orders set shipping_address = shipping_address - 'postalCode' where id = ${order.orderId}::uuid`);
    expect(await labels.bookReturnLabel(store.storeId, returnId)).toMatchObject({ ok: false, problem: "address_incomplete" });
    await db().execute(sql`update commerce.orders set shipping_address = shipping_address || '{"postalCode": "11122", "country": "SE"}'::jsonb where id = ${order.orderId}::uuid`);
    expect(await labels.bookReturnLabel(store.storeId, returnId)).toMatchObject({ ok: false, problem: "country" });
    expect((await labels.labelOptions(store.storeId, returnId))?.block).toBe("country");
  });
});

describe("the label reaches the shopper and is never stored (6.2 criterion 2)", () => {
  it("emails a button to the label route with no attachment; the route fetches from the carrier's host with the store's keys", async () => {
    const store = await labelStore("lbl-route");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await voluntaryReturn(store, order);
    net.calls.length = 0;
    expect(await labels.bookReturnLabel(store.storeId, returnId)).toMatchObject({ ok: true });
    const token = await tokenOf(returnId);
    const [mail] = await db().execute<Row>(sql`select html, text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.label_ready'`);
    expect(String(mail.text)).toContain(`/returns/${token}/label`);
    expect(String(mail.html)).not.toContain("api.bring.com");
    // Handed to the email provider without the file: no attachment, and Bring was never asked for the label to send it.
    const sent = net.calls.filter((c) => c.url.includes("resend"));
    expect(sent.length).toBeGreaterThan(0);
    for (const c of sent) expect(JSON.parse(c.body).attachments ?? []).toEqual([]);
    expect(net.calls.filter((c) => c.url.startsWith("https://api.bring.com/labels/"))).toEqual([]);
    net.calls.length = 0;
    const fetched = await labels.returnLabel(store.storeId, token);
    if (!fetched.ok) throw new Error(JSON.stringify(fetched));
    expect([...fetched.pdf.slice(0, 4)]).toEqual([0x25, 0x50, 0x44, 0x46]);
    const call = net.calls.find((c) => c.url.startsWith("https://api.bring.com/"))!;
    expect(call.headers["x-mybring-api-key"]).toBe("secret-key-0001");
    expect(call.headers["x-mybring-api-uid"]).toBe("me@shop.no");
    // Nothing kept: no file, no copy in the emails.
    const [kept] = await db().execute<Row>(sql`select count(*)::int as n from commerce.email_messages where order_id = ${order.orderId}::uuid and html like '%PDF%'`);
    expect(kept.n).toBe(0);
    // Another store's token, a malformed one: not found. Staff print the same way.
    const other = await labelStore("lbl-route-other");
    expect(await labels.returnLabel(other.storeId, token)).toMatchObject({ ok: false, status: 404 });
    expect(await labels.returnLabel(store.storeId, "nope")).toMatchObject({ ok: false, status: 404 });
    expect(await labels.staffReturnLabel(store.storeId, returnId)).toMatchObject({ ok: true });
    expect(await labels.staffReturnLabel(other.storeId, returnId)).toMatchObject({ ok: false, status: 404 });
  });

  it("never fetches a label address on another host (404), and answers a carrier that fails with a 503", async () => {
    const store = await labelStore("lbl-host");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await voluntaryReturn(store, order);
    expect(await labels.bookReturnLabel(store.storeId, returnId)).toMatchObject({ ok: true });
    const token = await tokenOf(returnId);
    await db().execute(sql`update commerce.returns set label_carrier_url = 'https://evil.example/label.pdf' where id = ${returnId}::uuid`);
    net.calls.length = 0;
    expect(await labels.returnLabel(store.storeId, token)).toMatchObject({ ok: false, status: 404 });
    expect(net.calls.filter((c) => c.url.includes("evil"))).toEqual([]);
    await db().execute(sql`update commerce.returns set label_carrier_url = 'https://api.bring.com/missing/label.pdf' where id = ${returnId}::uuid`);
    expect(await labels.returnLabel(store.storeId, token)).toMatchObject({ ok: false, status: 503 });
  });
});

describe("who pays (6.2 criterion 3)", () => {
  it("takes nothing off when the store pays, and never more than the label cost when the shopper pays", async () => {
    const store = await labelStore("lbl-payer");
    const settings = await getReturnSettings(store.storeId);
    expect(await saveReturnSettings(store.storeId, { ...settings, whoPaysReturn: "store" }, store.accountId)).toMatchObject({ ok: true });
    const storePays = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    expect(storePays.payer).toBe("store");
    const a = await voluntaryReturn(store, storePays);
    expect(await labels.bookReturnLabel(store.storeId, a)).toMatchObject({ ok: true });
    const [ra] = await db().execute<Row>(sql`select return_shipping_minor from commerce.returns where id = ${a}::uuid`);
    expect(Number(ra.return_shipping_minor)).toBe(0);

    expect(await saveReturnSettings(store.storeId, { ...settings, whoPaysReturn: "shopper" }, store.accountId)).toMatchObject({ ok: true });
    const shopperPays = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const b = await voluntaryReturn(store, shopperPays);
    expect(await labels.bookReturnLabel(store.storeId, b)).toMatchObject({ ok: true, costMinor: 10_000 });
    expect(await r.markInTransit(store.storeId, { returnId: b }, null)).toMatchObject({ ok: true });
    // Above the cost: refused (CRD Art. 14(1)).
    expect(await r.refundReturn(store.storeId, { returnId: b, amountMinor: 1, returnShippingMinor: 10_001 }, null)).toMatchObject({ ok: false, code: "above_cost" });
    // Booking takes nothing off by itself: the working starts whole (the parcel may come another way).
    const untouched = await r.previewRefund(store.storeId, b);
    expect(untouched!.refund.returnShippingMinor).toBe(0);
    // Staff confirm the parcel came with the label: the working takes it off.
    const preview = await r.previewRefund(store.storeId, b, 10_000);
    expect(preview!.refund.returnShippingMinor).toBe(10_000);
    expect(preview!.refund.working.find((row) => row.key === "return_shipping")?.amountMinor).toBe(-10_000);
    const refunded = await r.refundReturn(store.storeId, { returnId: b, amountMinor: preview!.refund.amountMinor, returnShippingMinor: 10_000 }, null);
    expect(refunded).toMatchObject({ ok: true });
    const [rb] = await db().execute<Row>(sql`select return_shipping_minor from commerce.returns where id = ${b}::uuid`);
    expect(Number(rb.return_shipping_minor)).toBe(10_000);
  });

  it("converts the cost once into a euro order's currency at the store's rate", async () => {
    const store = await labelStore("lbl-euro");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]], noInEuro);
    const returnId = await voluntaryReturn(store, order);
    const done = await labels.bookReturnLabel(store.storeId, returnId);
    // 80,00 NOK + 25 % = 100,00 NOK = 8,70 EUR at 11.5 (half up).
    expect(done).toMatchObject({ ok: true, costMinor: 870 });
    const [ret] = await db().execute<Row>(sql`select label_cost_minor, label_cost_carrier from commerce.returns where id = ${returnId}::uuid`);
    expect(Number(ret.label_cost_minor)).toBe(870);
    expect(ret.label_cost_carrier).toEqual({ amountMinor: 8000, currency: "NOK", vatIncluded: false });
  });

  it("takes nothing off when the carrier did not price the label", async () => {
    const store = await labelStore("lbl-noprice");
    carrier.state.price = null;
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await voluntaryReturn(store, order);
    expect(await labels.bookReturnLabel(store.storeId, returnId)).toMatchObject({ ok: true, costMinor: null });
    // An amount for an unpriced label needs a note saying where it comes from (4.8).
    expect(await r.markInTransit(store.storeId, { returnId }, null)).toMatchObject({ ok: true });
    expect(await r.refundReturn(store.storeId, { returnId, amountMinor: 1, returnShippingMinor: 5_000 }, null)).toMatchObject({ ok: false, code: "note_needed" });
  });

  it("never takes a test label's cost off, at booking or at refund, and a real label booked again after it takes nothing off either (review findings)", async () => {
    const store = await labelStore("lbl-testded");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    expect(order.payer).toBe("shopper");
    const returnId = await voluntaryReturn(store, order);
    carrier.state.test = true;
    const done = await labels.bookReturnLabel(store.storeId, returnId, {}, staffActor(store.accountId));
    if (!done.ok) throw new Error(JSON.stringify(done));
    expect(done.test).toBe(true);
    const [ret] = await db().execute<Row>(sql`select return_shipping_minor, label_test from commerce.returns where id = ${returnId}::uuid`);
    expect(ret.label_test).toBe(true);
    expect(Number(ret.return_shipping_minor)).toBe(0);
    // The email says it is a test and says nothing about a cost.
    const [mail] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${order.orderId}::uuid and kind = 'return.label_ready'`);
    expect(String(mail.text)).toContain("Dette er en testetikett og kan ikke brukes.");
    expect(String(mail.text)).not.toContain("trekkes fra tilbakebetalingen");
    // Staff cannot take a test label off the refund.
    expect(await r.markInTransit(store.storeId, { returnId }, null)).toMatchObject({ ok: true });
    expect(await r.refundReturn(store.storeId, { returnId, amountMinor: 1, returnShippingMinor: 10_000 }, null)).toMatchObject({ ok: false, code: "test_label" });
    // Book again for real: still nothing taken off until staff confirm the parcel came with it.
    carrier.state.test = false;
    expect(await labels.bookReturnLabel(store.storeId, returnId, {}, staffActor(store.accountId))).toMatchObject({ ok: true, test: false });
    const [again] = await db().execute<Row>(sql`select return_shipping_minor, label_test from commerce.returns where id = ${returnId}::uuid`);
    expect(again).toMatchObject({ label_test: false });
    expect(Number(again.return_shipping_minor)).toBe(0);
  });

  it("books a withdrawal's label in the job without taking its cost off: the customer may hand the parcel in another way (review finding)", async () => {
    const store = await labelStore("lbl-autoded", { auto: true });
    const order = await paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const returnId = await withdrawalReturn(store, order);
    await labels.bookPendingLabels(new Date(Date.now() + 6 * 60_000));
    const [ret] = await db().execute<Row>(sql`select label_source, return_shipping_minor from commerce.returns where id = ${returnId}::uuid`);
    expect(ret.label_source).toBe("carrier");
    expect(Number(ret.return_shipping_minor)).toBe(0);
    const preview = await r.previewRefund(store.storeId, returnId);
    expect(preview!.refund.returnShippingMinor).toBe(0);
  });
});

describe("a carrier that cannot book leaves the pasted path working (6.2 criterion 4)", () => {
  for (const mode of ["refuse", "timeout"] as const) {
    it(`a carrier that ${mode === "refuse" ? "refuses (no return agreement)" : "does not answer"}: the return stays approved and a pasted label still works`, async () => {
      const store = await labelStore(`lbl-${mode}`);
      const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
      const returnId = await voluntaryReturn(store, order);
      carrier.state.mode = mode;
      const done = await labels.bookReturnLabel(store.storeId, returnId);
      expect(done).toMatchObject({ ok: false, problem: "carrier" });
      if (!done.ok && mode === "refuse") expect(done.message).toContain("no return agreement");
      const [ret] = await db().execute<Row>(sql`select status::text as status, label_source, label_tries from commerce.returns where id = ${returnId}::uuid`);
      expect(ret).toMatchObject({ status: "approved", label_source: null });
      expect(Number(ret.label_tries)).toBe(1);
      expect(await r.setReturnInstructions(store.storeId, { returnId, instructions: "Use the label", labelUrl: "https://labels.example/abc.pdf", returnAddress: RETURN_ADDRESS }, null)).toMatchObject({ ok: true });
      const [after] = await db().execute<Row>(sql`select label_url, label_source from commerce.returns where id = ${returnId}::uuid`);
      expect(after).toMatchObject({ label_url: "https://labels.example/abc.pdf", label_source: "pasted" });
    });
  }
});

describe("one booking at a time (review finding: two bookings at once)", () => {
  it("books one carrier shipment when staff press Book twice (or the job and staff run together)", async () => {
    const store = await labelStore("lbl-race");
    const order = await paidOrder(store, [["DEMO-THERMOS", 1]]);
    const returnId = await voluntaryReturn(store, order);
    carrier.state.delayMs = 50;
    const before = carrier.booked.length;
    const [a, b] = await Promise.all([
      labels.bookReturnLabel(store.storeId, returnId, { weightGrams: 500 }, staffActor(store.accountId)),
      labels.bookReturnLabel(store.storeId, returnId, { weightGrams: 500 }, staffActor(store.accountId)),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(carrier.booked.length - before).toBe(1);
    const refused = [a, b].find((x) => !x.ok);
    expect(refused).toMatchObject({ ok: false, problem: "busy" });
    // After the first is done, another press is refused as booked, and the job counts no try for it.
    expect(await labels.bookReturnLabel(store.storeId, returnId)).toMatchObject({ ok: false, problem: "booked" });
    const events = await db().execute<Row>(sql`select 1 from commerce.order_events where order_id = ${order.orderId}::uuid and type = 'return.label_booked'`);
    expect(events.length).toBe(1);
  });

  it("the job running twice at once books a withdrawal's label once and counts no try for the run that found it busy", async () => {
    const store = await labelStore("lbl-race-job", { auto: true });
    const order = await paidOrder(store, [["DEMO-MUG-WHITE", 1]]);
    const returnId = await withdrawalReturn(store, order);
    carrier.state.delayMs = 50;
    const later = new Date(Date.now() + 6 * 60_000);
    const [{ number }] = await db().execute<Row>(sql`select number from commerce.returns where id = ${returnId}::uuid`);
    // Return numbers repeat across stores: count this one's bookings made by these two runs.
    const before = carrier.booked.filter((q) => q.returnReference === String(number)).length;
    await Promise.all([labels.bookPendingLabels(later), labels.bookPendingLabels(later)]);
    const [ret] = await db().execute<Row>(sql`select label_source, label_tries from commerce.returns where id = ${returnId}::uuid`);
    expect(ret.label_source).toBe("carrier");
    expect(carrier.booked.filter((q) => q.returnReference === String(number)).length - before).toBe(1);
    expect(Number(ret.label_tries)).toBe(1);
  });
});
