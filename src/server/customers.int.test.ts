import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const {
  checkPassword,
  createSignInCode,
  deleteCustomer,
  hashPassword,
  linkOrderToCustomer,
  listCustomerOrders,
  setPassword,
  signInWithPassword,
  verifySignInCode,
} = await import("./customers");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let storeId: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`accounts-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`accounts-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
});

afterAll(async () => {
  await closeDb();
});

/** A paid guest order with this email. */
async function guestOrder(email: string, number: string): Promise<string> {
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status,
      subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, 'paid', 10000, 0, 2000, 10000, '{}', '{}')
    returning id
  `);
  return String(order.id);
}

describe("passwords", () => {
  it("hashes with scrypt and a fresh salt, and checks only the right password", async () => {
    const a = await hashPassword("korrekt hest batteri stift");
    const b = await hashPassword("korrekt hest batteri stift");
    expect(a).toMatch(/^scrypt\$16384\$8\$1\$/);
    expect(a).not.toBe(b);
    expect(await checkPassword("korrekt hest batteri stift", a)).toBe(true);
    expect(await checkPassword("korrekt hest batteri stikk", a)).toBe(false);
    expect(await checkPassword("x", "garbage")).toBe(false);
  });
});

describe("signing in with a code", () => {
  const email = `Kari.${run}@Example.com`;

  it("claims the guest orders with the same email once the code proves the address", async () => {
    const orderId = await guestOrder(email.toLowerCase(), `A-${run}`);
    const code = await createSignInCode(storeId, email);
    expect(code).toMatch(/^\d{6}$/);

    expect(await verifySignInCode(storeId, email, code === "000000" ? "111111" : "000000")).toBeNull();
    const customerId = await verifySignInCode(storeId, email, code!);
    expect(customerId).not.toBeNull();
    // A code works once.
    expect(await verifySignInCode(storeId, email, code!)).toBeNull();

    const orders = await listCustomerOrders(storeId, customerId!);
    expect(orders.map((o) => o.id)).toEqual([orderId]);

    // Later orders with the address join the account when paid.
    const later = await guestOrder(email.toUpperCase(), `B-${run}`);
    await linkOrderToCustomer(storeId, later);
    expect((await listCustomerOrders(storeId, customerId!)).map((o) => o.id)).toContain(later);
  });

  it("stops a code after five wrong tries, and limits new codes to five an hour", async () => {
    const other = `ola.${run}@example.com`;
    const code = await createSignInCode(storeId, other);
    const wrong = code === "123456" ? "654321" : "123456";
    for (let i = 0; i < 5; i++) expect(await verifySignInCode(storeId, other, wrong)).toBeNull();
    expect(await verifySignInCode(storeId, other, code!)).toBeNull();

    for (let i = 0; i < 4; i++) expect(await createSignInCode(storeId, other)).not.toBeNull();
    expect(await createSignInCode(storeId, other)).toBeNull();
  });
});

describe("signing in with a password", () => {
  it("works once chosen, and locks after ten wrong tries", async () => {
    const email = `pw.${run}@example.com`;
    const code = await createSignInCode(storeId, email);
    const customerId = (await verifySignInCode(storeId, email, code!))!;
    expect(await signInWithPassword(storeId, email, "whatever it is")).toEqual({ ok: false, locked: false });

    await setPassword(storeId, customerId, "blå fjord seiler stille");
    expect(await signInWithPassword(storeId, email.toUpperCase(), "blå fjord seiler stille")).toEqual({ ok: true, customerId });
    for (let i = 0; i < 10; i++) await signInWithPassword(storeId, email, "wrong password here");
    expect(await signInWithPassword(storeId, email, "blå fjord seiler stille")).toEqual({ ok: false, locked: true });
  });
});

describe("deleting an account", () => {
  it("removes the customer but keeps their orders for the books", async () => {
    const email = `delete.${run}@example.com`;
    const orderId = await guestOrder(email, `C-${run}`);
    const code = await createSignInCode(storeId, email);
    const customerId = (await verifySignInCode(storeId, email, code!))!;
    await deleteCustomer(storeId, customerId);
    const [order] = await db().execute<Row>(sql`select customer_id from commerce.orders where id = ${orderId}::uuid`);
    expect(order.customer_id).toBeNull();
    const customers = await db().execute(sql`select 1 from commerce.customers where id = ${customerId}::uuid`);
    expect(customers).toHaveLength(0);
  });
});
