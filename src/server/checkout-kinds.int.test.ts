import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, zonedDate, zonedTime } from "@/lib/booking-slots";
import { toMarket } from "@/lib/markets";

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
const { preRegisterCustomer, startSession } = await import("./customers");

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

const shop = () => ({ storeId, market: no });
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
  const week = await appointmentSlots(storeId, product["demo-massasje"], { from: nextDay() });
  const slot = week?.days.flatMap((d) => d.slots)[0];
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
  /** Who buys (D108): in a discount group, or an employee of a company that gives half of one. */
  buyer?: "group" | "company";
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

  it.each(scenarios)("$name: from the cart to the payment form to a paid order", async (scenario) => {
    jar.clear();
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
    if (scenario.buyer) expect(summary.member).toMatchObject({ percent: scenario.buyer === "group" ? 10 : 5 });
    else expect(summary.member).toBeNull();

    // "Til kassen": Kaizen's checkout page, with Stripe's form.
    const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", scenario.consent ?? {}, { customerId: buyerId });
    expect(started).toEqual({ ok: true, url: `${origin}/s/${slug}/no/checkout` });
    const open = await getOpenCheckout(storeId, cartId());
    // The page shows the form, not "the cart has changed" with a button to start again.
    expect(open).toMatchObject({ changed: false, expired: false, clientSecret: expect.stringMatching(/_secret_test$/) });

    // The order is what the cart page showed: total, VAT, and what is left for the venue.
    const order = await getOrder(storeId, open!.orderId);
    expect({ total: order?.totalMinor, vat: order?.taxMinor, balance: order?.balanceMinor, member: order?.memberDiscountMinor, off: order?.discountMinor }).toEqual({
      total: summary.total,
      vat: summary.vat,
      balance: summary.balance,
      member: summary.memberDiscountMinor,
      off: summary.discountMinor,
    });
    // Stripe is asked for what is due now, no more and no less.
    const { params } = fake.created.at(-1)!;
    expect(chargedNow(params)).toBe(summary.dueNowMinor);
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
  });
});
