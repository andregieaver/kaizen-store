import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const { customerSummary, findCustomer, getCustomerDetail, listCustomers } = await import("./customer-admin");
const { listPlatformCustomers, getPlatformCustomer, listStorePeople } = await import("./platform-customers");

const run = Date.now().toString(36);
let storeId: string;
let ownerId: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`owner-${run}@example.com`}, 'Olga Owner', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`cust-${run}`}, ${`Kunder ${run}`}, null) as id
  `);
  storeId = String(store.id);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`owner-${run}@example.com`}`);
  ownerId = String(owner.id);
});

afterAll(async () => {
  await closeDb();
});

/** A paid order (or one never paid), placed some days ago. */
async function order(email: string, number: string, totalMinor: number, daysAgo: number, paid = true, customerId: string | null = null) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, customer_id,
      subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address, placed_at)
    values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, ${paid ? "paid" : "pending_payment"}, ${customerId}::uuid,
      ${totalMinor}, 0, 0, ${totalMinor}, '{}', ${JSON.stringify({ name: "Gunnar Gjest", line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" })},
      now() - make_interval(days => ${daysAgo}))
    returning id
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${storeId}::uuid, ${String(row.id)}::uuid, 'stripe', ${`cs_${number}`}, ${totalMinor}, 'NOK', ${paid ? "captured" : "pending"})
  `);
  return String(row.id);
}

describe("a store's customers (D35)", () => {
  it("are one per email, guests found by any of their orders, and kept at their latest order's address", async () => {
    const guest = `Gjest.${run}@Example.com`;
    const first = await order(guest, `G1-${run}`, 10000, 5);
    const latest = await order(guest.toLowerCase(), `G2-${run}`, 25000, 1);
    await order(guest, `G3-${run}`, 99900, 0, false); // never paid: not counted

    expect(await findCustomer(storeId, first)).toEqual({ key: latest, email: guest.toLowerCase(), customerId: null });
    const summary = await customerSummary(storeId, first);
    expect(summary).toMatchObject({ name: "Gunnar Gjest", account: null, orders: 2, liveSubscriptions: 0, spentMinor: { NOK: 35000 } });
  });

  it("with an account are kept at the account, and bring together orders by email or by the account", async () => {
    const email = `kari.${run}@example.com`;
    const [customer] = await db().execute<Row>(sql`
      insert into commerce.customers (store_id, email, name, email_verified_at) values (${storeId}::uuid, ${email}, 'Kari Konto', now())
      returning id
    `);
    const customerId = String(customer.id);
    const byEmail = await order(email, `K1-${run}`, 20000, 3);
    const signedIn = await order(`kari.old.${run}@example.com`, `K2-${run}`, 5000, 2, true, customerId);
    await db().execute(sql`
      insert into commerce.subscriptions (store_id, number, status, market_code, currency, locale, email, customer_id,
        interval, interval_count, subtotal_minor, shipping_minor, total_minor, tax_minor, first_order_id, manage_token)
      values (${storeId}::uuid, ${`S1-${run}`}, 'active', 'NO', 'NOK', 'nb-NO', ${email}, ${customerId}::uuid,
        'month', 1, 20000, 0, 20000, 4000, ${byEmail}::uuid, ${`manage-${run}`})
    `);
    await db().execute(sql`
      update commerce.orders set subscription_id = (select id from commerce.subscriptions where number = ${`S1-${run}`})
      where id = ${byEmail}::uuid
    `);

    const ref = await findCustomer(storeId, byEmail);
    expect(ref).toEqual({ key: customerId, email, customerId });
    expect((await findCustomer(storeId, customerId))?.key).toBe(customerId);

    const detail = await getCustomerDetail(storeId, ref!);
    expect(detail).toMatchObject({ name: "Kari Konto", account: "verified", orders: 2, liveSubscriptions: 1 });
    expect(detail?.orderList.map((o) => o.id)).toEqual([signedIn, byEmail]);
    expect(detail?.subscriptionList).toHaveLength(1);
    expect(detail?.subscriptionList[0]).toMatchObject({ status: "active", orders: 1 });
  });

  it("are listed by their latest order, and found by name or email", async () => {
    const all = await listCustomers(storeId);
    // The guest ordered a day ago, Kari two days ago (signed in, from another email: still Kari).
    expect(all.map((c) => c.email)).toEqual([`gjest.${run}@example.com`, `kari.${run}@example.com`]);
    expect(all[1]).toMatchObject({ name: "Kari Konto", account: "verified", orders: 2, liveSubscriptions: 1 });
    expect((await listCustomers(storeId, { q: "gunnar" })).map((c) => c.account)).toEqual([null]);
    expect(await listCustomers(storeId, { q: "nobody-by-this-name" })).toEqual([]);
    expect(await findCustomer(storeId, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("Kaizen's customers (D35)", () => {
  it("are the people who run stores, with each store's role and plan", async () => {
    const found = await listPlatformCustomers({ q: `kunder ${run}` });
    expect(found.map((c) => c.id)).toEqual([ownerId]);
    expect(found[0].stores).toEqual([expect.objectContaining({ slug: `cust-${run}`, role: "owner", planName: null })]);
    expect((await getPlatformCustomer(ownerId))?.stores).toHaveLength(1);
    expect(await listStorePeople(storeId)).toEqual([expect.objectContaining({ id: ownerId, role: "owner" })]);
  });
});
