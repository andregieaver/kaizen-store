import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { attentionFor, totalSales } from "@/lib/control-center";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const center = await import("./control-center");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let account: Account;
let storeId: string;
let variant: { id: string; sku: string };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`center-${run}@example.com`}, 'Kari', 'Kaffe') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`center-${run}`}, 'Kaffe', null) as id`);
  storeId = String(store.id);
  const [row] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`center-${run}@example.com`}`);
  account = { id: String(row.id), email: String(row.email), name: "Kari", platformAdmin: false };
  const [v] = await db().execute<Row>(sql`
    select v.id, v.sku from commerce.product_variants v join commerce.products p on p.id = v.product_id
    where v.store_id = ${storeId}::uuid and v.active and v.delivery = 'physical' and p.status = 'active' order by v.sku limit 1
  `);
  variant = { id: String(v.id), sku: String(v.sku) };
  await db().execute(sql`update commerce.inventory_levels set on_hand = 1 where variant_id = ${variant.id}::uuid`);
});

afterAll(async () => {
  await closeDb();
});

/** An order of the store: paid or not, placed some days ago. */
async function order(n: number, status: "paid" | "pending_payment" | "fulfilled", daysAgo: number, total: number, captured = true) {
  const [o] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
      billing_address, shipping_address, placed_at)
    values (${storeId}::uuid, ${`${run}-${n}`}, 'NO', 'NOK', 'nb-NO', 'x@example.com', ${status}, ${total}, 0, 0, ${total},
      ${JSON.stringify({ name: "Ane" })}, ${JSON.stringify({ name: "Ane", line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" })},
      now() - make_interval(days => ${daysAgo}))
    returning id
  `);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
    values (${storeId}::uuid, ${String(o.id)}::uuid, ${variant.id}::uuid, ${variant.sku}, 'Kopp', 1, ${total}, ${total}, 0, 0.25, 'txcd_99999999')
  `);
  if (captured) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${total}, 'NOK', 'captured')
    `);
  }
}

describe("the control center (D107)", () => {
  it("shows a new owner's store as not open yet, with nothing sold", async () => {
    const view = await center.controlCenter(account);
    expect(view.stores).toHaveLength(1);
    expect(view.stores[0]).toMatchObject({ slug: `center-${run}`, role: "owner", open: false, toSend: 0, sales: [] });
    expect(view.latest).toEqual([]);
    expect(attentionFor(view.stores).map((i) => i.action)).toContain("Finish setup");
  });

  it("counts the week's paid sales against the week before, orders to send, and stock running out, in code", async () => {
    await order(1, "paid", 1, 20_000);
    await order(2, "fulfilled", 3, 10_000);
    await order(3, "paid", 10, 5_000);
    // Unpaid checkouts are never sales.
    await order(4, "pending_payment", 1, 99_000, false);
    const view = await center.controlCenter(account);
    const store = view.stores[0];
    expect(store.sales).toEqual([{ currency: "NOK", week: 30_000, prior: 5_000, orders: 2, priorOrders: 1 }]);
    expect(totalSales(view.stores)[0].week).toBe(30_000);
    // Two paid orders with something to ship: the recent one and the older one.
    expect(store.toSend).toBe(2);
    expect(store.oldestToSend && Date.now() - Date.parse(store.oldestToSend) > 9 * 86_400_000).toBe(true);
    expect(store.lowStock).toBeGreaterThanOrEqual(1);
    expect(view.latest.map((o) => o.number)).toEqual([`${run}-1`, `${run}-2`, `${run}-3`]);
    const text = attentionFor(view.stores).map((i) => i.text).join("\n");
    expect(text).toContain("2 orders are waiting to be sent");
  });

  it("gives one store's own view, and nothing for a store the account is not in", async () => {
    expect((await center.controlCenter(account, `center-${run}`)).stores).toHaveLength(1);
    expect((await center.controlCenter(account, "no-such-store")).stores).toEqual([]);
    const stranger: Account = { ...account, id: "00000000-0000-4000-8000-000000000000" };
    expect((await center.controlCenter(stranger)).stores).toEqual([]);
  });
});
