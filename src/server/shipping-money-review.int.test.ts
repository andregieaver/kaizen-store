import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays, zonedDate } from "@/lib/booking-slots";
import { toMarket } from "@/lib/markets";
import { isoWeekday } from "@/lib/standing-orders";

import type { Membership } from "./auth";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

/** Adversarial review (money lens, D237): a weekly box must pay the market's flat rate (spec 1.4 decision 1, 2.8), never a shipping method's. */
const fake = vi.hoisted(() => {
  const setup = new Map<string, Record<string, unknown>>();
  let made = 0;
  const client = {
    customers: { create: async () => ({ id: "cus_weekly" }) },
    paymentMethods: { detach: async (id: string) => ({ id }) },
    paymentIntents: { create: async () => ({ id: "pi_x", status: "succeeded" }) },
    checkout: {
      sessions: {
        create: async () => {
          const id = `cs_review_${++made}`;
          setup.set(id, { status: "open", payment_status: "unpaid" });
          return { id, url: `https://checkout.stripe.test/${id}` };
        },
        retrieve: async (id: string) => ({ id, ...setup.get(id) }),
        expire: async (id: string) => ({ id }),
      },
    },
  };
  return { client, setup };
});

vi.mock("./stripe", () => ({ platformStripe: () => fake.client }));

const deliveries = await import("./standing-orders");

const run = Date.now().toString(36);
const slug = `shipreview-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const TZ = "Europe/Oslo";
let storeId: string;
let customerId: string;
const variant: Record<string, string> = {};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Ukeskassen', null) as id`);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${slug}@example.com`}`);
  const member = { account: { id: String(account.id) }, store: { id: storeId, slug, name: "Ukeskassen" }, role: "owner" } as unknown as Membership;
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${`acct_${run}`}, 'active', false)
  `);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${storeId}::uuid`);
  for (const row of await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${storeId}::uuid`)) {
    variant[String(row.sku)] = String(row.id);
  }
  await deliveries.setDeliveriesModule(member, true);
  const tomorrow = addDays(zonedDate(Date.now(), TZ), 1);
  await deliveries.saveSchedule(member, { id: null, marketCode: "NO", name: "Tomorrow", deliveryWeekday: isoWeekday(tomorrow), cutoffDays: 1, cutoffTime: "00:00", active: true });
  const scheduleId = (await deliveries.listSchedules(storeId))[0].id;
  const [customer] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name) values (${storeId}::uuid, ${`kari-${run}@example.com`}, 'Kari Nordmann') returning id
  `);
  customerId = String(customer.id);
  const shop = { storeId, storeSlug: slug, market: no };
  const who = { id: customerId, email: `kari-${run}@example.com`, name: "Kari Nordmann" };
  const address = { name: "Kari Nordmann", line1: "Storgata 1", line2: "", postalCode: "0155", city: "Oslo", phone: "" };
  await deliveries.startCardSetup(shop, who, { scheduleId, address, consent: true }, "https://shop.test");
  fake.setup.set("cs_review_1", {
    status: "complete",
    setup_intent: { status: "succeeded", payment_method: { id: "pm_visa", type: "card", card: { brand: "visa", last4: "4242" } } },
  });
  expect(await deliveries.finishCardSetup(storeId, customerId, "cs_review_1")).toBe(true);
  await deliveries.setListQuantity(storeId, customerId, variant["DEMO-MUG-WHITE"], 1);
  await db().execute(sql`update commerce.standing_orders set consent_at = now() - interval '3 days' where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid`);

  // The market's flat rate 99 kr; one shipping method, Express, at 249 kr everywhere.
  await db().execute(sql`
    insert into commerce.shipping_rates (store_id, market_code, currency, amount_minor, free_over_minor) values (${storeId}::uuid, 'NO', 'NOK', 9900, null)
    on conflict (store_id, market_code) do update set amount_minor = 9900, free_over_minor = null
  `);
  const [method] = await db().execute<Row>(sql`
    insert into commerce.shipping_methods (store_id, market_code, currency, name) values (${storeId}::uuid, 'NO', 'NOK', 'Express') returning id
  `);
  await db().execute(sql`
    insert into commerce.shipping_method_rates (store_id, method_id, basis, amount_minor) values (${storeId}::uuid, ${String(method.id)}::uuid, 'flat', 24900)
  `);
});

afterAll(async () => {
  await closeDb();
});

describe("a weekly box with the store's own shipping methods on (D102, D237 1.4 decision 1)", () => {
  it("pays the market's flat rate, as its estimate says, never a method's price", async () => {
    const view = await deliveries.getStandingOrder(storeId, customerId, no);
    expect(view?.estimate.shippingMinor).toBe(9900);
    expect(await deliveries.prepareDueDeliveries()).toMatchObject({ ordered: 1 });
    const [order] = await db().execute<Row>(sql`
      select o.shipping_minor, o.delivery from commerce.standing_deliveries sd join commerce.orders o on o.id = sd.order_id
      join commerce.standing_orders so on so.id = sd.standing_order_id
      where so.store_id = ${storeId}::uuid and so.customer_id = ${customerId}::uuid
    `);
    expect(Number(order.shipping_minor)).toBe(9900);
  });
});
