import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import Stripe from "stripe";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { POST as connectAccountsWebhook } from "@/app/api/stripe/connect/[mode]/accounts/route";
import { POST as connectWebhook } from "@/app/api/stripe/connect/[mode]/route";
import { POST as webhook } from "@/app/api/stripe/webhook/[storeId]/route";
import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import { encryptSecret } from "@/lib/secret-box";

import { placeOrder } from "./checkout";
import { getOrderDownloads, takeDownload } from "./orders";
import { applySession } from "./stripe-webhooks";

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
let storeId: string;

/** A store copied from the seeded template: demo catalogue, stock and shipping. */
beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`checkout-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`checkout-${run}`}, 'Test', null) as id
  `);
  storeId = String(store.id);
});

afterAll(async () => {
  await closeDb();
});

async function variant(sku: string): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    select id from commerce.product_variants where store_id = ${storeId}::uuid and sku = ${sku}
  `);
  return String(row.id);
}

async function cart(market: typeof no, lines: [string, number][]): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
    values (${storeId}::uuid, ${market.code}, ${market.currency}, ${market.locale}, now() + interval '1 day')
    returning id
  `);
  for (const [sku, quantity] of lines) {
    await db().execute(sql`
      insert into commerce.cart_lines (store_id, cart_id, variant_id, quantity)
      values (${storeId}::uuid, ${String(row.id)}::uuid, ${await variant(sku)}::uuid, ${quantity})
    `);
  }
  return String(row.id);
}

async function available(sku: string): Promise<{ on_hand: number; available: number }> {
  const [row] = await db().execute<Row>(sql`
    select on_hand, available::int from commerce.available_stock where variant_id = ${await variant(sku)}::uuid
  `);
  return { on_hand: Number(row.on_hand), available: Number(row.available) };
}

async function orderRow(orderId: string): Promise<Row> {
  const [row] = await db().execute<Row>(sql`select * from commerce.orders where id = ${orderId}::uuid`);
  return row;
}

describe("placing an order", () => {
  it("prices the basket, adds shipping and VAT, numbers the order and holds the stock", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-MUG-WHITE", 2]]));
    if (!result.ok) throw new Error(result.problem);
    const { order } = result;
    expect(order.number).toBe("1001");
    expect(order.lines).toEqual([{ title: "Demo: Keramikkopp (white)", unitPriceMinor: 24900, quantity: 2, recurring: false }]);
    expect(order.shippingMinor).toBe(9900);
    expect(order.totalMinor).toBe(59700);

    const row = await orderRow(order.orderId);
    expect(row).toMatchObject({ status: "pending_payment", subtotal_minor: "49800", tax_minor: "11940" });
    expect(await available("DEMO-MUG-WHITE")).toEqual({ on_hand: 40, available: 38 });
  });

  it("ships for free above the store's threshold", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-TOTE", 6]]));
    if (!result.ok) throw new Error(result.problem);
    expect(result.order.shippingMinor).toBe(0);
    expect(result.order.totalMinor).toBe(6 * 19900);
  });

  it("refuses more than is in stock, and writes nothing", async () => {
    const [before] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.orders where store_id = ${storeId}::uuid
    `);
    const result = await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-MUG-BLACK", 4]]));
    expect(result).toEqual({ ok: false, problem: "stock" });
    const [after] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.orders where store_id = ${storeId}::uuid
    `);
    expect(after.n).toBe(before.n);
  });

  it("lets only one of two shoppers have the last items", async () => {
    const [a, b] = await Promise.all([
      cart(no, [["DEMO-MUG-BLACK", 2]]),
      cart(no, [["DEMO-MUG-BLACK", 2]]),
    ]);
    const results = await Promise.all([
      placeOrder({ storeId, market: no }, a),
      placeOrder({ storeId, market: no }, b),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, problem: "stock" }]);
  });

  it("needs a shipping price for the country", async () => {
    await db().execute(sql`
      delete from commerce.shipping_rates where store_id = ${storeId}::uuid and market_code = 'SE'
    `);
    const result = await placeOrder({ storeId, market: se }, await cart(se, [["DEMO-TOTE", 1]]));
    expect(result).toEqual({ ok: false, problem: "no_shipping" });
  });
});

/** An order with a Stripe payment row, as startCheckout leaves it. */
async function pendingOrder(sessionId: string, sku = "DEMO-NOTEBOOK-LINED", quantity = 1) {
  const result = await placeOrder({ storeId, market: no }, await cart(no, [[sku, quantity]]));
  if (!result.ok) throw new Error(result.problem);
  await db().execute(sql`
    insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency)
    values (${storeId}::uuid, ${result.order.orderId}::uuid, 'stripe', ${sessionId}, ${result.order.totalMinor}, 'NOK')
  `);
  return result.order.orderId;
}

const session = (id: string, fields: Partial<Stripe.Checkout.Session>) =>
  ({ id, object: "checkout.session", ...fields }) as Stripe.Checkout.Session;

describe("payment outcomes", () => {
  it("marks the order paid with the customer's details, and draws the stock", async () => {
    const orderId = await pendingOrder(`cs_paid_${run}`);
    await applySession(
      storeId,
      session(`cs_paid_${run}`, {
        status: "complete",
        payment_status: "paid",
        customer_details: {
          email: "kari@example.com",
          name: "Kari Nordmann",
          phone: null,
          address: { line1: "Storgata 1", line2: null, postal_code: "0155", city: "Oslo", country: "NO", state: null },
        } as Stripe.Checkout.Session.CustomerDetails,
      }),
    );
    const row = await orderRow(orderId);
    expect(row.status).toBe("paid");
    expect(row.email).toBe("kari@example.com");
    expect(row.shipping_address).toMatchObject({ name: "Kari Nordmann", city: "Oslo" });
    expect(await available("DEMO-NOTEBOOK-LINED")).toEqual({ on_hand: 59, available: 59 });
  });

  it("cancels an expired checkout and gives the stock back", async () => {
    const orderId = await pendingOrder(`cs_expired_${run}`, "DEMO-TOTE", 1);
    const held = await available("DEMO-TOTE");
    await applySession(storeId, session(`cs_expired_${run}`, { status: "expired", payment_status: "unpaid" }));
    expect((await orderRow(orderId)).status).toBe("cancelled");
    expect((await available("DEMO-TOTE")).available).toBe(held.available + 1);
  });

  it("ignores sessions another store created", async () => {
    await applySession(storeId, session("cs_not_ours", { status: "complete", payment_status: "paid" }));
  });
});

describe("the Stripe webhook", () => {
  const secret = `whsec_test_${run}`;
  const signer = new Stripe("sk_test_signing_only");

  beforeAll(async () => {
    const key = randomBytes(32);
    process.env.SETTINGS_ENCRYPTION_KEY = key.toString("base64");
    await db().execute(sql`
      insert into commerce.payment_credentials (store_id, provider, mode, webhook_secret_ciphertext, webhook_secret_hint)
      values (${storeId}::uuid, 'stripe', 'test', ${encryptSecret(secret, key)}, 'whsec_…')
      on conflict (store_id, provider, mode) do update set webhook_secret_ciphertext = excluded.webhook_secret_ciphertext
    `);
  });

  function call(body: string, signature: string) {
    return webhook(
      new Request(`http://localhost/api/stripe/webhook/${storeId}`, {
        method: "POST",
        headers: { "stripe-signature": signature },
        body,
      }),
      { params: Promise.resolve({ storeId }) },
    );
  }

  const event = (sessionId: string) =>
    JSON.stringify({
      id: `evt_${sessionId}`,
      object: "event",
      type: "checkout.session.completed",
      data: { object: { id: sessionId, object: "checkout.session", status: "complete", payment_status: "paid" } },
    });

  it("applies a correctly signed event, once", async () => {
    const id = await pendingOrder(`cs_hook_${run}`);
    const body = event(`cs_hook_${run}`);
    const signature = signer.webhooks.generateTestHeaderString({ payload: body, secret });

    const response = await call(body, signature);
    expect(response.status).toBe(200);
    expect((await orderRow(id)).status).toBe("paid");

    const again = await call(body, signature);
    expect(again.status).toBe(200);
    const [events] = await db().execute<Row>(sql`
      select attempts from commerce.webhook_events where store_id = ${storeId}::uuid and event_id = ${`evt_cs_hook_${run}`}
    `);
    expect(events.attempts).toBe(1);
  });

  it("refuses an event with a wrong signature", async () => {
    const body = event("cs_forged");
    const forged = signer.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_someone_else" });
    expect((await call(body, forged)).status).toBe(400);
    expect((await call(body, "")).status).toBe(400);
  });
});

describe("the Connect webhooks", () => {
  const secret = `whsec_connect_${run}`;
  const thinSecret = `whsec_thin_${run}`;
  const accountId = `acct_hook${run}`;
  const signer = new Stripe("sk_test_signing_only");

  beforeAll(async () => {
    const key = randomBytes(32);
    process.env.SETTINGS_ENCRYPTION_KEY = key.toString("base64");
    process.env.STRIPE_SECRET_KEY_TEST = "sk_test_kaizen_platform";
    for (const [kind, value] of [["snapshot", secret], ["thin", thinSecret]]) {
      await db().execute(sql`
        insert into commerce.platform_webhooks (provider, mode, kind, endpoint_id, url, secret_ciphertext)
        values ('stripe', 'test', ${kind}, ${`we_${kind}`}, 'https://kaizen.test/hook', ${encryptSecret(value, key)})
        on conflict (provider, mode, kind) do update set secret_ciphertext = excluded.secret_ciphertext
      `);
    }
    await db().execute(sql`
      insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
      values (${storeId}::uuid, 'test', ${accountId}, 'active', false)
    `);
  });

  type ModeRoute = (request: Request, context: { params: Promise<{ mode: string }> }) => Promise<Response>;
  const call = (route: ModeRoute, path: string, body: string, signature: string) =>
    route(
      new Request(`http://localhost${path}`, { method: "POST", headers: { "stripe-signature": signature }, body }),
      { params: Promise.resolve({ mode: "test" }) },
    );

  const event = (sessionId: string, account: string) =>
    JSON.stringify({
      id: `evt_${sessionId}`,
      object: "event",
      account,
      type: "checkout.session.completed",
      data: { object: { id: sessionId, object: "checkout.session", status: "complete", payment_status: "paid" } },
    });

  it("applies a payment event to the store whose Stripe account it came from", async () => {
    const id = await pendingOrder(`cs_connect_${run}`);
    const body = event(`cs_connect_${run}`, accountId);
    const response = await call(
      connectWebhook,
      "/api/stripe/connect/test",
      body,
      signer.webhooks.generateTestHeaderString({ payload: body, secret }),
    );
    expect(response.status).toBe(200);
    expect((await orderRow(id)).status).toBe("paid");
  });

  it("ignores events from accounts that are not Kaizen stores, and refuses bad signatures", async () => {
    const body = event("cs_elsewhere", "acct_someoneelse");
    const signed = signer.webhooks.generateTestHeaderString({ payload: body, secret });
    expect(await (await call(connectWebhook, "/api/stripe/connect/test", body, signed)).json()).toMatchObject({
      ignored: "not a Kaizen store",
    });
    const forged = signer.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_other" });
    expect((await call(connectWebhook, "/api/stripe/connect/test", body, forged)).status).toBe(400);
    expect(
      (await connectWebhook(new Request("http://localhost/x", { method: "POST", body }), {
        params: Promise.resolve({ mode: "sandbox" }),
      })).status,
    ).toBe(404);
  });

  it("checks account events are signed, and ignores accounts that are not Kaizen stores", async () => {
    const body = JSON.stringify({
      id: "evt_thin_1",
      object: "v2.core.event",
      type: "v2.core.account[requirements].updated",
      created: new Date().toISOString(),
      related_object: { id: "acct_someoneelse", type: "v2.core.account", url: "/v2/core/accounts/acct_someoneelse" },
    });
    const path = "/api/stripe/connect/test/accounts";
    const signed = signer.webhooks.generateTestHeaderString({ payload: body, secret: thinSecret });
    const response = await call(connectAccountsWebhook, path, body, signed);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ignored: "not a Kaizen store" });

    const forged = signer.webhooks.generateTestHeaderString({ payload: body, secret: "whsec_other" });
    expect((await call(connectAccountsWebhook, path, body, forged)).status).toBe(400);
  });
});

describe("downloads (D24)", () => {
  /** The demo lamp, turned into a download with one file, two downloads and a week to use them. */
  beforeAll(async () => {
    await db().execute(sql`
      update commerce.product_variants set delivery = 'digital'
      where store_id = ${storeId}::uuid and sku = 'DEMO-LAMP'
    `);
    await db().execute(sql`
      update commerce.products p set delivery = 'digital', download_limit = 2, download_days = 7
      from commerce.product_variants v
      where v.product_id = p.id and v.store_id = ${storeId}::uuid and v.sku = 'DEMO-LAMP'
    `);
    await db().execute(sql`
      insert into commerce.product_files (store_id, product_id, name, path, size_bytes, content_type)
      select v.store_id, v.product_id, 'Lampe.pdf', ${`${storeId}/lamp/lampe.pdf`}, 1234, 'application/pdf'
      from commerce.product_variants v where v.store_id = ${storeId}::uuid and v.sku = 'DEMO-LAMP'
    `);
  });

  it("needs the shopper's consent before a download is bought", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-LAMP", 1]]));
    expect(result).toEqual({ ok: false, problem: "consent" });
  });

  it("sells a download with no shipping and no stock held, and records the consent", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-LAMP", 1]]), { digital: true });
    if (!result.ok) throw new Error(result.problem);
    expect(result.order).toMatchObject({ ships: false, shippingMinor: 0 });
    expect(result.order.totalMinor).toBe(result.order.lines[0].unitPriceMinor);
    const order = await orderRow(result.order.orderId);
    expect(order.digital_consent_at).not.toBeNull();
    const lines = await db().execute<Row>(sql`
      select delivery, withdrawal_exclusion from commerce.order_lines where order_id = ${result.order.orderId}::uuid
    `);
    expect(lines).toEqual([{ delivery: "digital", withdrawal_exclusion: "digital_content" }]);
    const holds = await db().execute(sql`
      select 1 from commerce.inventory_reservations where order_id = ${result.order.orderId}::uuid
    `);
    expect(holds).toHaveLength(0);
  });

  it("ships the rest of a mixed basket and holds only its stock", async () => {
    const result = await placeOrder(
      { storeId, market: no },
      await cart(no, [["DEMO-LAMP", 1], ["DEMO-TOTE", 1]]),
      { digital: true },
    );
    if (!result.ok) throw new Error(result.problem);
    expect(result.order.ships).toBe(true);
    const holds = await db().execute<Row>(sql`
      select v.sku from commerce.inventory_reservations r
      join commerce.product_variants v on v.id = r.variant_id
      where r.order_id = ${result.order.orderId}::uuid
    `);
    expect(holds.map((h) => h.sku)).toEqual(["DEMO-TOTE"]);
  });

  it("gives a paid order its download links, which stop at the limit", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-LAMP", 1]]), { digital: true });
    if (!result.ok) throw new Error(result.problem);
    const orderId = result.order.orderId;
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency)
      values (${storeId}::uuid, ${orderId}::uuid, 'stripe', ${`cs_dl_${run}`}, ${result.order.totalMinor}, 'NOK')
    `);
    expect(await getOrderDownloads(storeId, orderId)).toEqual([]);

    await applySession(storeId, session(`cs_dl_${run}`, { status: "complete", payment_status: "paid" }));
    const [download] = await getOrderDownloads(storeId, orderId);
    expect(download).toMatchObject({ name: "Lampe.pdf", used: 0, left: 2, gone: false });
    expect(download.token).toMatch(/^[0-9a-f]{64}$/);
    const days = (Date.parse(download.expiresAt!) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);

    expect(await takeDownload(storeId, download.token)).toEqual({
      path: `${storeId}/lamp/lampe.pdf`,
      name: "Lampe.pdf",
    });
    // Two at once for the last download: only one gets it.
    const race = await Promise.all([takeDownload(storeId, download.token), takeDownload(storeId, download.token)]);
    expect(race.filter(Boolean)).toHaveLength(1);
    expect(await getOrderDownloads(storeId, orderId)).toMatchObject([{ used: 2, left: 0, gone: true }]);
    expect(await takeDownload("00000000-0000-4000-8000-000000000000", download.token)).toBeNull();
  });

  it("gives an unpaid order no downloads", async () => {
    const result = await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-LAMP", 1]]), { digital: true });
    if (!result.ok) throw new Error(result.problem);
    const rows = await db().execute(sql`
      select 1 from commerce.order_downloads where order_id = ${result.order.orderId}::uuid
    `);
    expect(rows).toHaveLength(0);
  });
});

describe("buying for a business (B2B)", () => {
  it("needs the company for business-only products, and keeps it on the order", async () => {
    await db().execute(sql`update commerce.stores set audience = 'both' where id = ${storeId}::uuid`);
    await db().execute(sql`
      update commerce.products set audience = 'businesses'
      where store_id = ${storeId}::uuid and id = (select product_id from commerce.product_variants where id = ${await variant("DEMO-TOTE")}::uuid)
    `);
    try {
      const without = await cart(no, [["DEMO-TOTE", 1]]);
      expect(await placeOrder({ storeId, market: no }, without)).toEqual({ ok: false, problem: "company" });

      await db().execute(sql`
        update commerce.carts set company_name = 'Kaizen AS', organisation_number = '923609016' where id = ${without}::uuid
      `);
      const result = await placeOrder({ storeId, market: no }, without);
      if (!result.ok) throw new Error(result.problem);
      expect(result.order.company).toEqual({ name: "Kaizen AS", number: "923609016" });
      expect(await orderRow(result.order.orderId)).toMatchObject({ company_name: "Kaizen AS", organisation_number: "923609016" });

      // Products for everyone need no company, unless the store sells only to businesses.
      expect((await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-MUG-WHITE", 1]]))).ok).toBe(true);
      await db().execute(sql`update commerce.stores set audience = 'businesses' where id = ${storeId}::uuid`);
      expect(await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-MUG-WHITE", 1]]))).toEqual({
        ok: false,
        problem: "company",
      });
    } finally {
      await db().execute(sql`update commerce.stores set audience = 'consumers' where id = ${storeId}::uuid`);
      await db().execute(sql`update commerce.products set audience = 'all' where store_id = ${storeId}::uuid`);
    }
  });
});

describe("VAT per product (D65)", () => {
  it("taxes each line at its product's rate, and shipping at the standard rate", async () => {
    const product = sql`(select product_id from commerce.product_variants where id = ${await variant("DEMO-TOTE")}::uuid)`;
    await db().execute(sql`update commerce.products set vat_category = 'accommodation' where id = ${product}`);
    try {
      const result = await placeOrder({ storeId, market: no }, await cart(no, [["DEMO-TOTE", 1]]));
      if (!result.ok) throw new Error(result.problem);
      // 199,00 at 12 % and 99,00 shipping at 25 %.
      expect(result.order.taxMinor).toBe(2132 + 1980);
      const [line] = await db().execute<Row>(sql`
        select tax_minor::int as tax, tax_rate::float as rate from commerce.order_lines where order_id = ${result.order.orderId}::uuid
      `);
      expect(line).toEqual({ tax: 2132, rate: 0.12 });
    } finally {
      await db().execute(sql`update commerce.products set vat_category = 'standard' where id = ${product}`);
    }
  });
});
