import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, zonedDate } from "@/lib/booking-slots";
import { toMarket } from "@/lib/markets";
import { isoWeekday } from "@/lib/standing-orders";
import { allowSmallBase } from "@/lib/unit-price-test-support";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

/** Kaizen's platform Stripe client, faked: charges succeed unless told to refuse, and every call is kept. */
const fake = vi.hoisted(() => {
  const charges: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const sessions: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  const detached: string[] = [];
  const refuse = { next: null as null | { code: string; message: string } };
  const setup = new Map<string, Record<string, unknown>>();
  const expired: string[] = [];
  let made = 0;
  const client = {
    customers: { create: async () => ({ id: "cus_weekly" }) },
    paymentMethods: {
      detach: async (id: string) => {
        detached.push(id);
        return { id };
      },
    },
    paymentIntents: {
      create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
        charges.push({ params, options });
        if (refuse.next) {
          const error = Object.assign(new Error(refuse.next.message), { code: refuse.next.code, payment_intent: { id: `pi_refused_${charges.length}` } });
          refuse.next = null;
          throw error;
        }
        return { id: `pi_weekly_${charges.length}`, status: "succeeded" };
      },
    },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          sessions.push({ params, options });
          const id = `cs_weekly_${++made}`;
          setup.set(id, { status: "open", payment_status: "unpaid" });
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        retrieve: async (id: string) => ({ id, ...setup.get(id) }),
        expire: async (id: string) => {
          expired.push(id);
          setup.set(id, { status: "expired" });
          return { id };
        },
      },
    },
  };
  return { client, charges, sessions, detached, refuse, setup, expired };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client }));

const deliveries = await import("./standing-orders");

const run = Date.now().toString(36);
const slug = `weekly-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const TZ = "Europe/Oslo";
let storeId: string;
let member: Membership;
let customerId: string;
let scheduleId: string;
let listId: string;
const variant: Record<string, string> = {};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Ukeskassen', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${slug}@example.com`}`);
  member = { account: { id: String(account.id) }, store: { id: storeId, slug, name: "Ukeskassen" }, role: "owner" } as unknown as Membership;
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)
  `);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${storeId}::uuid`);
  for (const row of await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${storeId}::uuid`)) {
    variant[String(row.sku)] = String(row.id);
  }
  await deliveries.setDeliveriesModule(member, true);
  // Deliveries tomorrow, cutoff today at midnight: today's round is being packed.
  const tomorrow = addDays(zonedDate(Date.now(), TZ), 1);
  expect(
    await deliveries.saveSchedule(member, {
      id: null,
      marketCode: "NO",
      name: "Tomorrow",
      deliveryWeekday: isoWeekday(tomorrow),
      cutoffDays: 1,
      cutoffTime: "00:00",
      active: true,
    }),
  ).toEqual({ ok: true });
  scheduleId = (await deliveries.listSchedules(storeId))[0].id;
  const [customer] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${`kari-${run}@example.com`}, 'Kari Nordmann') returning id
  `);
  customerId = String(customer.id);
});

beforeEach(() => {
  fake.charges.length = 0;
  fake.sessions.length = 0;
});

afterAll(async () => {
  await closeDb();
});

const address = { name: "Kari Nordmann", line1: "Storgata 1", line2: "", postalCode: "0155", city: "Oslo", phone: "" };
const shop = () => ({ storeId, storeSlug: slug, market: no });
const customer = () => ({ id: customerId, email: `kari-${run}@example.com`, name: "Kari Nordmann" });
const round = (date: string) => ({ date, cutoffAt: Date.now() - 60_000 });

describe("starting a weekly delivery (D102)", () => {
  it("needs the shopper's agreement, then saves a card in Stripe's setup mode on the store's account", async () => {
    expect(await deliveries.startCardSetup(shop(), customer(), { scheduleId, address, consent: false }, "https://shop.test")).toEqual({
      ok: false,
      problem: "consent",
    });
    const started = await deliveries.startCardSetup(shop(), customer(), { scheduleId, address, consent: true }, "https://shop.test");
    expect(started).toEqual({ ok: true, url: "https://checkout.stripe.test/cs_weekly_1" });
    const { params, options } = fake.sessions[0];
    expect(options).toEqual({ stripeAccount: `acct_${run}` });
    expect(params).toMatchObject({ mode: "setup", currency: "nok", customer: "cus_weekly", locale: "nb" });
    expect(params).not.toHaveProperty("payment_method_types");
    expect(String(params.success_url)).toContain("/deliveries?setup={CHECKOUT_SESSION_ID}");

    // Not on until Stripe has the card.
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-TOTE"], 1)).toMatchObject({ ok: true });
    fake.setup.set("cs_weekly_1", { status: "open" });
    expect(await deliveries.finishCardSetup(storeId, customerId, "cs_weekly_1")).toBe(false);
    fake.setup.set("cs_weekly_1", {
      status: "complete",
      setup_intent: { status: "succeeded", payment_method: { id: "pm_visa", type: "card", card: { brand: "visa", last4: "4242" } } },
    });
    expect(await deliveries.finishCardSetup(storeId, customerId, "cs_weekly_1")).toBe(true);
    const view = await deliveries.getStandingOrder(storeId, customerId, no);
    expect(view).toMatchObject({ status: "active", cardLabel: "Visa •••• 4242", shippingAddress: { city: "Oslo", country: "NO" } });
    listId = view!.id;
    const [email] = await db().execute<Row>(sql`
      select kind from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'delivery.started'
    `);
    expect(email).toBeDefined();
  });
});

describe("the list (D102)", () => {
  it("takes the store's own goods to ship, and nothing else", async () => {
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-MASSAGE-60"], 1)).toEqual({ ok: false, problem: "not_listable" });
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-HYTTE"], 1)).toEqual({ ok: false, problem: "not_listable" });
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-MUG-WHITE"], 2)).toEqual({ ok: true, quantity: 2 });
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-MUG-WHITE"], 1, { add: true })).toEqual({ ok: true, quantity: 3 });
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-MUG-WHITE"], 500)).toEqual({ ok: true, quantity: 99 });
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-MUG-WHITE"], 2)).toEqual({ ok: true, quantity: 2 });
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-TOTE"], 0)).toEqual({ ok: true, quantity: 0 });
    // What is in it (D160): the list shows the variant's content as it is now, with the base the list's market shows.
    await db().execute(sql`
      update commerce.product_variants set measure_amount = 250, measure_unit = 'g', measure_base = '100g' where id = ${variant["DEMO-MUG-WHITE"]}::uuid
    `);
    const view = await deliveries.getStandingOrder(storeId, customerId, no);
    expect(view?.lines.map((l) => [l.quantity, l.available])).toEqual([[2, true]]);
    expect(view?.estimate.itemsMinor).toBe(2 * view!.lines[0].unitMinor!);
    // The country table as read shows kg in Norway whatever the owner chose; with Norway opened for the test, the owner's 100 g.
    expect(view?.lines[0].measure).toEqual({ amount: "250", unit: "g", base: "kg" });
    const restoreSmallBase = allowSmallBase("NO");
    try {
      expect((await deliveries.getStandingOrder(storeId, customerId, no))?.lines[0].measure).toEqual({ amount: "250", unit: "g", base: "100g" });
    } finally {
      restoreSmallBase();
    }
    await db().execute(sql`
      update commerce.product_variants set measure_amount = null, measure_unit = null, measure_base = null where id = ${variant["DEMO-MUG-WHITE"]}::uuid
    `);
  });
});

describe("the cutoff (D102)", () => {
  it("makes the list today's delivery once: an order at today's prices, its stock held, the shopper told", async () => {
    // The list as it stood at today's cutoff, agreed to before it, as if it had been running a while.
    await db().execute(sql`
      insert into commerce.standing_order_lines (store_id, standing_order_id, variant_id, quantity)
      values (${storeId}::uuid, ${listId}::uuid, ${variant["DEMO-MUG-BLACK"]}::uuid, 5)
    `);
    await db().execute(sql`update commerce.standing_orders set consent_at = now() - interval '3 days' where id = ${listId}::uuid`);
    const made = await deliveries.prepareDueDeliveries();
    expect(made).toMatchObject({ ordered: 1 });
    expect(await deliveries.prepareDueDeliveries()).toEqual({ ordered: 0, other: 0 });

    const [delivery] = await db().execute<Row>(sql`
      select sd.outcome, sd.left_out, o.id, o.status, o.email, o.shipping_address, o.total_minor, o.customer_id,
        (select min(r.expires_at) > now() + interval '1 day' from commerce.inventory_reservations r
          where r.order_id = o.id and r.released_at is null) as held_long
      from commerce.standing_deliveries sd join commerce.orders o on o.id = sd.order_id
      where sd.standing_order_id = ${listId}::uuid
    `);
    expect(delivery).toMatchObject({
      outcome: "ordered",
      status: "pending_payment",
      email: `kari-${run}@example.com`,
      customer_id: customerId,
      shipping_address: { line1: "Storgata 1", city: "Oslo" },
      held_long: true,
    });
    // Only 3 black mugs were there: the rest is left out, and said.
    expect(delivery.left_out).toEqual([{ title: expect.any(String), wanted: 5, got: 3 }]);
    const lines = await db().execute<Row>(sql`select sku, quantity from commerce.order_lines where order_id = ${String(delivery.id)}::uuid order by sku`);
    expect(lines.map((l) => [l.sku, l.quantity])).toEqual([
      ["DEMO-MUG-BLACK", 3],
      ["DEMO-MUG-WHITE", 2],
    ]);
    const [email] = await db().execute<Row>(sql`
      select kind from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'delivery.prepared'
    `);
    expect(email).toBeDefined();

    const view = await deliveries.getStandingOrder(storeId, customerId, no);
    expect(view?.current).toMatchObject({ orderId: delivery.id, totalMinor: Number(delivery.total_minor) });
  });

  it("takes changes made after the cutoff into the next delivery, not the one being packed", async () => {
    const [before] = await db().execute<Row>(sql`
      select o.total_minor from commerce.standing_deliveries sd join commerce.orders o on o.id = sd.order_id
      where sd.standing_order_id = ${listId}::uuid
    `);
    await deliveries.setListQuantity(storeId, customerId, variant["DEMO-TOTE"], 4);
    const [after] = await db().execute<Row>(sql`
      select o.total_minor from commerce.standing_deliveries sd join commerce.orders o on o.id = sd.order_id
      where sd.standing_order_id = ${listId}::uuid
    `);
    expect(after.total_minor).toBe(before.total_minor);
  });

  it("records skipped, paused and empty days without an order", async () => {
    const view = await deliveries.getStandingOrder(storeId, customerId, no);
    const next = view!.upcoming[0];
    expect(await deliveries.setSkip(storeId, customerId, next, true)).toMatchObject({ ok: true });
    expect(await deliveries.setSkip(storeId, customerId, "2020-01-01", true)).toEqual({ ok: false, problem: "date" });
    expect(await deliveries.prepareDelivery(storeId, listId, round(next))).toBe("skipped");
    expect(await deliveries.prepareDelivery(storeId, listId, round(next))).toBeNull();

    const later = view!.upcoming[1];
    await deliveries.setListStatus(storeId, customerId, "pause");
    expect(await deliveries.prepareDelivery(storeId, listId, round(later))).toBe("paused");
    await deliveries.setListStatus(storeId, customerId, "resume");

    await db().execute(sql`delete from commerce.standing_order_lines where standing_order_id = ${listId}::uuid and variant_id <> ${variant["DEMO-TOTE"]}::uuid`);
    await deliveries.setListQuantity(storeId, customerId, variant["DEMO-TOTE"], 0);
    expect(await deliveries.prepareDelivery(storeId, listId, round(view!.upcoming[2]))).toBe("empty");
    await deliveries.setListQuantity(storeId, customerId, variant["DEMO-TOTE"], 1);
  });
});

describe("sending (D102)", () => {
  const currentOrder = async () => {
    const [row] = await db().execute<Row>(sql`
      select o.id, o.total_minor from commerce.standing_deliveries sd join commerce.orders o on o.id = sd.order_id
      where sd.standing_order_id = ${listId}::uuid and sd.outcome = 'ordered' order by sd.delivery_date limit 1
    `);
    return { id: String(row.id), total: Number(row.total_minor) };
  };

  it("emails a link to pay when the card is refused, and keeps the order waiting", async () => {
    const order = await currentOrder();
    fake.refuse.next = { code: "authentication_required", message: "Authentication required" };
    const refused = await deliveries.chargeDelivery(storeId, order.id);
    expect(refused).toMatchObject({ ok: false, problem: expect.stringContaining("confirm this payment") });
    const [row] = await db().execute<Row>(sql`select status from commerce.orders where id = ${order.id}::uuid`);
    expect(row.status).toBe("pending_payment");
    expect(await deliveries.deliveryOfOrder(storeId, order.id)).toMatchObject({ listId, lastFailure: expect.stringContaining("confirm") });
    const [email] = await db().execute<Row>(sql`
      select kind from commerce.email_messages where store_id = ${storeId}::uuid and kind = 'delivery.card_failed'
    `);
    expect(email).toBeDefined();

    const url = await deliveries.startDeliveryPayment(shop(), customerId, order.id, "https://shop.test");
    expect(url).toBe("https://checkout.stripe.test/cs_weekly_2");
    expect(fake.sessions[0].params).toMatchObject({
      mode: "payment",
      customer: "cus_weekly",
      payment_intent_data: { setup_future_usage: "off_session" },
      line_items: [{ price_data: { unit_amount: order.total } }],
    });
    expect(await deliveries.deliveryOrderForSession(storeId, customerId, "cs_weekly_2")).toBe(order.id);
    expect(await deliveries.startDeliveryPayment(shop(), "00000000-0000-4000-8000-000000000000", order.id, "https://shop.test")).toBeNull();
  });

  it("charges the saved card off session for what was packed, on the store's account, and the order is paid", async () => {
    const order = await currentOrder();
    const charged = await deliveries.chargeDelivery(storeId, order.id);
    expect(charged).toMatchObject({ ok: true });
    // The pay link the shopper did not use is closed first, so they cannot pay twice.
    expect(fake.expired).toEqual(["cs_weekly_2"]);
    expect(fake.charges[0].params).toMatchObject({
      amount: order.total,
      currency: "nok",
      customer: "cus_weekly",
      payment_method: "pm_visa",
      off_session: true,
      confirm: true,
    });
    expect(fake.charges[0].params).not.toHaveProperty("payment_method_types");
    // A new try after the refusal is a new payment to Stripe.
    expect(fake.charges[0].options).toEqual({ stripeAccount: `acct_${run}`, idempotencyKey: `delivery-${order.id}-1` });
    const [row] = await db().execute<Row>(sql`
      select o.status, (select count(*)::int from commerce.inventory_reservations r where r.order_id = o.id and r.released_at is null) as held
      from commerce.orders o where o.id = ${order.id}::uuid
    `);
    expect(row).toEqual({ status: "paid", held: 0 });
    expect(await deliveries.chargeDelivery(storeId, order.id)).toMatchObject({ ok: false });
  });
});

describe("ending (D102)", () => {
  it("stops the list and lets go of its card, and a new list can start", async () => {
    expect(await deliveries.setListStatus(storeId, customerId, "cancel")).toMatchObject({ ok: true });
    expect(fake.detached).toContain("pm_visa");
    expect(await deliveries.getStandingOrder(storeId, customerId, no)).toBeNull();
    expect(await deliveries.setListQuantity(storeId, customerId, variant["DEMO-TOTE"], 1)).toEqual({ ok: false, problem: "no_list" });
    const rows = await deliveries.listStandingOrders(storeId);
    expect(rows.map((r) => r.status)).toEqual(["cancelled"]);
    const rounds = await deliveries.deliveryRounds(storeId);
    expect(rounds[0].current?.orders).toHaveLength(1);
  });
});
