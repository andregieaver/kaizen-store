import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("./document-html", () => ({ documentHtml: () => "<html></html>" }));
const jar = vi.hoisted(() => ({ cookies: new Map<string, string>() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies.has(name) ? { name, value: jar.cookies.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.cookies.set(name, value),
    delete: (name: string) => void jar.cookies.delete(name),
  }),
}));

const fx = await import("./invoice-test-fixture");
const customers = await import("./customers");
const shopper = await import("./privacy-shopper");
const { eraseSubject } = await import("./privacy-erasure");
const { applySession } = await import("./stripe-webhooks");

let store: Awaited<ReturnType<typeof fx.makeStore>>;
beforeAll(async () => {
  store = await fx.makeStore("secrev");
}, 60_000);
afterAll(async () => {
  await closeDb();
});

describe("security review: a shopper's export holds only the shopper's own data", () => {
  it("does not hand over the mail the store sent to an address the shopper merely typed on an order", async () => {
    const victim = `${fx.unique("victim")}@example.com`;
    const attacker = `${fx.unique("attacker")}@example.com`;
    // Mail the store sent to the victim, about the victim.
    await db().execute(sql`
      insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status)
      values (${store.storeId}::uuid, 'order.confirmation', ${victim}, 'Your order', '', 'VICTIM-SECRET-BODY Kirkeveien 5, Oslo', 'sent')
    `);
    // The attacker's own account, and an order they paid for under their own account with the victim's address typed at checkout.
    const [c] = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.customers (store_id, email, email_verified_at, name) values (${store.storeId}::uuid, ${attacker}, now(), 'Attacker') returning id`);
    const customerId = String(c.id);
    await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email: victim, customerId });
    jar.cookies.clear();
    await customers.startSession(store.storeId, customerId);
    const result = await shopper.shopperExport(store.storeId);
    expect(result.ok).toBe(true);
    if (!result.ok || !("file" in result)) throw new Error("no file");
    expect(JSON.stringify(result.file)).not.toContain("VICTIM-SECRET-BODY");
  }, 120_000);
});

describe("security review: an account that registered with an address nobody has proved", () => {
  it("is shown and erases only what is linked to the account, never the mail, forms, codes or checkouts kept under the typed address", async () => {
    const victim = `${fx.unique("stranger")}@example.com`;
    const sid = store.storeId;
    await db().execute(sql`
      insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status)
      values (${sid}::uuid, 'cart.reminder', ${victim}, 'You left something', '', 'STRANGER-CART-BODY two blue mugs', 'sent')
    `);
    await db().execute(sql`
      insert into commerce.form_submissions (store_id, block_id, kind, visitor, status, email, path, locale)
      values (${sid}::uuid, 'b1', 'subscription', 'v', 'sent', ${victim}, '/', 'en')
    `);
    await db().execute(sql`
      insert into commerce.customer_codes (store_id, email, code_hash, expires_at) values (${sid}::uuid, ${victim}, 'h', now() + interval '10 minutes')
    `);
    await db().execute(sql`insert into commerce.email_opt_outs (store_id, email, source) values (${sid}::uuid, ${victim}, 'link')`);
    // Anybody can open an account with any address: nothing proves it is theirs (no email_verified_at).
    const [c] = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.customers (store_id, email, name) values (${sid}::uuid, ${victim}, 'Registered Stranger') returning id`);
    const customerId = String(c.id);
    const { resolveSubject } = await import("./privacy-subject");
    const subject = await resolveSubject(sid, { customerId }, { channel: "shopper" });
    expect(subject).toMatchObject({ customerId, emailProven: false, addresses: [] });

    jar.cookies.clear();
    await customers.startSession(sid, customerId);
    const result = await shopper.shopperExport(sid);
    expect(result.ok).toBe(true);
    if (!result.ok || !("file" in result)) throw new Error("no file");
    expect(JSON.stringify(result.file)).not.toContain("STRANGER-CART-BODY");
    expect(result.file.sections.emails ?? []).toEqual([]);

    jar.cookies.clear();
    await customers.startSession(sid, customerId);
    const erased = await shopper.shopperErase(sid);
    expect(erased.ok).toBe(true);
    const count = async (q: ReturnType<typeof sql>) => Number((await db().execute<Record<string, unknown>>(sql`select count(*)::int as n from (${q}) t`))[0].n);
    // The stranger's records are as they were.
    expect(await count(sql`select 1 from commerce.email_messages where store_id = ${sid}::uuid and to_address = ${victim} and text like 'STRANGER-CART-BODY%'`)).toBe(1);
    expect(await count(sql`select 1 from commerce.form_submissions where store_id = ${sid}::uuid and email = ${victim}`)).toBe(1);
    expect(await count(sql`select 1 from commerce.customer_codes where store_id = ${sid}::uuid and email = ${victim}`)).toBe(1);
    expect(await count(sql`select 1 from commerce.email_opt_outs where store_id = ${sid}::uuid and email = ${victim}`)).toBe(1);
    // The account itself is gone.
    expect(await count(sql`select 1 from commerce.customers where id = ${customerId}::uuid`)).toBe(0);
  }, 120_000);

  it("still gives a proven address its own mail (the account the person proved is theirs)", async () => {
    const mine = `${fx.unique("proven")}@example.com`;
    await db().execute(sql`
      insert into commerce.email_messages (store_id, kind, to_address, subject, html, text, status)
      values (${store.storeId}::uuid, 'cart.reminder', ${mine}, 'You left something', '', 'MY-OWN-CART-BODY', 'sent')
    `);
    const [c] = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.customers (store_id, email, email_verified_at, name) values (${store.storeId}::uuid, ${mine}, now(), 'Proven') returning id`);
    jar.cookies.clear();
    await customers.startSession(store.storeId, String(c.id));
    const result = await shopper.shopperExport(store.storeId);
    expect(result.ok).toBe(true);
    if (!result.ok || !("file" in result)) throw new Error("no file");
    expect(JSON.stringify(result.file)).toContain("MY-OWN-CART-BODY");
  }, 120_000);
});

describe("security review: free text staff typed about an order is in the person's file", () => {
  it("exports a refund's reason and an event's reason and note", async () => {
    const email = `${fx.unique("typed")}@example.com`;
    const [c] = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.customers (store_id, email, email_verified_at, name) values (${store.storeId}::uuid, ${email}, now(), 'Typed') returning id`);
    const customerId = String(c.id);
    const placed = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email, customerId });
    await db().execute(sql`
      insert into commerce.refunds (store_id, payment_id, amount_minor, reason, provider_reference, status)
      select p.store_id, p.id, 100, 'REFUND-REASON-TEXT Kari phoned', 're_typed_1', 'pending' from commerce.payments p where p.order_id = ${placed.orderId}::uuid limit 1
    `);
    await db().execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${store.storeId}::uuid, ${placed.orderId}::uuid, 'note.added', '{"note":"NOTE-TEXT about Kari","by":"x"}', 'staff')
    `);
    jar.cookies.clear();
    await customers.startSession(store.storeId, customerId);
    const result = await shopper.shopperExport(store.storeId);
    expect(result.ok).toBe(true);
    if (!result.ok || !("file" in result)) throw new Error("no file");
    const text = JSON.stringify(result.file.sections.orders);
    expect(text).toContain("REFUND-REASON-TEXT Kari phoned");
    expect(text).toContain("NOTE-TEXT about Kari");
  }, 120_000);
});

describe("security review: the shopper's download is limited per account and hour", () => {
  it("refuses the sixth file of the hour and makes nothing for it", async () => {
    const email = `${fx.unique("hammer")}@example.com`;
    const [c] = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.customers (store_id, email, email_verified_at, name) values (${store.storeId}::uuid, ${email}, now(), 'Hammer') returning id`);
    const customerId = String(c.id);
    jar.cookies.clear();
    await customers.startSession(store.storeId, customerId);
    const logged = async () => Number((await db().execute<Record<string, unknown>>(sql`select count(*)::int as n from commerce.privacy_requests where store_id = ${store.storeId}::uuid and subject_customer_id = ${customerId}::uuid`))[0].n);
    for (let i = 0; i < shopper.EXPORTS_PER_HOUR; i++) expect((await shopper.shopperExport(store.storeId)).ok).toBe(true);
    const before = await logged();
    expect(await shopper.shopperExport(store.storeId)).toEqual({ ok: false, problem: "busy" });
    expect(await logged()).toBe(before);
  }, 120_000);
});

describe("security review: erasing a person with a checkout still open", () => {
  it("does not break the payment that arrives after the erasure", async () => {
    const email = `${fx.unique("mid")}@example.com`;
    const [c] = await db().execute<Record<string, unknown>>(sql`
      insert into commerce.customers (store_id, email, email_verified_at, name) values (${store.storeId}::uuid, ${email}, now(), 'Mid Checkout') returning id`);
    const customerId = String(c.id);
    // Checkout is open: a pending order of the account whose Stripe session the shopper has not paid yet.
    const placed = await fx.paidOrder(store, [["DEMO-MUG-WHITE", 1]], { email, customerId, pay: false });
    const erased = await eraseSubject(store.storeId, { customerId }, { channel: "shopper", accountId: null });
    expect(erased.ok).toBe(true);
    // The shopper now pays in the other tab: Stripe's event reaches the webhook.
    await expect(
      applySession(store.storeId, {
        id: placed.sessionId,
        object: "checkout.session",
        mode: "payment",
        status: "complete",
        payment_status: "paid",
        customer_details: { email, name: "Mid Checkout", address: { line1: "Storgata 1", postal_code: "0155", city: "Oslo", country: "NO" } },
      } as never),
    ).resolves.toBeUndefined();
    const [o] = await db().execute<Record<string, unknown>>(sql`select status from commerce.orders where id = ${placed.orderId}::uuid`);
    expect(o.status).toBe("paid");
  }, 120_000);
});
