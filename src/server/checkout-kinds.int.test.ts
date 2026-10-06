import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { convertCredits, earnAmount, restoreShare } from "@/lib/bonus";
import { localizationOf, conversionFor } from "@/lib/localization";
import { showMarket, toMarket } from "@/lib/markets";
import { unitPrice, unitPriceShown } from "@/lib/unit-price";
import { lineUnitPriceText } from "@/lib/unit-price-text";
import { allowSmallBase } from "@/lib/unit-price-test-support";
import { t } from "@/lib/i18n";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Every kind of product, from the cart to a paid order, as a shopper goes:
 * added to the cart as its product page adds it, the cart's totals as the
 * cart page shows them, the payment form on Kaizen's checkout page (which
 * must open, not ask to start again), what Stripe is asked to charge, and
 * the order once paid. A cart with a stay once looked changed for ever, so
 * the form never opened; each kind is held to the whole way here.
 */

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

/** Kaizen's platform Stripe client, faked: sessions and coupons, recorded. */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const coupons = new Map<string, number>();
  let next = 0;
  const client = {
    refunds: { create: async () => ({ id: `re_${++next}`, status: "succeeded" }) },
    coupons: {
      create: async (params: { amount_off: number }) => {
        const id = `coupon_${++next}`;
        coupons.set(id, params.amount_off);
        return { id };
      },
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_kinds_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", mode: params.mode });
          created.push({ params, options });
          return { id, url: `https://checkout.stripe.test/${id}`, client_secret: `${id}_secret_test`, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, ...sessions.get(id) }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client, created, sessions, coupons };
});

// Kaizen's own checkout page (D22), fixed here: other test files switch the platform's setting while this runs.
vi.mock("./connect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./connect")>()),
  getCheckoutUi: async () => "custom",
}));

// Posten / Bring's services and pickup points at checkout (D135), faked: the store's agreement is not real here.
vi.mock("./carriers", () => ({
  adapterFor: () => ({
    id: "bring",
    check: async () => ({ ok: true }),
    rates: async () => [
      { serviceId: "5800", carrier: "bring", name: "Pickup point", priceMinor: 6_900, currency: "NOK", estimate: { minDays: 2, maxDays: 3 }, needsPickupPoint: true },
      { serviceId: "5600", carrier: "bring", name: "Home delivery", priceMinor: 11_900, currency: "NOK", estimate: { minDays: 1, maxDays: 2 } },
      { serviceId: "3584", carrier: "bring", name: "Mailbox parcel", priceMinor: 4_000, currency: "NOK" },
    ],
    pickupPoints: async () => [
      { id: "pp-1", name: "Kiosken", address: { name: "Kiosken", street: "Storgata 1", postalCode: "0150", city: "Oslo", country: "NO" }, distanceMeters: 300 },
      { id: "pp-2", name: "Butikken", address: { name: "Butikken", street: "Lilleveien 4", postalCode: "0151", city: "Oslo", country: "NO" }, distanceMeters: 900 },
    ],
  }),
}));
vi.mock("./shipping-carriers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shipping-carriers")>()),
  carrierContext: async (storeId: string) => ({
    storeId,
    environment: "test",
    details: { senderName: "Kaizen Test", senderStreet: "Gate 1", senderPostalCode: "0150", senderCity: "Oslo" },
    secrets: {},
  }),
}));

vi.mock("./stripe", () => ({
  platformStripe: () => fake.client,
  platformPublishableKey: () => "pk_test_kinds",
  platformModes: () => ["test"],
}));

const { changeLine, getCart, getCartGift, setCartGift } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { getOpenCheckout, startCheckout } = await import("./checkout");
const { getOrder, getShopperOrder } = await import("./orders");
const { appointmentSlots } = await import("./appointments");
const { rentalTimes } = await import("./ranges");
const { saveDiscount, setCartCode } = await import("./discounts");
const { saveCampaign } = await import("./campaigns");
const { preRegisterCustomer, startSession } = await import("./customers");
const { bonusOverview, customerBonus, getBonusSettings, setCartCredits, shopperBonus } = await import("./bonus");
const { cancelOrder, refundOrder } = await import("./order-admin");
const { setCartCompany } = await import("./cart");
const { attachReferral, rememberAffiliate } = await import("./affiliates");
const { chooseDelivery, deliveryOptionsFor, quoteDelivery } = await import("./delivery-options");
const { orderNumberAudit } = await import("./order-numbers");
const { issueWaitingInvoices } = await import("./invoice-issue");
const documentFixture = await import("./invoice-test-fixture");

const run = Date.now().toString(36);
const slug = `kinds-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const origin = "http://localhost:3000";
let storeId: string;
let tz: string;
let member: Membership;
/** The demo products every new store is copied with: variant ids by SKU, product ids by handle. */
const variant: Record<string, string> = {};
const product: Record<string, string> = {};
const times: Record<string, { checkIn: string; checkOut: string }> = {};

// No country allows 100 g today (`UNIT_PRICE_COUNTRY_RULES`): Norway is opened for this file so that the notebook, whose
// owner chose 100 g, holds the small base's arithmetic through every money path (cart, order, euro, business, plan). The one
// test of "the unit price per kg in the rules as read" closes it again for its length.
let restoreSmallBase = () => {};

beforeAll(async () => {
  restoreSmallBase = allowSmallBase("NO");
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id
  `);
  storeId = String(store.id);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${`acct_kinds${run}`}, 'active', false)
  `);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${storeId}::uuid`);
  // The seller's details and VAT registration: what an invoice needs (D159). The orders are checked out in Stripe's test mode like a new store's.
  await db().execute(sql`
    update commerce.stores set legal_name = 'Kinds AS', organisation_number = '923456789', postal_address = 'Storgata 1, 0155 Oslo', country = 'NO' where id = ${storeId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${storeId}::uuid, true, 'NO923456789MVA')
    on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923456789MVA'
  `);
  // The store offers euro (D109), at the rate `noInEuro` uses.
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
  `);
  // Posten / Bring's services at checkout (D135): the pickup point and home delivery, 10 % on top of the price with VAT.
  await db().execute(sql`
    insert into commerce.shipping_carriers (store_id, carrier, complete, countries, checkout_enabled, checkout_services, markup_percent, free_over_minor)
    values (${storeId}::uuid, 'bring', true, array['NO'], true, array['5800', '5600'], 10, 250000)
  `);
  // The demo lamp as a download (D24), as the demo has none of its own.
  await db().execute(sql`
    update commerce.product_variants set delivery = 'digital' where store_id = ${storeId}::uuid and sku = 'DEMO-LAMP'
  `);
  await db().execute(sql`
    update commerce.products p set delivery = 'digital', download_limit = 2, download_days = 7
    from commerce.product_variants v where v.product_id = p.id and v.store_id = ${storeId}::uuid and v.sku = 'DEMO-LAMP'
  `);
  const rows = await db().execute<Row>(sql`
    select p.id as product_id, p.handle, v.id as variant_id, v.sku, s.time_zone,
      a.check_in_time::text as check_in, a.check_out_time::text as check_out
    from commerce.products p
    join commerce.product_variants v on v.product_id = p.id
    join commerce.stores s on s.id = p.store_id
    left join commerce.appointment_settings a on a.product_id = p.id
    where p.store_id = ${storeId}::uuid
  `);
  for (const row of rows) {
    variant[String(row.sku)] = String(row.variant_id);
    product[String(row.handle)] = String(row.product_id);
    if (row.check_in) times[String(row.handle)] = { checkIn: String(row.check_in).slice(0, 5), checkOut: String(row.check_out).slice(0, 5) };
    tz = String(row.time_zone);
  }
  // What is in the demo goods (D160): the mug 250 g compared per kg, the notebook 120 g compared per 100 g, so every goods scenario
  // below carries a unit price. The demo has none of its own (a measure is not a kind of product).
  for (const [sku, spec] of Object.entries(MEASURES)) {
    await db().execute(sql`
      update commerce.product_variants set measure_amount = ${spec.amount}::numeric, measure_unit = 'g', measure_base = ${spec.base}
      where store_id = ${storeId}::uuid and sku = ${sku}
    `);
  }
  const [owner] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name) values (${`owner-${slug}@example.com`}, 'Owner') returning id
  `);
  member = {
    account: { id: String(owner.id), email: `owner-${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug, markets: [no] } as unknown as Store,
  };
});

afterAll(async () => {
  restoreSmallBase();
  await closeDb();
});

/** Norway shown in euro (D109): 1 EUR = 11.5 NOK. */
const noInEuro = showMarket(
  { code: "NO", currency: "NOK", defaultLocale: "nb-NO" },
  {
    currency: "EUR",
    conversion: conversionFor(localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]), "NOK", "EUR")!,
  },
);
/** The country as the scenario shows it. */
let view = no;
const shop = () => ({ storeId, market: view });
const cartId = () => jar.get(`cart_${storeId}_${no.slug}`)!;
/** A day some weeks ahead, a different week for each scenario, so no two want the same room or bike. */
let weeks = 3;
const nextDay = () => addDays(zonedDate(Date.now(), tz), 7 * weeks++);
const at = (date: string, time: string) => new Date(zonedTime(date, time, tz)).toISOString();

async function add(sku: string, quantity: number, booking?: { startsAt: string; resourceId: string | null }, plan: string | null = null) {
  const result = await changeLine(shop(), variant[sku], quantity, "add", plan, undefined, booking);
  expect(result, sku).toMatchObject({ outcome: "added" });
}

const addStay = async (nights: number) => add("DEMO-HYTTE", nights, { startsAt: at(nextDay(), times["demo-hytte"].checkIn), resourceId: null });

async function addAppointment() {
  // The first week with a free time: a fixed day ahead can fall beyond how far ahead the massage is booked, or on a day it is closed.
  const week = await appointmentSlots(storeId, product["demo-massasje"]);
  const slot = week?.days.flatMap((d) => d.slots).find((s) => s.resourceIds.length > 0);
  if (!slot) throw new Error("no free massage times");
  await add("DEMO-MASSAGE-60", 1, { startsAt: slot.startsAt, resourceId: null });
}

async function addRental(sku: string, period: "day" | "half_day" | "hour", count: number) {
  const day = nextDay();
  if (period === "day") return add(sku, count, { startsAt: at(day, times["demo-sykkelutleie"].checkIn), resourceId: null });
  const offered = await rentalTimes(storeId, product["demo-sykkelutleie"], day, period);
  if (!offered?.[0]) throw new Error(`no ${period} rentals on ${day}`);
  await add(sku, count, { startsAt: offered[0].startsAt, resourceId: null });
}

/** What Stripe's session charges today: its lines (not what renews after a free trial), shipping, less its coupon. */
function chargedNow(params: Record<string, unknown>): number {
  const items = params.line_items as { quantity: number; price_data: { unit_amount: number; recurring?: unknown } }[];
  const trial = Number((params.subscription_data as { trial_period_days?: number } | undefined)?.trial_period_days ?? 0) > 0;
  const lines = items.reduce((sum, i) => sum + (trial && i.price_data.recurring ? 0 : i.price_data.unit_amount * i.quantity), 0);
  const shipping = (params.shipping_options as { shipping_rate_data: { fixed_amount: { amount: number } } }[] | undefined)?.[0]
    ?.shipping_rate_data.fixed_amount.amount ?? 0;
  const coupon = (params.discounts as { coupon: string }[] | undefined)?.[0]?.coupon;
  return lines + shipping - (coupon ? (fake.coupons.get(coupon) ?? 0) : 0);
}

/**
 * The invoice of a paid order (D159) and its credit notes, held to the order and to the refunds to the minor unit, in the currency shown.
 * The database makes the invoice in the payment's own transaction, but only for a live account (a test-mode order never gets a legal number),
 * and this store's account is a test one like every new store's: it is switched to live for the one call that issues the waiting invoice, and
 * back, which is the same function, called later.
 */
async function expectDocuments(orderId: string, scenario: { euro?: boolean; gifts?: number }) {
  await db().execute(sql`update commerce.stripe_accounts set mode = 'live' where store_id = ${storeId}::uuid`);
  try {
    expect(await issueWaitingInvoices(storeId)).toBeGreaterThanOrEqual(1);
  } finally {
    await db().execute(sql`update commerce.stripe_accounts set mode = 'test' where store_id = ${storeId}::uuid`);
  }
  const invoice = (await documentFixture.invoiceOf(storeId, orderId))!;
  expect(invoice, "an invoice for the paid order").not.toBeNull();
  const order = (await getOrder(storeId, orderId))!;
  // The invoice is the order, in the currency shown.
  expect(invoice.currency).toBe(scenario.euro ? "EUR" : "NOK");
  expect({ total: invoice.totalMinor, vat: invoice.taxMinor }).toEqual({ total: order.totalMinor, vat: order.taxMinor });
  expect(invoice.netMinor + invoice.taxMinor).toBe(invoice.totalMinor);
  // The VAT per rate is what the order charged on its lines and shipping, rate by rate.
  const expected = await documentFixture.orderVatByRate(orderId);
  const buckets = new Map<string, number>(invoice.snapshot.buckets.map((b: { rate: number; vatMinor: number }) => [b.rate.toFixed(4), b.vatMinor]));
  for (const [rate, vat] of expected) if (vat !== 0) expect(buckets.get(rate), `VAT at ${rate}`).toBe(vat);
  expect(invoice.snapshot.buckets.reduce((sum: number, b: { vatMinor: number }) => sum + b.vatMinor, 0)).toBe(order.taxMinor);
  expect(invoice.snapshot.lines.filter((l: { kind: string }) => l.kind === "gift")).toHaveLength(scenario.gifts ?? 0);
  // What was paid online and what is left for the venue.
  const online = invoice.snapshot.payments.find((p: { kind: string }) => p.kind === "paid_online");
  const venue = invoice.snapshot.payments.find((p: { kind: string }) => p.kind === "pay_at_venue");
  expect(online?.amountMinor ?? 0).toBe(order.totalMinor - order.balanceMinor);
  expect(venue?.amountMinor ?? 0).toBe(order.balanceMinor);
  // An order in euro carries its VAT in the seller's currency (kroner) at the store's rate, and the figure unit 1c adds up.
  if (scenario.euro) {
    const home = invoice.snapshot.buckets.reduce((sum: number, b: { vatMinor: number }) => sum + Math.floor(b.vatMinor * 11.5 + 0.5), 0);
    expect(invoice).toMatchObject({ vatHomeCurrency: "NOK", fxRate: 11.5, vatHomeMinor: home });
    expect(invoice.snapshot.vatMain).toMatchObject({ currency: "NOK", vatMinor: home });
  } else {
    expect(invoice.vatHomeMinor).toBeNull();
    expect(invoice.snapshot.vatMain).toMatchObject({ currency: "NOK", vatMinor: order.taxMinor, fxRate: null });
  }

  // Refunded in two parts: a credit note for each, never above the invoice, and together exactly the refunds, with the VAT of each rate adding up.
  const admin = (await (await import("./order-admin")).getOrderAdmin(storeId, orderId))!;
  if (admin.refundableMinor < 2) return;
  const part = Math.floor(admin.refundableMinor / 3);
  const refunded = [part, admin.refundableMinor - part];
  for (const amountMinor of refunded) {
    const made = await refundOrder(storeId, orderId, { amountMinor, reason: "Test", restock: [] }, null);
    expect(made, JSON.stringify({ made, refunded, admin: { refundable: admin.refundableMinor, canRefund: admin.canRefund } })).toMatchObject({ ok: true });
  }
  const notes = await documentFixture.notesOf(storeId, orderId);
  expect(notes.map((n) => n.totalMinor)).toEqual(refunded);
  expect(notes.reduce((sum, n) => sum + n.totalMinor, 0)).toBe(refunded[0] + refunded[1]);
  expect(notes.every((n) => n.currency === invoice.currency && n.netMinor + n.taxMinor === n.totalMinor)).toBe(true);
  if (refunded[0] + refunded[1] === invoice.totalMinor) {
    // The whole invoice credited: nothing left, per rate, and the VAT credited is the invoice's.
    expect(notes.reduce((sum, n) => sum + n.taxMinor, 0)).toBe(invoice.taxMinor);
    for (const bucket of invoice.snapshot.buckets as { rate: number; basis: string; vatMinor: number; grossMinor: number }[]) {
      const credited = notes.flatMap((n) => n.snapshot.buckets).filter((b: { rate: number; basis: string }) => b.rate === bucket.rate && b.basis === bucket.basis);
      expect(credited.reduce((sum: number, b: { grossMinor: number }) => sum + b.grossMinor, 0)).toBe(bucket.grossMinor);
      expect(credited.reduce((sum: number, b: { vatMinor: number }) => sum + b.vatMinor, 0)).toBe(bucket.vatMinor);
    }
  }
  if (scenario.euro) {
    for (const n of notes) expect(n).toMatchObject({ vatHomeCurrency: "NOK", fxRate: 11.5 });
  }
}

/** What the demo goods hold, for the unit price (D160): content in grams and what the owner compares it per (null: kg). */
const MEASURES: Record<string, { amount: string; grams: number; base: "100g" | null }> = {
  "DEMO-MUG-WHITE": { amount: "250", grams: 250, base: null },
  "DEMO-NOTEBOOK-LINED": { amount: "120", grams: 120, base: "100g" },
};

/**
 * The unit price an independent reader works out from the catalogue (D160): the krone price, converted at the store's rate when
 * the view is euro (rounded to the cent like the shop shows it), reduced by the purchase option, and then the price per kg or
 * per 100 g by integer arithmetic of its own (half up), apart from `unitPrice()`. A business's price is netted first.
 */
async function expectedUnitPrice(variantId: string, sku: string, opts: { euro: boolean; planPercent: number; net?: number }): Promise<number> {
  const [row] = await db().execute<Row>(sql`select amount_minor from commerce.current_prices where variant_id = ${variantId}::uuid and market_code = 'NO'`);
  const native = Number(row.amount_minor);
  const shownPrice = opts.euro ? Math.round(native / 11.5) : native;
  const afterPlan = opts.planPercent ? Math.round((shownPrice * (100 - opts.planPercent)) / 100) : shownPrice;
  const price = BigInt(opts.net === undefined ? afterPlan : afterPlan - Math.round(afterPlan * opts.net / (1 + opts.net)));
  const grams = BigInt(MEASURES[sku].grams);
  const per = MEASURES[sku].base === "100g" ? BigInt(100) : BigInt(1000);
  return Number((price * per * BigInt(2) + grams) / (BigInt(2) * grams));
}

/**
 * The unit price in a basket (D160): for every line with a content, the cart's is the order line's is what an independent reader
 * works out from the catalogue, in the currency shown, whatever came off the basket (a code, a campaign, a group's discount, credits)
 * and for a business, who sees the price without VAT, netted first as the page shows it. A free gift draws none. A unit price
 * is display: the totals the rest of the test holds are unchanged by it.
 */
async function expectUnitPrices(cart: Awaited<ReturnType<typeof getCart>>, order: NonNullable<Awaited<ReturnType<typeof getOrder>>>, scenario: { euro?: boolean }) {
  const euro = Boolean(scenario.euro);
  const skuOf = (id: string) => Object.entries(variant).find(([, v]) => v === id)![0];
  for (const line of cart.lines) {
    const sku = skuOf(line.variantId);
    const spec = MEASURES[sku];
    if (!spec) {
      expect(line.measure, `${sku} has no content`).toBeNull();
      continue;
    }
    const planPercent = line.plan?.discountPercent ?? 0;
    const base = spec.base ?? "kg";
    expect(line.measure, sku).toEqual({ amount: spec.amount, unit: "g", base });
    const want = await expectedUnitPrice(line.variantId, sku, { euro, planPercent });
    // (a) the cart's, from one unit's price as the cart shows it
    const inCart = unitPrice(line.unitPriceMinor!, line.measure!, base);
    expect(inCart, `${sku} in the cart`).toEqual({ ok: true, minor: want, base });
    // (b) the order line's, from its own price and its frozen measure
    const sold = order.lines.filter((l) => l.variantId === line.variantId && !l.gift);
    expect(sold.length, `${sku} on the order`).toBeGreaterThan(0);
    for (const ol of sold) {
      expect(ol.measure, `${sku} snapshot`).toEqual(line.measure);
      expect(ol.unitPriceMinor).toBe(line.unitPriceMinor);
      expect(unitPrice(ol.unitPriceMinor, ol.measure!, ol.measure!.base)).toEqual(inCart);
      expect(lineUnitPriceText(ol, order.currency, order.locale, t("nb"))).not.toBeNull();
      // (c) a business sees the price without VAT: the cart and the order line, each with its own rate, agree with the oracle
      const net = unitPriceShown(line.unitPriceMinor!, { rate: line.vatRate, shown: "excl" }, line.measure!, base).excl;
      const netSold = unitPriceShown(ol.unitPriceMinor, { rate: ol.taxRate, shown: "excl" }, ol.measure!, ol.measure!.base).excl;
      expect(netSold).toEqual(net);
      expect(net).toEqual({ ok: true, minor: await expectedUnitPrice(line.variantId, sku, { euro, planPercent, net: line.vatRate }), base });
    }
  }
  // A free product a campaign gave keeps its snapshot and draws no unit line.
  for (const gift of order.lines.filter((l) => l.gift)) {
    expect(lineUnitPriceText(gift, order.currency, order.locale, t("nb"))).toBeNull();
  }
}

type Scenario = {
  name: string;
  fill: () => Promise<void>;
  consent?: { digital?: boolean; subscription?: boolean };
  /** How each appointment is paid (D66), set before the cart is filled. */
  massage?: "now" | "deposit" | "venue";
  code?: string;
  /** Shown in euro instead of the country's own currency (D109). */
  euro?: boolean;
  /** Who buys (D108): in a discount group, or an employee of a company that gives half of one. */
  buyer?: "group" | "company";
  /** Campaigns running while it is bought (D114), made from the demo store's products. */
  campaigns?: () => Record<string, unknown>[];
  /** What they give: reductions, and free products added to the order. */
  gifts?: number;
  /** Lines with a time, confirmed once paid. */
  bookings: number;
  /** A carrier's service chosen at checkout (D135), instead of the flat rate: a pickup point, or home delivery. */
  delivery?: "pickup" | "home";
  /** A product that keeps selling past zero (wave 3, D172): its units beyond the stock are backordered, and the order says so without changing a price. */
  backorder?: { sku: string; stock: number; quantity: number; days: number };
  /** A gift message on the cart (wave 3, D173): the store has gift messages on, the buyer ticked it and wrote the words; they reach the order and change no money. */
  gift?: { to: string; from: string; message: string };
};

/** Puts a variant at a level and lets it keep selling past zero for `days`, as the owner's Inventory page does. */
async function shortOf(sku: string, stock: number, days: number) {
  await db().execute(sql`update commerce.product_variants set stock_policy = 'continue', backorder_days = ${days} where store_id = ${storeId}::uuid and id = ${variant[sku]}::uuid`);
  await db().execute(sql`update commerce.inventory_levels set on_hand = ${stock} where store_id = ${storeId}::uuid and variant_id = ${variant[sku]}::uuid`);
}

const scenarios: Scenario[] = [
  { name: "goods, with shipping", fill: () => add("DEMO-MUG-WHITE", 2), bookings: 0 },
  { name: "a download", fill: () => add("DEMO-LAMP", 1), consent: { digital: true }, bookings: 0 },
  {
    name: "a subscription",
    fill: async () => {
      // Every other month, 10 % off each delivery (D25).
      const [plan] = await db().execute<Row>(sql`
        insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
        values (${storeId}::uuid, ${product["demo-notatbok"]}::uuid, 'month', 2, 10) returning id
      `);
      await add("DEMO-NOTEBOOK-LINED", 1, undefined, String(plan.id));
    },
    consent: { subscription: true },
    bookings: 0,
  },
  { name: "an appointment paid now", fill: addAppointment, massage: "now", bookings: 1 },
  { name: "an appointment with a deposit", fill: addAppointment, massage: "deposit", bookings: 1 },
  { name: "a stay, two nights with a deposit", fill: () => addStay(2), bookings: 1 },
  { name: "a bike for two days", fill: () => addRental("DEMO-SYKKEL", "day", 2), bookings: 1 },
  { name: "a bike for half a day", fill: () => addRental("DEMO-SYKKEL-HALV", "half_day", 1), bookings: 1 },
  { name: "a bike for three hours", fill: () => addRental("DEMO-SYKKEL-TIME", "hour", 3), bookings: 1 },
  {
    name: "a stay, a massage and a mug with a discount code",
    fill: async () => {
      await addStay(2);
      await addAppointment();
      await add("DEMO-MUG-WHITE", 1);
    },
    massage: "deposit",
    code: `TI${run}`.toUpperCase(),
    bookings: 2,
  },
  { name: "goods for a customer in a discount group", fill: () => add("DEMO-MUG-WHITE", 3), buyer: "group", bookings: 0 },
  {
    name: "a stay, a massage and a mug with a code, for a company's employee",
    fill: async () => {
      await addStay(2);
      await addAppointment();
      await add("DEMO-MUG-WHITE", 1);
    },
    massage: "deposit",
    code: `TI${run}`.toUpperCase(),
    buyer: "company",
    bookings: 2,
  },
  {
    // A subscription is not lowered by the group's discount: only what is bought once.
    name: "goods and a subscription for a customer in a discount group",
    fill: async () => {
      const [plan] = await db().execute<Row>(sql`
        insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
        values (${storeId}::uuid, ${product["demo-notatbok"]}::uuid, 'month', 3, 0) returning id
      `);
      await add("DEMO-NOTEBOOK-LINED", 1, undefined, String(plan.id));
      await add("DEMO-MUG-WHITE", 2);
    },
    consent: { subscription: true },
    buyer: "group",
    bookings: 0,
  },
];

let tierId: string;
let companyId: string;
let homeCategory: string;

const percentCampaign = (percent: number, over: Record<string, unknown> = {}) => ({ name: `${percent} % off`, kind: "percent", percent, ...over });
const threeForTwo = (over: Record<string, unknown> = {}) => ({ name: "3 for 2", kind: "multi_buy", buyQuantity: 3, payQuantity: 2, ...over });
const freeNotebook = (over: Record<string, unknown> = {}) => ({ name: "Free notebook", kind: "gift", giftVariantId: variant["DEMO-NOTEBOOK-LINED"], thresholds: { NO: "1" }, ...over });

const campaignScenarios: Scenario[] = [
  { name: "goods with a percentage campaign", fill: () => add("DEMO-MUG-WHITE", 2), campaigns: () => [percentCampaign(20)], bookings: 0 },
  {
    name: "a 3 for 2 campaign on a category, over two products",
    fill: async () => {
      await add("DEMO-MUG-WHITE", 3);
      await add("DEMO-NOTEBOOK-LINED", 1);
    },
    campaigns: () => [threeForTwo({ scope: "some", termIds: [homeCategory] })],
    bookings: 0,
  },
  {
    name: "a free product over an amount",
    fill: () => add("DEMO-MUG-WHITE", 2),
    campaigns: () => [freeNotebook()],
    gifts: 1,
    bookings: 0,
  },
  {
    name: "campaigns with a customer group's discount and a code, on goods and a stay",
    fill: async () => {
      await addStay(2);
      await add("DEMO-MUG-WHITE", 3);
    },
    campaigns: () => [percentCampaign(15, { scope: "some", productIds: [product["demo-keramikkopp"]] }), freeNotebook({ thresholds: { NO: "100" } })],
    gifts: 1,
    code: `TI${run}`.toUpperCase(),
    buyer: "group",
    bookings: 1,
  },
  {
    name: "a campaign for a customer group with one that stacks, for a group member",
    fill: () => add("DEMO-MUG-WHITE", 2),
    campaigns: () => [percentCampaign(20, { tierIds: [tierId] }), percentCampaign(10, { stacks: true })],
    buyer: "group",
    bookings: 0,
  },
  {
    name: "a stacking percentage over a 3 for 2 for a group, for a company's employee",
    fill: () => add("DEMO-MUG-WHITE", 3),
    campaigns: () => [threeForTwo({ tierIds: [tierId] }), percentCampaign(10, { stacks: true })],
    buyer: "company",
    bookings: 0,
  },
  {
    name: "two 3 for 2 offers, the second on what the first left to pay for",
    fill: () => add("DEMO-MUG-WHITE", 6),
    campaigns: () => [threeForTwo(), threeForTwo({ name: "3 for 2, again", stacks: true })],
    bookings: 0,
  },
  {
    name: "a stacking 3 for 2 with a stacking percentage, for a group member, shown in euro",
    fill: () => add("DEMO-MUG-WHITE", 4),
    campaigns: () => [threeForTwo({ stacks: true }), percentCampaign(10, { stacks: true })],
    buyer: "group",
    euro: true,
    bookings: 0,
  },
  {
    name: "a 3 for 2 and a free product, for a company's employee, shown in euro",
    fill: () => add("DEMO-MUG-WHITE", 3),
    campaigns: () => [threeForTwo(), freeNotebook()],
    gifts: 1,
    buyer: "company",
    euro: true,
    bookings: 0,
  },
];

const euroScenarios: Scenario[] = [
  { name: "goods, shown in euro", fill: () => add("DEMO-MUG-WHITE", 2), euro: true, bookings: 0 },
  {
    name: "a stay, a massage and a mug with a code, for a company's employee, shown in euro",
    fill: async () => {
      await addStay(2);
      await addAppointment();
      await add("DEMO-MUG-WHITE", 1);
    },
    massage: "deposit",
    code: `TI${run}`.toUpperCase(),
    buyer: "company",
    euro: true,
    bookings: 2,
  },
  { name: "a bike for three hours, shown in euro", fill: () => addRental("DEMO-SYKKEL-TIME", "hour", 3), euro: true, bookings: 1 },
];

/**
 * Backorders (wave 3, D172): a mug with 1 left that keeps selling takes 3, so 2 are sold beyond the stock. The cart, the order, Stripe and the invoice
 * all carry the whole line at the shown price, and the order says how many units are on backorder and for how many days.
 */
const backorderScenarios: Scenario[] = [
  {
    name: "goods sold beyond the stock, with shipping",
    fill: async () => {
      await shortOf("DEMO-MUG-WHITE", 1, 7);
      await add("DEMO-MUG-WHITE", 3);
    },
    backorder: { sku: "DEMO-MUG-WHITE", stock: 1, quantity: 3, days: 7 },
    bookings: 0,
  },
  {
    name: "goods sold beyond the stock, shown in euro",
    fill: async () => {
      await shortOf("DEMO-MUG-WHITE", 0, 14);
      await add("DEMO-MUG-WHITE", 2);
    },
    euro: true,
    backorder: { sku: "DEMO-MUG-WHITE", stock: 0, quantity: 2, days: 14 },
    bookings: 0,
  },
];

/** A gift message (wave 3, D173): the words are the buyer's, reach the order, the confirmation and the slip, and change no amount, in kroner and in euro. */
const giftScenarios: Scenario[] = [
  { name: "goods as a gift with a message", fill: () => add("DEMO-MUG-WHITE", 2), gift: { to: "Lena", from: "Anna", message: "Grattis med dagen!\nMed kjærlig hilsen" }, bookings: 0 },
  { name: "goods as a gift, shown in euro", fill: () => add("DEMO-MUG-WHITE", 1), gift: { to: "Lena", from: "Anna", message: "Happy birthday" }, euro: true, bookings: 0 },
];

/** Posten / Bring's services chosen at checkout (D135): the price the shopper saw is the price of the order and of Stripe's charge. */
const deliveryScenarios: Scenario[] = [
  { name: "goods delivered to a pickup point", fill: () => add("DEMO-MUG-WHITE", 2), delivery: "pickup", bookings: 0 },
  { name: "goods delivered home, free above the store's limit", fill: () => add("DEMO-MUG-WHITE", 20), delivery: "home", bookings: 0 },
  { name: "goods delivered home, shown in euro", fill: () => add("DEMO-MUG-WHITE", 2), delivery: "home", euro: true, bookings: 0 },
  {
    name: "goods delivered to a pickup point with a discount code, for a group member, shown in euro",
    fill: () => add("DEMO-MUG-WHITE", 3),
    delivery: "pickup",
    code: `TI${run}`.toUpperCase(),
    buyer: "group",
    euro: true,
    bookings: 0,
  },
];

/** A signed-in customer, in a 10 % group or an employee of a company whose employees get half of it. */
async function signInBuyer(kind: "group" | "company"): Promise<string> {
  const customerId = await preRegisterCustomer(storeId, `${kind}-${Date.now()}-${run}@example.com`);
  if (kind === "group") {
    await db().execute(sql`update commerce.customers set tier_id = ${tierId}::uuid where id = ${customerId}::uuid`);
  } else {
    await db().execute(sql`update commerce.customers set company_id = ${companyId}::uuid, company_role = 'employee' where id = ${customerId}::uuid`);
  }
  await startSession(storeId, customerId);
  return customerId;
}

describe("checkout for every kind of product", () => {
  beforeAll(async () => {
    const [home] = await db().execute<Row>(sql`select id from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and slug = 'hjem'`);
    homeCategory = String(home.id);
    // Every scenario buys and pays: plenty on the shelf for all of them.
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
    const made = await saveDiscount(member, null, { code: `TI${run}`.toUpperCase(), kind: "percent", percent: 10 });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const [tier] = await db().execute<Row>(sql`
      insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'Wholesale', 10) returning id
    `);
    tierId = String(tier.id);
    const [company] = await db().execute<Row>(sql`
      insert into commerce.customer_companies (store_id, name, tier_id, employee_share_percent)
      values (${storeId}::uuid, 'Acme AS', ${tierId}::uuid, 50) returning id
    `);
    companyId = String(company.id);
  });

  it.each([...scenarios, ...euroScenarios, ...campaignScenarios, ...deliveryScenarios, ...backorderScenarios, ...giftScenarios])("$name: from the cart to the payment form to a paid order", async (scenario) => {
    jar.clear();
    view = scenario.euro ? noInEuro : no;
    // Campaigns run only in the scenarios that make them (D114).
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    for (const input of scenario.campaigns?.() ?? []) {
      const saved = await saveCampaign(member, null, input);
      if (!saved.ok) throw new Error(saved.problems.join(" "));
    }
    if (scenario.massage) {
      await db().execute(sql`
        update commerce.appointment_settings set payment = ${scenario.massage}, deposit_percent = 30
        where store_id = ${storeId}::uuid and product_id = ${product["demo-massasje"]}::uuid
      `);
    }
    const buyerId = scenario.buyer ? await signInBuyer(scenario.buyer) : null;
    await scenario.fill();
    if (scenario.code) expect(await setCartCode(shop(), scenario.code)).toBe(true);
    // The store's gift messages are on only while a gift scenario runs (D173).
    await db().execute(sql`
      insert into commerce.order_settings (store_id, gift_messages) values (${storeId}::uuid, ${Boolean(scenario.gift)})
      on conflict (store_id) do update set gift_messages = excluded.gift_messages
    `);
    if (scenario.gift) {
      expect(await getCartGift(shop())).toMatchObject({ enabled: true });
      expect(await setCartGift(shop(), { isGift: true, ...scenario.gift })).toMatchObject({ ok: true });
    }
    // The shopper asked for Bring's services for a postal code and chose one (D135).
    let chosenLabel: string | null = null;
    if (scenario.delivery) {
      expect(await quoteDelivery(shop(), cartId(), "0150")).toEqual({ ok: true });
      const listed = await deliveryOptionsFor(shop(), cartId(), { label: "Frakt", rate: null }, () => 0);
      expect(listed.postalCode).toBe("0150");
      // Only the services the store switched on, cheapest first; the mailbox parcel is not one.
      expect(listed.options.map((o) => o.label)).toEqual(["Pickup point", "Home delivery"]);
      const option = listed.options.find((o) => o.needsPickupPoint === (scenario.delivery === "pickup"))!;
      chosenLabel = option.label;
      // A service that needs a pickup point is not chosen without one, or with one that was not offered.
      if (option.needsPickupPoint) {
        expect(await chooseDelivery(shop(), cartId(), option.id)).toEqual({ ok: false, problem: "pickup_point" });
        expect(await chooseDelivery(shop(), cartId(), option.id, "elsewhere")).toEqual({ ok: false, problem: "pickup_point" });
      }
      expect(await chooseDelivery(shop(), cartId(), option.id, option.needsPickupPoint ? "pp-2" : undefined)).toEqual({ ok: true });
    }

    // The cart page (and the slide-out cart) show every line as fine, and what it all costs.
    const cart = await getCart(shop());
    expect(cart.lines.map((l) => l.status)).toEqual(cart.lines.map(() => "ok"));
    const summary = await cartSummary(shop(), cart);
    expect(summary.blocked).toBe(false);
    if (scenario.code) expect(summary.discountMinor).toBeGreaterThan(0);
    if (scenario.campaigns) expect(summary.campaignDiscountMinor + summary.gifts.length).toBeGreaterThan(0);
    expect(summary.gifts).toHaveLength(scenario.gifts ?? 0);
    expect(cart.currency).toBe(scenario.euro ? "EUR" : "NOK");
    if (scenario.buyer) expect(summary.member).toMatchObject({ percent: scenario.buyer === "group" ? 10 : 5 });
    else expect(summary.member).toBeNull();

    if (scenario.delivery) {
      expect(summary.delivery?.delivery).toMatchObject({ carrier: "bring", label: chosenLabel, postalCode: "0150" });
      // The price with VAT and the store's 10 %: 69 kr -> 86.25 -> 94.88 (pickup), 119 kr -> 148.75 -> 163.63 (home); in euro at 11.5.
      const base = scenario.delivery === "pickup" ? 9_488 : 16_363;
      const free = summary.subtotal >= (scenario.euro ? Math.round(250_000 / 11.5) : 250_000);
      expect(summary.shipping).toBe(free ? 0 : scenario.euro ? Math.round(base / 11.5) : base);
    }

    // "Til kassen": Kaizen's checkout page, with Stripe's form.
    const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", scenario.consent ?? {}, { customerId: buyerId });
    expect(started).toEqual({ ok: true, url: `${origin}/s/${slug}/${view.slug}/checkout` });
    const open = await getOpenCheckout(storeId, cartId());
    // The page shows the form, not "the cart has changed" with a button to start again.
    expect(open).toMatchObject({ changed: false, expired: false, clientSecret: expect.stringMatching(/_secret_test$/) });

    // The order is what the cart page showed: total, VAT, and what is left for the venue.
    const order = await getOrder(storeId, open!.orderId);
    expect({ total: order?.totalMinor, vat: order?.taxMinor, balance: order?.balanceMinor, member: order?.memberDiscountMinor, campaign: order?.campaignDiscountMinor, off: order?.discountMinor }).toEqual({
      total: summary.total,
      vat: summary.vat,
      balance: summary.balance,
      member: summary.memberDiscountMinor,
      campaign: summary.campaignDiscountMinor + summary.gifts.reduce((sum, gift) => sum + gift.unitPriceMinor * gift.quantity, 0),
      off: summary.discountMinor + summary.gifts.reduce((sum, gift) => sum + gift.unitPriceMinor * gift.quantity, 0),
    });
    await expectUnitPrices(cart, order!, scenario);
    // The gift is the buyer's words, kept on the order as typed, and moves no amount: the totals above already equal the cart's, which had no gift line.
    if (scenario.gift) {
      expect(order?.gift).toEqual({ isGift: true, to: scenario.gift.to, from: scenario.gift.from, message: scenario.gift.message });
      expect((await getCart(shop())).gift).toMatchObject({ isGift: true, message: scenario.gift.message });
      // A gift changed after checkout began is a changed cart: the form asks to start again instead of paying for a stale order.
      await setCartGift(shop(), { isGift: true, to: "Someone else", from: scenario.gift.from, message: scenario.gift.message });
      expect(await getOpenCheckout(storeId, cartId())).toMatchObject({ changed: true });
      await setCartGift(shop(), { isGift: true, ...scenario.gift });
      expect(await getOpenCheckout(storeId, cartId())).toMatchObject({ changed: false });
    } else {
      expect(order?.gift).toBeNull();
    }
    // A backordered line costs what the same line in stock would: whole quantity, the shown price, no surcharge (D172).
    if (scenario.backorder) {
      const wanted = scenario.backorder;
      const line = order!.lines.find((l) => l.sku === wanted.sku)!;
      const cartLine = cart.lines.find((l) => l.variantId === variant[wanted.sku])!;
      expect(line.quantity).toBe(wanted.quantity);
      expect(line.unitPriceMinor).toBe(cartLine.unitPriceMinor!);
      expect(line.totalMinor).toBe(cartLine.unitPriceMinor! * wanted.quantity);
      expect(line.backorder).toEqual({ units: wanted.quantity - wanted.stock, days: wanted.days });
      // The cart does not call the line out of stock and does not cap it at the shelf.
      expect(cartLine.status).toBe("ok");
    }
    // The free products are lines of the order, at no cost, and they are what the cart showed.
    expect(order?.lines.filter((l) => l.gift).map((l) => [l.variantId, l.quantity, l.totalMinor])).toEqual(summary.gifts.map((g) => [g.variantId, g.quantity, 0]));
    // The order keeps the delivery as it was chosen, and the shipping Stripe is told of carries its name.
    if (scenario.delivery) {
      expect(order?.shippingMinor).toBe(summary.shipping);
      expect(order?.delivery).toMatchObject({
        carrier: "bring",
        label: chosenLabel,
        postalCode: "0150",
        pickupPoint: scenario.delivery === "pickup" ? { id: "pp-2", name: "Butikken" } : null,
      });
      const named = (fake.created.at(-1)!.params.shipping_options as { shipping_rate_data: { display_name: string } }[] | undefined)?.[0];
      if (summary.shipping) expect(named?.shipping_rate_data.display_name).toBe(chosenLabel);
    } else {
      expect(order?.delivery).toBeNull();
    }
    // Stripe is asked for what is due now, no more and no less.
    const { params } = fake.created.at(-1)!;
    expect(chargedNow(params)).toBe(summary.dueNowMinor);
    // Stripe is asked in the currency shown, and the order is recorded in it.
    expect(order?.currency).toBe(scenario.euro ? "EUR" : "NOK");
    if (scenario.euro) expect(JSON.stringify(params)).toContain('"currency":"eur"');
    const [payment] = await db().execute<Row>(sql`
      select amount_minor from commerce.payments where order_id = ${open!.orderId}::uuid and provider = 'stripe'
    `);
    expect(Number(payment.amount_minor)).toBe(summary.dueNowMinor);

    // Paid: the order page shows it paid, with its times booked, and the checkout is over.
    fake.sessions.set(open!.sessionId, {
      status: "complete",
      payment_status: "paid",
      mode: params.mode,
      payment_intent: `pi_${open!.sessionId}`,
      ...(params.mode === "subscription" && { subscription: `sub_kinds_${run}_${open!.orderId}` }),
    });
    const paid = await getShopperOrder(storeId, open!.orderId, open!.sessionId);
    expect(paid?.status).toBe("paid");
    if (scenario.backorder) {
      // Paid, the order owns the stock it was sold: the level is below zero by exactly the backordered units, and the order line keeps them.
      const wanted = scenario.backorder;
      const [level] = await db().execute<Row>(sql`select sum(on_hand)::int as on_hand from commerce.inventory_levels where store_id = ${storeId}::uuid and variant_id = ${variant[wanted.sku]}::uuid`);
      expect(Number(level.on_hand)).toBe(wanted.stock - wanted.quantity);
      expect(paid?.lines.find((l) => l.sku === wanted.sku)?.backorder).toEqual({ units: wanted.quantity - wanted.stock, days: wanted.days });
      // Put the shelf back for the scenarios after it.
      await db().execute(sql`update commerce.product_variants set stock_policy = 'deny', backorder_days = null where store_id = ${storeId}::uuid and id = ${variant[wanted.sku]}::uuid`);
      await db().execute(sql`update commerce.inventory_levels set on_hand = 500 where store_id = ${storeId}::uuid and variant_id = ${variant[wanted.sku]}::uuid`);
    }
    const booked = paid?.lines.filter((l) => l.booking) ?? [];
    expect(booked.map((l) => l.booking?.status)).toEqual(Array(scenario.bookings).fill("confirmed"));
    expect(await getOpenCheckout(storeId, cartId())).toBeNull();
    // Its invoice and the credit notes of its refunds (D159) are the order and the refunds, to the minor unit, in the currency shown.
    await expectDocuments(open!.orderId, scenario);
    // The gift reaches the buyer's confirmation (and only the buyer's) and the packing slip, as text, and nothing is sent to the recipient (D173).
    if (scenario.gift) {
      await db().execute(sql`update commerce.orders set email = ${`gift-${run}@example.com`} where id = ${open!.orderId}::uuid`);
      await (await import("./shopper-emails")).sendOrderConfirmation(storeId, open!.orderId);
      const giftMails = await db().execute<Row>(sql`select to_address, text from commerce.email_messages where store_id = ${storeId}::uuid and order_id = ${open!.orderId}::uuid`);
      expect(giftMails.map((m) => String(m.to_address))).toEqual([`gift-${run}@example.com`]);
      expect(String(giftMails[0].text)).toContain(scenario.gift.message);
      const slips = await (await import("./packing-slips")).packingSlipData(storeId, [open!.orderId]);
      expect(slips.ok && slips.slips[0].gift).toEqual({ isGift: true, ...scenario.gift });
      // The slip prints no money: the order's total is not in what it is made from.
      expect(JSON.stringify(slips)).not.toContain(String(summary.total));
    }
    // The emails about it link back to the currency it was bought in (D109).
    if (scenario.euro) {
      await db().execute(sql`update commerce.orders set email = ${`shopper-${run}@example.com`} where id = ${open!.orderId}::uuid`);
      await (await import("./shopper-emails")).sendOrderConfirmation(storeId, open!.orderId);
      const mails = await db().execute<Row>(sql`
        select html from commerce.email_messages where store_id = ${storeId}::uuid and order_id = ${open!.orderId}::uuid
      `);
      expect(mails.length).toBeGreaterThan(0);
      for (const mail of mails) expect(String(mail.html)).not.toMatch(/\/no\/(order|account)/);
      expect(mails.some((mail) => String(mail.html).includes("/no-eur/order/"))).toBe(true);

      // The order file (D165): the order is in it in the currency it was charged, the main-currency columns are the store's own conversion at its
      // rate, and its lines and VAT add up to what the cart showed.
      const exporting = { ...member, store: { ...member.store, timeZone: "Europe/Oslo", markets: [no], localization: localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]) } as unknown as Store };
      const filedOrder = await (await import("./data-jobs")).requestOrderExport(exporting, { mode: "numbers", numbers: [order!.number], dialect: "standard" });
      if (!filedOrder.ok || filedOrder.mode !== "file") throw new Error(`order file ${JSON.stringify(filedOrder)}`);
      const { parseCsv } = await import("@/lib/csv");
      const parsedFile = parseCsv(filedOrder.csv);
      const [fileHeader, ...fileRows] = parsedFile.rows;
      const cell = (row: string[], name: string) => row[fileHeader.indexOf(name)] ?? "";
      const asMinor = (text: string) => (text === "" ? 0 : Math.round(Number(text) * 100));
      const first = fileRows[0];
      expect(cell(first, "currency")).toBe("EUR");
      expect(asMinor(cell(first, "total"))).toBe(summary.total);
      expect(asMinor(cell(first, "tax_total"))).toBe(summary.vat);
      expect(cell(first, "main_currency")).toBe("NOK");
      expect(cell(first, "main_rate")).toBe("11.5");
      expect(cell(first, "main_converted")).toBe("true");
      expect(asMinor(cell(first, "total_main"))).toBe(Math.round(summary.total * 11.5));
      expect(fileRows.reduce((n, r) => n + asMinor(cell(r, "line_tax")), 0) + asMinor(cell(first, "shipping_vat"))).toBe(summary.vat);

      // The shopper's data (D162, G2): the order is in the file in the currency it was charged, never converted, whatever its kind of line, and
      // erasing the person keeps the sale as it was: the amounts, VAT and discount do not move, and nothing is deleted.
      const { exportCustomerData } = await import("./privacy-export");
      const { eraseSubject } = await import("./privacy-erasure");
      const address = `shopper-${run}@example.com`;
      const exported = await exportCustomerData(storeId, { email: address }, { channel: "staff", accountId: member.account.id });
      if (!exported.ok) throw new Error(exported.problem);
      type Money = { amountMinor: number; currency: string };
      const filed = (exported.file.sections.orders as unknown as { id: string; currency: string; total: Money; tax: Money; discount: Money; lines: { booked: unknown }[] }[]).find((o) => o.id === open!.orderId)!;
      expect(filed.currency).toBe("EUR");
      expect(filed.total).toEqual({ amountMinor: summary.total, currency: "EUR" });
      expect(filed.tax).toEqual({ amountMinor: summary.vat, currency: "EUR" });
      expect(filed.discount.currency).toBe("EUR");
      expect(filed.lines.filter((l) => l.booked)).toHaveLength(scenario.bookings);
      const before = await getOrder(storeId, open!.orderId);
      expect(await eraseSubject(storeId, { email: address }, { channel: "staff", accountId: member.account.id })).toMatchObject({ ok: true, outcome: "erased" });
      const after = await getOrder(storeId, open!.orderId);
      expect({ total: after?.totalMinor, vat: after?.taxMinor, off: after?.discountMinor, currency: after?.currency, lines: after?.lines.length }).toEqual({
        total: before?.totalMinor,
        vat: before?.taxMinor,
        off: before?.discountMinor,
        currency: "EUR",
        lines: before?.lines.length,
      });
      const [kept] = await db().execute<Row>(sql`select restricted_at, anonymised_at, customer_id from commerce.orders where id = ${open!.orderId}::uuid`);
      expect(kept).toMatchObject({ anonymised_at: null, customer_id: null });
      expect(kept.restricted_at).not.toBeNull();
    }
  });
});

/**
 * The unit price in a krone store shown in euro (D160, D109): worked from the price the shopper reads, in euro, never converted from
 * the krone figure. A mug of 250 g at 49,99 kr is 4,35 euro shown (4999 / 11,5 rounded), so 17,40 euro per kg; converting the krone
 * figure (199,96 kr per kg) gives 17,39, which is not what the shop shows.
 */
describe("the unit price in euro (D160)", () => {
  it("is worked from the shown euro price, in the cart and on the order, and differs from the converted krone figure", async () => {
    const [{ id: mug }] = await db().execute<Row>(sql`select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = 'DEMO-MUG-WHITE'`);
    const [before] = await db().execute<Row>(sql`select amount_minor from commerce.current_prices where variant_id = ${String(mug)}::uuid and market_code = 'NO'`);
    await db().execute(sql`select commerce.set_price(${String(mug)}::uuid, 'NO', 4999)`);
    try {
      jar.clear();
      view = noInEuro;
      await add("DEMO-MUG-WHITE", 2);
      const cart = await getCart(shop());
      const line = cart.lines[0];
      expect(cart.currency).toBe("EUR");
      expect(line.unitPriceMinor).toBe(435);
      // 435 cents for 250 g: 1740 cents per kg, whatever the quantity.
      expect(unitPrice(line.unitPriceMinor!, line.measure!, line.measure!.base)).toEqual({ ok: true, minor: 1740, base: "kg" });
      const converted = Math.round((4999 * 4) / 11.5);
      expect(converted).toBe(1739);
      expect(1740).not.toBe(converted);

      const summary = await cartSummary(shop(), cart);
      await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId: null });
      const open = await getOpenCheckout(storeId, cartId());
      const order = (await getOrder(storeId, open!.orderId))!;
      expect(order.currency).toBe("EUR");
      // The unit price changes nothing the order charges.
      expect(order.totalMinor).toBe(summary.total);
      const ol = order.lines.find((l) => l.sku === "DEMO-MUG-WHITE")!;
      expect(ol.unitPriceMinor).toBe(435);
      expect(ol.measure).toEqual({ amount: "250", unit: "g", base: "kg" });
      expect(unitPrice(ol.unitPriceMinor, ol.measure!, ol.measure!.base)).toEqual({ ok: true, minor: 1740, base: "kg" });
      expect(lineUnitPriceText(ol, order.currency, order.locale, t("nb"))?.replace(/\s/g, " ")).toBe("17,40 €/kg");
      await expectUnitPrices(cart, order, { euro: true });
    } finally {
      await db().execute(sql`select commerce.set_price(${String(mug)}::uuid, 'NO', ${Number(before.amount_minor)})`);
      view = no;
    }
  });

  it("follows a business buyer's price without VAT and a purchase option's reduced price, and a free trial's plan price in the cart", async () => {
    jar.clear();
    view = no;
    const [plan] = await db().execute<Row>(sql`
      insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent, trial_days)
      values (${storeId}::uuid, ${product["demo-notatbok"]}::uuid, 'month', 1, 10, 14) returning id
    `);
    await add("DEMO-NOTEBOOK-LINED", 2, undefined, String(plan.id));
    const cart = await getCart(shop());
    const line = cart.lines[0];
    // 129 kr less 10 % is 116,10 kr for 120 g: 96,75 kr per 100 g. The cart shows the plan's price in a trial.
    expect(line.unitPriceMinor).toBe(11610);
    expect(unitPrice(line.unitPriceMinor!, line.measure!, "100g")).toEqual({ ok: true, minor: 9675, base: "100g" });
    // A business sees the price without VAT, netted first: 116,10 kr less 25 % VAT included is 92,88 kr.
    const net = 11610 - Math.round((11610 * 0.25) / 1.25);
    expect(net).toBe(9288);
    expect(unitPriceShown(11610, { rate: 0.25, shown: "excl" }, line.measure!, "100g").excl).toEqual({ ok: true, minor: Math.round((9288 * 100) / 120), base: "100g" });
    // In the free trial today's price is nothing, so the order line, which keeps today's price, has no unit price: the cart has it.
    const { placeOrder } = await import("./checkout");
    const placed = await placeOrder({ storeId, market: no }, cartId(), { subscription: true });
    if (!placed.ok) throw new Error(placed.problem);
    const order = (await getOrder(storeId, placed.order.orderId))!;
    const ol = order.lines.find((l) => l.sku === "DEMO-NOTEBOOK-LINED")!;
    expect(ol.measure).toEqual({ amount: "120", unit: "g", base: "100g" });
    expect(ol.unitPriceMinor).toBe(0);
    expect(lineUnitPriceText(ol, order.currency, order.locale, t("nb"))).toBeNull();
    await db().execute(sql`update commerce.selling_plans set active = false where id = ${String(plan.id)}::uuid`);
  });
});

/**
 * The rules as read (D160): no market compares per 100 g, so the notebook, whose owner chose 100 g, is compared per kg in Norway
 * with the table as it is. The cart's unit price, the order line's and an independent reader's agree, and the totals are the
 * same as with the small base.
 */
describe("the unit price with the country table as read (D160)", () => {
  it("compares the notebook per kg, not per 100 g, in the cart and on the order, and changes no money", async () => {
    const totalOf = async () => {
      jar.clear();
      view = no;
      await add("DEMO-NOTEBOOK-LINED", 2);
      const cart = await getCart(shop());
      const { placeOrder } = await import("./checkout");
      const placed = await placeOrder({ storeId, market: no }, cartId());
      if (!placed.ok) throw new Error(placed.problem);
      const order = (await getOrder(storeId, placed.order.orderId))!;
      await (await import("./checkout")).cancelUnpaidOrder(placed.order.orderId, "test");
      return { cart, order, orderId: placed.order.orderId };
    };
    const open = await totalOf();
    expect(open.cart.lines[0].measure).toEqual({ amount: "120", unit: "g", base: "100g" });
    restoreSmallBase();
    try {
      const closed = await totalOf();
      const line = closed.cart.lines[0];
      expect(line.measure).toEqual({ amount: "120", unit: "g", base: "kg" });
      // 129 kr for 120 g is 1 075 kr per kg, by integer arithmetic of its own (half up).
      const price = BigInt(line.unitPriceMinor!);
      const want = Number((price * BigInt(1000) * BigInt(2) + BigInt(120)) / (BigInt(2) * BigInt(120)));
      expect(unitPrice(line.unitPriceMinor!, line.measure!, "kg")).toEqual({ ok: true, minor: want, base: "kg" });
      const sold = closed.order.lines.find((l) => l.sku === "DEMO-NOTEBOOK-LINED")!;
      expect(sold.measure).toEqual({ amount: "120", unit: "g", base: "kg" });
      expect(unitPrice(sold.unitPriceMinor, sold.measure!, sold.measure!.base)).toEqual({ ok: true, minor: want, base: "kg" });
      const rows = await db().execute<Row>(sql`select measure_base from commerce.order_lines where order_id = ${closed.orderId}::uuid and sku = 'DEMO-NOTEBOOK-LINED'`);
      expect(rows[0].measure_base).toBe("kg");
      // The small base changes no money.
      expect(closed.order.totalMinor).toBe(open.order.totalMinor);
      expect(closed.order.taxMinor).toBe(open.order.taxMinor);
    } finally {
      restoreSmallBase = allowSmallBase("NO");
    }
  });
});

describe("campaigns with limits (D115)", () => {
  const cancel = async (orderId: string) => (await import("./checkout")).cancelUnpaidOrder(orderId, "test");

  it("go only to the customer groups they are for, and to no one who is not signed in", async () => {
    jar.clear();
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    await saveCampaign(member, null, percentCampaign(30, { tierIds: [tierId] }));
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBe(0);
    // A member of the group gets it; so does an employee of a company in it; not someone in no group.
    jar.clear();
    await signInBuyer("group");
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBeGreaterThan(0);
    jar.clear();
    await signInBuyer("company");
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBeGreaterThan(0);
    jar.clear();
    const stranger = await preRegisterCustomer(storeId, `nogroup-${Date.now()}-${run}@example.com`);
    await startSession(storeId, stranger);
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBe(0);
  });

  it("go to a customer a number of orders, only when they are signed in", async () => {
    jar.clear();
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    await saveCampaign(member, null, percentCampaign(40, { perCustomerLimit: 1 }));
    // Not signed in: it cannot be told who has had it.
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBe(0);

    jar.clear();
    const customerId = await signInBuyer("group");
    await add("DEMO-MUG-WHITE", 1);
    const first = await cartSummary(shop(), await getCart(shop()));
    expect(first.campaignDiscountMinor).toBeGreaterThan(0);
    expect(await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId })).toMatchObject({ ok: true });
    const open = await getOpenCheckout(storeId, cartId());
    // The same customer's next order is over the limit, while another customer still gets it.
    jar.clear();
    await startSession(storeId, customerId);
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBe(0);
    jar.clear();
    await signInBuyer("company");
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBeGreaterThan(0);
    // A cancelled checkout gives the use back.
    await (await import("./checkout")).cancelUnpaidOrder(open!.orderId, "test");
    jar.clear();
    await startSession(storeId, customerId);
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBeGreaterThan(0);
  });

  it("run only in the countries they name", async () => {
    jar.clear();
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    await db().execute(sql`insert into commerce.campaigns (store_id, name, kind, percent, markets) values (${storeId}::uuid, 'Kun Sverige', 'percent', 30, '["SE"]'::jsonb)`);
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBe(0);
    await db().execute(sql`update commerce.campaigns set markets = '["NO", "SE"]'::jsonb where store_id = ${storeId}::uuid`);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBeGreaterThan(0);
    await db().execute(sql`update commerce.campaigns set markets = '[]'::jsonb where store_id = ${storeId}::uuid`);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBeGreaterThan(0);
  });

  it("stop when their orders are used up, and give a use back when a checkout is cancelled", async () => {
    jar.clear();
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    await saveCampaign(member, null, percentCampaign(50, { usageLimit: 1 }));
    await add("DEMO-MUG-WHITE", 1);
    const first = await cartSummary(shop(), await getCart(shop()));
    expect(first.campaignDiscountMinor).toBeGreaterThan(0);
    const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId: null });
    expect(started).toMatchObject({ ok: true });
    const open = await getOpenCheckout(storeId, cartId());
    const order = await getOrder(storeId, open!.orderId);
    expect(order?.campaignDiscountMinor).toBe(first.campaignDiscountMinor);
    expect(order?.campaignLabel).toBe("50 % off");

    // The one order took the only use, even while it waits for payment.
    jar.clear();
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBe(0);
    const [again] = await db().execute<Row>(sql`select count(*)::int as n from commerce.campaigns where store_id = ${storeId}::uuid`);
    expect(Number(again.n)).toBe(1);
    // And checkout cannot take a use that is gone: the order is placed at the full price.
    const second = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId: null });
    expect(second).toMatchObject({ ok: true });
    const secondOrder = await getOrder(storeId, (await getOpenCheckout(storeId, cartId()))!.orderId);
    expect(secondOrder?.campaignDiscountMinor).toBe(0);

    // A cancelled checkout gives the use back.
    await cancel(open!.orderId);
    jar.clear();
    await add("DEMO-MUG-WHITE", 1);
    expect((await cartSummary(shop(), await getCart(shop()))).campaignDiscountMinor).toBeGreaterThan(0);
  });
});

/**
 * Bonus credits (D130) in every kind of basket: what the cart page shows is what checkout charges to the minor unit,
 * the credits are held against the order and given back or kept by how it ends, and what it earns is what the database
 * says it should.
 */
describe("checkout with bonus credits (D130)", () => {
  const rates = new Map([["NOK", { rate: 11.5 }], ["EUR", { rate: 1 }]]);
  const START = 500_000; // 5 000 NOK of credits, usable now
  const cancel = async (orderId: string) => (await import("./checkout")).cancelUnpaidOrder(orderId, "test");

  const program = (over: { enabled?: boolean; maxPercent?: number; minRedeem?: number; earnBps?: number; pendingDays?: number } = {}) =>
    db().execute(sql`
      insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, currency)
      values (${storeId}::uuid, ${over.enabled ?? true}, ${over.earnBps ?? 500}, ${over.pendingDays ?? 14}, ${over.maxPercent ?? 50}, ${over.minRedeem ?? 0}, 'NOK')
      on conflict (store_id) do update set enabled = excluded.enabled, earn_bps = excluded.earn_bps, pending_days = excluded.pending_days,
        max_redeem_percent = excluded.max_redeem_percent, min_redeem_minor = excluded.min_redeem_minor
    `);

  /** Signs a shopper in (in a group or a company when asked) with credits they can use now. */
  async function shopper(kind?: "group" | "company", credits = START): Promise<string> {
    const id = kind
      ? await signInBuyer(kind)
      : await (async () => {
          const created = await preRegisterCustomer(storeId, `bonus-${Date.now()}-${Math.random().toString(36).slice(2)}-${run}@example.com`);
          await startSession(storeId, created);
          return created;
        })();
    if (credits > 0) await db().execute(sql`select commerce.bonus_adjust(${storeId}::uuid, ${id}::uuid, ${credits}, 'test credits', null, ${`test-${id}`})`);
    return id;
  }

  /** What the ledger says, in the credits' currency. */
  const ledger = async (customerId: string) => {
    const [row] = await db().execute<Row>(sql`select * from commerce.bonus_balance(${storeId}::uuid, ${customerId}::uuid)`);
    return { available: Number(row.available_minor), pending: Number(row.pending_minor) };
  };
  const verified = async (customerId: string) => {
    const [row] = await db().execute<Row>(sql`select commerce.bonus_verify(${storeId}::uuid, ${customerId}::uuid) as ok`);
    return Boolean(row.ok);
  };
  /** Moves a customer's ledger back in time: the ledger is immutable, but a test may pull the trigger. */
  async function age(customerId: string, days: number) {
    await db().execute(sql`alter table commerce.bonus_entries disable trigger bonus_entries_immutable`);
    await db().execute(sql`
      update commerce.bonus_entries set created_at = created_at - make_interval(days => ${days}), available_at = available_at - make_interval(days => ${days}),
        expires_at = expires_at - make_interval(days => ${days}) where customer_id = ${customerId}::uuid
    `);
    await db().execute(sql`alter table commerce.bonus_entries enable trigger bonus_entries_immutable`);
  }
  const used = async (orderId: string) => {
    const [row] = await db().execute<Row>(sql`select coalesce(-sum(amount_minor), 0)::bigint as n from commerce.bonus_entries where order_id = ${orderId}::uuid and kind = 'redeem'`);
    return Number(row.n);
  };
  /** What an order paid online for goods, as the database counts it. */
  const onlineGoods = async (orderId: string) => {
    const [row] = await db().execute<Row>(sql`select coalesce(sum(total_minor - venue_minor), 0)::bigint as n from commerce.order_lines where order_id = ${orderId}::uuid`);
    return Number(row.n);
  };
  const toNok = (minor: number, currency: string, rounding: "down" | "up") => convertCredits(minor, currency, "NOK", rates, rounding)!;

  /** The shopper pays on Stripe's form: the order page learns of it, as it does when they return. */
  async function pay(open: { orderId: string; sessionId: string }, params: Record<string, unknown>) {
    fake.sessions.set(open.sessionId, {
      status: "complete",
      payment_status: "paid",
      mode: params.mode,
      payment_intent: `pi_${open.sessionId}`,
      ...(params.mode === "subscription" && { subscription: `sub_bonus_${run}_${open.orderId}` }),
    });
    return getShopperOrder(storeId, open.orderId, open.sessionId);
  }

  beforeAll(async () => {
    const [home] = await db().execute<Row>(sql`select id from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and slug = 'hjem'`);
    homeCategory = String(home.id);
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
    await program();
    // The group, the company and the code the other scenarios made, when this describe runs alone.
    let [tier] = await db().execute<Row>(sql`select id from commerce.customer_tiers where store_id = ${storeId}::uuid limit 1`);
    tier ??= (await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'Wholesale', 10) returning id`))[0];
    tierId = String(tier.id);
    let [company] = await db().execute<Row>(sql`select id from commerce.customer_companies where store_id = ${storeId}::uuid limit 1`);
    company ??= (
      await db().execute<Row>(sql`
        insert into commerce.customer_companies (store_id, name, tier_id, employee_share_percent) values (${storeId}::uuid, 'Acme AS', ${tierId}::uuid, 50) returning id
      `)
    )[0];
    companyId = String(company.id);
    const [code] = await db().execute<Row>(sql`select id from commerce.discount_codes where store_id = ${storeId}::uuid and code = ${`TI${run}`.toUpperCase()}`);
    if (!code) {
      const made = await saveDiscount(member, null, { code: `TI${run}`.toUpperCase(), kind: "percent", percent: 10 });
      if (!made.ok) throw new Error(made.problems.join(" "));
    }
  });
  afterAll(async () => {
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    await db().execute(sql`update commerce.bonus_settings set enabled = false where store_id = ${storeId}::uuid`);
  });

  type CreditScenario = Scenario & { /** Nothing can be paid with credits in it (no goods bought once that are due online). */ none?: boolean; company?: boolean };
  const creditScenarios: CreditScenario[] = [
    { name: "goods, with shipping", fill: () => add("DEMO-MUG-WHITE", 2), bookings: 0 },
    { name: "a download", fill: () => add("DEMO-LAMP", 1), consent: { digital: true }, bookings: 0 },
    {
      name: "a subscription with a mug bought once",
      fill: async () => {
        const [plan] = await db().execute<Row>(sql`
          insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
          values (${storeId}::uuid, ${product["demo-notatbok"]}::uuid, 'month', 2, 10) returning id
        `);
        await add("DEMO-NOTEBOOK-LINED", 1, undefined, String(plan.id));
        await add("DEMO-MUG-WHITE", 2);
      },
      consent: { subscription: true },
      bookings: 0,
    },
    {
      name: "a subscription alone: nothing to pay with credits",
      fill: async () => {
        const [plan] = await db().execute<Row>(sql`
          insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
          values (${storeId}::uuid, ${product["demo-notatbok"]}::uuid, 'month', 2, 10) returning id
        `);
        await add("DEMO-NOTEBOOK-LINED", 1, undefined, String(plan.id));
      },
      consent: { subscription: true },
      none: true,
      bookings: 0,
    },
    { name: "an appointment paid now", fill: addAppointment, massage: "now", bookings: 1 },
    { name: "an appointment with a deposit: only what is paid online", fill: addAppointment, massage: "deposit", bookings: 1 },
    { name: "an appointment paid at the venue: nothing online to pay with credits", fill: addAppointment, massage: "venue", none: true, bookings: 1 },
    { name: "a stay, two nights with a deposit", fill: () => addStay(2), bookings: 1 },
    { name: "a bike for two days", fill: () => addRental("DEMO-SYKKEL", "day", 2), bookings: 1 },
    { name: "a bike for three hours", fill: () => addRental("DEMO-SYKKEL-TIME", "hour", 3), bookings: 1 },
    {
      name: "a stay, a massage and a mug with a code, for a group member",
      fill: async () => {
        await addStay(2);
        await addAppointment();
        await add("DEMO-MUG-WHITE", 1);
      },
      massage: "deposit",
      code: `TI${run}`.toUpperCase(),
      buyer: "group",
      bookings: 2,
    },
    {
      name: "goods for a business buying for its company",
      fill: () => add("DEMO-MUG-WHITE", 3),
      company: true,
      bookings: 0,
    },
    {
      name: "a free product, a 3 for 2, a group's discount and a code, together with credits",
      fill: async () => {
        await addStay(2);
        await add("DEMO-MUG-WHITE", 3);
      },
      campaigns: () => [threeForTwo(), freeNotebook({ thresholds: { NO: "100" } })],
      gifts: 1,
      code: `TI${run}`.toUpperCase(),
      buyer: "group",
      bookings: 1,
    },
    { name: "goods, shown in euro", fill: () => add("DEMO-MUG-WHITE", 2), euro: true, bookings: 0 },
    {
      name: "a mug and a massage with a deposit and a code, for a company's employee, shown in euro",
      fill: async () => {
        await addAppointment();
        await add("DEMO-MUG-WHITE", 2);
      },
      massage: "deposit",
      code: `TI${run}`.toUpperCase(),
      buyer: "company",
      euro: true,
      bookings: 1,
    },
    {
      name: "campaigns and a group's discount, shown in euro",
      fill: () => add("DEMO-MUG-WHITE", 4),
      campaigns: () => [threeForTwo({ stacks: true }), percentCampaign(10, { stacks: true })],
      buyer: "group",
      euro: true,
      bookings: 0,
    },
  ];

  it.each(creditScenarios)("$name: what the cart shows is what is charged, held, and earned", async (scenario) => {
    jar.clear();
    view = scenario.euro ? noInEuro : no;
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    for (const input of scenario.campaigns?.() ?? []) {
      const saved = await saveCampaign(member, null, input);
      if (!saved.ok) throw new Error(saved.problems.join(" "));
    }
    await db().execute(sql`
      update commerce.appointment_settings set payment = ${scenario.massage ?? "now"}, deposit_percent = 30
      where store_id = ${storeId}::uuid and product_id = ${product["demo-massasje"]}::uuid
    `);
    const buyerId = await shopper(scenario.buyer);
    await scenario.fill();
    if (scenario.code) expect(await setCartCode(shop(), scenario.code)).toBe(true);
    if (scenario.company) await setCartCompany(shop(), { name: "Acme AS", number: "923456789" });

    // The shopper asks to use all they can.
    const asked = await setCartCredits(shop(), cartId(), buyerId, 1_000_000_000);
    const cart = await getCart(shop());
    expect(cart.lines.map((l) => l.status)).toEqual(cart.lines.map(() => "ok"));
    const summary = await cartSummary(shop(), cart);
    expect(summary.blocked).toBe(false);
    if (scenario.none) {
      expect(asked.ok).toBe(false);
      expect(summary.bonusMinor).toBe(0);
      expect(summary.bonus.maxUsableMinor).toBe(0);
    } else {
      expect(asked).toMatchObject({ ok: true });
      expect(summary.bonusMinor).toBeGreaterThan(0);
      expect(asked).toMatchObject({ usingMinor: summary.bonusMinor });
    }
    expect(summary.bonus).toMatchObject({ enabled: true, signedIn: true, usingMinor: summary.bonusMinor, earnPercent: 5, pendingDays: 14 });
    // Credits are off the goods, never more than half of them, and what is left to pay is never below the provider's least.
    expect(summary.bonusMinor).toBeLessThanOrEqual(Math.floor(summary.subtotal / 2));
    if (summary.dueNowMinor > 0) expect(summary.dueNowMinor).toBeGreaterThanOrEqual(view.currency === "EUR" ? 50 : 300);
    // `discountMinor` (codes, group, campaigns) leaves the credits out: they are their own line.
    expect(summary.total).toBe(summary.subtotal + summary.feeMinor + (summary.shipping ?? 0) - summary.discountMinor - summary.bonusMinor);
    expect(summary.payable.length > 0 && (summary.bonusLine(0) >= 0)).toBe(true);

    const before = await ledger(buyerId);
    const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", scenario.consent ?? {}, {
      customerId: buyerId,
      contact: { name: "Kari", email: `kari-${run}@example.com`, phone: "99999999" },
    });
    if (scenario.none) {
      // Nothing to pay online with credits may still be a booking paid at the venue, which is confirmed at once.
      expect(started).toMatchObject({ ok: true });
      const placed = await db().execute<Row>(sql`select id, credit_minor from commerce.orders where customer_id = ${buyerId}::uuid order by placed_at desc limit 1`);
      expect(Number(placed[0].credit_minor)).toBe(0);
      expect((await ledger(buyerId)).available).toBe(before.available);
      return;
    }
    expect(started).toEqual({ ok: true, url: `${origin}/s/${slug}/${view.slug}/checkout` });
    const open = await getOpenCheckout(storeId, cartId());
    expect(open).toMatchObject({ changed: false, expired: false, clientSecret: expect.stringMatching(/_secret_test$/) });

    // The order is what the cart showed, and the credits are its own line inside the discount.
    const order = await getOrder(storeId, open!.orderId);
    const giftValue = summary.gifts.reduce((sum, gift) => sum + gift.unitPriceMinor * gift.quantity, 0);
    expect({ total: order?.totalMinor, vat: order?.taxMinor, balance: order?.balanceMinor, credit: order?.creditMinor, off: order?.discountMinor }).toEqual({
      total: summary.total,
      vat: summary.vat,
      balance: summary.balance,
      credit: summary.bonusMinor,
      off: summary.discountMinor + giftValue,
    });
    expect(order?.bonus).toMatchObject({ usedMinor: summary.bonusMinor, earnedMinor: 0 });
    const lines = await db().execute<Row>(sql`select discount_minor, bonus_discount_minor, total_minor, venue_minor, gift from commerce.order_lines where order_id = ${open!.orderId}::uuid`);
    expect(lines.reduce((sum, l) => sum + Number(l.bonus_discount_minor), 0)).toBe(summary.bonusMinor);
    for (const l of lines) {
      expect(Number(l.bonus_discount_minor)).toBeLessThanOrEqual(Number(l.discount_minor));
      expect(Number(l.venue_minor)).toBeLessThanOrEqual(Number(l.total_minor));
      if (l.gift) expect(Number(l.bonus_discount_minor)).toBe(0);
    }
    // Stripe is asked for what is due now, with the credits inside its coupon (or in each line's amount for a deposit).
    const { params } = fake.created.at(-1)!;
    expect(chargedNow(params)).toBe(summary.dueNowMinor);
    expect(JSON.stringify(params)).not.toContain("payment_method_types");
    const [payment] = await db().execute<Row>(sql`select amount_minor from commerce.payments where order_id = ${open!.orderId}::uuid and provider = 'stripe'`);
    expect(Number(payment.amount_minor)).toBe(summary.dueNowMinor);
    // The credits are held: the ledger gave them up, in the credits' currency, rounded so it never promises more than there is.
    const debit = toNok(summary.bonusMinor, order!.currency, "up");
    expect(await used(open!.orderId)).toBe(debit);
    expect((await ledger(buyerId)).available).toBe(before.available - debit);
    // The cart asks for what the order used: nothing changed, so checkout does not ask to start again.
    expect(await getOpenCheckout(storeId, cartId())).toMatchObject({ changed: false });

    // Paid: it earns 5 % of what was paid online for goods, as the cart said it would, usable after the return period.
    const paid = await pay(open!, params);
    expect(paid?.status).toBe("paid");
    const base = await onlineGoods(open!.orderId);
    const earned = earnAmount(base, 500);
    expect(summary.bonus.willEarnMinor).toBe(earned);
    const done = await getOrder(storeId, open!.orderId);
    expect(done?.bonus).toMatchObject({ usedMinor: summary.bonusMinor, earnedMinor: earned });
    if (earned > 0) {
      expect(new Date(done!.bonus!.availableAt!).getTime()).toBeGreaterThan(Date.now() + 13 * 86_400_000);
      const after = await ledger(buyerId);
      expect(after.pending).toBe(before.pending + toNok(earned, order!.currency, "down"));
      expect(after.available).toBe(before.available - debit);
    }
    expect(await verified(buyerId)).toBe(true);
    // Paying a second time changes nothing.
    await pay(open!, params);
    expect(await used(open!.orderId)).toBe(debit);
    expect((await ledger(buyerId)).pending).toBe(before.pending + toNok(earned, order!.currency, "down"));
  });

  /** A cart for the signed-in shopper with what `fill` adds, credits asked for (all by default); the checkout, unpaid. */
  async function checkout(buyerId: string | null, fill: () => Promise<void>, ask: number | null = 1_000_000_000, consent: { digital?: boolean } = {}) {
    jar.clear();
    view = no;
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    if (buyerId) await startSession(storeId, buyerId);
    await fill();
    const asked = ask === null || !buyerId ? null : await setCartCredits(shop(), cartId(), buyerId, ask);
    const summary = await cartSummary(shop(), await getCart(shop()));
    const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", consent, { customerId: buyerId });
    const open = await getOpenCheckout(storeId, cartId());
    return { asked, summary, started, open, params: fake.created.at(-1)!.params, cart: cartId() };
  }

  it("uses at most the owner's percentage of the goods, what the customer has, and never leaves less than the provider's least", async () => {
    const buyer = await shopper(undefined, 10_000);
    // Two mugs, 498 NOK, and 99 of shipping: half of the goods is 249, but the customer has 100.
    const small = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    expect(small.summary.bonusMinor).toBe(10_000);
    expect(small.summary.dueNowMinor).toBe(49_800 + 9_900 - 10_000);
    const rich = await shopper(undefined, START);
    const half = await checkout(rich, () => add("DEMO-MUG-WHITE", 2));
    expect(half.summary.bonusMinor).toBe(24_900);
    // Asking for less uses less; asking for more is brought down.
    const less = await checkout(rich, () => add("DEMO-MUG-WHITE", 2), 5_000);
    expect(less.summary.bonusMinor).toBe(5_000);
    expect(less.asked).toMatchObject({ ok: true, usingMinor: 5_000 });
    // A code that leaves 4 NOK of a download to pay: credits may take only what leaves the provider's 3 NOK.
    const made = await saveDiscount(member, null, { code: `FIX${run}`.toUpperCase(), kind: "fixed", amounts: { NO: "895" } });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const tiny = await checkout(rich, async () => {
      await add("DEMO-LAMP", 1);
      expect(await setCartCode(shop(), `FIX${run}`.toUpperCase())).toBe(true);
    }, 1_000_000_000, { digital: true });
    expect(tiny.summary.dueNowMinor).toBe(300);
    expect(tiny.summary.bonusMinor).toBe(100);
    expect(chargedNow(tiny.params)).toBe(300);
    expect(tiny.summary.total).toBe(300);
    // Another customer who has only credits that are not usable yet, or none, uses nothing.
    const pendingOnly = await shopper(undefined, 0);
    await db().execute(sql`select commerce.bonus_grant(${storeId}::uuid, ${pendingOnly}::uuid, 'adjust', 50000, null, null, now() + interval '3 days', null, 'later', null, ${`later-${pendingOnly}`})`);
    const none = await checkout(pendingOnly, () => add("DEMO-MUG-WHITE", 2));
    expect(none.summary.bonus).toMatchObject({ availableMinor: 0, pendingMinor: 50_000, maxUsableMinor: 0, usingMinor: 0 });
    expect(none.summary.bonus.pendingAvailableAt).not.toBeNull();
    expect(none.asked).toMatchObject({ ok: false });
  });

  it("uses nothing below the owner's minimum", async () => {
    await program({ minRedeem: 20_000 });
    try {
      const buyer = await shopper();
      // One mug: half of it is 124.50, under the 200 minimum.
      const one = await checkout(buyer, () => add("DEMO-MUG-WHITE", 1));
      expect(one.summary.bonusMinor).toBe(0);
      expect(one.asked).toMatchObject({ ok: false });
      const two = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
      expect(two.summary.bonusMinor).toBe(24_900);
      // Asking for less than the minimum is refused with the reason, not silently ignored.
      const tooLittle = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2), 100);
      expect(tooLittle.asked).toMatchObject({ ok: false, problems: [expect.stringContaining("The least you can use at once")] });
      expect(tooLittle.summary.bonusMinor).toBe(0);
    } finally {
      await program();
    }
  });

  it("holds credits against an unpaid order, gives them back when it is cancelled, and takes them again if it is paid after all", async () => {
    const buyer = await shopper();
    const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    expect((await ledger(buyer)).available).toBe(START - 24_900);
    const orderId = placed.open!.orderId;
    expect(await cancel(orderId)).toBe(true);
    expect((await ledger(buyer)).available).toBe(START);
    // Cancelling again gives nothing twice.
    await cancel(orderId);
    expect((await ledger(buyer)).available).toBe(START);
    // The shopper asks again from the same cart: the credits are held again, by a new order.
    const again = await startCheckout({ ...shop(), storeSlug: slug }, placed.cart, origin, "Frakt", {}, { customerId: buyer });
    expect(again).toMatchObject({ ok: true });
    expect((await ledger(buyer)).available).toBe(START - 24_900);
    const second = (await getOpenCheckout(storeId, placed.cart))!;
    // The first one is paid after all (the session had been completed while we thought it expired): its credits are taken again.
    const { completeOrderPayment } = await import("./checkout");
    expect(await completeOrderPayment(orderId, "late")).toBe(true);
    expect((await ledger(buyer)).available).toBe(START - 2 * 24_900);
    expect((await getOrder(storeId, orderId))?.bonus).toMatchObject({ usedMinor: 24_900 });
    expect(await verified(buyer)).toBe(true);
    await cancel(second.orderId);
    expect((await ledger(buyer)).available).toBe(START - 24_900);
  });

  it("releases credits held by an unpaid order that lapsed without a word from the payment provider", async () => {
    const buyer = await shopper();
    const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    const { runBonusJobs } = await import("./bonus");
    expect((await runBonusJobs()).released).toBe(0);
    expect((await ledger(buyer)).available).toBe(START - 24_900);
    await db().execute(sql`update commerce.orders set placed_at = now() - interval '3 hours' where id = ${placed.open!.orderId}::uuid`);
    expect((await runBonusJobs()).released).toBe(1);
    expect((await ledger(buyer)).available).toBe(START);
    expect((await getOrder(storeId, placed.open!.orderId))?.status).toBe("cancelled");
    expect((await runBonusJobs()).released).toBe(0);
  });

  it("takes back what a refunded part earned and returns the refunded share of what was used, whichever way it is cut", async () => {
    const buyer = await shopper();
    const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    const orderId = placed.open!.orderId;
    await pay(placed.open!, placed.params);
    const dueNow = placed.summary.dueNowMinor;
    const usedCredits = placed.summary.bonusMinor;
    const [grant] = await db().execute<Row>(sql`select amount_minor from commerce.bonus_entries where order_id = ${orderId}::uuid and kind = 'earn'`);
    const earned = Number(grant.amount_minor);
    expect(earned).toBe(earnAmount(await onlineGoods(orderId), 500));
    const start = await ledger(buyer);
    expect(start).toEqual({ available: START - usedCredits, pending: earned });

    // A third of what was paid goes back.
    const third = Math.floor(dueNow / 3);
    const out = await refundOrder(storeId, orderId, { amountMinor: third, reason: "a third", restock: [] }, member.account.id);
    expect(out).toMatchObject({ ok: true });
    const back1 = restoreShare(usedCredits, third, dueNow);
    const taken1 = Math.floor((earned * third) / dueNow);
    expect(await ledger(buyer)).toEqual({ available: START - usedCredits + back1, pending: earned - taken1 });
    // The rest, in two parts: all that was earned is taken back, and all that was used is back, to the unit.
    const half = Math.floor((dueNow - third) / 2);
    await refundOrder(storeId, orderId, { amountMinor: half, reason: "half", restock: [] }, member.account.id);
    await refundOrder(storeId, orderId, { amountMinor: dueNow - third - half, reason: "rest", restock: [] }, member.account.id);
    expect(await ledger(buyer)).toEqual({ available: START, pending: 0 });
    expect(await verified(buyer)).toBe(true);
    // The order's own page still says what it used and earned.
    expect((await getOrder(storeId, orderId))?.bonus).toMatchObject({ usedMinor: usedCredits, earnedMinor: earnAmount(await onlineGoods(orderId), 500) });
  });

  it("gives credits back and takes what was earned when a paid order is cancelled", async () => {
    const buyer = await shopper();
    const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    await pay(placed.open!, placed.params);
    expect((await ledger(buyer)).available).toBe(START - placed.summary.bonusMinor);
    const cancelled = await cancelOrder(storeId, placed.open!.orderId, "changed my mind", member.account.id);
    expect(cancelled).toMatchObject({ ok: true });
    expect(await ledger(buyer)).toEqual({ available: START, pending: 0 });
    expect(await verified(buyer)).toBe(true);
    // A refund after the cancel has nothing left to take or give back twice.
    expect(await used(placed.open!.orderId)).toBe(placed.summary.bonusMinor);
    const [entries] = await db().execute<Row>(sql`select count(*)::int as n from commerce.bonus_entries where order_id = ${placed.open!.orderId}::uuid`);
    // Used, earned, taken back, given back.
    expect(Number(entries.n)).toBe(4);
  });

  it("does not take back credits the customer has already spent, and never goes below zero", async () => {
    const buyer = await shopper(undefined, 0);
    // A first order with no credits: it earns 5 % of 597 NOK, pending.
    const first = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2), null);
    await pay(first.open!, first.params);
    const earned = (await ledger(buyer)).pending;
    expect(earned).toBe(Math.floor((49_800 * 500) / 10_000));
    // After the return period they are usable: the next order spends them all.
    await age(buyer, 15);
    expect(await ledger(buyer)).toEqual({ available: earned, pending: 0 });
    const second = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    expect(second.summary.bonusMinor).toBe(earned);
    await pay(second.open!, second.params);
    const afterSecond = await ledger(buyer);
    expect(afterSecond.available).toBe(0);
    // The first order is refunded in full: what it earned is gone, so nothing can be taken back.
    await refundOrder(storeId, first.open!.orderId, { amountMinor: first.summary.dueNowMinor, reason: "all", restock: [] }, member.account.id);
    expect((await ledger(buyer)).available).toBe(0);
    expect(await verified(buyer)).toBe(true);
    expect((await customerBonus(storeId, buyer)).balance.availableMinor).toBe(0);
  });

  it("changes nothing for a guest", async () => {
    const before = Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.bonus_entries where store_id = ${storeId}::uuid`))[0].n);
    const guest = await checkout(null, () => add("DEMO-MUG-WHITE", 2));
    expect(guest.summary.bonus).toMatchObject({ enabled: true, signedIn: false, usingMinor: 0, maxUsableMinor: 0, willEarnMinor: 0, availableMinor: 0 });
    expect(guest.summary.bonusMinor).toBe(0);
    expect(await setCartCredits(shop(), guest.cart, null, 100)).toMatchObject({ ok: false });
    expect(guest.summary.total).toBe(49_800 + 9_900);
    await pay(guest.open!, guest.params);
    const order = await getOrder(storeId, guest.open!.orderId);
    expect(order).toMatchObject({ creditMinor: 0, bonus: null });
    const after = Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.bonus_entries where store_id = ${storeId}::uuid`))[0].n);
    expect(after).toBe(before);
  });

  it("does nothing while the program is off, and earns nothing for an order paid while it was", async () => {
    const buyer = await shopper();
    await program({ enabled: false });
    try {
      const off = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
      expect(off.summary.bonus).toMatchObject({ enabled: false, usingMinor: 0, maxUsableMinor: 0, willEarnMinor: 0 });
      expect(off.asked).toMatchObject({ ok: false });
      expect(off.summary.total).toBe(49_800 + 9_900);
      await pay(off.open!, off.params);
      expect((await getOrder(storeId, off.open!.orderId))?.bonus).toBeNull();
      // The balance stays, for when the program is back on.
      expect(await ledger(buyer)).toEqual({ available: START, pending: 0 });
      expect((await shopperBonus(shop(), buyer)).enabled).toBe(false);
      // An order placed while it was on and paid after it was switched off keeps its credits used and earns nothing.
      await program();
      const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
      await program({ enabled: false });
      await pay(placed.open!, placed.params);
      expect(await ledger(buyer)).toEqual({ available: START - placed.summary.bonusMinor, pending: 0 });
    } finally {
      await program();
    }
  });

  it("settles two checkouts for the same customer at once without spending credits twice", async () => {
    const buyer = await shopper(undefined, 30_000);
    jar.clear();
    await startSession(storeId, buyer);
    await add("DEMO-MUG-WHITE", 2);
    const a = cartId();
    jar.delete(`cart_${storeId}_${no.slug}`);
    await add("DEMO-MUG-BLACK", 2);
    const b = cartId();
    expect(a).not.toBe(b);
    // Each asks for 249 NOK; there are 300.
    await db().execute(sql`update commerce.carts set bonus_request_minor = 24900, bonus_request_currency = 'NOK' where id in (${a}::uuid, ${b}::uuid)`);
    const starts = await Promise.all([a, b].map((id) => startCheckout({ ...shop(), storeSlug: slug }, id, origin, "Frakt", {}, { customerId: buyer })));
    expect(starts).toEqual([expect.objectContaining({ ok: true }), expect.objectContaining({ ok: true })]);
    const orders = await db().execute<Row>(sql`select credit_minor from commerce.orders where cart_id in (${a}::uuid, ${b}::uuid) order by placed_at`);
    const total = orders.reduce((sum, o) => sum + Number(o.credit_minor), 0);
    // Between them they used what the customer had, no more: the second got what the first left.
    expect(total).toBe(30_000);
    expect((await ledger(buyer)).available).toBe(0);
    expect(await verified(buyer)).toBe(true);
    for (const id of [a, b]) {
      const [row] = await db().execute<Row>(sql`select id from commerce.orders where cart_id = ${id}::uuid`);
      await cancel(String(row.id));
    }
    expect((await ledger(buyer)).available).toBe(30_000);
  });

  it("shows a customer their credits in the currency they shop in, and the owner what the program owes", async () => {
    const buyer = await shopper(undefined, 11_500);
    view = noInEuro;
    const shown = await shopperBonus(shop(), buyer);
    expect(shown).toMatchObject({ enabled: true, currency: "EUR", earnPercent: 5, pendingDays: 14, balance: { availableMinor: 1_000, pendingMinor: 0 } });
    expect(shown.entries[0]).toMatchObject({ kind: "adjust", amountMinor: 1_000, note: "test credits" });
    view = no;
    const own = await shopperBonus(shop(), buyer);
    expect(own.balance).toMatchObject({ currency: "NOK", availableMinor: 11_500 });
    const overview = await bonusOverview(storeId);
    expect(overview.currency).toBe("NOK");
    expect(overview.outstandingMinor).toBeGreaterThanOrEqual(11_500);
    expect((await getBonusSettings(storeId)).enabled).toBe(true);
  });

  it("counts credits as a discount on the order but not as a code's, and takings are what was paid", async () => {
    const made = await saveDiscount(member, null, { code: `GIVE${run}`.toUpperCase(), kind: "percent", percent: 10 });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const buyer = await shopper();
    const placed = await checkout(buyer, async () => {
      await add("DEMO-MUG-WHITE", 2);
      expect(await setCartCode(shop(), `GIVE${run}`.toUpperCase())).toBe(true);
    });
    // 10 % of 498 is 49.80 off by the code; credits take half of the 448.20 left.
    expect(placed.summary.codeDiscountMinor).toBe(4_980);
    expect(placed.summary.bonusMinor).toBe(22_410);
    await pay(placed.open!, placed.params);
    const order = await getOrder(storeId, placed.open!.orderId);
    expect(order).toMatchObject({ discountMinor: 4_980, creditMinor: 22_410, totalMinor: 49_800 + 9_900 - 4_980 - 22_410 });
    const [row] = await db().execute<Row>(sql`select discount_minor, credit_minor from commerce.orders where id = ${placed.open!.orderId}::uuid`);
    expect([Number(row.discount_minor), Number(row.credit_minor)]).toEqual([4_980 + 22_410, 22_410]);
    // The code's page: what it gave leaves the credits out.
    const { listDiscounts } = await import("./discounts");
    const given = (await listDiscounts(storeId)).find((d) => d.code === `GIVE${run}`.toUpperCase());
    expect(given?.given.NOK).toBe(4_980);
    // The AI manager's takings count what was paid, not the credits.
    const { salesTrend } = await import("./owner-insights");
    const trend = await salesTrend({ store: { id: storeId, timeZone: tz, markets: [no] } as unknown as Store }, { period: "day", count: 1 });
    const [today] = await db().execute<Row>(sql`
      select coalesce(sum(o.total_minor), 0)::bigint as taken from commerce.orders o
      where o.store_id = ${storeId}::uuid and o.copied_from is null and o.currency = 'NOK' and o.status <> 'cancelled'
        and o.placed_at >= date_trunc('day', now() at time zone ${tz}) at time zone ${tz}
        and exists (select 1 from commerce.payments p where p.order_id = o.id and p.status = 'captured')
    `);
    expect(trend.series.at(-1)?.taken[0]).toBe(new Intl.NumberFormat(no.locale, { style: "currency", currency: "NOK" }).format(Number(today.taken) / 100));
  });
});

/**
 * A friend's welcome discount (D131) in every kind of basket: what the cart page shows is what checkout charges to the
 * minor unit, it is taken after campaigns and the group's discount and before codes and credits, it is kept with the order
 * and its lines so VAT and refunds agree, the order is attributed to whose link it came through, and the referrer earns
 * what the database says when it is paid.
 */
describe("checkout with a friend's welcome discount (D131)", () => {
  const rates = new Map([["NOK", { rate: 11.5 }], ["EUR", { rate: 1 }]]);
  let referrer: { id: string; code: string };
  let codeNumber = 0;

  const program = (over: { affiliate?: boolean; bonus?: boolean; percent?: number; max?: number | null; bps?: number; orders?: number | null; earnBps?: number } = {}) =>
    (async () => {
      await db().execute(sql`
        insert into commerce.bonus_settings (store_id, enabled, earn_bps, pending_days, max_redeem_percent, min_redeem_minor, currency)
        values (${storeId}::uuid, ${over.bonus ?? true}, ${over.earnBps ?? 500}, 14, 50, 0, 'NOK')
        on conflict (store_id) do update set enabled = excluded.enabled, earn_bps = excluded.earn_bps
      `);
      await db().execute(sql`
        insert into commerce.affiliate_settings (store_id, enabled, reward_bps, reward_orders, friend_percent, friend_max_minor)
        values (${storeId}::uuid, ${over.affiliate ?? true}, ${over.bps ?? 500}, ${over.orders === undefined ? 1 : over.orders}, ${over.percent ?? 10}, ${over.max ?? null})
        on conflict (store_id) do update set enabled = excluded.enabled, reward_bps = excluded.reward_bps, reward_orders = excluded.reward_orders,
          friend_percent = excluded.friend_percent, friend_max_minor = excluded.friend_max_minor
      `);
    })();

  /** A customer with a referral link. */
  async function withLink(): Promise<{ id: string; code: string }> {
    const id = await preRegisterCustomer(storeId, `referrer-${Date.now()}-${Math.random().toString(36).slice(2)}-${run}@example.com`);
    const code = `kinds${String(++codeNumber).padStart(3, "0")}${run}`.slice(0, 16).toLowerCase().replace(/[^a-z0-9]/g, "a");
    await db().execute(sql`insert into commerce.affiliates (store_id, customer_id, code) values (${storeId}::uuid, ${id}::uuid, ${code})`);
    return { id, code };
  }

  /** A new signed-in shopper (in a group or a company when asked). */
  async function friend(kind?: "group" | "company"): Promise<string> {
    if (kind) return signInBuyer(kind);
    const created = await preRegisterCustomer(storeId, `friend-${Date.now()}-${Math.random().toString(36).slice(2)}-${run}@example.com`);
    await startSession(storeId, created);
    return created;
  }

  const ledger = async (customerId: string) => {
    const [row] = await db().execute<Row>(sql`select * from commerce.bonus_balance(${storeId}::uuid, ${customerId}::uuid)`);
    return { available: Number(row.available_minor), pending: Number(row.pending_minor) };
  };
  const verified = async (customerId: string) => Boolean((await db().execute<Row>(sql`select commerce.bonus_verify(${storeId}::uuid, ${customerId}::uuid) as ok`))[0].ok);
  const attribution = async (orderId: string) => {
    const [row] = await db().execute<Row>(sql`
      select status, reject_reason, discount_minor, reward_minor, affiliate_customer_id, friend_customer_id
      from commerce.affiliate_attributions where order_id = ${orderId}::uuid
    `);
    return row && { status: String(row.status), reason: row.reject_reason ? String(row.reject_reason) : null, discount: Number(row.discount_minor), reward: Number(row.reward_minor), affiliate: String(row.affiliate_customer_id), friend: row.friend_customer_id ? String(row.friend_customer_id) : null };
  };
  const onlineGoods = async (orderId: string) => {
    const [row] = await db().execute<Row>(sql`select coalesce(sum(total_minor - venue_minor), 0)::bigint as n from commerce.order_lines where order_id = ${orderId}::uuid`);
    return Number(row.n);
  };
  /** What the referrer earns on an order: the goods paid online, their share, in the credits' currency. */
  const rewardOf = async (orderId: string, currency: string, bps = 500) => convertCredits(Math.floor(((await onlineGoods(orderId)) * bps) / 10_000), currency, "NOK", rates, "down")!;

  async function pay(open: { orderId: string; sessionId: string }, params: Record<string, unknown>) {
    fake.sessions.set(open.sessionId, {
      status: "complete",
      payment_status: "paid",
      mode: params.mode,
      payment_intent: `pi_${open.sessionId}`,
      ...(params.mode === "subscription" && { subscription: `sub_welcome_${run}_${open.orderId}` }),
    });
    return getShopperOrder(storeId, open.orderId, open.sessionId);
  }

  /** A cart for `buyerId` (signed in, or a guest) with what `fill` adds and the referrer's link kept on it; the checkout, unpaid. */
  async function checkout(buyerId: string | null, fill: () => Promise<void>, link: string | null = referrer.code, consent: { digital?: boolean } = {}) {
    jar.clear();
    view = no;
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    if (buyerId) await startSession(storeId, buyerId);
    await fill();
    if (link) await rememberAffiliate(shop(), cartId(), link);
    const summary = await cartSummary(shop(), await getCart(shop()));
    const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", consent, { customerId: buyerId });
    const open = await getOpenCheckout(storeId, cartId());
    return { summary, started, open, params: fake.created.at(-1)?.params ?? {}, cart: cartId() };
  }

  beforeAll(async () => {
    const [home] = await db().execute<Row>(sql`select id from commerce.terms where store_id = ${storeId}::uuid and content_type = 'product' and slug = 'hjem'`);
    homeCategory = String(home.id);
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
    await program();
    let [tier] = await db().execute<Row>(sql`select id from commerce.customer_tiers where store_id = ${storeId}::uuid limit 1`);
    tier ??= (await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'Wholesale', 10) returning id`))[0];
    tierId = String(tier.id);
    let [company] = await db().execute<Row>(sql`select id from commerce.customer_companies where store_id = ${storeId}::uuid limit 1`);
    company ??= (
      await db().execute<Row>(sql`
        insert into commerce.customer_companies (store_id, name, tier_id, employee_share_percent) values (${storeId}::uuid, 'Acme AS', ${tierId}::uuid, 50) returning id
      `)
    )[0];
    companyId = String(company.id);
    const [code] = await db().execute<Row>(sql`select id from commerce.discount_codes where store_id = ${storeId}::uuid and code = ${`TI${run}`.toUpperCase()}`);
    if (!code) {
      const made = await saveDiscount(member, null, { code: `TI${run}`.toUpperCase(), kind: "percent", percent: 10 });
      if (!made.ok) throw new Error(made.problems.join(" "));
    }
    referrer = await withLink();
  });
  afterAll(async () => {
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    await db().execute(sql`update commerce.affiliate_settings set enabled = false where store_id = ${storeId}::uuid`);
    await db().execute(sql`update commerce.bonus_settings set enabled = false where store_id = ${storeId}::uuid`);
  });

  type WelcomeScenario = Scenario & { /** Nothing the welcome discount can be taken off: no goods bought once. */ none?: boolean; company?: boolean };
  const welcomeScenarios: WelcomeScenario[] = [
    { name: "goods, with shipping", fill: () => add("DEMO-MUG-WHITE", 2), bookings: 0 },
    { name: "a download", fill: () => add("DEMO-LAMP", 1), consent: { digital: true }, bookings: 0 },
    {
      name: "a subscription with a mug bought once: the subscription is not lowered",
      fill: async () => {
        const [plan] = await db().execute<Row>(sql`
          insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
          values (${storeId}::uuid, ${product["demo-notatbok"]}::uuid, 'month', 2, 10) returning id
        `);
        await add("DEMO-NOTEBOOK-LINED", 1, undefined, String(plan.id));
        await add("DEMO-MUG-WHITE", 2);
      },
      consent: { subscription: true },
      bookings: 0,
    },
    {
      name: "a subscription alone: nothing to take it off",
      fill: async () => {
        const [plan] = await db().execute<Row>(sql`
          insert into commerce.selling_plans (store_id, product_id, interval, interval_count, discount_percent)
          values (${storeId}::uuid, ${product["demo-notatbok"]}::uuid, 'month', 2, 10) returning id
        `);
        await add("DEMO-NOTEBOOK-LINED", 1, undefined, String(plan.id));
      },
      consent: { subscription: true },
      none: true,
      bookings: 0,
    },
    { name: "an appointment with a deposit", fill: addAppointment, massage: "deposit", bookings: 1 },
    { name: "an appointment paid at the venue", fill: addAppointment, massage: "venue", bookings: 1 },
    { name: "a stay, two nights with a deposit", fill: () => addStay(2), bookings: 1 },
    { name: "a bike for two days", fill: () => addRental("DEMO-SYKKEL", "day", 2), bookings: 1 },
    {
      name: "a stay, a massage and a mug with a code, for a group member",
      fill: async () => {
        await addStay(2);
        await addAppointment();
        await add("DEMO-MUG-WHITE", 1);
      },
      massage: "deposit",
      code: `TI${run}`.toUpperCase(),
      buyer: "group",
      bookings: 2,
    },
    { name: "goods for a business buying for its company", fill: () => add("DEMO-MUG-WHITE", 3), company: true, bookings: 0 },
    {
      name: "a free product, a 3 for 2, a group's discount and a code",
      fill: async () => {
        await addStay(2);
        await add("DEMO-MUG-WHITE", 3);
      },
      campaigns: () => [threeForTwo(), freeNotebook({ thresholds: { NO: "100" } })],
      gifts: 1,
      code: `TI${run}`.toUpperCase(),
      buyer: "group",
      bookings: 1,
    },
    { name: "goods, shown in euro", fill: () => add("DEMO-MUG-WHITE", 2), euro: true, bookings: 0 },
    {
      name: "a mug and a massage with a deposit and a code, for a company's employee, shown in euro",
      fill: async () => {
        await addAppointment();
        await add("DEMO-MUG-WHITE", 2);
      },
      massage: "deposit",
      code: `TI${run}`.toUpperCase(),
      buyer: "company",
      euro: true,
      bookings: 1,
    },
    {
      name: "campaigns and a group's discount, shown in euro",
      fill: () => add("DEMO-MUG-WHITE", 4),
      campaigns: () => [threeForTwo({ stacks: true }), percentCampaign(10, { stacks: true })],
      buyer: "group",
      euro: true,
      bookings: 0,
    },
  ];

  it.each(welcomeScenarios)("$name: what the cart shows is what is charged, kept, attributed and rewarded", async (scenario) => {
    jar.clear();
    view = scenario.euro ? noInEuro : no;
    await db().execute(sql`delete from commerce.campaigns where store_id = ${storeId}::uuid`);
    for (const input of scenario.campaigns?.() ?? []) {
      const saved = await saveCampaign(member, null, input);
      if (!saved.ok) throw new Error(saved.problems.join(" "));
    }
    await db().execute(sql`
      update commerce.appointment_settings set payment = ${scenario.massage ?? "now"}, deposit_percent = 30
      where store_id = ${storeId}::uuid and product_id = ${product["demo-massasje"]}::uuid
    `);
    const buyerId = await friend(scenario.buyer);
    await scenario.fill();
    if (scenario.code) expect(await setCartCode(shop(), scenario.code)).toBe(true);
    if (scenario.company) await setCartCompany(shop(), { name: "Acme AS", number: "923456789" });
    await rememberAffiliate(shop(), cartId(), referrer.code);

    const cart = await getCart(shop());
    const summary = await cartSummary(shop(), cart);
    expect(summary.blocked).toBe(false);
    // The welcome discount is 10 % of the goods bought once that campaigns and the group's discount left, rounded down.
    const goods = summary.payable.reduce((sum, line, i) => sum + (line.plan || line.unitPriceMinor <= 0 ? 0 : Math.max(0, summary.today(line) - summary.campaignLine(i) - summary.memberLine(i))), 0);
    expect(summary.referralMinor).toBe(Math.floor(goods / 10));
    if (scenario.none) {
      expect(summary.referralMinor).toBe(0);
      expect(summary.referral.state).toBe("none");
    } else {
      expect(summary.referralMinor).toBeGreaterThan(0);
      expect(summary.referral).toEqual({ state: "applied", percent: 10, discountMinor: summary.referralMinor });
    }
    // Its own line: `discountMinor` (codes, group, campaigns) and the credits leave it out, and the total adds up.
    expect(summary.total).toBe(summary.subtotal + summary.feeMinor + (summary.shipping ?? 0) - summary.discountMinor - summary.referralMinor - summary.bonusMinor);
    expect(summary.payable.reduce((sum, _line, i) => sum + summary.referralLine(i), 0)).toBe(summary.referralMinor);

    const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", scenario.consent ?? {}, {
      customerId: buyerId,
      contact: { name: "Kari", email: `kari-${run}@example.com`, phone: "99999999" },
    });
    expect(started).toMatchObject({ ok: true });
    const open = await getOpenCheckout(storeId, cartId());
    if (!open) {
      // Paid at the venue alone: confirmed at once, so there is no payment form, but the order is placed all the same.
      const [placed] = await db().execute<Row>(sql`select id, total_minor, referral_discount_minor from commerce.orders where customer_id = ${buyerId}::uuid order by placed_at desc limit 1`);
      expect(Number(placed.referral_discount_minor)).toBe(summary.referralMinor);
      expect(Number(placed.total_minor)).toBe(summary.total);
      return;
    }
    expect(open).toMatchObject({ changed: false, expired: false, clientSecret: expect.stringMatching(/_secret_test$/) });

    // The order is what the cart showed, and the welcome discount is its own part of the discount.
    const order = await getOrder(storeId, open.orderId);
    const giftValue = summary.gifts.reduce((sum, gift) => sum + gift.unitPriceMinor * gift.quantity, 0);
    expect({ total: order?.totalMinor, vat: order?.taxMinor, balance: order?.balanceMinor, referral: order?.referralDiscountMinor, off: order?.discountMinor }).toEqual({
      total: summary.total,
      vat: summary.vat,
      balance: summary.balance,
      referral: summary.referralMinor,
      off: summary.discountMinor + giftValue,
    });
    const lines = await db().execute<Row>(sql`select discount_minor, referral_discount_minor, total_minor, venue_minor, gift, selling_plan_id from commerce.order_lines where order_id = ${open.orderId}::uuid`);
    expect(lines.reduce((sum, l) => sum + Number(l.referral_discount_minor), 0)).toBe(summary.referralMinor);
    for (const l of lines) {
      expect(Number(l.referral_discount_minor)).toBeLessThanOrEqual(Number(l.discount_minor));
      expect(Number(l.venue_minor)).toBeLessThanOrEqual(Number(l.total_minor));
      // Never a free product, never what renews.
      if (l.gift || l.selling_plan_id) expect(Number(l.referral_discount_minor)).toBe(0);
    }
    // Stripe is asked for what is due now, the welcome discount inside its coupon (or in each line's amount for a deposit).
    const { params } = fake.created.at(-1)!;
    expect(chargedNow(params)).toBe(summary.dueNowMinor);
    expect(JSON.stringify(params)).not.toContain("payment_method_types");
    // Part of the one coupon Stripe is given (or of each line's amount, for a deposit).
    if (summary.referralMinor > 0 && summary.balance === 0) expect(params).toHaveProperty("discounts");
    const [paymentRow] = await db().execute<Row>(sql`select amount_minor from commerce.payments where order_id = ${open.orderId}::uuid and provider = 'stripe'`);
    expect(Number(paymentRow.amount_minor)).toBe(summary.dueNowMinor);
    // Whose friend it is: waiting for payment, with the discount it was given.
    expect(await attribution(open.orderId)).toEqual({ status: "pending", reason: null, discount: summary.referralMinor, reward: 0, affiliate: referrer.id, friend: buyerId });
    expect(await getOpenCheckout(storeId, cartId())).toMatchObject({ changed: false });

    // Paid: the referrer earns 5 % of what was paid online for goods, as the database counts it, usable after the return period.
    const before = await ledger(referrer.id);
    expect((await pay(open, params))?.status).toBe("paid");
    const reward = await rewardOf(open.orderId, order!.currency);
    expect(await attribution(open.orderId)).toMatchObject({ status: reward > 0 ? "rewarded" : "rejected", reward });
    expect(await ledger(referrer.id)).toEqual({ available: before.available, pending: before.pending + reward });
    if (reward > 0) expect((await db().execute<Row>(sql`select referred_by_customer_id as r from commerce.customers where id = ${buyerId}::uuid`))[0].r).toBe(referrer.id);
    expect(await verified(referrer.id)).toBe(true);
    // Paying a second time changes nothing.
    await pay(open, params);
    expect((await ledger(referrer.id)).pending).toBe(before.pending + reward);
  });

  it("takes it off before a code and the credits, which count what is left", async () => {
    const buyer = await friend();
    await db().execute(sql`select commerce.bonus_adjust(${storeId}::uuid, ${buyer}::uuid, 500000, 'test credits', null, ${`test-${buyer}`})`);
    const made = await saveDiscount(member, null, { code: `WEL${run}`.toUpperCase(), kind: "percent", percent: 10 });
    if (!made.ok) throw new Error(made.problems.join(" "));
    const placed = await checkout(buyer, async () => {
      await add("DEMO-MUG-WHITE", 2);
      expect(await setCartCode(shop(), `WEL${run}`.toUpperCase())).toBe(true);
    });
    const asked = await setCartCredits(shop(), placed.cart, buyer, 1_000_000_000);
    expect(asked).toMatchObject({ ok: true });
    // Re-read and place again with the credits asked for.
    const again = await checkout(buyer, async () => {
      jar.set(`cart_${storeId}_${no.slug}`, placed.cart);
    });
    // Two mugs, 498 NOK: 10 % welcome (49.80), then the code's 10 % of the 448.20 left (44.82), then credits up to half of the 403.38 left.
    expect(again.summary.referralMinor).toBe(4_980);
    expect(again.summary.codeDiscountMinor).toBe(4_482);
    expect(again.summary.bonusMinor).toBe(Math.floor((49_800 - 4_980 - 4_482) / 2));
    const order = await getOrder(storeId, again.open!.orderId);
    expect(order).toMatchObject({ referralDiscountMinor: 4_980, creditMinor: again.summary.bonusMinor, discountMinor: 4_482, totalMinor: again.summary.total });
    expect(order!.totalMinor).toBe(49_800 + 9_900 - 4_980 - 4_482 - again.summary.bonusMinor);
    // Only what was paid online for goods earns: the referrer's 5 % is of it, and the friend's own 5 % too.
    await pay(again.open!, again.params);
    expect((await attribution(again.open!.orderId))?.reward).toBe(Math.floor((await onlineGoods(again.open!.orderId)) * 500 / 10_000));
    // The code's page counts what the code gave, not the welcome discount or the credits.
    const { listDiscounts } = await import("./discounts");
    expect((await listDiscounts(storeId)).find((d) => d.code === `WEL${run}`.toUpperCase())?.given.NOK).toBeGreaterThanOrEqual(4_482);
  });

  it("is capped at the owner's most, in the currency shown", async () => {
    await program({ max: 2_000 });
    try {
      const buyer = await friend();
      const capped = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
      expect(capped.summary.referralMinor).toBe(2_000);
      // Shown in euro the 20 NOK cap is 1.73 EUR (rounded down), and 10 % of the two mugs is more than that.
      const buyer2 = await friend();
      jar.clear();
      view = noInEuro;
      await startSession(storeId, buyer2);
      await add("DEMO-MUG-WHITE", 2);
      await rememberAffiliate(shop(), cartId(), referrer.code);
      const inEuro = await cartSummary(shop(), await getCart(shop()));
      expect(inEuro.referralMinor).toBe(173);
      view = no;
    } finally {
      await program();
    }
  });

  it("gives a friend who registered through a link the discount without a code in the cart, and their later orders no discount", async () => {
    const buyer = await friend();
    expect(await attachReferral(storeId, buyer, referrer.code)).toBe(true);
    const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2), null);
    expect(placed.summary.referral).toEqual({ state: "applied", percent: 10, discountMinor: 4_980 });
    expect(await attribution(placed.open!.orderId)).toMatchObject({ status: "pending", affiliate: referrer.id, friend: buyer, discount: 4_980 });
    await pay(placed.open!, placed.params);
    // The next order still belongs to the referrer, with no welcome discount; one rewarded order is all the store gives here.
    const next = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2), null);
    expect(next.summary.referralMinor).toBe(0);
    expect(await attribution(next.open!.orderId)).toBeUndefined();
  });

  it("gives a guest only the nudge, and attributes nothing", async () => {
    const guest = await checkout(null, () => add("DEMO-MUG-WHITE", 2));
    expect(guest.summary.referral).toEqual({ state: "guest", percent: 10, discountMinor: 0 });
    expect(guest.summary.referralMinor).toBe(0);
    expect(guest.summary.total).toBe(49_800 + 9_900);
    const order = await getOrder(storeId, guest.open!.orderId);
    expect(order).toMatchObject({ referralDiscountMinor: 0, discountMinor: 0 });
    expect(await attribution(guest.open!.orderId)).toBeUndefined();
    const before = await ledger(referrer.id);
    await pay(guest.open!, guest.params);
    expect(await ledger(referrer.id)).toEqual(before);
  });

  it("is for the first order only: a friend who has ordered before gets nothing, and it is recorded", async () => {
    const buyer = await friend();
    const first = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    expect(first.summary.referralMinor).toBeGreaterThan(0);
    await pay(first.open!, first.params);
    // The next cart, with the same link in it: no discount, and no reward (one order earns, by default).
    const second = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    expect(second.summary.referral.state).toBe("none");
    expect(second.summary.referralMinor).toBe(0);
    expect(second.summary.total).toBe(49_800 + 9_900);
    expect(await attribution(second.open!.orderId)).toBeUndefined();
    // Someone who ordered before and arrives with a link is a rejected attribution.
    const old = await friend();
    await pay((await checkout(old, () => add("DEMO-MUG-WHITE", 1), null)).open!, fake.created.at(-1)!.params);
    const late = await checkout(old, () => add("DEMO-MUG-WHITE", 2));
    expect(late.summary.referralMinor).toBe(0);
    expect(await attribution(late.open!.orderId)).toMatchObject({ status: "rejected", reason: "not_new", discount: 0 });
  });

  it("gives the referrer nothing and the friend nothing when they are the same person, or the referrer is blocked", async () => {
    await startSession(storeId, referrer.id);
    const own = await checkout(referrer.id, () => add("DEMO-MUG-WHITE", 2));
    expect(own.summary.referral.state).toBe("none");
    expect(own.summary.referralMinor).toBe(0);
    expect(await attribution(own.open!.orderId)).toMatchObject({ status: "rejected", reason: "self", discount: 0 });
    const other = await withLink();
    await db().execute(sql`update commerce.affiliates set blocked_at = now(), blocked_reason = 'abuse' where customer_id = ${other.id}::uuid`);
    const blocked = await checkout(await friend(), () => add("DEMO-MUG-WHITE", 2), other.code);
    // A blocked referrer's code is not even kept on the cart.
    expect(blocked.summary.referralMinor).toBe(0);
    expect(await attribution(blocked.open!.orderId)).toBeUndefined();
  });

  it("does nothing while either program is off, and an order placed while it was on earns nothing once it is off", async () => {
    await program({ bonus: false });
    try {
      const off = await checkout(await friend(), () => add("DEMO-MUG-WHITE", 2));
      expect(off.summary.referral.state).toBe("none");
      expect(off.summary.total).toBe(49_800 + 9_900);
    } finally {
      await program();
    }
    const buyer = await friend();
    const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    expect(placed.summary.referralMinor).toBeGreaterThan(0);
    await program({ affiliate: false });
    try {
      const before = await ledger(referrer.id);
      await pay(placed.open!, placed.params);
      expect(await attribution(placed.open!.orderId)).toMatchObject({ status: "rejected", reason: "off" });
      expect(await ledger(referrer.id)).toEqual(before);
    } finally {
      await program();
    }
  });

  it("takes back the reward by the refunded share, and all of it when the order is cancelled", async () => {
    const buyer = await friend();
    const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    const orderId = placed.open!.orderId;
    await pay(placed.open!, placed.params);
    const reward = (await attribution(orderId))!.reward;
    expect(reward).toBeGreaterThan(0);
    const before = await ledger(referrer.id);
    const dueNow = placed.summary.dueNowMinor;
    const third = Math.floor(dueNow / 3);
    expect(await refundOrder(storeId, orderId, { amountMinor: third, reason: "a third", restock: [] }, member.account.id)).toMatchObject({ ok: true });
    expect((await ledger(referrer.id)).pending).toBe(before.pending - Math.floor((reward * third) / dueNow));
    await refundOrder(storeId, orderId, { amountMinor: dueNow - third, reason: "rest", restock: [] }, member.account.id);
    expect(await ledger(referrer.id)).toEqual({ available: before.available, pending: before.pending - reward });
    expect((await attribution(orderId))?.status).toBe("reversed");
    expect(await verified(referrer.id)).toBe(true);
    // A cancelled order takes back what is left.
    const other = await checkout(await friend(), () => add("DEMO-MUG-WHITE", 2));
    await pay(other.open!, other.params);
    const pending = (await ledger(referrer.id)).pending;
    const got = (await attribution(other.open!.orderId))!.reward;
    expect(await cancelOrder(storeId, other.open!.orderId, "changed my mind", member.account.id)).toMatchObject({ ok: true });
    expect((await ledger(referrer.id)).pending).toBe(pending - got);
    expect((await attribution(other.open!.orderId))?.status).toBe("reversed");
  });

  it("shows the welcome discount on the order page, apart from codes and credits, and in the integration's discount", async () => {
    const buyer = await friend();
    const placed = await checkout(buyer, () => add("DEMO-MUG-WHITE", 2));
    await pay(placed.open!, placed.params);
    const order = await getOrder(storeId, placed.open!.orderId);
    expect(order).toMatchObject({ referralDiscountMinor: 4_980, discountMinor: 0, creditMinor: 0, totalMinor: 49_800 + 9_900 - 4_980 });
    const shopper = await getShopperOrder(storeId, placed.open!.orderId, placed.open!.sessionId);
    expect(shopper).toMatchObject({ referralDiscountMinor: 4_980 });
  });
});

describe("VAT categories and rates, D157", () => {
  const vatOf = (total: number, rate: number) => Math.round((total * rate) / (1 + rate));
  /** Norway's rates today for the demo categories: seeded `food` 15 %, `culture_events` 12 %, `books` and `periodicals` 0 (exempt); no row for the rest, so the standard rate. */
  const categories: [string, number][] = [
    ["standard", 0.25],
    ["food", 0.15],
    ["culture_events", 0.12],
    ["books", 0],
    ["periodicals", 0],
    ["medicines", 0.25],
    ["children_goods", 0.25],
    ["exempt", 0],
  ];
  const setCategory = (handle: string, category: string) =>
    db().execute(sql`update commerce.products set vat_category = ${category} where store_id = ${storeId}::uuid and id = ${product[handle]}::uuid`);

  /** Cart page, checkout and Stripe for what is in the cart: the order, held to what the cart showed. */
  async function placed(consent: { digital?: boolean } = {}) {
    const cart = await getCart(shop());
    const summary = await cartSummary(shop(), cart);
    expect(await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", consent, {})).toMatchObject({ ok: true });
    const open = await getOpenCheckout(storeId, cartId());
    expect(open).toMatchObject({ changed: false });
    const order = (await getOrder(storeId, open!.orderId))!;
    expect({ total: order.totalMinor, vat: order.taxMinor, shipping: order.shippingMinor }).toEqual({ total: summary.total, vat: summary.vat, shipping: summary.shipping });
    expect(chargedNow(fake.created.at(-1)!.params)).toBe(summary.dueNowMinor);
    return { cart, summary, order };
  }

  it.each(categories.flatMap(([category, rate]) => [[category, rate, false] as const, [category, rate, true] as const]))(
    "a product in %s is taken at %s, shown in euro: %s, in the cart, the order and the order's line",
    async (category, rate, euro) => {
      jar.clear();
      view = euro ? noInEuro : no;
      await setCategory("demo-keramikkopp", category);
      try {
        await add("DEMO-MUG-WHITE", 2);
        const { cart, summary, order } = await placed();
        expect(cart.lines[0].vatRate).toBe(rate);
        const [line] = order.lines;
        expect(line.taxRate).toBe(rate);
        // The line's VAT is its total's, and the order's is the line's and the shipping's (the standard rate, as always).
        expect(summary.vat).toBe(vatOf(line.totalMinor, rate) + vatOf(order.shippingMinor, 0.25));
        expect(order.shippingVatRate).toBe(0.25);
        expect(order.vatKind).toBe("standard");
        expect(order.vatReliefMinor).toBe(0);
      } finally {
        await setCategory("demo-keramikkopp", "standard");
      }
    },
  );

  it.each([false, true])("a basket with food, a book-like exempt product and a standard one carries each at its own rate, shown in euro: %s", async (euro) => {
    jar.clear();
    view = euro ? noInEuro : no;
    await setCategory("demo-keramikkopp", "food");
    await setCategory("demo-notatbok", "exempt");
    try {
      await add("DEMO-MUG-WHITE", 2);
      await add("DEMO-NOTEBOOK-LINED", 3);
      await add("DEMO-LAMP", 1);
      const { summary, order } = await placed({ digital: true });
      const byRate = new Map(order.lines.map((l) => [l.sku, l.taxRate]));
      expect(byRate.get("DEMO-MUG-WHITE")).toBe(0.15);
      expect(byRate.get("DEMO-NOTEBOOK-LINED")).toBe(0);
      expect(byRate.get("DEMO-LAMP")).toBe(0.25);
      expect(summary.vat).toBe(order.lines.reduce((sum, l) => sum + vatOf(l.totalMinor, l.taxRate), 0) + vatOf(order.shippingMinor, 0.25));
      expect(order.taxMinor).toBe(summary.vat);
    } finally {
      await setCategory("demo-keramikkopp", "standard");
      await setCategory("demo-notatbok", "standard");
    }
  });

  it("keeps the rate an order was placed at when the rate changes, and the next cart takes the new one", async () => {
    // A category of this run's own: the seeded rates are shared reference data and are never changed by a test.
    const code = `t${run}`.slice(0, 20);
    await db().execute(sql`insert into commerce.vat_categories (code, name_en, sort, active) values (${code}, 'Test goods', 999, true)`);
    const [{ today }] = await db().execute<Row>(sql`select (now() at time zone 'Europe/Oslo')::date::text as today`);
    await db().execute(sql`select commerce.set_vat_rate('NO', ${code}, 0.10, date '2026-01-01', 'Kaizen test data, not a rate', date '2026-10-03', '', ${member.account.id}::uuid)`);
    await setCategory("demo-keramikkopp", code);
    try {
      jar.clear();
      view = no;
      await add("DEMO-MUG-WHITE", 2);
      const first = await placed();
      expect(first.order.lines[0].taxRate).toBe(0.1);
      await db().execute(sql`select commerce.set_vat_rate('NO', ${code}, 0.18, ${String(today)}::date, 'Kaizen test data, not a rate', date '2026-10-03', '', ${member.account.id}::uuid)`);
      // The order that was placed keeps its rate...
      expect((await getOrder(storeId, first.order.id))!.lines[0].taxRate).toBe(0.1);
      // ...and the next cart takes the new one.
      jar.clear();
      await add("DEMO-MUG-WHITE", 2);
      const second = await placed();
      expect(second.order.lines[0].taxRate).toBe(0.18);
      expect(second.summary.vat).toBe(vatOf(second.order.lines[0].totalMinor, 0.18) + vatOf(second.order.shippingMinor, 0.25));
    } finally {
      await setCategory("demo-keramikkopp", "standard");
    }
  });
});

describe("order numbering (D141)", () => {
  it("runs in one sequence after every kind of checkout, with the cancelled ones included", async () => {
    const audit = await orderNumberAudit(storeId);
    expect(audit.orders).toBeGreaterThan(20);
    expect(audit).toMatchObject({ firstNumber: 1001, missing: 0, firstMissing: null, offFormat: 0, ok: true });
    expect(audit.lastNumber).toBe(1000 + audit.orders);
    expect(audit.nextNumber).toBe(audit.lastNumber! + 1);
  });

  it("is not changed by anyone going round the application", async () => {
    const [order] = await db().execute<Row>(sql`select id from commerce.orders where store_id = ${storeId}::uuid order by number limit 1`);
    await expect(db().execute(sql`update commerce.orders set number = '9999' where id = ${String(order.id)}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/order_number\.changed/) } });
    await expect(db().execute(sql`delete from commerce.orders where id = ${String(order.id)}::uuid`)).rejects.toMatchObject({ cause: { message: expect.stringMatching(/order_number\.deleted/) } });
  });
});

describe("tax reports, D161: a store selling in kroner and, shown in euro, in euro", () => {
  const reports = import("./tax-reports");
  const reconciliations = import("./tax-reconciliation");
  const totalsModule = import("./analytics-totals");
  const csvModule = import("@/lib/tax-csv");
  let own: Awaited<ReturnType<typeof documentFixture.makeStore>>;
  const placed: { order: Awaited<ReturnType<typeof documentFixture.paidOrder>>; euro: boolean; kind: string }[] = [];
  const sweden = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
  /** The store as the reports read it (this file builds its stores by hand: `getStore()` is cached for a request). */
  const storeOf = (markets: (typeof no)[]) =>
    ({
      id: own.storeId,
      slug: own.slug,
      timeZone: "Europe/Oslo",
      markets,
      localization: localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], markets),
    }) as unknown as Store;
  const today = async () => (await reports).storeToday(storeOf([no]));
  const range = async () => {
    const day = await today();
    const { addDays } = await import("@/lib/analytics-period");
    return { from: day, to: addDays(day, 1) };
  };

  beforeAll(async () => {
    own = await documentFixture.makeStore("kinds-tax");
    // The demo lamp is a download here (as in the store of the checkout above).
    await db().execute(sql`update commerce.product_variants set delivery = 'digital' where store_id = ${own.storeId}::uuid and sku = 'DEMO-LAMP'`);
    await db().execute(sql`
      update commerce.products p set delivery = 'digital', download_limit = 2, download_days = 7
      from commerce.product_variants v where v.product_id = p.id and v.store_id = ${own.storeId}::uuid and v.sku = 'DEMO-LAMP'
    `);
    const consent = { digital: true };
    for (const euro of [false, true]) {
      const market = euro ? documentFixture.noInEuro : documentFixture.no;
      placed.push({ euro, kind: "goods", order: await documentFixture.paidOrder(own, [["DEMO-MUG-WHITE", 2]], { market }) });
      placed.push({ euro, kind: "download", order: await documentFixture.paidOrder(own, [["DEMO-LAMP", 1]], { market, consent }) });
      placed.push({ euro, kind: "goods and download", order: await documentFixture.paidOrder(own, [["DEMO-MUG-WHITE", 1], ["DEMO-LAMP", 1]], { market, consent }) });
    }
  }, 90_000);

  it("has an invoice for every order, in the currency shown: kroner and euro", async () => {
    expect(placed.map((p) => p.order.currency)).toEqual(["NOK", "NOK", "NOK", "EUR", "EUR", "EUR"]);
    const rows = await db().execute<Row>(sql`select currency, count(*)::int as n from commerce.invoices where store_id = ${own.storeId}::uuid group by currency order by currency`);
    expect(rows.map((r) => [String(r.currency).trim(), r.n])).toEqual([["EUR", 3], ["NOK", 3]]);
  });

  it("gives the VAT per country and rate in each document currency as the orders have it, and in kroner at the rate each invoice holds", async () => {
    const { vatReport } = await reports;
    const store = storeOf([no]);
    const { report } = await vatReport(store, await range());
    expect(report.mainCurrency).toBe("NOK");
    expect(report.rows.map((r) => [r.country, r.rate, r.currency, r.invoices, r.orders])).toEqual([["NO", 0.25, "NOK", 3, 3], ["NO", 0.25, "EUR", 3, 3]].sort((a, b) => String(b[2]).localeCompare(String(a[2]))));
    const byCurrency = (currency: string) => placed.filter((p) => p.order.currency === currency).map((p) => p.order);
    for (const currency of ["NOK", "EUR"]) {
      const row = report.rows.find((r) => r.currency === currency)!;
      expect(row.vatMinor, currency).toBe(byCurrency(currency).reduce((n, o) => n + o.tax, 0));
      expect(row.grossMinor, currency).toBe(byCurrency(currency).reduce((n, o) => n + o.total, 0));
      expect(row.netMinor, currency).toBe(row.grossMinor - row.vatMinor);
    }
    // The converted VAT of the invoices is what each invoice froze (the euro ones at 11.5 kroner), added up: never a rate of today.
    const [stored] = await db().execute<Row>(sql`select coalesce(sum((snapshot -> 'vatMain' ->> 'vatMinor')::bigint), 0)::bigint as vat from commerce.invoices where store_id = ${own.storeId}::uuid`);
    expect(report.totals.vatChargedMainMinor).toBe(Number(stored.vat));
    const eur = report.rows.find((r) => r.currency === "EUR")!;
    expect(eur.vatMainMinor).toBeGreaterThanOrEqual(Math.round(eur.vatMinor * 11.5) - 3);
    expect(eur.vatMainMinor).toBeLessThanOrEqual(Math.round(eur.vatMinor * 11.5) + 3);
    expect(report.notConverted).toEqual({ invoices: 0, creditNotes: 0, currencies: [], leftOut: [] });
  });

  it("writes the CSV with the document currency's columns equal to the orders', and the kroner columns beside them", async () => {
    const { vatReport } = await reports;
    const { vatCsv } = await csvModule;
    const store = storeOf([no]);
    const r = await range();
    const { report } = await vatReport(store, r);
    const lines = vatCsv(report, r).split("\r\n");
    expect(lines).toHaveLength(report.rows.length + 2);
    const decimal = (minor: number) => (minor / 100).toFixed(2);
    for (const currency of ["NOK", "EUR"]) {
      const orders = placed.filter((p) => p.order.currency === currency).map((p) => p.order);
      const vat = orders.reduce((n, o) => n + o.tax, 0);
      const gross = orders.reduce((n, o) => n + o.total, 0);
      const line = lines.find((l) => l.includes(`,${currency},3,3,`))!;
      expect(line, currency).toContain(`,${currency},3,3,${decimal(gross - vat)},${decimal(vat)},${decimal(gross)},0,`);
      expect(line.endsWith(",true"), currency).toBe(true);
      expect(line, currency).toContain(",NOK,");
    }
  });

  it("agrees with Finance: the reconciliation is exact in kroner and in euro and its line for Finance is the Finance page's VAT figure", async () => {
    const { reconciliation } = await reconciliations;
    const { periodTotals } = await totalsModule;
    const store = storeOf([no]);
    const r = await range();
    const view = await reconciliation(store, r);
    expect(view.balanced).toBe(true);
    expect(view.bridges.map((b) => [b.currency, b.differenceMinor])).toEqual([["EUR", 0], ["NOK", 0]]);
    const finance = await periodTotals(store, { ...r, days: 1, preset: "custom", label: "today" });
    expect(view.main.financeMainMinor).toBe(finance.totals.vatMinor);
    expect(view.undocumented.orders).toBe(0);
  });

  it("counts a document with no conversion to the main currency instead of converting it at today's rate: a store that moved its home to Sweden", async () => {
    const { vatReport } = await reports;
    await db().execute(sql`update commerce.stores set country = 'SE' where id = ${own.storeId}::uuid`);
    const store = storeOf([sweden, no]);
    expect(store.markets[0].nativeCurrency).toBe("SEK");
    const { report } = await vatReport(store, await range());
    expect(report.notConverted).toMatchObject({ invoices: 6, creditNotes: 0, currencies: ["EUR", "NOK"] });
    // What the main-currency figure leaves out is named per currency (the reconciliation shows it on its own line, never as an exchange-rate effect).
    expect(report.notConverted.leftOut.map((o) => [o.currency, o.invoices]).sort()).toEqual([["EUR", 3], ["NOK", 3]]);
    expect(report.totals.vatChargedMainMinor).toBe(0);
    expect(report.rows.every((r) => !r.mainConverted && r.vatMainMinor === null)).toBe(true);
    // The own-currency figures are all there.
    expect(report.byCurrency.map((c) => [c.currency, c.invoices]).sort()).toEqual([["EUR", 3], ["NOK", 3]]);
    await db().execute(sql`update commerce.stores set country = 'NO' where id = ${own.storeId}::uuid`);
  });
});

/**
 * Draft orders made by staff (wave 3, run 2, D173): a draft is priced by the one function that prices an order, sent as a numbered order, and paid through the pay link (Stripe's hosted page,
 * each line at what is due) or recorded as paid outside Kaizen. Every scenario holds the totals to the cart's where a cart could have made the same order, Stripe's charge to the order, and the
 * invoice and its credit notes to the order and the refunds, to the minor unit, in kroner and in euro.
 */
describe("draft orders from staff (D173)", () => {
  const owner = () => ({ ...member, kind: "member", permissions: null }) as unknown as Parameters<typeof import("./draft-orders").recordDraftPaidOutside>[0];
  const actor = () => ({ accountId: member.account.id, kind: "staff" as const });

  beforeAll(async () => {
    await db().execute(sql`insert into commerce.store_members (store_id, account_id, role) values (${storeId}::uuid, ${member.account.id}::uuid, 'owner') on conflict do nothing`);
    await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
    await db().execute(sql`update commerce.order_settings set gift_messages = false where store_id = ${storeId}::uuid`);
  });

  type DraftScenario = {
    name: string;
    euro?: boolean;
    lines: { sku: string; quantity: number; price?: string }[];
    custom?: { title: string; price: string };
    discount?: { kind: "percent" | "amount"; value: string; label: string };
    shipping?: { kind: "rate" } | { kind: "free" } | { kind: "custom"; price: string };
    /** The same goods in a cart give the same totals (a draft with no staff price, discount, custom item or shipping choice). */
    sameAsCart?: boolean;
  };

  const draftScenarios: DraftScenario[] = [
    { name: "goods at the list prices, with the flat shipping", lines: [{ sku: "DEMO-MUG-WHITE", quantity: 2 }, { sku: "DEMO-NOTEBOOK-LINED", quantity: 3 }], sameAsCart: true },
    { name: "goods at the list prices, shown in euro", euro: true, lines: [{ sku: "DEMO-MUG-WHITE", quantity: 3 }], sameAsCart: true },
    {
      name: "goods with a staff price, a percent discount, a custom item and free shipping",
      lines: [{ sku: "DEMO-MUG-WHITE", quantity: 2, price: "39,00" }, { sku: "DEMO-NOTEBOOK-LINED", quantity: 1 }],
      custom: { title: "Engraving", price: "150,00" },
      discount: { kind: "percent", value: "12,5", label: "Friends and family" },
      shipping: { kind: "free" },
    },
    {
      name: "goods with an amount discount and a typed shipping price, shown in euro",
      euro: true,
      lines: [{ sku: "DEMO-MUG-WHITE", quantity: 4 }],
      custom: { title: "Gift wrapping", price: "100,00" },
      discount: { kind: "amount", value: "25", label: "Goodwill" },
      shipping: { kind: "custom", price: "20,00" },
    },
  ];

  async function buildDraft(scenario: DraftScenario) {
    const { createDraft, saveDraft } = await import("./draft-orders");
    const made = await createDraft(storeId, actor(), { marketSlug: view.slug });
    if (!made.ok) throw new Error(made.problem);
    const lines = [
      ...scenario.lines.map((l) => ({ kind: "goods" as const, variantId: variant[l.sku], quantity: l.quantity, ...(l.price ? { price: l.price } : {}) })),
      ...(scenario.custom ? [{ kind: "custom" as const, title: scenario.custom.title, quantity: 1, price: scenario.custom.price, vatCategory: "standard" }] : []),
    ];
    const saved = await saveDraft(storeId, actor(), made.draft.id, {
      version: made.draft.version,
      marketSlug: view.slug,
      email: `draft-${run}@example.com`,
      shippingAddress: { name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo", country: "NO" },
      billingAddress: {},
      // A custom item is sold to a business only (`custom_consumer`: the withdrawal of a service for a private buyer is not decided).
      ...(scenario.custom ? { companyName: "Acme AS", organisationNumber: "923609016" } : {}),
      tags: ["staff-made"],
      discount: scenario.discount ?? null,
      shipping: scenario.shipping ?? { kind: "rate" },
      lines,
    });
    if (!saved.ok) throw new Error(`${saved.problem} ${JSON.stringify(saved.fields)}`);
    return saved.draft;
  }

  it.each(draftScenarios)("$name: priced like an order, sent, paid through the pay link, and invoiced", async (scenario) => {
    jar.clear();
    view = scenario.euro ? noInEuro : no;
    const { previewDraft, sendDraft } = await import("./draft-orders");
    const { startDraftPayment } = await import("./draft-pay");
    const draft = await buildDraft(scenario);
    const preview = (await previewDraft(storeId, draft.id))!;
    expect(preview.blocking).toEqual([]);
    const summary = preview.summary!;
    expect(summary.currency).toBe(scenario.euro ? "EUR" : "NOK");
    // The same goods in a cart cost the same: the draft is priced by the checkout's own pieces.
    if (scenario.sameAsCart) {
      for (const l of scenario.lines) await add(l.sku, l.quantity);
      const cartTotals = await cartSummary(shop(), await getCart(shop()));
      expect({ subtotal: summary.subtotalMinor, shipping: summary.shippingMinor, vat: summary.taxMinor, total: summary.totalMinor }).toEqual({
        subtotal: cartTotals.subtotal,
        shipping: cartTotals.shipping,
        vat: cartTotals.vat,
        total: cartTotals.total,
      });
    }
    // The VAT of the lines and the shipping adds up to the order's, and the discount's lines add up to the discount.
    expect(summary.lines.reduce((n, l) => n + l.staffDiscountMinor, 0)).toBe(summary.staffDiscountMinor);
    expect(summary.totalMinor).toBe(summary.subtotalMinor + summary.shippingMinor - summary.staffDiscountMinor);

    const sent = await sendDraft(storeId, actor(), draft.id, { version: draft.version, createLink: true });
    if (!sent.ok) throw new Error(`${sent.problem} ${JSON.stringify(sent.problems)}`);
    const order = (await getOrder(storeId, sent.orderId))!;
    expect(order).toMatchObject({ status: "pending_payment", currency: scenario.euro ? "EUR" : "NOK", totalMinor: summary.totalMinor, taxMinor: summary.taxMinor, shippingMinor: summary.shippingMinor });
    expect(order.staffDiscountMinor).toBe(summary.staffDiscountMinor);
    expect(order.staffDiscountLabel).toBe(scenario.discount?.label ?? null);
    if (scenario.custom) expect(order.lines.filter((l) => l.custom)).toHaveLength(1);

    const token = sent.link!.split("/").pop()!;
    // The store as the pay page reads it (this file builds its stores by hand: `getStore()` is cached for a request).
    const store = { id: storeId, slug, termsAtCheckout: "off", timeZone: tz, markets: [no], localization: localizationOf([], [{ currency: "NOK", rate: 11.5, roundTo: 1 }, { currency: "EUR", rate: 1, roundTo: 1 }], [no]) } as unknown as Store;
    const payShop = { store, market: view };
    expect(await startDraftPayment(payShop, token, { termsTicked: true, origin })).toMatchObject({ ok: true });
    const { params } = fake.created.at(-1)!;
    // What Stripe is asked to charge is the order's total: each line at what is due, quantity 1, no coupon.
    expect(chargedNow(params)).toBe(order.totalMinor);
    expect(params.discounts).toBeUndefined();
    if (scenario.euro) expect(JSON.stringify(params)).toContain('"currency":"eur"');
    const [pending] = await db().execute<Row>(sql`select provider_reference, amount_minor from commerce.payments where order_id = ${sent.orderId}::uuid and provider = 'stripe' and status = 'pending'`);
    expect(Number(pending.amount_minor)).toBe(order.totalMinor);
    const sessionId = String(pending.provider_reference);
    fake.sessions.set(sessionId, { status: "complete", payment_status: "paid", mode: params.mode, payment_intent: `pi_${sessionId}` });
    const paid = await getShopperOrder(storeId, sent.orderId, sessionId);
    expect(paid?.status).toBe("paid");
    // The invoice states the order, and its credit notes the refunds, to the minor unit.
    await expectDocuments(sent.orderId, { euro: scenario.euro });
  });

  it("paid outside Kaizen, shown in euro: the invoice says the money was paid outside, the VAT is the order's, and a recorded refund gets its credit note", async () => {
    jar.clear();
    view = noInEuro;
    const { recordDraftPaidOutside } = await import("./draft-orders");
    const draft = await buildDraft({ name: "outside", euro: true, lines: [{ sku: "DEMO-MUG-WHITE", quantity: 2 }, { sku: "DEMO-NOTEBOOK-LINED", quantity: 1 }], discount: { kind: "percent", value: "10", label: "Loyal customer" } });
    const done = await recordDraftPaidOutside(owner(), draft.id, { version: draft.version, method: "bank_transfer", reference: "KID 4711" });
    if (!done.ok) throw new Error(`${done.problem} ${JSON.stringify(done.problems)}`);
    const order = (await getOrder(storeId, done.orderId))!;
    expect(order).toMatchObject({ status: "paid", currency: "EUR" });
    const invoice = (await documentFixture.invoiceOf(storeId, done.orderId))!;
    expect(invoice, "an invoice at once: the money is real").not.toBeNull();
    expect(invoice.currency).toBe("EUR");
    expect({ total: invoice.totalMinor, vat: invoice.taxMinor }).toEqual({ total: order.totalMinor, vat: order.taxMinor });
    const payments = invoice.snapshot.payments as { kind: string; amountMinor: number; method?: string }[];
    expect(payments.map((p) => p.kind)).toEqual(["paid_outside"]);
    expect(payments[0]).toMatchObject({ amountMinor: order.totalMinor, method: "bank_transfer" });
    expect(JSON.stringify(invoice.snapshot)).not.toContain("KID 4711");
    const expected = await documentFixture.orderVatByRate(done.orderId);
    const buckets = new Map<string, number>(invoice.snapshot.buckets.map((b: { rate: number; vatMinor: number }) => [b.rate.toFixed(4), b.vatMinor]));
    for (const [rate, vat] of expected) if (vat !== 0) expect(buckets.get(rate), `VAT at ${rate}`).toBe(vat);
    const home = invoice.snapshot.buckets.reduce((sum: number, b: { vatMinor: number }) => sum + Math.floor(b.vatMinor * 11.5 + 0.5), 0);
    expect(invoice).toMatchObject({ vatHomeCurrency: "NOK", fxRate: 11.5, vatHomeMinor: home });
    // Kaizen took no fee on money it never touched, and Stripe was not asked for anything.
    const [fee] = await db().execute<Row>(sql`select kaizen_fee_minor, provider from commerce.payments where order_id = ${done.orderId}::uuid`);
    expect({ fee: Number(fee.kaizen_fee_minor), provider: fee.provider }).toEqual({ fee: 0, provider: "manual" });
    // Recorded as refunded in two parts: no Stripe call, a credit note for each, together the refunds.
    const before = fake.created.length;
    const admin = (await (await import("./order-admin")).getOrderAdmin(storeId, done.orderId))!;
    expect(admin.canRefund).toBe(true);
    const part = Math.floor(admin.refundableMinor / 3);
    const refunded = [part, admin.refundableMinor - part];
    for (const amountMinor of refunded) {
      expect(await refundOrder(storeId, done.orderId, { amountMinor, reason: "Returned", restock: [] }, member.account.id)).toMatchObject({ ok: true, status: "succeeded" });
    }
    expect(fake.created.length).toBe(before);
    const notes = await documentFixture.notesOf(storeId, done.orderId);
    expect(notes.map((n) => n.totalMinor)).toEqual(refunded);
    expect(notes.reduce((n, note) => n + note.taxMinor, 0)).toBe(invoice.taxMinor);
    expect(notes.every((n) => n.currency === "EUR" && n.netMinor + n.taxMinor === n.totalMinor)).toBe(true);
    for (const n of notes) expect(n).toMatchObject({ vatHomeCurrency: "NOK", fxRate: 11.5 });
  });

  it("keeps the number sequence whole through drafts that were sent, expired, reopened and paid", async () => {
    jar.clear();
    view = no;
    const { sendDraft, expireDrafts, reopenDraft } = await import("./draft-orders");
    const draft = await buildDraft({ name: "numbers", lines: [{ sku: "DEMO-MUG-WHITE", quantity: 1 }] });
    const sent = await sendDraft(storeId, actor(), draft.id, { version: draft.version, createLink: true });
    if (!sent.ok) throw new Error(sent.problem);
    await expireDrafts(new Date(Date.now() + 40 * 86_400_000));
    expect((await getOrder(storeId, sent.orderId))!).toMatchObject({ status: "cancelled", number: sent.number });
    expect((await reopenDraft(storeId, actor(), draft.id)).ok).toBe(true);
    const again = await sendDraft(storeId, actor(), draft.id, { version: (await (await import("./draft-orders")).getDraft(storeId, draft.id))!.version, createLink: true });
    expect(again.ok).toBe(true);
    const audit = await orderNumberAudit(storeId);
    expect(audit).toMatchObject({ missing: 0, firstMissing: null, offFormat: 0, ok: true });
    expect(audit.lastNumber).toBe(1000 + audit.orders);
  });
});
