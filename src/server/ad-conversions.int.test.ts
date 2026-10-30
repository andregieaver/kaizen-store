import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { saveAdConnection } = await import("./ad-connections");
const { queueAdConversions, recordAdSignals, sendAdConversions } = await import("./ad-conversions");

/** Server-side conversion events (wave 5 unit I2, D303, `docs/wave-5-marketing.md` 12.3), the platforms stubbed. */

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let storeId: string;
let otherId: string;
let accountId: string;

async function newStore(name: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${name}-${run}@example.com`}, 'Kari', 'Annonser') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Annonser', null) as id`);
  return String(store.id);
}

const cart = async (store: string) =>
  String(
    (
      await db().execute<Row>(sql`
        insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${store}::uuid, 'NO', 'NOK', 'nb-NO', now() + interval '1 day') returning id
      `)
    )[0].id,
  );

/** An order from a cart, paid with a captured payment unless said otherwise. */
async function order(store: string, cartId: string, n: string, o: { paid?: boolean; testMode?: boolean; account?: string } = {}): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, cart_id, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, copied_from)
    values (${store}::uuid, ${`AD-${run}-${n}`}, 'NO', 'NOK', 'nb-NO', ${cartId}::uuid, 'kari@example.com', ${o.paid === false ? "pending_payment" : "paid"}, 19900, 0, 0, 3980, 19900,
      ${JSON.stringify({ phone: "+47 912 34 567" })}::jsonb, '{}'::jsonb, null)
    returning id
  `);
  const id = String(row.id);
  await db().execute(sql`
    insert into commerce.order_lines (store_id, order_id, sku, title, quantity, unit_price_minor, total_minor, tax_minor, tax_rate, tax_code)
    values (${store}::uuid, ${id}::uuid, 'MUG-1', 'Mug', 1, 19900, 19900, 3980, 0.25, 'txcd_99999999')
  `);
  if (o.paid !== false) {
    await db().execute(sql`
      insert into commerce.payments (store_id, order_id, provider, provider_reference, provider_account, amount_minor, kaizen_fee_minor, currency, status, test_mode)
      values (${store}::uuid, ${id}::uuid, ${o.testMode ? "venue" : "stripe"}, ${`cs_${run}_${n}`}, ${o.account ?? null}, 19900, 0, 'NOK', 'captured', ${o.testMode ?? false})
    `);
  }
  return id;
}

const conversions = (orderId: string) =>
  db().execute<Row>(sql`select platform, event, status, answer from commerce.ad_conversions where order_id = ${orderId}::uuid order by platform, event`);

beforeAll(async () => {
  storeId = await newStore("ads");
  otherId = await newStore("ads-other");
  const [account] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid limit 1`);
  accountId = String(account.account_id);
  expect(await saveAdConnection(storeId, accountId, { platform: "meta", accountId: "1234567", token: "EAAB-test-token", dataLevel: "standard", testCode: "", on: true })).toEqual({ ok: true });
  expect(await saveAdConnection(storeId, accountId, { platform: "tiktok", accountId: "C4ABCDEFGHIJ1234567", token: "tt-test-token", dataLevel: "enhanced", testCode: "", on: true })).toEqual({ ok: true });
});

afterAll(async () => {
  for (const id of [storeId, otherId]) {
    await db().execute(sql`delete from commerce.ad_conversions where store_id = ${id}::uuid`);
    await db().execute(sql`delete from commerce.ad_connections where store_id = ${id}::uuid`);
  }
  await db().execute(sql`delete from commerce.stripe_accounts where account_id = ${`acct_ads${run}`}`);
  await closeDb();
});

describe("ad conversions (D303 I2)", () => {
  it("keeps a token encrypted, and refuses a connection without one", async () => {
    const [row] = await db().execute<Row>(sql`select token, token_hint from commerce.ad_connections where store_id = ${storeId}::uuid and platform = 'meta'`);
    expect(String(row.token)).not.toContain("EAAB-test-token");
    expect(String(row.token_hint)).toMatch(/oken$/);
    expect(await saveAdConnection(storeId, accountId, { platform: "pinterest", accountId: "549755813888", token: "", dataLevel: "standard", testCode: "", on: true })).toEqual({ ok: false, problem: "need_token" });
  });

  it("sends a consented order's purchase once per platform with the same event id, and hashes only at the enhanced level", async () => {
    const consented = await cart(storeId);
    expect(await recordAdSignals(storeId, [consented], true, { fbp: "fb.1.1760000000000.1", ttclid: "E.C.P.abcdefghij", email: "x@y.z" })).toBe(1);
    // Another store's cart cannot be written through this store.
    const theirs = await cart(otherId);
    expect(await recordAdSignals(storeId, [theirs], true, { fbp: "fb.1.1760000000000.2" })).toBe(0);
    const id = await order(storeId, consented, "1");
    await queueAdConversions();
    expect((await conversions(id)).map((r) => `${r.platform}:${r.event}`)).toEqual(["meta:begin_checkout", "meta:purchase", "tiktok:begin_checkout", "tiktok:purchase"]);
    const calls: { url: string; body: string }[] = [];
    await sendAdConversions({ deadline: Date.now() + 10_000, fetcher: async (url, init) => (calls.push({ url, body: init.body }), { ok: true, status: 200 }) });
    expect((await conversions(id)).every((r) => r.status === "sent")).toBe(true);
    const purchases = calls.filter((c) => c.body.includes("Purchase") || c.body.includes("CompletePayment"));
    expect(purchases).toHaveLength(2);
    for (const c of purchases) expect(c.body).toContain(id);
    const meta = purchases.find((c) => c.url.includes("graph.facebook.com"))!;
    expect(meta.body).not.toMatch(/"em"|kari@example\.com/);
    const tiktok = purchases.find((c) => c.url.includes("tiktok"))!;
    expect(tiktok.body).toMatch(/"email":"[0-9a-f]{64}"/);
    expect(tiktok.body).not.toContain("kari@example.com");
    // Queued again, nothing new.
    await queueAdConversions();
    expect(await conversions(id)).toHaveLength(4);
  });

  // A copied order (D129) is out by the same condition (`copied_from is null`); the database lets no test make one by hand.
  it("sends nothing for an order without consent, and no purchase for one paid in test mode", async () => {
    const plain = await order(storeId, await cart(storeId), "2");
    const testCart = await cart(storeId);
    await recordAdSignals(storeId, [testCart], true, { fbp: "fb.1.1760000000000.3" });
    const testMode = await order(storeId, testCart, "3", { testMode: true });
    await queueAdConversions();
    expect(await conversions(plain)).toHaveLength(0);
    // Test mode: a checkout started, but no purchase.
    expect((await conversions(testMode)).map((r) => r.event)).toEqual(["begin_checkout", "begin_checkout"]);
    // A Stripe payment's own flag is always false: its mode is its account's, a test account here (found in production, 29 October 2026).
    await db().execute(sql`insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due) values (${storeId}::uuid, 'test', ${`acct_ads${run}`}, 'active', false)`);
    const stripeCart = await cart(storeId);
    await recordAdSignals(storeId, [stripeCart], true, { fbp: "fb.1.1760000000000.4" });
    const onTestAccount = await order(storeId, stripeCart, "4", { account: `acct_ads${run}` });
    await queueAdConversions();
    expect((await conversions(onTestAccount)).map((r) => r.event)).toEqual(["begin_checkout", "begin_checkout"]);
  });

  it("tries a failure again, then keeps it as failed with the platform's answer", async () => {
    const c = await cart(storeId);
    await recordAdSignals(storeId, [c], true, { fbp: "fb.1.1760000000000.5" });
    const id = await order(storeId, c, "5", { paid: false });
    await db().execute(sql`delete from commerce.ad_connections where store_id = ${storeId}::uuid and platform = 'tiktok'`);
    await queueAdConversions();
    for (let i = 0; i < 3; i++) {
      await db().execute(sql`update commerce.ad_conversions set next_at = now() where order_id = ${id}::uuid`);
      await sendAdConversions({ deadline: Date.now() + 5_000, fetcher: async () => ({ ok: false, status: 503 }) });
    }
    expect(await conversions(id)).toMatchObject([{ platform: "meta", event: "begin_checkout", status: "failed", answer: "http_503" }]);
  });

  it("clears the ids when the shopper withdraws marketing", async () => {
    const c = await cart(storeId);
    await recordAdSignals(storeId, [c], true, { fbp: "fb.1.1760000000000.6" });
    await recordAdSignals(storeId, [c], false, {});
    const [row] = await db().execute<Row>(sql`select ad_consent_at, ad_signals from commerce.carts where id = ${c}::uuid`);
    expect(row).toMatchObject({ ad_consent_at: null, ad_signals: null });
  });
});
