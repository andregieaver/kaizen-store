import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { randomToken, sealFikenState } from "@/lib/fiken";
import { parseKey } from "@/lib/secret-box";

process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers() }));
vi.mock("./stripe", () => ({ platformStripe: () => ({}), platformPublishableKey: () => "pk_test_x", platformModes: () => ["test"], WEBHOOK_EVENTS: [] }));

const ebay = await import("./ebay");
const { newStore, variantId, setLevel, clearLevels, levelsOf, mainLocation } = await import("./inventory-test-support");

type Row = Record<string, unknown>;
type Call = { method: string; url: string; body: unknown; headers: Record<string, string> };

/** A stand-in for eBay's token endpoint and Sell APIs, as their OpenAPI documents describe them. */
function fakeEbay() {
  const calls: Call[] = [];
  let refreshWorks = true;
  let orders: unknown[] = [];
  const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === "string" ? (url.includes("oauth2/token") ? Object.fromEntries(new URLSearchParams(init.body)) : JSON.parse(init.body)) : null;
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ method: init?.method ?? "GET", url, body, headers });
    const json = (status: number, value: unknown) => new Response(value === null ? null : JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (url.endsWith("/identity/v1/oauth2/token")) {
      const form = body as Record<string, string>;
      if (form.grant_type === "refresh_token" && !refreshWorks) return json(400, { error: "invalid_grant" });
      return json(200, { access_token: `access-${calls.length}`, expires_in: 7200, refresh_token: form.grant_type === "authorization_code" ? "refresh-1" : undefined });
    }
    if (url.includes("/inventory_item/")) return json(204, null);
    if (url.endsWith("/sell/inventory/v1/offer")) return json(201, { offerId: "offer-1" });
    if (url.includes("/offer/offer-1/publish")) return json(200, { listingId: "listing-1" });
    if (url.includes("/sell/fulfillment/v1/order?")) return json(200, { orders, total: orders.length });
    if (url.includes("/shipping_fulfillment")) return json(201, null);
    return json(404, { errors: [{ message: "Not found in the stand-in." }] });
  }) as typeof fetch;
  return { calls, fetcher, setOrders: (o: unknown[]) => (orders = o), refuseRefresh: () => (refreshWorks = false) };
}

const app = { clientId: "KaizenaF-app-PRD-1234", clientSecret: "PRD-secret-5678", ruName: "Kaizena_Flow-KaizenaF-app-abcdef" };
let store: Awaited<ReturnType<typeof newStore>>;
let fake: ReturnType<typeof fakeEbay>;
let deps: { fetch: typeof fetch; app: typeof app };
let mug = "";

beforeAll(async () => {
  store = await newStore("ebay");
  fake = fakeEbay();
  deps = { fetch: fake.fetcher, app };
  await db().execute(sql`insert into commerce.markets (store_id, code, currency, default_locale, locales, active) values (${store.storeId}::uuid, 'DE', 'EUR', 'en-GB', array['en-GB'], true) on conflict do nothing`);
  mug = await variantId(store.storeId, "DEMO-MUG-WHITE");
  await db().execute(sql`select commerce.set_price(${mug}::uuid, 'DE', 1290)`);
  await clearLevels(store.storeId, "DEMO-MUG-WHITE");
  await setLevel(store.storeId, "DEMO-MUG-WHITE", await mainLocation(store.storeId), 7);
});

afterAll(async () => {
  await closeDb();
});

describe("eBay as a sales channel (D555)", () => {
  it("connects through eBay's consent page, the state checked and the grant kept encrypted", async () => {
    const start = await ebay.startEbayConnect(store.member, deps);
    if (!start.ok) throw new Error(start.problem);
    expect(start.url).toContain("auth.ebay.com/oauth2/authorize");
    expect(start.url).toContain(`redirect_uri=${app.ruName}`);
    const state = new URL(start.url).searchParams.get("state")!;
    expect(await ebay.finishEbayConnect(new URLSearchParams({ state: "wrong", code: "c" }), start.cookie, { ...deps, owner: async () => store.member })).toBe(`/admin/${store.slug}/integrations/ebay?ebay=failed`);
    const back = await ebay.finishEbayConnect(new URLSearchParams({ state, code: "the-code" }), start.cookie, { ...deps, owner: async () => store.member });
    expect(back).toBe(`/admin/${store.slug}/integrations/ebay?ebay=connected`);
    const exchange = fake.calls.find((c) => c.url.endsWith("oauth2/token"))!;
    expect(exchange.headers.Authorization).toBe(`Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`);
    expect(exchange.body).toMatchObject({ grant_type: "authorization_code", code: "the-code", redirect_uri: app.ruName });
    const [row] = await db().execute<Row>(sql`select access_token_encrypted, refresh_token_encrypted from commerce.marketplace_connections where store_id = ${store.storeId}::uuid`);
    expect(String(row.access_token_encrypted)).not.toContain("access-");
    expect(String(row.refresh_token_encrypted)).not.toContain("refresh-1");
    // A cookie for another account is refused.
    const other = sealFikenState(parseKey(process.env.SETTINGS_ENCRYPTION_KEY)!, { state: "s".repeat(64), store: store.slug, account: "5c2c8f0e-3a9d-4c7b-9e21-0d6f1a2b3c4d", verifier: randomToken() });
    expect(await ebay.finishEbayConnect(new URLSearchParams({ state: "s".repeat(64), code: "c" }), other, { ...deps, owner: async () => store.member })).toContain("ebay=failed");
  });

  it("refuses settings that eBay would not take, and keeps good ones", async () => {
    expect(await ebay.saveEbaySettings(store.member, { marketplace: "EBAY_XX" })).toMatchObject({ ok: false });
    const settings = { marketplace: "EBAY_DE", fulfillmentPolicyId: "6196932000", paymentPolicyId: "6196933000", returnPolicyId: "6196934000", merchantLocationKey: "oslo-1", categoryId: "20625" };
    expect(await ebay.saveEbaySettings(store.member, settings)).toEqual({ ok: true });
    expect((await ebay.getEbayConnection(store.storeId))?.settings).toEqual(settings);
  });

  it("lists a chosen variant at the store's euro price with its own stock, and says why another cannot be", async () => {
    const tote = await variantId(store.storeId, "DEMO-TOTE");
    expect(await ebay.chooseForEbay(store.member, [mug, tote], true)).toEqual({ ok: true, changed: 2 });
    expect(await ebay.syncEbayListings(store.storeId, deps)).toEqual({ listed: 1, failed: 1 });
    const item = fake.calls.find((c) => c.method === "PUT" && c.url.includes("/inventory_item/DEMO-MUG-WHITE"))!;
    expect(item.headers["Content-Language"]).toBe("de-DE");
    expect(item.body).toMatchObject({ condition: "NEW", availability: { shipToLocationAvailability: { quantity: 7 } } });
    const offer = fake.calls.find((c) => c.method === "POST" && c.url.endsWith("/sell/inventory/v1/offer"))!;
    expect(offer.body).toMatchObject({ sku: "DEMO-MUG-WHITE", marketplaceId: "EBAY_DE", format: "FIXED_PRICE", categoryId: "20625", pricingSummary: { price: { value: "12.90", currency: "EUR" } }, listingPolicies: { fulfillmentPolicyId: "6196932000" } });
    const listings = await db().execute<Row>(sql`select variant_id, state, listing_id, error from commerce.marketplace_listings where store_id = ${store.storeId}::uuid order by state`);
    expect(listings.find((l) => l.variant_id === mug)).toMatchObject({ state: "listed", listing_id: "listing-1" });
    expect(String(listings.find((l) => l.variant_id === tote)?.error)).toContain("no price in EUR");
  });

  it("brings eBay's orders here once, drawing the store's own stock, and sends their tracking back", async () => {
    fake.setOrders([
      {
        orderId: "12-34567-89012",
        creationDate: "2026-11-11T09:00:00.000Z",
        orderFulfillmentStatus: "NOT_STARTED",
        pricingSummary: { total: { value: "30.70", currency: "EUR" } },
        buyer: { username: "kaeufer1" },
        fulfillmentStartInstructions: [{ shippingStep: { shipTo: { fullName: "Max Mustermann", contactAddress: { addressLine1: "Hauptstr. 1", city: "Berlin", postalCode: "10115", countryCode: "DE" } } } }],
        lineItems: [{ lineItemId: "1000", sku: "DEMO-MUG-WHITE", title: "Becher", quantity: 2, total: { value: "25.80", currency: "EUR" } }],
      },
    ]);
    expect(await ebay.importEbayOrders(store.storeId, deps)).toBe(1);
    expect(await ebay.importEbayOrders(store.storeId, deps)).toBe(0);
    const filter = new URL(fake.calls.filter((c) => c.url.includes("/order?")).at(-1)!.url).searchParams.get("filter")!;
    expect(filter).toContain("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");
    const ownName = String((await db().execute<Row>(sql`select name from commerce.inventory_locations where id = ${await mainLocation(store.storeId)}::uuid`))[0].name);
    expect((await levelsOf(store.storeId, "DEMO-MUG-WHITE"))[ownName]).toBe(5);
    const [order] = await ebay.listMarketplaceOrders(store.storeId);
    expect(order).toMatchObject({ externalId: "12-34567-89012", totalMinor: 3070, currency: "EUR", buyerName: "Max Mustermann", state: "open", shipTo: { city: "Berlin", country: "DE" } });
    expect(await ebay.markEbayOrderSent(store.member, order.id, "DHL", "!", deps)).toMatchObject({ ok: false });
    expect(await ebay.markEbayOrderSent(store.member, order.id, "DHL", "JJD0001234567", deps)).toEqual({ ok: true });
    const posted = fake.calls.find((c) => c.url.includes("/order/12-34567-89012/shipping_fulfillment"))!;
    expect(posted.body).toMatchObject({ lineItems: [{ lineItemId: "1000", quantity: 2 }], shippingCarrierCode: "DHL", trackingNumber: "JJD0001234567" });
    expect(await ebay.markEbayOrderSent(store.member, order.id, "DHL", "JJD0001234567", deps)).toMatchObject({ ok: false });
  });

  it("is the owner's alone, and asks to be connected again when eBay no longer takes the grant", async () => {
    expect(await ebay.saveEbaySettings({ ...store.member, role: "admin", permissions: ["settings:write"] } as never, {})).toMatchObject({ ok: false });
    await db().execute(sql`update commerce.marketplace_connections set access_expires_at = now() - interval '1 minute' where store_id = ${store.storeId}::uuid`);
    fake.refuseRefresh();
    expect(await ebay.importEbayOrders(store.storeId, deps)).toBe(0);
    expect((await ebay.getEbayConnection(store.storeId))?.state).toBe("refused");
  });
});
