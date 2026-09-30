import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { convertCredits, earnAmount, restoreShare } from "@/lib/bonus";
import { localizationOf, conversionFor } from "@/lib/localization";
import { showMarket, toMarket } from "@/lib/markets";

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
          return { id, url: null, client_secret: `${id}_secret_test`, payment_method_types: ["card"] };
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

vi.mock("./stripe", () => ({
  platformStripe: () => fake.client,
  platformPublishableKey: () => "pk_test_kinds",
  platformModes: () => ["test"],
}));

const { changeLine, getCart } = await import("./cart");
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

beforeAll(async () => {
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
  // The store offers euro (D109), at the rate `noInEuro` uses.
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
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
};

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

  it.each([...scenarios, ...euroScenarios, ...campaignScenarios])("$name: from the cart to the payment form to a paid order", async (scenario) => {
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
    // The free products are lines of the order, at no cost, and they are what the cart showed.
    expect(order?.lines.filter((l) => l.gift).map((l) => [l.variantId, l.quantity, l.totalMinor])).toEqual(summary.gifts.map((g) => [g.variantId, g.quantity, 0]));
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
      ...(params.mode === "subscription" && { subscription: `sub_kinds_${run}_${open!.orderId}` }),
    });
    const paid = await getShopperOrder(storeId, open!.orderId, open!.sessionId);
    expect(paid?.status).toBe("paid");
    const booked = paid?.lines.filter((l) => l.booking) ?? [];
    expect(booked.map((l) => l.booking?.status)).toEqual(Array(scenario.bookings).fill("confirmed"));
    expect(await getOpenCheckout(storeId, cartId())).toBeNull();
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
