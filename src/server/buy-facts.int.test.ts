import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

/**
 * Buy facts (bloat review step 2.13): the one cached read of what only an owner sets about buying agrees with each reader it replaces,
 * and each fact changes after its table is written (next/cache is mocked here, so every call reads again).
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

vi.mock("./stripe-keys", () => ({ platformModes: () => ["test"], platformPublishableKey: () => "pk_test_buy", platformSecretKey: () => "sk_test_x" }));

const { getCheckoutUi } = await import("./connect");
const { getCheckoutInfo } = await import("./orders");
const { getCheckoutAccount } = await import("./settings");
const { listCheckoutFields } = await import("./checkout-rules");
const { quoteMode } = await import("./quote-requests");
const { backInStockOn } = await import("./stock-requests");
const { saveMethodChoices } = await import("./payment-methods");
const { buyFacts, paymentsOnOf, providerOf } = await import("./buy-facts");

const run = Date.now().toString(36);
const slug = `buyfacts-${run}`;
let storeId: string;

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [made] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  storeId = String(made.id);
  await db().execute(sql`
    insert into commerce.stripe_accounts (store_id, mode, account_id, card_payments, requirements_due)
    values (${storeId}::uuid, 'test', ${`acct_buy${run}`}, 'active', false)
  `);
  await db().execute(sql`update commerce.payment_providers set enabled = true, active_mode = 'test' where store_id = ${storeId}::uuid`);
}, 120_000);

afterAll(async () => {
  await closeDb();
});

/** Every fact the old readers can answer, from the old readers. */
async function oldReaders() {
  const info = await getCheckoutInfo(storeId, "NO");
  return {
    checkoutUi: await getCheckoutUi(),
    paymentsOn: info.paymentsOn,
    provider: info.provider,
    accountId: (await getCheckoutAccount(storeId))?.accountId ?? null,
    checkoutFields: (await listCheckoutFields(db(), storeId, { onlyOn: true })).length > 0,
    quoteMode: await quoteMode(storeId),
    backInStock: await backInStockOn(storeId),
  };
}

async function agrees() {
  const facts = await buyFacts(storeId, "NO");
  const old = await oldReaders();
  expect(facts.checkoutUi).toBe(old.checkoutUi);
  expect(paymentsOnOf(facts)).toBe(old.paymentsOn);
  expect(providerOf(facts)).toBe(old.provider);
  expect(facts.accountId).toBe(old.accountId);
  expect(facts.checkoutFields).toBe(old.checkoutFields);
  expect(facts.quoteMode).toBe(old.quoteMode);
  expect(facts.backInStock).toBe(old.backInStock);
  return facts;
}

describe("buyFacts()", () => {
  it("agrees with the readers it replaces", async () => {
    const facts = await agrees();
    expect(facts).toMatchObject({
      checkoutUi: "custom",
      paymentsRow: true,
      activeMode: "test",
      onMollie: false,
      starter: false,
      accountId: `acct_buy${run}`,
      klarnaOff: false,
      klarnaActive: false,
      checkoutFields: false,
      quoteMode: "off",
      backInStock: false,
      hasBreaks: false,
      hasSchemes: false,
    });
    expect(paymentsOnOf(facts)).toBe(true);
    expect(providerOf(facts)).toBe("stripe");
  });

  it("has Klarna active only when Stripe says so", async () => {
    await db().execute(sql`
      update commerce.stripe_accounts set method_states = '{"card_payments":{"status":"active"},"klarna_payments":{"status":"active"}}'::jsonb
      where store_id = ${storeId}::uuid and mode = 'test'
    `);
    expect((await agrees()).klarnaActive).toBe(true);
  });

  it("changes after Klarna is switched off for the country", async () => {
    const [owner] = await db().execute<Row>(sql`select account_id from commerce.store_members where store_id = ${storeId}::uuid and role = 'owner' limit 1`);
    await saveMethodChoices(storeId, String(owner.account_id), { markets: ["NO"], on: new Set() });
    expect((await agrees()).klarnaOff).toBe(true);
  });

  it("changes after payments are switched off", async () => {
    await db().execute(sql`update commerce.payment_providers set enabled = false where store_id = ${storeId}::uuid`);
    const facts = await agrees();
    expect(facts.paymentsRow).toBe(false);
    expect(facts.accountId).toBeNull();
    expect(paymentsOnOf(facts)).toBe(false);
    await db().execute(sql`update commerce.payment_providers set enabled = true where store_id = ${storeId}::uuid`);
    expect(paymentsOnOf(await agrees())).toBe(true);
  });

  it("changes after an enabled checkout field is added", async () => {
    await db().execute(sql`
      insert into commerce.checkout_fields (store_id, kind, label, enabled) values (${storeId}::uuid, 'text', '{"en":"Ref"}'::jsonb, true)
    `);
    expect((await agrees()).checkoutFields).toBe(true);
  });

  it("changes after the quote mode is set", async () => {
    await db().execute(sql`
      insert into commerce.order_settings (store_id, quote_requests) values (${storeId}::uuid, 'everyone')
      on conflict (store_id) do update set quote_requests = 'everyone'
    `);
    expect((await agrees()).quoteMode).toBe("everyone");
  });

  it("changes after back in stock is enabled", async () => {
    await db().execute(sql`
      insert into commerce.automations (store_id, kind, enabled, enabled_at) values (${storeId}::uuid, 'back_in_stock', true, now())
      on conflict (store_id, kind) do update set enabled = true, enabled_at = now()
    `);
    expect((await agrees()).backInStock).toBe(true);
  });

  it("changes after a price break and after a producer scheme", async () => {
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid order by created_at limit 1`);
    const productId = String(product.id);
    expect((await agrees()).hasBreaks).toBe(false);
    await db().execute(sql`
      insert into commerce.price_breaks (store_id, product_id, from_quantity, percent) values (${storeId}::uuid, ${productId}::uuid, 10, 5)
    `);
    expect((await agrees()).hasBreaks).toBe(true);
    expect((await agrees()).hasSchemes).toBe(false);
    await db().execute(sql`
      insert into commerce.product_schemes (store_id, product_id, scheme) values (${storeId}::uuid, ${productId}::uuid, 'packaging')
    `);
    expect((await agrees()).hasSchemes).toBe(true);
  });
});
