import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";
import {
  VIES_LIMIT_OWNER_PER_HOUR,
  VIES_LIMIT_PER_CART_PER_HOUR,
  VIES_LIMIT_PER_CLIENT_PER_HOUR,
  VIES_LIMIT_PER_STORE_PER_HOUR,
  VIES_RESERVE_FOR_REFRESH_PER_HOUR,
} from "@/lib/vies";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));
process.env.SETTINGS_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");

const { checkCartVatNumber, checkSellerNumber, pruneVatChecks, refreshStaleCartCheck, viesClientKey } = await import("./vat-checks");

const run = Date.now().toString(36);
let storeId: string;
let cartId: string;
const de = toMarket({ code: "DE", currency: "EUR", defaultLocale: "de-DE" });

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`sec-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${`sec-${run}`}, 'Test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${storeId}::uuid, code, currency, default_locale, locales, true from commerce.countries where code = 'DE'
    on conflict do nothing
  `);
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'DE', 'EUR', 'de-DE', now() + interval '1 day') returning id
  `);
  cartId = String(cart.id);
});

afterAll(async () => {
  await closeDb();
});

/** The hour's counts are the limits' state: each scenario starts from none. */
afterEach(async () => {
  await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid and bucket like 'vies:%'`);
});

const countFor = async (bucket: string) => {
  const [row] = await db().execute<Row>(sql`select coalesce(sum(count), 0)::int as n from commerce.chat_usage where store_id = ${storeId}::uuid and bucket = ${bucket}`);
  return Number(row.n);
};
const newCart = async () => {
  const [cart] = await db().execute<Row>(sql`
    insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'DE', 'EUR', 'de-DE', now() + interval '1 day') returning id
  `);
  return String(cart.id);
};
const okVies = (counter: { calls: number }, delay = 0) =>
  (async () => {
    counter.calls++;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return new Response(JSON.stringify({ valid: true, name: "X", address: "Y" }), { status: 200 });
  }) as unknown as typeof fetch;
let serial = 0;
const unique = () => `DE8${String(Date.now() % 10_000_000).padStart(7, "0")}${String(++serial % 10)}`.slice(0, 11);

describe("the VIES rate limit", () => {
  it("holds against concurrent requests: no more live VIES calls than the cart's hourly limit", async () => {
    let calls = 0;
    const slowVies = (async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 150));
      return new Response(JSON.stringify({ valid: true, name: "X", address: "Y" }), { status: 200 });
    }) as unknown as typeof fetch;
    const numbers = Array.from({ length: 40 }, (_, i) => `DE9${String(i).padStart(8, "0")}`);
    await Promise.all(numbers.map((n) => checkCartVatNumber({ storeId, market: de }, cartId, n, { fetch: slowVies })));
    // The count is read before the call and the row is written after it, so every one of the 40 saw "0 used".
    expect(calls).toBeLessThanOrEqual(VIES_LIMIT_PER_CART_PER_HOUR);
  });
});

describe("who can use up the VIES budget", () => {
  it("one client cannot reach the store's limit by opening carts: its own limit comes first, and what it was refused cost the store nothing", async () => {
    const counter = { calls: 0 };
    const fetchStub = okVies(counter);
    const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
    const clientKey = viesClientKey(storeId, headers);
    expect(clientKey).toMatch(/^[0-9a-f]{24}$/);
    const carts = [await newCart(), await newCart(), await newCart()];
    const outcomes: string[] = [];
    for (let i = 0; i < VIES_LIMIT_PER_CLIENT_PER_HOUR + 5; i++) {
      const result = await checkCartVatNumber({ storeId, market: de }, carts[i % 3], `DE70${String(i).padStart(7, "0")}`, { fetch: fetchStub, clientKey });
      outcomes.push(result.ok ? result.outcome : result.problem);
    }
    expect(counter.calls).toBe(VIES_LIMIT_PER_CLIENT_PER_HOUR);
    expect(outcomes.slice(0, VIES_LIMIT_PER_CLIENT_PER_HOUR).every((o) => o === "valid")).toBe(true);
    expect(outcomes.slice(VIES_LIMIT_PER_CLIENT_PER_HOUR).every((o) => o === "unavailable")).toBe(true);
    // The store's shoppers' count is what was asked, not what was refused.
    expect(await countFor("vies:s")).toBe(VIES_LIMIT_PER_CLIENT_PER_HOUR);
  });

  it("another client is not held up by that one", async () => {
    const counter = { calls: 0 };
    const fetchStub = okVies(counter);
    const a = viesClientKey(storeId, new Headers({ "x-forwarded-for": "203.0.113.20" }));
    const b = viesClientKey(storeId, new Headers({ "x-forwarded-for": "203.0.113.21" }));
    expect(a).not.toBe(b);
    for (let i = 0; i < VIES_LIMIT_PER_CLIENT_PER_HOUR + 1; i++) {
      await checkCartVatNumber({ storeId, market: de }, await newCart(), `DE71${String(i).padStart(7, "0")}`, { fetch: fetchStub, clientKey: a });
    }
    const before = counter.calls;
    const result = await checkCartVatNumber({ storeId, market: de }, await newCart(), unique(), { fetch: fetchStub, clientKey: b });
    expect(result).toMatchObject({ ok: true, outcome: "valid" });
    expect(counter.calls).toBe(before + 1);
  });

  it("holds the store's limit against parallel requests from many carts", async () => {
    const counter = { calls: 0 };
    const fetchStub = okVies(counter, 40);
    const carts = await Promise.all(Array.from({ length: 8 }, () => newCart()));
    const jobs: Promise<unknown>[] = [];
    for (const [c, cart] of carts.entries()) {
      for (let i = 0; i < VIES_LIMIT_PER_CART_PER_HOUR; i++) {
        jobs.push(checkCartVatNumber({ storeId, market: de }, cart, `DE72${String(c * 10 + i).padStart(7, "0")}`, { fetch: fetchStub }));
      }
    }
    await Promise.all(jobs);
    // 80 asked, in parallel, over eight carts each within its own limit: the store's count caps them.
    expect(counter.calls).toBe(VIES_LIMIT_PER_STORE_PER_HOUR);
  });

  it("keeps the owner's own checks apart: shoppers using up the store's limit does not stop the owner's Check now", async () => {
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, 'vies:s', date_trunc('hour', now()), ${VIES_LIMIT_PER_STORE_PER_HOUR + 40})
    `);
    const counter = { calls: 0 };
    const check = await checkSellerNumber(storeId, "SE556677889901", { fetch: okVies(counter) });
    expect(check).toMatchObject({ status: "valid", purpose: "seller" });
    expect(counter.calls).toBe(1);
  });

  it("limits the owner's own checks too, in a count of their own, and says so as the limit", async () => {
    const counter = { calls: 0 };
    for (let i = 0; i < VIES_LIMIT_OWNER_PER_HOUR; i++) await checkSellerNumber(storeId, "SE556677889901", { fetch: okVies(counter) });
    expect(counter.calls).toBe(VIES_LIMIT_OWNER_PER_HOUR);
    const over = await checkSellerNumber(storeId, "SE556677889901", { fetch: okVies(counter) });
    expect(over).toMatchObject({ status: "unavailable", error: "limit" });
    expect(counter.calls).toBe(VIES_LIMIT_OWNER_PER_HOUR);
  });

  it("keeps a reserve for a cart that already holds a valid answer and asks again, past the shoppers' limit", async () => {
    const counter = { calls: 0 };
    const fetchStub = okVies(counter);
    const cart = await newCart();
    const number = unique();
    // A valid answer from 30 hours ago: stale.
    const [old] = await db().execute<Row>(sql`
      insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, requested_at)
      values (${storeId}::uuid, 'buyer', ${cart}::uuid, ${number}, 'DE', 'valid', 'vies', now() - interval '30 hours') returning id
    `);
    await db().execute(sql`
      update commerce.carts set vat_number = ${number}, vat_check_id = ${String(old.id)}::uuid, company_name = 'X', organisation_number = '1' where id = ${cart}::uuid
    `);
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count)
      values (${storeId}::uuid, 'vies:s', date_trunc('hour', now()), ${VIES_LIMIT_PER_STORE_PER_HOUR})
    `);
    // A new shopper's first check is refused at the limit ...
    expect(await checkCartVatNumber({ storeId, market: de }, await newCart(), unique(), { fetch: fetchStub })).toMatchObject({ outcome: "unavailable" });
    expect(counter.calls).toBe(0);
    // ... the stale one is asked again from the reserve.
    await refreshStaleCartCheck({ storeId, market: de }, cart, { fetch: fetchStub });
    expect(counter.calls).toBe(1);
    expect(VIES_RESERVE_FOR_REFRESH_PER_HOUR).toBeGreaterThan(0);
  });

  it("makes a client key of the address without keeping it, and none without an address", () => {
    expect(viesClientKey(storeId, new Headers())).toBeNull();
    const a = viesClientKey(storeId, new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" }));
    expect(a).toBe(viesClientKey(storeId, new Headers({ "x-forwarded-for": "198.51.100.7" })));
    expect(a).not.toContain("198");
    expect(viesClientKey(storeId, new Headers({ "x-forwarded-for": "198.51.100.7" }), new Date(Date.now() + 2 * 86_400_000))).not.toBe(a);
    expect(viesClientKey("00000000-0000-4000-8000-000000000001", new Headers({ "x-forwarded-for": "198.51.100.7" }))).not.toBe(a);
  });
});

describe("retention of a buyer's VAT number check", () => {
  it("forgets a check older than 30 days when the only thing pointing at it is an expired, abandoned cart", async () => {
    const [cart] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
      values (${storeId}::uuid, 'DE', 'EUR', 'de-DE', now() - interval '60 days') returning id
    `);
    const [check] = await db().execute<Row>(sql`
      insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, name, address, requested_at)
      values (${storeId}::uuid, 'buyer', ${String(cart.id)}::uuid, 'DE777000111', 'DE', 'valid', 'vies', 'SOLE TRADER NAME', 'HOME ADDRESS 1', now() - interval '90 days')
      returning id
    `);
    await db().execute(sql`
      update commerce.carts set vat_number = 'DE777000111', vat_check_id = ${String(check.id)}::uuid, company_name = 'X', organisation_number = '1'
      where id = ${String(cart.id)}::uuid
    `);
    await pruneVatChecks();
    const left = await db().execute<Row>(sql`select 1 from commerce.vat_checks where id = ${String(check.id)}::uuid`);
    // Nothing deletes carts anywhere, so "a cart points at it" is true for ever: the name and address VIES gave live on.
    expect(left).toHaveLength(0);
  });
  it("lets a closed cart go of the number it held, and keeps what a live cart or an order rests on", async () => {
    const make = async (cart: { expires: string; status?: string; updated?: string }, age: string) => {
      const [c] = await db().execute<Row>(sql`
        insert into commerce.carts (store_id, market_code, currency, locale, expires_at, status, updated_at)
        values (${storeId}::uuid, 'DE', 'EUR', 'de-DE', ${cart.expires}::timestamptz, ${cart.status ?? "open"}, ${cart.updated ?? "now()"}::timestamptz) returning id
      `);
      const [k] = await db().execute<Row>(sql`
        insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, name, address, requested_at)
        values (${storeId}::uuid, 'buyer', ${String(c.id)}::uuid, 'DE999000111', 'DE', 'valid', 'vies', 'NAME', 'ADDRESS', ${age}::timestamptz) returning id
      `);
      await db().execute(sql`update commerce.carts set vat_number = 'DE999000111', vat_check_id = ${String(k.id)}::uuid where id = ${String(c.id)}::uuid`);
      return { cart: String(c.id), check: String(k.id) };
    };
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
    const live = await make({ expires: new Date(Date.now() + 86_400_000).toISOString() }, day(90));
    const recentlyExpired = await make({ expires: day(5) }, day(90));
    const converted = await make({ expires: day(100), status: "converted", updated: day(60) }, day(90));
    const convertedRecently = await make({ expires: day(100), status: "converted", updated: day(2) }, day(90));
    const result = await pruneVatChecks();
    const exists = async (id: string) => (await db().execute<Row>(sql`select 1 from commerce.vat_checks where id = ${id}::uuid`)).length === 1;
    const cartKeeps = async (id: string) => {
      const [row] = await db().execute<Row>(sql`select vat_number, vat_check_id from commerce.carts where id = ${id}::uuid`);
      return row.vat_number !== null || row.vat_check_id !== null;
    };
    // A live cart keeps what it holds; so does one that expired a few days ago (the job lets go after 30 days, and the foreign key would refuse earlier).
    expect([await exists(live.check), await cartKeeps(live.cart)]).toEqual([true, true]);
    expect([await exists(recentlyExpired.check), await cartKeeps(recentlyExpired.cart)]).toEqual([true, true]);
    expect([await exists(convertedRecently.check), await cartKeeps(convertedRecently.cart)]).toEqual([true, true]);
    // A converted cart over 30 days: the cart lets go, then the check, which no order rests on, goes.
    expect([await exists(converted.check), await cartKeeps(converted.cart)]).toEqual([false, false]);
    expect(result.cartsCleared).toBeGreaterThanOrEqual(1);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    // Stale test data does not stay in the way of the other tests.
    await db().execute(sql`update commerce.carts set vat_number = null, vat_check_id = null where id in (${live.cart}::uuid, ${recentlyExpired.cart}::uuid, ${convertedRecently.cart}::uuid)`);
  });

  it("is not stopped by one check a cart still points at: the others are still forgotten", async () => {
    const [stuck] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at) values (${storeId}::uuid, 'DE', 'EUR', 'de-DE', now() - interval '2 days') returning id
    `);
    const [heldCheck] = await db().execute<Row>(sql`
      insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, requested_at)
      values (${storeId}::uuid, 'buyer', ${String(stuck.id)}::uuid, 'DE999000222', 'DE', 'valid', 'vies', now() - interval '90 days') returning id
    `);
    await db().execute(sql`update commerce.carts set vat_check_id = ${String(heldCheck.id)}::uuid where id = ${String(stuck.id)}::uuid`);
    const [loose] = await db().execute<Row>(sql`
      insert into commerce.vat_checks (store_id, purpose, cart_id, number, country_prefix, status, source, requested_at)
      values (${storeId}::uuid, 'buyer', null, 'DE999000333', 'DE', 'valid', 'vies', now() - interval '90 days') returning id
    `);
    await pruneVatChecks();
    expect((await db().execute<Row>(sql`select 1 from commerce.vat_checks where id = ${String(loose.id)}::uuid`)).length).toBe(0);
    expect((await db().execute<Row>(sql`select 1 from commerce.vat_checks where id = ${String(heldCheck.id)}::uuid`)).length).toBe(1);
    await db().execute(sql`update commerce.carts set vat_check_id = null where id = ${String(stuck.id)}::uuid`);
  });
});
