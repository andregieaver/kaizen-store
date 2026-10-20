import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { addDays } from "@/lib/payment-terms";
import { toMarket } from "@/lib/markets";

import type { Membership } from "./auth";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * Payment terms for company accounts (wave 4 unit F, D293): an employee of a company with terms buys goods without paying, the order is paid as a shop status
 * with its invoice issued (a `due` line, the store being live), and nothing is a sale until the balance arrives: by Stripe's page from the order page, or
 * recorded by staff as paid outside. Before that it is cancelled whole with a void (its credit note, no money); the reminder and the overdue notice go once
 * each; the credit limit counts what the company owes; a company that owes cannot be deleted.
 */

vi.mock("server-only", () => ({}));
vi.mock("./refresh", () => ({ refreshTag: () => {}, refreshTagNow: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

/** Kaizena Flow's platform Stripe client, faked: hosted sessions, recorded. */
const fake = vi.hoisted(() => {
  const sessions = new Map<string, Record<string, unknown>>();
  const created: { params: Record<string, unknown>; options: Record<string, unknown> }[] = [];
  let next = 0;
  const client = {
    refunds: { create: async () => ({ id: `re_terms_${++next}`, status: "succeeded" }) },
    coupons: { create: async () => ({ id: `coupon_terms_${++next}` }) },
    checkout: {
      sessions: {
        create: async (params: Record<string, unknown>, options: Record<string, unknown>) => {
          const id = `cs_terms_${++next}`;
          sessions.set(id, { status: "open", payment_status: "unpaid", mode: params.mode });
          created.push({ params, options });
          return { id, url: `https://checkout.stripe.test/${id}`, client_secret: null, payment_method_types: ["card"] };
        },
        retrieve: async (id: string) => ({ id, ...sessions.get(id) }),
        expire: async (id: string) => {
          sessions.set(id, { ...sessions.get(id), status: "expired" });
          return { id };
        },
      },
    },
    charges: { retrieve: async () => ({}) },
    paymentIntents: { retrieve: async () => ({ latest_charge: null }) },
  };
  return { client, created, sessions };
});

vi.mock("./connect", async (importOriginal) => ({ ...(await importOriginal<typeof import("./connect")>()), getCheckoutUi: async () => "hosted" }));
vi.mock("./stripe", () => ({ platformStripe: () => fake.client, platformPublishableKey: () => "pk_live_terms", platformModes: () => ["test", "live"] }));

const { changeLine } = await import("./cart");
const { cartSummary } = await import("./cart-summary");
const { getCart } = await import("./cart");
const { startCheckout } = await import("./checkout");
const { getOrder, getShopperOrder } = await import("./orders");
const { preRegisterCustomer, startSession } = await import("./customers");
const { cancelOrder } = await import("./order-admin");
const { deleteCompany } = await import("./companies");
const terms = await import("./payment-terms");

const run = Date.now().toString(36);
const slug = `terms-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const origin = "http://localhost:3000";
let storeId: string;
let companyId: string;
let ownerId: string;
let member: Membership;
const variant: Record<string, string> = {};
const shop = () => ({ storeId, market: no });
const cartId = () => jar.get(`cart_${storeId}_${no.slug}`)!;
const payer = { name: "Kari Nordmann", email: `kari-${run}@example.com`, line1: "Storgata 1", postalCode: "0155", city: "Oslo" };

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  storeId = String(store.id);
  // A live store selling to businesses (D178), so its orders on terms get real invoice numbers (a test-mode order gets none, D159).
  await db().execute(sql`update commerce.stores set features = features || array['business'], audience = 'both' where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'live', ${`acct_terms${run}`}, 'active', false)
  `);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'live' where store_id = ${storeId}::uuid`);
  await db().execute(sql`update commerce.stores set legal_name = 'Terms AS', organisation_number = '923456780', postal_address = 'Storgata 1, 0155 Oslo', country = 'NO' where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.store_tax_profile (store_id, vat_registered, vat_number) values (${storeId}::uuid, true, 'NO923456780MVA')
    on conflict (store_id) do update set vat_registered = true, vat_number = 'NO923456780MVA'
  `);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position) values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
    on conflict do nothing
  `);
  await db().execute(sql`update commerce.inventory_levels set on_hand = on_hand + 500 where store_id = ${storeId}::uuid`);
  const rows = await db().execute<Row>(sql`select v.id, v.sku from commerce.product_variants v where v.store_id = ${storeId}::uuid`);
  for (const r of rows) variant[String(r.sku)] = String(r.id);
  const [company] = await db().execute<Row>(sql`
    insert into commerce.customer_companies (store_id, name, organisation_number, payment_terms) values (${storeId}::uuid, 'Fjord AS', '987654321', 'net_30') returning id
  `);
  companyId = String(company.id);
  const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid and role = 'owner' limit 1`);
  ownerId = String(owner.account_id);
  member = {
    account: { id: ownerId, email: `${slug}@example.com`, name: "Owner", platformAdmin: false },
    role: "owner",
    store: { id: storeId, slug, markets: [no], keptMarkets: [no], allMarkets: [no] } as unknown as Store,
  };
});

afterAll(async () => {
  await closeDb();
});

beforeEach(() => jar.clear());

/** A signed-in employee of the company (or of none), with a mug or two in the cart. */
async function buyer({ role = "employee", mugs = 2 }: { role?: "employee" | "owner" | null; mugs?: number } = {}): Promise<string> {
  const customerId = await preRegisterCustomer(storeId, `buyer-${Math.random().toString(36).slice(2)}-${run}@example.com`);
  if (role) await db().execute(sql`update commerce.customers set company_id = ${companyId}::uuid, company_role = ${role} where id = ${customerId}::uuid`);
  await startSession(storeId, customerId);
  const added = await changeLine(shop(), variant["DEMO-MUG-WHITE"], mugs, "add");
  expect(added).toMatchObject({ outcome: "added" });
  return customerId;
}

/** Places the cart on terms: the order page's address (with the terms key), and the order. */
async function placeOnTerms(customerId: string) {
  const started = await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId, onTerms: true, payer });
  expect(started.ok).toBe(true);
  const url = new URL((started as { url: string }).url);
  const orderId = url.pathname.split("/").at(-1)!;
  return { url, orderId, key: url.searchParams.get("session_id")!, order: (await getOrder(storeId, orderId))! };
}

const sale = async (orderId: string) => {
  const [row] = await db().execute<Row>(sql`select exists (select 1 from commerce.payments where order_id = ${orderId}::uuid and status = 'captured') as paid`);
  return Boolean(row.paid);
};

describe("buying on payment terms", () => {
  it("confirms an employee's order at once with nothing paid: paid as a shop status, the whole total owed, due in 30 days, the invoice issued with its due line", async () => {
    const customerId = await buyer();
    const summary = await cartSummary(shop(), await getCart(shop()));
    const { url, orderId, key, order } = await placeOnTerms(customerId);
    expect(url.pathname).toBe(`/s/${slug}/no/order/${orderId}`);
    expect(key).toMatch(/^terms_/);
    // What the cart showed is what the order owes; nothing went to Stripe.
    expect({ total: order.totalMinor, vat: order.taxMinor, balance: order.balanceMinor, status: order.status }).toEqual({ total: summary.total, vat: summary.vat, balance: summary.total, status: "paid" });
    const [today] = await db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, now())::text as d`);
    expect(order.paymentTerms).toEqual({ terms: "net_30", dueOn: addDays(String(today.d), 30), paidAt: null, state: "due" });
    expect(order.company).toEqual({ name: "Fjord AS", number: "987654321" });
    expect(order.billingAddress).toMatchObject({ name: "Kari Nordmann", line1: "Storgata 1", postalCode: "0155", city: "Oslo" });
    expect(await sale(orderId)).toBe(false);
    expect(fake.created).toHaveLength(0);
    // The order page opens by the terms key; the invoice says what is due and when.
    expect((await getShopperOrder(storeId, orderId, key))?.id).toBe(orderId);
    const [invoice] = await db().execute<Row>(sql`select document_number, snapshot from commerce.invoices where order_id = ${orderId}::uuid and kind = 'order'`);
    expect(invoice.document_number).toBeTruthy();
    expect((invoice.snapshot as { payments: unknown[] }).payments).toEqual([
      { kind: "due", amountMinor: summary.total, provider: "terms", dueOn: addDays(String(today.d), 30), terms: "net_30" },
    ]);
  });

  it("refuses a customer who is not in a company, a company without terms and a company switched off, before anything is placed", async () => {
    const outsider = await buyer({ role: null });
    expect(await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId: outsider, onTerms: true, payer })).toEqual({ ok: false, problem: "terms" });
    jar.clear();
    await db().execute(sql`update commerce.customer_companies set active = false where id = ${companyId}::uuid`);
    const employee = await buyer();
    expect(await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId: employee, onTerms: true, payer })).toEqual({ ok: false, problem: "terms" });
    await db().execute(sql`update commerce.customer_companies set active = true where id = ${companyId}::uuid`);
    // A signed-out shopper, and one who gives no billing address.
    expect(await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId: null, onTerms: true, payer })).toEqual({ ok: false, problem: "terms" });
    expect(await startCheckout({ ...shop(), storeSlug: slug }, cartId(), origin, "Frakt", {}, { customerId: employee, onTerms: true, payer: { name: "Kari", email: payer.email } })).toEqual({ ok: false, problem: "payer" });
    const [placed] = await db().execute<Row>(sql`select count(*)::int as n from commerce.orders where cart_id = ${cartId()}::uuid`);
    expect(Number(placed.n)).toBe(0);
  });

  it("keeps the company within its credit limit, counting what it already owes, converted to the limit's currency", async () => {
    const first = await placeOnTerms(await buyer({ mugs: 1 }));
    const owed = first.order.totalMinor;
    // Room for exactly what is owed plus one mug more: a second mug passes, a third does not.
    jar.clear();
    const probe = await buyer({ mugs: 1 });
    const mug = (await cartSummary(shop(), await getCart(shop()))).total;
    const [already] = await db().execute<Row>(sql`
      select coalesce(sum(o.balance_minor), 0)::bigint as owed from commerce.order_payment_terms t join commerce.orders o on o.id = t.order_id
      where t.company_id = ${companyId}::uuid and t.paid_at is null and o.status in ('paid', 'fulfilled')
    `);
    expect(Number(already.owed)).toBeGreaterThanOrEqual(owed);
    await db().execute(sql`update commerce.customer_companies set credit_limit_minor = ${Number(already.owed) + mug}, credit_currency = 'NOK' where id = ${companyId}::uuid`);
    const offer = await terms.termsForBasket(storeId, probe, { goodsOnly: true, totalMinor: mug, currency: "NOK" });
    expect(offer).toMatchObject({ ok: true, roomMinor: 0, companyName: "Fjord AS" });
    expect(await terms.termsForBasket(storeId, probe, { goodsOnly: true, totalMinor: mug + 1, currency: "NOK" })).toMatchObject({ ok: false, reason: "limit" });
    // The same limit kept in euro: the NOK owed is converted at the store's rate (11.5).
    await db().execute(sql`update commerce.customer_companies set credit_limit_minor = ${Math.round((Number(already.owed) + mug) / 11.5) - 1}, credit_currency = 'EUR' where id = ${companyId}::uuid`);
    expect(await terms.termsForBasket(storeId, probe, { goodsOnly: true, totalMinor: mug, currency: "NOK" })).toMatchObject({ ok: false, reason: "limit" });
    // A limit in a currency the store has no rate for refuses, never guesses.
    await db().execute(sql`update commerce.customer_companies set credit_limit_minor = 99999999, credit_currency = 'SEK' where id = ${companyId}::uuid`);
    expect(await terms.termsForBasket(storeId, probe, { goodsOnly: true, totalMinor: mug, currency: "NOK" })).toMatchObject({ ok: false, reason: "no_rate" });
    await db().execute(sql`update commerce.customer_companies set credit_limit_minor = null, credit_currency = null where id = ${companyId}::uuid`);
  });
});

describe("paying, cancelling and reminding", () => {
  it("is paid from the order page on Stripe's hosted page for the balance alone, and becomes a sale only then", async () => {
    const { orderId, key, order } = await placeOnTerms(await buyer());
    const store = { id: storeId, slug } as unknown as Store;
    const started = await terms.startTermsPayment({ store, market: no }, orderId, origin);
    expect(started).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/checkout\.stripe\.test\//) });
    const { params } = fake.created.at(-1)!;
    // One line, the balance, no shipping asked, no Stripe invoice, back to the order page by its own key.
    expect(params.line_items).toEqual([{ quantity: 1, price_data: { currency: "nok", unit_amount: order.balanceMinor, product_data: { name: `Faktura for ordre ${order.number}` } } }]);
    expect(params).not.toHaveProperty("shipping_address_collection");
    expect(params).not.toHaveProperty("invoice_creation");
    expect((params.metadata as Record<string, string>).terms_balance).toBe("1");
    expect(params.cancel_url).toBe(`${origin}/s/${slug}/no/order/${orderId}?session_id=${encodeURIComponent(key)}`);
    // The shopper pays and comes back before the webhook: the order page asks Stripe and settles the terms.
    const sessionId = [...fake.sessions.keys()].at(-1)!;
    fake.sessions.set(sessionId, { status: "complete", payment_status: "paid", mode: "payment", payment_intent: `pi_${sessionId}` });
    const back = await getShopperOrder(storeId, orderId, sessionId);
    expect(back?.balanceMinor).toBe(0);
    expect(back?.paymentTerms).toMatchObject({ state: "paid", paidAt: expect.any(String) });
    expect(back?.status).toBe("paid");
    expect(await sale(orderId)).toBe(true);
    // The invoice was issued once; Pay now on a paid order opens nothing.
    const [invoices] = await db().execute<Row>(sql`select count(*)::int as n from commerce.invoices where order_id = ${orderId}::uuid`);
    expect(Number(invoices.n)).toBe(1);
    expect(await terms.startTermsPayment({ store, market: no }, orderId, origin)).toEqual({ ok: false, problem: "paid" });
    const events = await db().execute<Row>(sql`select type, data from commerce.order_events where order_id = ${orderId}::uuid and type like 'order.terms_%' order by id`);
    expect(events.map((e) => e.type)).toEqual(["order.terms_placed", "order.terms_paid"]);
  });

  it("is recorded as paid outside Kaizena Flow by the owner, with the method and day, and only once", async () => {
    const { orderId, order } = await placeOnTerms(await buyer());
    const [day] = await db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, now())::text as d`);
    expect(await terms.recordTermsPaidOutside(storeId, orderId, { method: "bank_transfer", receivedOn: String(day.d), reference: "KID 123" }, ownerId)).toEqual({ ok: true });
    const [payment] = await db().execute<Row>(sql`select amount_minor, method, received_on::text as received_on from commerce.payments where order_id = ${orderId}::uuid and provider = 'manual'`);
    expect({ amount: Number(payment.amount_minor), method: payment.method, on: payment.received_on }).toEqual({ amount: order.balanceMinor, method: "bank_transfer", on: String(day.d) });
    expect((await getOrder(storeId, orderId))?.paymentTerms?.state).toBe("paid");
    expect(await terms.recordTermsPaidOutside(storeId, orderId, { method: "cash" }, ownerId)).toEqual({ ok: false, problem: "not_found" });
    // A day in the future is refused; nobody but the store's members may record it.
    const second = await placeOnTerms((jar.clear(), await buyer()));
    expect(await terms.recordTermsPaidOutside(storeId, second.orderId, { method: "cash", receivedOn: addDays(String(day.d), 2) }, ownerId)).toEqual({ ok: false, problem: "received_on" });
    expect(await terms.recordTermsPaidOutside(storeId, second.orderId, { method: "cash" }, null)).toEqual({ ok: false, problem: "not_allowed" });
  });

  it("is cancelled before it is paid with a void: the goods back in stock, a credit note for the invoice, no refund in the figures, and no money moved", async () => {
    const { orderId, order } = await placeOnTerms(await buyer({ mugs: 3 }));
    const [before] = await db().execute<Row>(sql`select sum(on_hand)::int as n from commerce.inventory_levels where variant_id = ${variant["DEMO-MUG-WHITE"]}::uuid`);
    const outcome = await cancelOrder(storeId, orderId, "Ordered by mistake", ownerId);
    expect(outcome).toEqual({ ok: true, refundId: "", amountMinor: 0, unpaid: true });
    const after = await getOrder(storeId, orderId);
    expect({ status: after?.status, balance: after?.balanceMinor, state: after?.paymentTerms?.state }).toEqual({ status: "cancelled", balance: 0, state: "cancelled" });
    const [stock] = await db().execute<Row>(sql`select sum(on_hand)::int as n from commerce.inventory_levels where variant_id = ${variant["DEMO-MUG-WHITE"]}::uuid`);
    expect(Number(stock.n)).toBe(Number(before.n) + 3);
    const [note] = await db().execute<Row>(sql`select c.total_minor, r.kind from commerce.credit_notes c join commerce.refunds r on r.id = c.refund_id join commerce.invoices i on i.id = c.invoice_id where i.order_id = ${orderId}::uuid`);
    expect({ total: Number(note.total_minor), kind: note.kind }).toEqual({ total: order.totalMinor, kind: "void" });
    expect(await sale(orderId)).toBe(false);
    const [inFigures] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.refunds r join commerce.payments p on p.id = r.payment_id
      where p.order_id = ${orderId}::uuid and r.status = 'succeeded' and r.order_edit_id is null and r.kind <> 'void'
    `);
    expect(Number(inFigures.n)).toBe(0);
  });

  it("sends the reminder three days before the due day and the notice the day after, once each, the notice to the owner too", async () => {
    const { orderId, order } = await placeOnTerms(await buyer());
    const due = order.paymentTerms!.dueOn;
    const dayAt = (day: string) => new Date(`${day}T12:00:00Z`);
    await terms.runTermsJobs({ now: dayAt(addDays(due, -4)) });
    const mails = async () => db().execute<Row>(sql`select kind from commerce.email_messages where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid and kind like '%payment%' order by created_at`);
    expect((await mails()).map((m) => m.kind)).toEqual([]);
    await terms.runTermsJobs({ now: dayAt(addDays(due, -3)) });
    await terms.runTermsJobs({ now: dayAt(addDays(due, -2)) });
    expect((await mails()).map((m) => m.kind)).toEqual(["order.payment_due"]);
    await terms.runTermsJobs({ now: dayAt(due) });
    expect((await mails()).map((m) => m.kind)).toEqual(["order.payment_due"]);
    await terms.runTermsJobs({ now: dayAt(addDays(due, 1)) });
    await terms.runTermsJobs({ now: dayAt(addDays(due, 2)) });
    expect((await mails()).map((m) => m.kind).sort()).toEqual(["order.payment_due", "order.payment_overdue", "staff.payment_overdue"]);
    // The staff alert names the order and the amount, never who the customer or the company is.
    const [alert] = await db().execute<Row>(sql`select text from commerce.email_messages where order_id = ${orderId}::uuid and kind = 'staff.payment_overdue'`);
    expect(String(alert.text)).toContain(order.number);
    expect(String(alert.text)).not.toContain("Fjord AS");
    expect(String(alert.text)).not.toContain("Kari");
    const [row] = await db().execute<Row>(sql`select reminder_sent_at is not null as r, overdue_sent_at is not null as o from commerce.order_payment_terms where order_id = ${orderId}::uuid`);
    expect(row).toEqual({ r: true, o: true });
  });

  it("keeps a company that still owes, and lets one go once everything is paid", async () => {
    const [company] = await db().execute<Row>(sql`
      insert into commerce.customer_companies (store_id, name, payment_terms) values (${storeId}::uuid, ${`Brief AS ${run}`}, 'net_15') returning id
    `);
    const id = String(company.id);
    const customerId = await preRegisterCustomer(storeId, `brief-${run}@example.com`);
    await db().execute(sql`update commerce.customers set company_id = ${id}::uuid, company_role = 'owner' where id = ${customerId}::uuid`);
    await startSession(storeId, customerId);
    await changeLine(shop(), variant["DEMO-MUG-WHITE"], 1, "add");
    const { orderId } = await placeOnTerms(customerId);
    await db().execute(sql`update commerce.customers set company_id = null, company_role = null where id = ${customerId}::uuid`);
    expect(await deleteCompany(member, id)).toMatchObject({ ok: false });
    expect(await terms.recordTermsPaidOutside(storeId, orderId, { method: "other" }, ownerId)).toEqual({ ok: true });
    expect(await deleteCompany(member, id)).toEqual({ ok: true });
    const [kept] = await db().execute<Row>(sql`select company_id from commerce.order_payment_terms where order_id = ${orderId}::uuid`);
    expect(kept.company_id).toBeNull();
  });
});
