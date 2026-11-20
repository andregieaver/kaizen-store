import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));
vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_x", platformSecretKey: () => "sk_test_x" }));

const { deleteCustomers, DELETE_CUSTOMERS_MAX } = await import("./customer-delete");
const staff = await import("./customer-staff");
const deals = await import("./deals");
const { addTag } = await import("./segments");
const { newStore } = await import("./inventory-test-support");

/**
 * Deleting customers (test sign-ups and the like): the customer goes with their own deals, notes and tags; a deal with a company stays
 * without them; a cart and a marketing consent are kept without them; one with an order is kept, and nothing of another store is touched.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const mail = (name: string) => `${name}-${run}@example.com`;
let store: Awaited<ReturnType<typeof newStore>>;
let other: Awaited<ReturnType<typeof newStore>>;

beforeAll(async () => {
  store = await newStore("cdelete");
  other = await newStore("cdelete-other");
});

afterAll(async () => {
  await closeDb();
});

async function customer(s: typeof store, name: string): Promise<string> {
  const made = await staff.createCustomer(s.member, { email: mail(name), name });
  if (!made.ok) throw new Error(JSON.stringify(made.problem));
  return made.id;
}

const count = async (query: ReturnType<typeof sql>) => Number((await db().execute<Row>(query))[0].n);

describe("deleting customers", () => {
  it("takes the customer with their own deals, notes and tags, and keeps what is the store's proof without them", async () => {
    const drill = await customer(store, "drill");
    const [pipeline] = await deals.ensurePipeline(store.storeId, { name: "Sales", stages: [{ name: "New" }] });
    const own = await deals.createDeal(store.member, { title: "Drill sign-up", customerId: drill, pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
    expect(own.ok).toBe(true);
    const [company] = await db().execute<Row>(sql`insert into commerce.customer_companies (store_id, name) values (${store.storeId}::uuid, ${`Firma ${run}`}) returning id`);
    const shared = await deals.createDeal(store.member, { title: "Firm deal", customerId: drill, companyId: String(company.id), pipelineId: pipeline.id, stageId: pipeline.stages[0].id });
    expect(shared.ok).toBe(true);
    await staff.addNote(store.member, `c:${drill}`, { body: "A test sign-up" });
    await addTag(store.storeId, store.accountId, mail("drill"), "test");
    await db().execute(sql`insert into commerce.marketing_subscribers (store_id, email, customer_id, status, source) values (${store.storeId}::uuid, ${mail("drill")}, ${drill}::uuid, 'subscribed', 'admin')`).catch(() => undefined);
    // Someone of the same name in another store is never touched.
    const elsewhere = await customer(other, "drill");

    const result = await deleteCustomers(store.member, [mail("drill").toUpperCase()]);
    expect(result).toMatchObject({ ok: true, deleted: 1, deals: 1, kept: [] });
    expect(await count(sql`select count(*) as n from commerce.customers where id = ${drill}::uuid`)).toBe(0);
    expect(await count(sql`select count(*) as n from commerce.deals where store_id = ${store.storeId}::uuid and id = ${own.ok ? own.id : ""}::uuid`)).toBe(0);
    const [left] = await db().execute<Row>(sql`select customer_id from commerce.deals where store_id = ${store.storeId}::uuid and id = ${shared.ok ? shared.id : ""}::uuid`);
    expect(left).toEqual({ customer_id: null });
    expect(await count(sql`select count(*) as n from commerce.customer_notes where store_id = ${store.storeId}::uuid and email = ${mail("drill")}`)).toBe(0);
    expect(await count(sql`select count(*) as n from commerce.customer_tags where store_id = ${store.storeId}::uuid and email = ${mail("drill")}`)).toBe(0);
    expect(await count(sql`select count(*) as n from commerce.customers where id = ${elsewhere}::uuid`)).toBe(1);
    const [audited] = await db().execute<Row>(sql`select action from commerce.audit_log where store_id = ${store.storeId}::uuid and action = 'customer.deleted' limit 1`);
    expect(audited).toEqual({ action: "customer.deleted" });
  });

  it("keeps a customer with an order, and says so", async () => {
    const buyer = await customer(store, "buyer");
    const plain = await customer(store, "plain");
    await db().execute(sql`
      insert into commerce.orders (store_id, number, market_code, currency, locale, email, customer_id, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor, billing_address, shipping_address)
      values (${store.storeId}::uuid, ${`CD-${run}`}, 'NO', 'NOK', 'nb-NO', ${mail("buyer")}, ${buyer}::uuid, 100, 0, 0, 0, 100, '{}'::jsonb, '{}'::jsonb)
    `);
    const result = await deleteCustomers(store.member, [mail("buyer"), mail("plain"), mail("nobody")]);
    expect(result).toMatchObject({ ok: true, deleted: 1, kept: [{ email: mail("buyer"), why: "records" }] });
    expect(await count(sql`select count(*) as n from commerce.customers where id = ${buyer}::uuid`)).toBe(1);
    expect(await count(sql`select count(*) as n from commerce.customers where id = ${plain}::uuid`)).toBe(0);
  });

  it("refuses without customers:write, with nobody, and past one page", async () => {
    const readOnly = { ...store.member, role: "read_only" as const, permissions: [] };
    expect(await deleteCustomers(readOnly as never, [mail("x")])).toEqual({ ok: false, problem: "forbidden" });
    expect(await deleteCustomers(store.member, ["", "  "])).toEqual({ ok: false, problem: "none" });
    const many = Array.from({ length: DELETE_CUSTOMERS_MAX + 1 }, (_, i) => `p${i}-${run}@example.com`);
    expect(await deleteCustomers(store.member, many)).toEqual({ ok: false, problem: "too_many" });
  });
});
