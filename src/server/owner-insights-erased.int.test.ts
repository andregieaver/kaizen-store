import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Membership } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));

const ownerTools = await import("./owner-tools");
const stores = await import("./stores");

type Row = Record<string, unknown>;
// Tool answers are loose JSON, read field by field here.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Answer = Record<string, any>;

/**
 * The AI manager's `customer_insights` after an erasure (wave 1g, D162): a person who was erased is no customer in the answer (not counted,
 * not named, not joined to anyone else's orders), but the sale is a sale and stays in the period's average, as in the analytics pages.
 */

const run = Date.now().toString(36);
let member: Membership;
let storeId: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`ins-erased-${run}@example.com`}, 'Kari', 'Kaffe') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`ins-erased-${run}`}, 'Kaffe', null) as id`);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id, email from commerce.accounts where email = ${`ins-erased-${run}@example.com`}`);
  member = { account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false }, store: (await stores.getStore(`ins-erased-${run}`))!, role: "owner" };
  const [v] = await db().execute<Row>(sql`select id, sku from commerce.product_variants where store_id = ${storeId}::uuid limit 1`);
  let n = 0;
  const order = async (email: string, name: string, daysAgo: number, total: number) => {
    n += 1;
    const [o] = await db().execute<Row>(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, tax_minor, total_minor,
        billing_address, shipping_address, placed_at)
      values (${storeId}::uuid, ${`${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', ${total}, 0, 0, ${total},
        ${JSON.stringify({ name })}, ${JSON.stringify({ name, line1: "Gata 1", postalCode: "0150", city: "Oslo", country: "NO" })}, now() - make_interval(days => ${daysAgo}))
      returning id
    `);
    await db().execute(sql`
      insert into commerce.order_lines (store_id, order_id, variant_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
      values (${storeId}::uuid, ${String(o.id)}::uuid, ${String(v.id)}::uuid, ${String(v.sku)}, 'Kopp', 1, ${total}, ${total}, 0, 0.25, 'txcd_99999999')
    `);
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
      values (${storeId}::uuid, ${String(o.id)}::uuid, 'stripe', ${`cs_${run}_${n}`}, ${total}, 'NOK', 'captured')
    `);
    return String(o.id);
  };
  ids.ane1 = await order("ane@example.com", "Ane", 5, 10_000);
  ids.ane2 = await order("ane@example.com", "Ane", 20, 20_000);
  ids.cy = await order("cy@example.com", "Cy", 10, 30_000);
}, 60_000);
afterAll(async () => {
  await closeDb();
});

const insights = () => ownerTools.runOwnerTool({ account: member.account, store: member.store, invalidate: () => {} }, "customer_insights", { days: 90 }) as Promise<Answer>;

describe("customer_insights after an erasure (D162)", () => {
  it("counts Ane twice, Cy once, and the average of the three sales", async () => {
    const out = await insights();
    expect(out.customers_ever).toBe(2);
    expect(out.came_back).toMatchObject({ customers: 1 });
    expect(out.average_order_in_period).toEqual([{ currency: "NOK", orders: 3, average: expect.stringMatching(/^200[,.]00/) }]);
  });

  it("drops a restricted order from the customers and keeps it in the average, naming nobody", async () => {
    const [row] = await db().execute<Row>(sql`select commerce.anonymise_order(${storeId}::uuid, ${ids.ane2}::uuid, 'erasure') as r`);
    expect(row.r).toBe("restricted");
    const out = await insights();
    // Ane has one order left as a customer, so nobody came back; the restricted sale is no customer here.
    expect(out.customers_ever).toBe(2);
    expect(out.came_back).toMatchObject({ customers: 0 });
    expect(out.average_order_in_period).toEqual([{ currency: "NOK", orders: 3, average: expect.stringMatching(/^200[,.]00/) }]);
    expect(out.best_customers.map((c: { orders: number }) => c.orders)).toEqual([1, 1]);
  });
});
