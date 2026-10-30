import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { encryptSecret, parseKey } from "@/lib/secret-box";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
process.env.MOLLIE_CLIENT_ID = "app_fixture";
process.env.MOLLIE_CLIENT_SECRET = "secret_fixture";
process.env.SITE_URL = "https://kaizenaflow.test";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
// Stripe is never asked here: a Mollie store's checkout goes to Mollie.
vi.mock("./stripe", () => ({ platformStripe: () => null, platformModes: () => ["test", "live"], WEBHOOK_EVENTS: [], stripeFor: () => null }));

type Call = { method: string; path: string; body: Record<string, unknown> | null; headers: Record<string, string> };

/**
 * A recorded fake of Mollie's API (D292), shaped as Mollie's documentation answers: OAuth tokens, the organisation and its profile, methods, payments,
 * refunds and chargebacks. Every call is kept, so the tests see what Kaizena Flow sent Mollie.
 */
const mollie = vi.hoisted(() => {
  const calls: Call[] = [];
  const payments = new Map<string, Record<string, unknown>>();
  const refunds = new Map<string, Record<string, unknown>[]>();
  const chargebacks = new Map<string, Record<string, unknown>[]>();
  const refused = new Set<string>();
  let n = 0;
  // Ids unique to this run, as Mollie's are: a database used before never holds the same ones.
  const run = Math.random().toString(36).slice(2, 8);
  const json = (body: unknown, status = 200) => new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const raw = typeof init?.body === "string" ? init.body : init?.body ? String(init.body) : "";
    const body = raw && headers["Content-Type"] === "application/json" ? (JSON.parse(raw) as Record<string, unknown>) : raw ? Object.fromEntries(new URLSearchParams(raw)) : null;
    calls.push({ method, path: url.pathname + url.search, body, headers });
    // A token Mollie no longer takes (revoked before its time).
    if (url.pathname !== "/oauth2/tokens" && refused.has(String(headers.Authorization).replace(/^Bearer /, ""))) return json({ detail: "Unauthorized request" }, 401);
    if (url.pathname === "/oauth2/tokens") {
      return json({ access_token: `access_${++n}`, refresh_token: "refresh_fixture", expires_in: 3600, token_type: "bearer", scope: "payments.read payments.write refunds.read refunds.write" });
    }
    const path = url.pathname.replace(/^\/v2/, "");
    if (path === "/organizations/me") return json({ id: "org_12345", name: "Fixture AS" });
    if (path === "/profiles") return json({ _embedded: { profiles: [{ id: "pfl_fixture1", name: "Fixture shop", status: "verified" }] } });
    if (path === "/methods") return json({ _embedded: { methods: [{ id: "creditcard" }, { id: "ideal" }, { id: "paypal" }, { id: "klarna" }, { id: "vipps" }] } });
    if (path === "/payments" && method === "POST") {
      const id = `tr_${run}${++n}`;
      const payment = { id, status: "open", isCancelable: true, amount: body!.amount, mode: body!.testmode ? "test" : "live", _links: { checkout: { href: `https://www.mollie.com/checkout/${id}` } } };
      payments.set(id, payment);
      return json(payment, 201);
    }
    const match = /^\/payments\/(tr_[A-Za-z0-9]+)(\/refunds|\/chargebacks)?$/.exec(path);
    if (match) {
      const payment = payments.get(match[1]);
      if (!payment) return json({ detail: "No payment exists with token" }, 404);
      if (match[2] === "/refunds" && method === "POST") {
        const refund = { id: `re_${run}${++n}`, status: "pending", amount: body!.amount, metadata: body!.metadata, createdAt: new Date().toISOString() };
        refunds.set(match[1], [...(refunds.get(match[1]) ?? []), refund]);
        return json(refund, 201);
      }
      if (match[2] === "/refunds") return json({ _embedded: { refunds: refunds.get(match[1]) ?? [] } });
      if (match[2] === "/chargebacks") return json({ _embedded: { chargebacks: chargebacks.get(match[1]) ?? [] } });
      if (method === "PATCH") {
        Object.assign(payment, body);
        return json(payment);
      }
      if (method === "DELETE") {
        payment.status = "canceled";
        return json(undefined, 204);
      }
      return json(payment);
    }
    return json({ detail: `Unknown ${method} ${path}` }, 404);
  };
  return { calls, payments, refunds, chargebacks, refused, fetch };
});

const fx = await import("./invoice-test-fixture");
const { setMollieFetch, connectMollie, checkoutProviderOf } = await import("./mollie");
const { startCheckout } = await import("./checkout");
const { handleMollieWebhook } = await import("./payment-providers/mollie");
const { getShopperOrder, getOrder } = await import("./orders");
const { refundOrder } = await import("./order-admin");
const { saveMethodChoices } = await import("./payment-methods");
const { setStripeProvider } = await import("./settings");

type Row = Record<string, unknown>;

beforeAll(() => setMollieFetch(mollie.fetch as typeof fetch));
afterAll(async () => {
  setMollieFetch(null);
  await closeDb();
});

const payer = { name: "Kari Nordmann", email: "kari@example.no", phone: "", line1: "Storgata 5", line2: "", postalCode: "0182", city: "Oslo" };

/** A store on Mollie in a mode, its connection made the way the callback makes it. */
async function mollieStore(label: string, mode: "test" | "live" = "live") {
  const own = await fx.makeStore(label, { mode });
  await connectMollie(own.storeId, own.ownerId, new URLSearchParams({ code: "auth_fixture", state: "s" }));
  await db().execute(sql`insert into commerce.checkout_providers (store_id, mode, provider) values (${own.storeId}::uuid, ${mode}, 'mollie')`);
  return own;
}

async function cartOf(storeId: string, market = fx.no, sku = "DEMO-MUG-WHITE", quantity = 1): Promise<string> {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day') returning id
  `);
  await db().execute(sql`
    insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
    select ${storeId}::uuid, ${String(cart.id)}::uuid, id, ${quantity} from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
  `);
  return String(cart.id);
}

const lastCall = (method: string, prefix: string) => [...mollie.calls].reverse().find((c) => c.method === method && c.path.startsWith(prefix))!;

async function checkout(own: Awaited<ReturnType<typeof mollieStore>>, market = fx.no, typed: Record<string, string> | null = payer) {
  const cartId = await cartOf(own.storeId, market);
  const result = await startCheckout({ storeId: own.storeId, storeSlug: own.slug, market }, cartId, "https://shop.test", "Frakt", {}, { payer: typed });
  return { cartId, result };
}

async function paymentOf(orderId: string) {
  const [p] = await db().execute<Row>(sql`select provider, provider_reference, provider_account, status, amount_minor, currency, kaizen_fee_minor, test_mode from commerce.payments where order_id = ${orderId}::uuid`);
  return p;
}

async function orderOfCart(cartId: string) {
  const [o] = await db().execute<Row>(sql`select id, status, email, billing_address, shipping_address, total_minor from commerce.orders where cart_id = ${cartId}::uuid order by placed_at desc limit 1`);
  return o;
}

describe("connecting Mollie", () => {
  it("keeps the organisation, its website profile and the token encrypted, and uses Mollie's checkout only while chosen", async () => {
    const own = await fx.makeStore("mo-connect");
    expect(await checkoutProviderOf(own.storeId, "live")).toBe("stripe");
    await connectMollie(own.storeId, own.ownerId, new URLSearchParams({ code: "auth_fixture", state: "s" }));
    const tokenCall = lastCall("POST", "/oauth2/tokens");
    expect(tokenCall.headers.Authorization).toBe(`Basic ${Buffer.from("app_fixture:secret_fixture").toString("base64")}`);
    expect(tokenCall.body).toMatchObject({ grant_type: "authorization_code", code: "auth_fixture", redirect_uri: "https://kaizenaflow.test/api/integrations/mollie/callback" });
    const [row] = await db().execute<Row>(sql`select organization_id, profile_id, refresh_token from commerce.mollie_connections where store_id = ${own.storeId}::uuid`);
    expect(row).toMatchObject({ organization_id: "org_12345", profile_id: "pfl_fixture1" });
    expect(String(row.refresh_token)).not.toContain("refresh_fixture");
    expect(await checkoutProviderOf(own.storeId, "live")).toBe("stripe");
    await db().execute(sql`insert into commerce.checkout_providers (store_id, mode, provider) values (${own.storeId}::uuid, 'live', 'mollie')`);
    expect(await checkoutProviderOf(own.storeId, "live")).toBe("mollie");
    expect(await checkoutProviderOf(own.storeId, "test")).toBe("stripe");
  });

  it("makes a new access token from the refresh token when the one kept has ended", async () => {
    const own = await mollieStore("mo-refresh");
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await db().execute(sql`update commerce.mollie_connections set access_token = ${encryptSecret("access_old", key)}, access_expires_at = now() - interval '1 minute' where store_id = ${own.storeId}::uuid`);
    const before = mollie.calls.length;
    await checkout(own);
    const made = mollie.calls.slice(before);
    expect(made[0]).toMatchObject({ method: "POST", path: "/oauth2/tokens", body: { grant_type: "refresh_token", refresh_token: "refresh_fixture" } });
    expect(made.slice(1).every((c) => c.headers.Authorization !== "Bearer access_old")).toBe(true);
  });
});

describe("a token Mollie refuses before its time (PSI DATA-03)", () => {
  it("makes a new one from the refresh token and asks once more, and the shopper never sees the refusal", async () => {
    const own = await mollieStore("mo-401");
    const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
    await db().execute(sql`update commerce.mollie_connections set access_token = ${encryptSecret("access_revoked", key)}, access_expires_at = now() + interval '1 hour' where store_id = ${own.storeId}::uuid`);
    mollie.refused.add("access_revoked");
    const before = mollie.calls.length;
    const { result } = await checkout(own);
    expect(result).toMatchObject({ ok: true });
    const made = mollie.calls.slice(before);
    const refusedAt = made.findIndex((c) => c.headers.Authorization === "Bearer access_revoked");
    expect(refusedAt).toBeGreaterThanOrEqual(0);
    expect(made[refusedAt + 1]).toMatchObject({ method: "POST", path: "/oauth2/tokens", body: { grant_type: "refresh_token" } });
    expect(made.slice(refusedAt + 1).some((c) => c.headers.Authorization === "Bearer access_revoked")).toBe(false);
  });
});

describe("paying with Mollie", () => {
  it("places the order with who pays, opens a Mollie payment on the store's profile with Kaizena Flow's fee, and sends the shopper to Mollie's page", async () => {
    const own = await mollieStore("mo-pay");
    const { cartId, result } = await checkout(own);
    expect(result).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/www\.mollie\.com\/checkout\/tr_/) });
    const order = await orderOfCart(cartId);
    expect(order).toMatchObject({ status: "pending_payment", email: "kari@example.no", billing_address: { name: "Kari Nordmann", line1: "Storgata 5", postalCode: "0182", city: "Oslo", country: "NO" } });
    const created = lastCall("POST", "/v2/payments");
    expect(created.headers["Idempotency-Key"]).toBe(`checkout-${order.id}`);
    expect(created.body).toMatchObject({
      amount: { currency: "NOK", value: (Number(order.total_minor) / 100).toFixed(2) },
      description: expect.stringMatching(/^Order /),
      profileId: "pfl_fixture1",
      locale: "nb_NO",
      webhookUrl: "https://kaizenaflow.test/api/mollie/live",
      metadata: { order_id: order.id, store_id: own.storeId },
      billingAddress: { email: "kari@example.no" },
      method: ["creditcard", "ideal", "paypal", "vipps"],
    });
    expect(created.body).not.toHaveProperty("testmode");
    const payment = await paymentOf(String(order.id));
    expect(payment).toMatchObject({ provider: "mollie", provider_account: "pfl_fixture1", status: "pending", test_mode: false });
    // The return address names the payment, as the order page's key.
    const patched = lastCall("PATCH", `/v2/payments/${payment.provider_reference}`);
    expect(patched.body).toMatchObject({ redirectUrl: expect.stringMatching(new RegExp(`/order/${order.id}\\?session_id=${payment.provider_reference}$`)) });
  });

  it("refuses to place anything when who pays is missing, and leaves out of the method list what the owner switched off for the country", async () => {
    const own = await mollieStore("mo-payer");
    const { cartId, result } = await checkout(own, fx.no, { ...payer, line1: "" });
    expect(result).toEqual({ ok: false, problem: "payer" });
    expect(await orderOfCart(cartId)).toBeUndefined();
    await saveMethodChoices(own.storeId, own.ownerId, { markets: ["NO"], on: new Set(["NO:link", "NO:klarna"]) });
    await checkout(own);
    expect(lastCall("POST", "/v2/payments").body!.method).toEqual(["creditcard", "paypal", "vipps"]);
  });

  it("completes the order when Mollie, asked by the webhook, says it is paid, once; and the shopper's return asks Mollie when the webhook is late", async () => {
    const own = await mollieStore("mo-paid");
    const { cartId } = await checkout(own);
    const order = await orderOfCart(cartId);
    const reference = String((await paymentOf(String(order.id))).provider_reference);
    // The shopper is back before the webhook: the order page asks Mollie.
    mollie.payments.get(reference)!.status = "paid";
    const seen = await getShopperOrder(own.storeId, String(order.id), reference);
    expect(seen?.status).toBe("paid");
    expect((await paymentOf(String(order.id))).status).toBe("captured");
    // The webhook after it: nothing more happens.
    expect(await handleMollieWebhook("live", `id=${reference}`)).toBe("applied");
    expect(await handleMollieWebhook("live", `id=${reference}`)).toBe("applied");
    const [paid] = await db().execute<Row>(sql`select count(*)::int as n from commerce.order_events where order_id = ${String(order.id)}::uuid and type = 'order.paid'`);
    expect(paid.n).toBe(1);
    // A forged call for a payment no store has, or in the other mode, changes nothing.
    expect(await handleMollieWebhook("live", "id=tr_unknown123")).toBe("unknown");
    expect(await handleMollieWebhook("test", `id=${reference}`)).toBe("unknown");
    expect(await handleMollieWebhook("live", "id=<script>")).toBe("unknown");
  });

  it("cancels the order and lets its stock go when the shopper cancels on Mollie's page", async () => {
    const own = await mollieStore("mo-cancel");
    const { cartId } = await checkout(own);
    const order = await orderOfCart(cartId);
    const reference = String((await paymentOf(String(order.id))).provider_reference);
    mollie.payments.get(reference)!.status = "canceled";
    await handleMollieWebhook("live", `id=${reference}`);
    expect((await getOrder(own.storeId, String(order.id)))?.status).toBe("cancelled");
    expect((await paymentOf(String(order.id))).status).toBe("cancelled");
  });

  it("closes the shopper's earlier Mollie payment when they check out again, and waits for one Mollie cannot cancel", async () => {
    const own = await mollieStore("mo-again");
    const cartId = await cartOf(own.storeId);
    const shop = { storeId: own.storeId, storeSlug: own.slug, market: fx.no };
    await startCheckout(shop, cartId, "https://shop.test", "Frakt", {}, { payer });
    const first = await orderOfCart(cartId);
    const firstRef = String((await paymentOf(String(first.id))).provider_reference);
    const again = await startCheckout(shop, cartId, "https://shop.test", "Frakt", {}, { payer });
    expect(again.ok).toBe(true);
    expect(lastCall("DELETE", `/v2/payments/${firstRef}`)).toBeTruthy();
    expect((await getOrder(own.storeId, String(first.id)))?.status).toBe("cancelled");
    // A card payment under way cannot be cancelled: the shopper is told to wait a moment.
    const second = await orderOfCart(cartId);
    const secondRef = String((await paymentOf(String(second.id))).provider_reference);
    mollie.payments.get(secondRef)!.isCancelable = false;
    expect(await startCheckout(shop, cartId, "https://shop.test", "Frakt", {}, { payer })).toMatchObject({ ok: false, problem: "processing" });
  });

  it("keeps a test payment a test: Mollie's testmode, the row's mode, and no invoice number", async () => {
    const own = await mollieStore("mo-test", "test");
    const { cartId } = await checkout(own);
    const order = await orderOfCart(cartId);
    expect(lastCall("POST", "/v2/payments").body).toMatchObject({ testmode: true, webhookUrl: "https://kaizenaflow.test/api/mollie/test" });
    const payment = await paymentOf(String(order.id));
    expect(payment.test_mode).toBe(true);
    mollie.payments.get(String(payment.provider_reference))!.status = "paid";
    await handleMollieWebhook("test", `id=${payment.provider_reference}`);
    expect((await getOrder(own.storeId, String(order.id)))?.status).toBe("paid");
    expect(await fx.invoiceOf(own.storeId, String(order.id))).toBeNull();
    // A test payment is cancelled at Mollie in test mode too (Mollie takes `testmode` in a cancel's body).
    const again = await checkout(own);
    expect(again.result.ok).toBe(true);
    const cartId2 = again.cartId;
    const shop = { storeId: own.storeId, storeSlug: own.slug, market: fx.no };
    const open = await orderOfCart(cartId2);
    const ref = String((await paymentOf(String(open.id))).provider_reference);
    await startCheckout(shop, cartId2, "https://shop.test", "Frakt", {}, { payer });
    expect(lastCall("DELETE", `/v2/payments/${ref}`).body).toEqual({ testmode: true });
  });

  it("lets a store take real payments through Mollie alone, without a Stripe account of its own", async () => {
    const own = await fx.makeStore("mo-live", { mode: "test" });
    await db().execute(sql`update commerce.stripe_accounts set card_payments = 'inactive', requirements_due = true where store_id = ${own.storeId}::uuid`);
    const owner = await fx.ownerOf(own);
    expect(await setStripeProvider(owner, true, "live", false)).toMatchObject({ ok: false });
    await connectMollie(own.storeId, own.ownerId, new URLSearchParams({ code: "auth_fixture", state: "s" }));
    await db().execute(sql`insert into commerce.checkout_providers (store_id, mode, provider) values (${own.storeId}::uuid, 'live', 'mollie')`);
    expect(await setStripeProvider(owner, true, "live", false)).toEqual({ ok: true });
    const { result } = await checkout(own);
    expect(result).toMatchObject({ ok: true, url: expect.stringContaining("mollie.com/checkout/") });
  });

  it("charges Norway shown in euro in euro, at the amount the shopper saw", async () => {
    const own = await mollieStore("mo-euro");
    const { cartId, result } = await checkout(own, fx.noInEuro);
    expect(result.ok).toBe(true);
    const order = await orderOfCart(cartId);
    const created = lastCall("POST", "/v2/payments");
    expect(created.body!.amount).toEqual({ currency: "EUR", value: (Number(order.total_minor) / 100).toFixed(2) });
    expect((await paymentOf(String(order.id))).currency).toBe("EUR");
  });
});

describe("after a Mollie payment", () => {
  async function paidMollieOrder(label: string) {
    const own = await mollieStore(label);
    const { cartId } = await checkout(own);
    const order = await orderOfCart(cartId);
    const reference = String((await paymentOf(String(order.id))).provider_reference);
    mollie.payments.get(reference)!.status = "paid";
    await handleMollieWebhook("live", `id=${reference}`);
    return { own, orderId: String(order.id), reference, total: Number(order.total_minor) };
  }

  it("issues the invoice when paid, refunds through Mollie with an idempotency key, and the credit note follows Mollie's word that it is refunded", async () => {
    const { own, orderId, reference } = await paidMollieOrder("mo-refund");
    expect(await fx.invoiceOf(own.storeId, orderId)).not.toBeNull();
    const refunded = await refundOrder(own.storeId, orderId, { amountMinor: 5000, restock: [], reason: "Changed their mind" }, own.ownerId);
    expect(refunded).toMatchObject({ ok: true, status: "pending" });
    const call = lastCall("POST", `/v2/payments/${reference}/refunds`);
    expect(call.body).toMatchObject({ amount: { currency: "NOK", value: "50.00" }, metadata: { order_id: orderId } });
    expect(call.headers["Idempotency-Key"]).toMatch(new RegExp(`^refund-${orderId}-`));
    expect(await fx.notesOf(own.storeId, orderId)).toHaveLength(0);
    // Mollie says it is done: the webhook brings the row up to date and the credit note is made.
    mollie.refunds.get(reference)![0].status = "refunded";
    mollie.payments.get(reference)!.amountRefunded = { currency: "NOK", value: "50.00" };
    await handleMollieWebhook("live", `id=${reference}`);
    const rows = await fx.refundRowsOf(own.storeId, orderId);
    expect(rows).toEqual([expect.objectContaining({ amount: 5000, status: "succeeded" })]);
    expect(await fx.notesOf(own.storeId, orderId)).toHaveLength(1);
  });

  it("records a refund made in Mollie's Dashboard, and keeps a chargeback as a lost dispute", async () => {
    const { own, orderId, reference } = await paidMollieOrder("mo-dash");
    mollie.refunds.set(reference, [{ id: `re_dash${reference.slice(3)}`, status: "refunded", amount: { currency: "NOK", value: "20.00" }, metadata: null, createdAt: new Date(Date.now() - 3_600_000).toISOString() }]);
    mollie.chargebacks.set(reference, [{ id: `chb_${reference.slice(3)}`, amount: { currency: "NOK", value: "30.00" }, reason: { code: "AC04" }, createdAt: new Date().toISOString(), reversedAt: null }]);
    mollie.payments.get(reference)!.amountRefunded = { currency: "NOK", value: "20.00" };
    mollie.payments.get(reference)!.amountChargedBack = { currency: "NOK", value: "30.00" };
    await handleMollieWebhook("live", `id=${reference}`);
    expect(await fx.refundRowsOf(own.storeId, orderId)).toEqual([expect.objectContaining({ amount: 2000, status: "succeeded", reference: `re_dash${reference.slice(3)}` })]);
    const [dispute] = await db().execute<Row>(sql`select provider, amount_minor::int as amount_minor, status, outcome, reason from commerce.payment_disputes where order_id = ${orderId}::uuid`);
    expect(dispute).toMatchObject({ provider: "mollie", amount_minor: 3000, status: "lost", outcome: "lost", reason: "AC04" });
    // Read again: nothing more is written.
    await handleMollieWebhook("live", `id=${reference}`);
    const [counts] = await db().execute<Row>(sql`
      select (select count(*)::int from commerce.refunds r join commerce.payments p on p.id = r.payment_id where p.order_id = ${orderId}::uuid) as refunds,
             (select count(*)::int from commerce.payment_disputes where order_id = ${orderId}::uuid) as disputes
    `);
    expect(counts).toEqual({ refunds: 1, disputes: 1 });
  });
});
