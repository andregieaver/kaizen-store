import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

import { randomBytes } from "node:crypto";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.MOLLIE_CLIENT_ID = "app_fixture";
process.env.MOLLIE_CLIENT_SECRET = "secret_fixture";

/**
 * A balance on payment terms paid in parts, and through Mollie (wave 11 unit H, D387): money recorded outside for part of it lowers what is owed and the
 * order stays unpaid; *Pay now* then asks for what is left, and the order is paid once it reaches zero, one sale; a store whose checkout is Mollie's alone
 * takes the balance on Mollie's page, settled by Mollie's answer as Stripe's is.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
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

/** Mollie's API, faked as `mollie.int.test.ts` does: tokens, the organisation and profile, methods and payments. */
const mollie = vi.hoisted(() => {
  const payments = new Map<string, Record<string, unknown>>();
  const posted: Record<string, unknown>[] = [];
  let n = 0;
  const run = Math.random().toString(36).slice(2, 8);
  const json = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const raw = typeof init?.body === "string" ? init.body : "";
    const body = raw.startsWith("{") ? (JSON.parse(raw) as Record<string, unknown>) : raw ? Object.fromEntries(new URLSearchParams(raw)) : null;
    if (url.pathname === "/oauth2/tokens") return json({ access_token: `access_${++n}`, refresh_token: "refresh_fixture", expires_in: 3600, token_type: "bearer", scope: "payments.read payments.write" });
    const path = url.pathname.replace(/^\/v2/, "");
    if (path === "/organizations/me") return json({ id: "org_12345", name: "Terms AS" });
    if (path === "/profiles") return json({ _embedded: { profiles: [{ id: "pfl_terms1", name: "Terms shop", status: "verified" }] } });
    if (path === "/methods") return json({ _embedded: { methods: [{ id: "creditcard" }, { id: "vipps" }] } });
    if (path === "/payments" && method === "POST") {
      const id = `tr_${run}${++n}`;
      posted.push(body!);
      const payment = { id, status: "open", isCancelable: true, amount: body!.amount, mode: "live", metadata: body!.metadata, _links: { checkout: { href: `https://www.mollie.com/checkout/${id}` } } };
      payments.set(id, payment);
      return json(payment, 201);
    }
    const match = /^\/payments\/(tr_[A-Za-z0-9]+)(\/refunds|\/chargebacks)?$/.exec(path);
    if (match) {
      const payment = payments.get(match[1]);
      if (!payment) return json({ detail: "No payment exists with token" }, 404);
      if (match[2]) return json({ _embedded: { [match[2].slice(1)]: [] } });
      if (method === "PATCH") Object.assign(payment, body);
      return json(payment);
    }
    return json({ detail: `Unknown ${method} ${path}` }, 404);
  };
  return { payments, posted, fetch };
});

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
const { startCheckout } = await import("./checkout");
const { getOrder, getShopperOrder } = await import("./orders");
const { preRegisterCustomer, startSession } = await import("./customers");
const terms = await import("./payment-terms");
const { setMollieFetch, connectMollie } = await import("./mollie");
const { handleMollieWebhook } = await import("./payment-providers/mollie");
const { periodTotals } = await import("./analytics-totals");
const { getStore } = await import("./stores");
const { customPeriod, todayIn } = await import("@/lib/analytics-period");

/** Today's paid orders in the store's figures (Finance's `periodTotals()`). */
async function ordersToday(): Promise<number> {
  const store = (await getStore(slug))!;
  const today = todayIn(new Date(), store.timeZone);
  return (await periodTotals(store, customPeriod(today, today))).totals.orders;
}

const run = Date.now().toString(36);
const slug = `terms-${run}`;
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const origin = "http://localhost:3000";
let storeId: string;
let companyId: string;
let ownerId: string;
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
});

beforeAll(() => setMollieFetch(mollie.fetch as typeof fetch));
afterAll(async () => {
  setMollieFetch(null);
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

describe("a balance paid in parts", () => {
  it("lowers what is owed for money recorded outside, keeps the order unpaid and no sale, then asks Pay now for what is left and is paid once at zero", async () => {
    const before = await ordersToday();
    const { orderId, order } = await placeOnTerms(await buyer());
    const part = Math.floor(order.balanceMinor / 3);
    expect(await terms.recordTermsPaidOutside(storeId, orderId, { method: "bank_transfer", amountMinor: order.balanceMinor + 1 }, ownerId)).toEqual({ ok: false, problem: "amount" });
    expect(await terms.recordTermsPaidOutside(storeId, orderId, { method: "bank_transfer", amountMinor: part, reference: "First part" }, ownerId)).toEqual({
      ok: true,
      left: order.balanceMinor - part,
    });
    const after = await getOrder(storeId, orderId);
    expect(after?.balanceMinor).toBe(order.balanceMinor - part);
    expect(after?.paymentTerms?.state).not.toBe("paid");
    // Part of the money arrived, but an order on terms is a sale only once its balance is paid in full (D387): in no period yet.
    expect(await ordersToday()).toBe(before);
    const [unsold] = await db().execute<Row>(sql`select sold_at = 'infinity'::timestamptz as never from commerce.orders where id = ${orderId}::uuid`);
    expect(unsold.never).toBe(true);
    const store = { id: storeId, slug } as unknown as Store;
    const started = await terms.startTermsPayment({ store, market: no }, orderId, origin);
    expect(started).toMatchObject({ ok: true });
    const { params } = fake.created.at(-1)!;
    expect((params.line_items as { price_data: { unit_amount: number } }[])[0].price_data.unit_amount).toBe(order.balanceMinor - part);
    const sessionId = [...fake.sessions.keys()].at(-1)!;
    fake.sessions.set(sessionId, { status: "complete", payment_status: "paid", mode: "payment", payment_intent: `pi_${sessionId}` });
    const back = await getShopperOrder(storeId, orderId, sessionId);
    expect(back?.balanceMinor).toBe(0);
    expect(back?.paymentTerms).toMatchObject({ state: "paid", paidAt: expect.any(String) });
    const events = await db().execute<Row>(sql`select type, data from commerce.order_events where order_id = ${orderId}::uuid and type like 'order.terms_%' order by id`);
    expect(events.map((e) => e.type)).toEqual(["order.terms_placed", "order.terms_part_paid", "order.terms_paid"]);
    // Paid in full today: a sale of today, dated by when its balance was paid.
    expect(await ordersToday()).toBe(before + 1);
    const [sold] = await db().execute<Row>(sql`
      select o.sold_at = t.paid_at as same from commerce.orders o join commerce.order_payment_terms t on t.order_id = o.id where o.id = ${orderId}::uuid
    `);
    expect(sold.same).toBe(true);
    expect((events[1].data as Record<string, unknown>).left).toBe(order.balanceMinor - part);
    const [captured] = await db().execute<Row>(sql`select coalesce(sum(amount_minor), 0)::bigint as n from commerce.payments where order_id = ${orderId}::uuid and status = 'captured'`);
    expect(Number(captured.n)).toBe(order.balanceMinor);
    expect(await terms.recordTermsPaidOutside(storeId, orderId, { method: "cash", amountMinor: 1 }, ownerId)).toEqual({ ok: false, problem: "not_found" });
  });
});

describe("a store whose checkout is Mollie's", () => {
  it("takes the balance on Mollie's page and is paid when Mollie says so", async () => {
    const { orderId, order } = await placeOnTerms(await buyer());
    // The store moves its checkout to Mollie after the order was placed on terms.
    await connectMollie(storeId, ownerId, new URLSearchParams({ code: "auth_fixture", state: "s" }));
    await db().execute(sql`insert into commerce.checkout_providers (store_id, mode, provider) values (${storeId}::uuid, 'live', 'mollie') on conflict (store_id, mode) do update set provider = 'mollie'`);
    try {
      const before = fake.created.length;
      const store = { id: storeId, slug } as unknown as Store;
      const started = await terms.startTermsPayment({ store, market: no }, orderId, origin);
      expect(started).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/www\.mollie\.com\/checkout\//) });
      expect(fake.created.length).toBe(before);
      expect(mollie.posted.at(-1)).toMatchObject({ amount: { currency: "NOK", value: (order.balanceMinor / 100).toFixed(2) } });
      // A second press while it is open waits for it.
      expect(await terms.startTermsPayment({ store, market: no }, orderId, origin)).toEqual({ ok: false, problem: "processing" });
      const [payment] = await db().execute<Row>(sql`select provider_reference from commerce.payments where order_id = ${orderId}::uuid and provider = 'mollie'`);
      const reference = String(payment.provider_reference);
      mollie.payments.get(reference)!.status = "paid";
      expect(await handleMollieWebhook("live", `id=${reference}`)).toBe("applied");
      const paid = await getOrder(storeId, orderId);
      expect(paid?.balanceMinor).toBe(0);
      expect(paid?.paymentTerms?.state).toBe("paid");
      expect(paid?.status).toBe("paid");
    } finally {
      await db().execute(sql`delete from commerce.checkout_providers where store_id = ${storeId}::uuid`);
    }
  });
});
