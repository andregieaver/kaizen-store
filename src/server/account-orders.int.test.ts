import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { ACCOUNT_ORDERS_PAGE, parseAccountOrderParams } from "@/lib/account-orders";

vi.mock("server-only", () => ({}));

const { findCustomerOrders } = await import("./customers");

type Row = Record<string, unknown>;

/**
 * Finding an order in My account (wave 5 unit J2, D304, `docs/wave-5-marketing.md` 11.2): keyset pages without gaps or repeats, search by
 * number, product and tracking number within the customer's own orders, the state filter, and another customer's orders never found.
 */

const run = Date.now().toString(36);
let storeId: string;
let mine: string;
let theirs: string;
let n = 0;

async function order(customerId: string, o: { title?: string; at: string; status?: string }) {
  n += 1;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, status, subtotal_minor, shipping_minor, discount_minor,
      tax_minor, total_minor, billing_address, shipping_address, placed_at)
    values (${storeId}::uuid, ${`AO${run}-${n}`}, 'NO', 'NOK', 'nb-NO', 'x@example.com', ${customerId}::uuid, ${o.status ?? "paid"}::commerce.order_status, 100, 0, 0, 0, 100,
      '{}'::jsonb, '{}'::jsonb, ${o.at}::timestamptz)
    returning id, number
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code, venue_minor, delivery)
    values (${storeId}::uuid, ${String(row.id)}::uuid, ${`SKU-${n}`}, ${o.title ?? "Thing"}, 1, 100, 100, 0, 0.25, 'txcd_99999999', 0, 'digital')
  `);
  return { id: String(row.id), number: String(row.number) };
}

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`ao-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`ao-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  const make = async (who: string) =>
    String((await db().execute<Row>(sql`insert into commerce.customers (store_id, email) values (${storeId}::uuid, ${`${who}-${run}@example.com`}) returning id`))[0].id);
  mine = await make("mine");
  theirs = await make("theirs");
});

afterAll(async () => {
  await closeDb();
});

describe("finding an order in My account (D304 J2)", () => {
  it("pages the customer's own orders newest first, without gaps or repeats", async () => {
    for (let i = 0; i < ACCOUNT_ORDERS_PAGE + 5; i++) await order(mine, { at: `2026-09-01T10:${String(i).padStart(2, "0")}:00Z` });
    await order(theirs, { at: "2026-09-02T10:00:00Z" });
    const first = await findCustomerOrders(storeId, mine, parseAccountOrderParams({}));
    expect(first.orders).toHaveLength(ACCOUNT_ORDERS_PAGE);
    expect(first.next).not.toBeNull();
    const second = await findCustomerOrders(storeId, mine, { ...parseAccountOrderParams({}), after: first.next });
    expect(second.orders).toHaveLength(5);
    expect(second.next).toBeNull();
    const ids = [...first.orders, ...second.orders].map((o) => o.id);
    expect(new Set(ids).size).toBe(ACCOUNT_ORDERS_PAGE + 5);
    expect(first.orders[0].placedAt > first.orders[1].placedAt).toBe(true);
  });

  it("finds by product, number and tracking number, only among the customer's own", async () => {
    const shoes = await order(mine, { title: "Red running shoes", at: "2026-10-01T10:00:00Z" });
    const other = await order(theirs, { title: "Red running shoes", at: "2026-10-01T11:00:00Z" });
    const byProduct = await findCustomerOrders(storeId, mine, parseAccountOrderParams({ q: "running" }));
    expect(byProduct.orders.map((o) => o.id)).toEqual([shoes.id]);
    const byNumber = await findCustomerOrders(storeId, mine, parseAccountOrderParams({ q: other.number }));
    expect(byNumber.orders).toHaveLength(0);
    expect((await findCustomerOrders(storeId, mine, parseAccountOrderParams({ q: `#${shoes.number}` }))).orders.map((o) => o.id)).toEqual([shoes.id]);
    await db().execute(sql`insert into commerce.shipments (store_id, order_id, carrier, tracking_number, legacy) values (${storeId}::uuid, ${shoes.id}::uuid, 'Posten', 'TRACK70', true)`);
    expect((await findCustomerOrders(storeId, mine, parseAccountOrderParams({ q: "track70" }))).orders.map((o) => o.id)).toEqual([shoes.id]);
    // A wildcard typed is a literal.
    expect((await findCustomerOrders(storeId, mine, parseAccountOrderParams({ q: "%%" }))).orders).toHaveLength(0);
  });

  it("filters by state", async () => {
    const sent = await findCustomerOrders(storeId, mine, parseAccountOrderParams({ state: "sent" }));
    expect(sent.orders.every((o) => o.status !== "cancelled")).toBe(true);
    expect(sent.orders).toHaveLength(1);
    const open = await findCustomerOrders(storeId, mine, parseAccountOrderParams({ state: "open" }));
    expect(open.orders.length).toBeGreaterThan(0);
    expect(open.orders.some((o) => o.id === sent.orders[0].id)).toBe(false);
  });
});
