import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }) }));

const {
  checkPassword,
  createSignInCode,
  deleteCustomer,
  emailHistory,
  getCheckoutAccount,
  hashPassword,
  linkOrderToCustomer,
  listCustomerOrders,
  openCheckoutAccount,
  registerCustomer,
  resetPassword,
  saveCheckoutAccount,
  setPassword,
  signInWithPassword,
  takeCheckoutSignIn,
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

/** A guest order paid with Stripe (a captured payment), or still waiting for payment. */
async function paidOrder(email: string, number: string, status: "paid" | "pending_payment" = "paid"): Promise<string> {
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status,
      subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${storeId}::uuid, ${number}, 'NO', 'NOK', 'nb-NO', ${email}, ${status}, 10000, 0, 2000, 10000,
      '{"name": "Kari Nordmann"}', '{"name": "Kari Nordmann", "line1": "Storgata 1", "postalCode": "0155", "city": "Oslo", "country": "NO"}')
    returning id
  `);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency, status)
    values (${storeId}::uuid, ${String(order.id)}::uuid, 'stripe', ${`cs_${number}`}, 10000, 'NOK',
      ${status === "paid" ? "captured" : "pending"})
  `);
  return String(order.id);
}

const PASSWORD = "blå fjord seiler stille";

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

describe("registering (D32)", () => {
  it("opens an account with a password at once, but only orders placed signed in join it until the email is proven", async () => {
    const email = `new.${run}@example.com`;
    const outcome = await registerCustomer(storeId, { email: email.toUpperCase(), name: " Ny Kunde ", password: PASSWORD });
    expect(outcome).toMatchObject({ ok: true });
    const customerId = outcome.ok ? outcome.customerId : "";
    expect(await signInWithPassword(storeId, email, PASSWORD)).toEqual({ ok: true, customerId });
    const [row] = await db().execute<Row>(sql`select name, email, email_verified_at from commerce.customers where id = ${customerId}::uuid`);
    expect(row).toMatchObject({ name: "Ny Kunde", email, email_verified_at: null });

    // Someone who registered another person's email sees none of their later guest orders.
    const guest = await paidOrder(email, `R1-${run}`);
    await linkOrderToCustomer(storeId, guest);
    expect(await listCustomerOrders(storeId, customerId)).toEqual([]);

    // A code proves the email: then they join.
    const code = await createSignInCode(storeId, email);
    expect(await verifySignInCode(storeId, email, code!)).toBe(customerId);
    expect((await listCustomerOrders(storeId, customerId)).map((o) => o.id)).toEqual([guest]);
  });

  it("sends an email with an account or paid orders to choose a new password instead", async () => {
    const shopper = `guest.${run}@example.com`;
    expect(await emailHistory(storeId, shopper)).toBeNull();
    await paidOrder(shopper, `R2-${run}`, "pending_payment");
    // An order never paid is no purchase.
    expect(await emailHistory(storeId, shopper)).toBeNull();
    await paidOrder(shopper, `R3-${run}`);
    expect(await registerCustomer(storeId, { email: shopper, name: "", password: PASSWORD })).toEqual({ ok: false, known: "purchases" });

    const member = `new.${run}@example.com`;
    expect(await registerCustomer(storeId, { email: member, name: "", password: PASSWORD })).toEqual({ ok: false, known: "account" });
  });

  it("replaces the password with an emailed code, which opens the account with every paid order and ends other sessions", async () => {
    const shopper = `guest.${run}@example.com`;
    const code = await createSignInCode(storeId, shopper);
    expect(await resetPassword(storeId, shopper, code === "000000" ? "111111" : "000000", PASSWORD)).toBeNull();
    const customerId = await resetPassword(storeId, shopper, code!, PASSWORD);
    expect(customerId).not.toBeNull();
    expect(await signInWithPassword(storeId, shopper, PASSWORD)).toEqual({ ok: true, customerId });
    // The paid order shows; the one never paid does not.
    expect((await listCustomerOrders(storeId, customerId!)).map((o) => o.status)).toEqual(["paid"]);
    const [sessions] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.customer_sessions where customer_id = ${customerId}::uuid
    `);
    expect(sessions.n).toBe(0);
  });
});

describe("an account asked for at checkout (D32)", () => {
  it("opens once the order is paid, with the order, name and address, and signs in once from the order page", async () => {
    const email = `checkout.${run}@example.com`;
    const orderId = await paidOrder(email, `K1-${run}`, "pending_payment");
    await saveCheckoutAccount(storeId, orderId, PASSWORD);
    // Not before payment.
    expect(await openCheckoutAccount(storeId, orderId)).toBeNull();

    await db().execute(sql`update commerce.orders set status = 'paid' where id = ${orderId}::uuid`);
    await db().execute(sql`update commerce.payments set status = 'captured' where order_id = ${orderId}::uuid`);
    expect(await openCheckoutAccount(storeId, orderId)).toBe("created");
    // Once, however often the payment is seen.
    expect(await openCheckoutAccount(storeId, orderId)).toBeNull();

    const [customer] = await db().execute<Row>(sql`
      select id, name, address->>'line1' as line1 from commerce.customers where store_id = ${storeId}::uuid and email = ${email}
    `);
    expect(customer).toMatchObject({ name: "Kari Nordmann", line1: "Storgata 1" });
    expect(await signInWithPassword(storeId, email, PASSWORD)).toEqual({ ok: true, customerId: String(customer.id) });
    expect((await listCustomerOrders(storeId, String(customer.id))).map((o) => o.id)).toEqual([orderId]);
    const [request] = await db().execute<Row>(sql`select password_hash from commerce.checkout_accounts where order_id = ${orderId}::uuid`);
    expect(request.password_hash).toBeNull();

    expect(await getCheckoutAccount(storeId, orderId)).toEqual({ outcome: "created", email, canSignIn: true });
    expect(await takeCheckoutSignIn(storeId, orderId)).toBe(String(customer.id));
    expect(await takeCheckoutSignIn(storeId, orderId)).toBeNull();
    expect((await getCheckoutAccount(storeId, orderId))?.canSignIn).toBe(false);
  });

  it("opens none for an email with earlier purchases, which is asked to choose a new password", async () => {
    const email = `repeat.${run}@example.com`;
    await paidOrder(email, `K2-${run}`);
    const orderId = await paidOrder(email, `K3-${run}`);
    await saveCheckoutAccount(storeId, orderId, PASSWORD);
    expect(await openCheckoutAccount(storeId, orderId)).toBe("known");
    expect(await getCheckoutAccount(storeId, orderId)).toEqual({ outcome: "known", email, canSignIn: false });
    expect(await takeCheckoutSignIn(storeId, orderId)).toBeNull();
    const [customers] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.customers where store_id = ${storeId}::uuid and email = ${email}
    `);
    expect(customers.n).toBe(0);
  });

  it("is forgotten when the shopper unticks it before paying", async () => {
    const orderId = await paidOrder(`untick.${run}@example.com`, `K4-${run}`, "pending_payment");
    await saveCheckoutAccount(storeId, orderId, PASSWORD);
    await saveCheckoutAccount(storeId, orderId, null);
    expect(await getCheckoutAccount(storeId, orderId)).toBeNull();
  });
});
