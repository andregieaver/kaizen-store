import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));

const { CONVERSATION_ORDERS, conversationCustomer, latestOrdersOf } = await import("./support-customer");
const { deskReplyTo } = await import("./support-reply-to");
const support = await import("./support");
const { systemDesk } = await import("./support-desk");

type Row = Record<string, unknown>;

/**
 * Ecosystem plan E1.1 and E1.4 (D711): the customer a conversation is with and their latest orders, as the inbox's Context column shows
 * them; and the address replies to the store's order emails go to while its desk takes them.
 */

const run = Date.now().toString(36);
let storeId: string;
let otherStore: string;
let kari: string;
let n = 0;

async function makeStore(tag: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`sc-${tag}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`sc-${tag}-${run}`}, 'Test', null) as id`);
  return String(created.id);
}

async function order(store: string, o: { customerId?: string | null; email: string; at: string; status?: string; total?: number }): Promise<string> {
  n += 1;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at, capture_mode, capture_before)
    values (${store}::uuid, ${`SC${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${o.email}, ${o.customerId ?? null}::uuid, ${o.status ?? "paid"}::commerce.order_status,
      ${o.total ?? 100}, 0, 0, 0, ${o.total ?? 100}, '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz,
      ${o.status === "authorized" ? "by_hand" : null}, ${o.status === "authorized" ? sql`now() + interval '7 days'` : sql`null`})
    returning id
  `);
  return String(row.id);
}

beforeAll(async () => {
  storeId = await makeStore("a");
  otherStore = await makeStore("b");
  kari = String(
    (await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`kari-${run}@example.com`}) returning id`))[0].id,
  );
}, 120_000);

afterAll(async () => {
  await closeDb();
});

describe("the customer and their latest orders in a conversation (E1.1)", () => {
  it("lists the newest paid or held orders by the account or its address, counts them all, and leaves out what was never paid", async () => {
    const email = `kari-${run}@example.com`;
    await order(storeId, { customerId: kari, email, at: "2026-10-01T10:00:00Z" });
    // A guest order with the account's address counts as theirs, as on the customer's own page.
    await order(storeId, { email: email.toUpperCase(), at: "2026-10-05T10:00:00Z", status: "fulfilled" });
    const held = await order(storeId, { customerId: kari, email, at: "2026-10-09T10:00:00Z", status: "authorized", total: 49900 });
    const newest = await order(storeId, { customerId: kari, email, at: "2026-10-10T10:00:00Z", status: "paid", total: 12950 });
    // Never paid: not an order to ask about.
    await order(storeId, { customerId: kari, email, at: "2026-10-11T10:00:00Z", status: "pending_payment" });
    // Another store's order with the same address is never shown.
    await order(otherStore, { email, at: "2026-10-12T10:00:00Z" });

    const latest = await latestOrdersOf(storeId, kari);
    expect(latest.count).toBe(4);
    expect(latest.orders).toHaveLength(CONVERSATION_ORDERS);
    expect(latest.orders.map((o) => o.id).slice(0, 2)).toEqual([newest, held]);
    expect(latest.orders[0]).toMatchObject({ status: "paid", totalMinor: 12950, currency: "NOK" });
    expect(latest.orders.map((o) => o.status)).not.toContain("pending_payment");
  });

  it("is the signed-in account, else the matching address, and holds no orders for a person who may not read them", async () => {
    expect(await conversationCustomer(storeId, { customerId: null, addressCustomer: null }, true)).toBeNull();
    const signedIn = await conversationCustomer(storeId, { customerId: kari, addressCustomer: null }, true);
    expect(signedIn).toMatchObject({ id: kari, verified: true, orderCount: 4 });
    expect(signedIn!.orders).toHaveLength(CONVERSATION_ORDERS);
    expect(await conversationCustomer(storeId, { customerId: null, addressCustomer: kari }, false)).toEqual({ id: kari, verified: false, orders: null, orderCount: null });
  });

  it("hands the signed-in customer's id on with the conversation", async () => {
    const desk = systemDesk(storeId);
    await support.ensureDesk(desk);
    await db().execute(sql`update commerce.support_settings set mode = 'people' where store_id = ${storeId}::uuid`);
    const [made] = await db().execute<Row>(sql`
      insert into commerce.support_conversations (store_id, source, handler, token_hash, customer_id, market, locale)
      values (${storeId}::uuid, 'site', 'queue', ${`hash-${run}`}, ${kari}::uuid, 'no', 'nb-NO')
      returning id
    `);
    const view = await support.staffConversation(desk, String(made.id));
    expect(view).toMatchObject({ signedIn: true, customerId: kari, addressCustomer: null });
  });
});

describe("replies to the store's order emails (E1.4)", () => {
  const env = { SUPPORT_INBOUND_DOMAIN: "in.example.com" };
  const set = (mode: string, formMessages: string, emailKey: string | null) =>
    db().execute(sql`update commerce.support_settings set mode = ${mode}, form_messages = ${formMessages}, email_key = ${emailKey} where store_id = ${storeId}::uuid`);

  it("go to the desk's address only while it is on, takes customers' messages alone and has its address", async () => {
    await support.ensureDesk(systemDesk(storeId));
    const key = `k${run}`.padEnd(16, "0").slice(0, 20);
    await set("people", "inbox", key);
    expect(await deskReplyTo(storeId, env)).toBe(`desk-${key}@in.example.com`);
    // Receiving not set up on the platform: the store's own address stays.
    expect(await deskReplyTo(storeId, {})).toBeNull();
    await set("people", "inbox_and_email", key);
    expect(await deskReplyTo(storeId, env)).toBeNull();
    await set("off", "inbox", key);
    expect(await deskReplyTo(storeId, env)).toBeNull();
    await set("people", "inbox", null);
    expect(await deskReplyTo(storeId, env)).toBeNull();
    // A store with no desk at all.
    expect(await deskReplyTo(otherStore, env)).toBeNull();
  });
});
