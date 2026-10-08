import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

type Row = Record<string, unknown>;

process.env.SETTINGS_ENCRYPTION_KEY = randomBytes(32).toString("base64");

let requestHeaders = new Headers();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} }),
}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));

const { recordVisit, attachVisitToCart, pruneVisits } = await import("./analytics-visits");
const { NEW_VISITS_PER_ADDRESS_WINDOW, NEW_VISITS_PER_STORE_DAY } = await import("@/lib/visit-record");
const { POST } = await import("@/app/api/visit/route");
const route = await import("@/app/api/visit/route");

/**
 * Cookieless visit counting (D152): what a page view becomes, what is dropped, and that nothing identifying is kept.
 */

const run = Date.now().toString(36);
const slug = `visits-${run}`;
let storeId: string;
let market: string;
const IP = "203.0.113.77";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
const DESKTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
// 23:30 in Oslo on 2 October (UTC+2), and 00:30 on the 3rd: the hash's UTC day and the store's day differ for the second.
const EVENING = new Date("2026-10-02T21:30:00Z");
const PAST_MIDNIGHT = new Date("2026-10-02T22:30:00Z");

// A request from one of the store's own pages: the endpoint ties the store in the body to the page it came from.
const asRequest = (extra: Record<string, string> = {}, ua = UA, ip = IP) =>
  new Headers({
    "user-agent": ua,
    "x-forwarded-for": `${ip}, 10.0.0.1`,
    host: "localhost:3000",
    origin: "http://localhost:3000",
    referer: `http://localhost:3000/s/${slug}/no/cart`,
    ...extra,
  });

const view = (path: string, extra: Record<string, unknown> = {}) => ({ store: slug, path, ...extra });
const page = (suffix = "") => `/s/${slug}/${market.toLowerCase()}${suffix}`;

async function visits() {
  return db().execute<Row>(sql`select * from commerce.visits where store_id = ${storeId}::uuid order by first_seen, id`);
}

const setCounting = (on: boolean) => db().execute(sql`update commerce.stores set visit_counting = ${on} where id = ${storeId}::uuid`);

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id`);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Visit test', null) as id`);
  storeId = String(created.id);
  await db().execute(sql`update commerce.stores set time_zone = 'Europe/Oslo' where id = ${storeId}::uuid`);
  const [m] = await db().execute<Row>(sql`select market_code from commerce.store_markets where store_id = ${storeId}::uuid limit 1`).catch(() => [undefined]);
  market = String(m?.market_code ?? "NO");
});

beforeEach(async () => {
  await db().execute(sql`delete from commerce.product_views where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.visits where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid`);
  await setCounting(true);
  requestHeaders = asRequest();
});

afterAll(async () => {
  await closeDb();
});

describe("recording a page view", () => {
  it("writes nothing while the store has visit counting off", async () => {
    await setCounting(false);
    expect(await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "off" });
    expect(await visits()).toHaveLength(0);
  });

  it("makes one row for the visitor's first page view of the day, with its channel decided from that view", async () => {
    const outcome = await recordVisit({
      headers: asRequest(),
      body: view(page("/p/demo-mug"), { referrer: "www.google.com", utm_medium: "cpc", utm_campaign: "Spring" }),
      now: EVENING,
    });
    expect(outcome).toEqual({ recorded: true });
    const [row, ...more] = await visits();
    expect(more).toHaveLength(0);
    expect(row).toMatchObject({
      market_code: market,
      device: "mobile",
      channel: "paid_search",
      source: "google",
      campaign: "spring",
      landing_path: `/${market.toLowerCase()}/p/demo-mug`,
      page_views: 1,
    });
    expect(String(row.day).slice(0, 10)).toBe("2026-10-02");
    expect(String(row.visitor)).toMatch(/^[0-9a-f]{24}$/);
  });

  it("adds a later page view to the same row and keeps what the first one decided", async () => {
    await recordVisit({ headers: asRequest(), body: view(page(), { utm_source: "newsletter", utm_medium: "email" }), now: EVENING });
    await recordVisit({ headers: asRequest(), body: view(page("/cart"), { referrer: "www.facebook.com" }), now: new Date(EVENING.getTime() + 60_000) });
    const rows = await visits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ page_views: 2, channel: "email", source: "newsletter", landing_path: `/${market.toLowerCase()}` });
    expect(new Date(String(rows[0].last_seen)).getTime()).toBe(EVENING.getTime() + 60_000);
  });

  it("counts a visit from the store's own host as direct", async () => {
    await recordVisit({
      headers: asRequest({ host: "shop.example", origin: "http://shop.example", referer: `http://shop.example/s/${slug}/no` }),
      body: view(page(), { referrer: "shop.example" }),
      now: EVENING,
    });
    expect((await visits())[0].channel).toBe("direct");
  });

  it("counts product pages on the visit and per product and day, and ignores a handle that is no product", async () => {
    const [product] = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid order by handle limit 1`);
    const handle = String(product.handle);
    await recordVisit({ headers: asRequest(), body: view(page(`/p/${handle}`)), now: EVENING });
    await recordVisit({ headers: asRequest(), body: view(page(`/p/${handle}`)), now: EVENING });
    await recordVisit({ headers: asRequest(), body: view(page("/p/no-such-product")), now: EVENING });
    await recordVisit({ headers: asRequest(), body: view(page("/cart")), now: EVENING });
    const [row] = await visits();
    expect(row).toMatchObject({ page_views: 4, product_views: 2 });
    const counters = await db().execute<Row>(sql`select * from commerce.product_views where store_id = ${storeId}::uuid`);
    expect(counters).toHaveLength(1);
    expect(counters[0]).toMatchObject({ product_id: String(product.id), views: 2 });
    expect(String(counters[0].day).slice(0, 10)).toBe("2026-10-02");
    // A counter holds no visitor.
    expect(Object.keys(counters[0]).sort()).toEqual(["day", "product_id", "store_id", "views"]);
  });

  it("notes the first time checkout was reached and keeps that time", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    expect((await visits())[0].checkout_at).toBeNull();
    await recordVisit({ headers: asRequest(), body: view(page("/checkout")), now: new Date(EVENING.getTime() + 60_000) });
    await recordVisit({ headers: asRequest(), body: view(page("/checkout")), now: new Date(EVENING.getTime() + 120_000) });
    const [row] = await visits();
    expect(row.page_views).toBe(3);
    expect(new Date(String(row.checkout_at)).getTime()).toBe(EVENING.getTime() + 60_000);
  });

  it("makes another row for another visitor and for the same one on another day, and the two cannot be linked", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    await recordVisit({ headers: asRequest({}, DESKTOP), body: view(page()), now: EVENING });
    await recordVisit({ headers: asRequest(), body: view(page()), now: new Date("2026-10-03T10:00:00Z") });
    const rows = await visits();
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.visitor)).size).toBe(3);
    expect(rows.map((r) => String(r.device)).sort()).toEqual(["desktop", "mobile", "mobile"]);
  });

  it("dates the row by the store's day", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: PAST_MIDNIGHT });
    expect(String((await visits())[0].day).slice(0, 10)).toBe("2026-10-03");
  });

  it("makes one row for a visitor either side of UTC midnight within one store day, and two for two store days", async () => {
    // Store day 3 October in Oslo (UTC+2) runs from 22:00Z on the 2nd to 22:00Z on the 3rd: UTC midnight falls inside it.
    await recordVisit({ headers: asRequest(), body: view(page()), now: PAST_MIDNIGHT });
    await recordVisit({ headers: asRequest(), body: view(page("/cart")), now: new Date("2026-10-03T08:00:00Z") });
    const rows = await visits();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ page_views: 2 });
    expect(String(rows[0].day).slice(0, 10)).toBe("2026-10-03");
    // Just before the store's midnight is the day before: another day, another id.
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    const both = await visits();
    expect(both).toHaveLength(2);
    expect(new Set(both.map((r) => r.visitor)).size).toBe(2);
  });

  it("drops robots, Global Privacy Control and Do Not Track, and writes nothing for them", async () => {
    expect(await recordVisit({ headers: asRequest({}, "Googlebot/2.1 (+http://www.google.com/bot.html)"), body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "bot" });
    expect(await recordVisit({ headers: new Headers({ "x-forwarded-for": IP }), body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "bot" });
    expect(await recordVisit({ headers: asRequest({ "sec-gpc": "1" }), body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "privacy" });
    expect(await recordVisit({ headers: asRequest({ dnt: "1" }), body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "privacy" });
    expect(await visits()).toHaveLength(0);
  });

  it("drops a body that is wrong, a store that is not there and a page that is not the store's", async () => {
    expect(await recordVisit({ headers: asRequest(), body: { store: slug }, now: EVENING })).toEqual({ recorded: false, reason: "invalid" });
    expect(await recordVisit({ headers: asRequest(), body: "text", now: EVENING })).toEqual({ recorded: false, reason: "invalid" });
    expect(await recordVisit({ headers: asRequest(), body: { store: "no-such-store", path: "/s/no-such-store/no" }, now: EVENING })).toEqual({ recorded: false, reason: "unknown_store" });
    expect(await recordVisit({ headers: asRequest(), body: view("/admin/anything"), now: EVENING })).toEqual({ recorded: false, reason: "unknown_page" });
    expect(await recordVisit({ headers: asRequest(), body: view(`/s/another-store/${market.toLowerCase()}/cart`), now: EVENING })).toEqual({ recorded: false, reason: "unknown_page" });
    expect(await visits()).toHaveLength(0);
  });

  it("stores only a safe landing path: no token, no order id, no query, whatever the page was", async () => {
    const m = market.toLowerCase();
    const secret = "AbCdEf0123456789secrettoken";
    const orderId = "0b3c9a42-6d0e-4b7e-9c35-2f4d9c6a7e11";
    const cases: [string, string][] = [
      [page(`/account/sign-in/${secret}`), "(other)"],
      [page(`/account/invoice/${secret}`), "(other)"],
      [page(`/account/company/invite/${secret}`), "(other)"],
      [page(`/order/${orderId}`), "(other)"],
      [page(`/account/orders/${orderId}`), "(other)"],
      [page(`/unsubscribe/${secret}`), "(other)"],
      [page(`/subscription/${secret}`), "(other)"],
      [page(`/download/${secret}`), "(other)"],
      [page(`/cart/restore/${secret}`), "(other)"],
      [page("/account"), "(other)"],
      [page("/cart"), `/${m}/cart`],
      [page("/checkout"), `/${m}/checkout`],
      [page("/search"), `/${m}/search`],
      [page("/blog/our-story"), `/${m}/blog/our-story`],
      [page("/category/mugs"), `/${m}/category/mugs`],
      // A store that sells in one country has no country chooser: its front door is its own country's front page (D181).
      [`/s/${slug}`, `/${m}`],
    ];
    for (const [path, expected] of cases) {
      await db().execute(sql`delete from commerce.visits where store_id = ${storeId}::uuid`);
      expect(await recordVisit({ headers: asRequest(), body: view(path), now: EVENING }), path).toEqual({ recorded: true });
      const [row] = await visits();
      expect(row.landing_path, path).toBe(expected);
    }
    // And nothing of a secret is anywhere in what was kept.
    const all = await db().execute<Row>(sql`select * from commerce.visits where store_id = ${storeId}::uuid`);
    expect(JSON.stringify(all)).not.toContain(secret);
    expect(JSON.stringify(all)).not.toContain(orderId);
  });

  it("counts a view only from a page of the store the body names", async () => {
    const elsewhere: Record<string, string>[] = [
      { origin: "https://evil.example" },
      { referer: "http://localhost:3000/s/another-store/no/cart" },
      { referer: `http://localhost:3000/s/${slug}-two/no/cart` },
      { referer: "http://localhost:3000/admin/anything" },
      { referer: "https://evil.example/s/" + slug },
      { origin: "null" },
    ];
    for (const extra of elsewhere) {
      expect(await recordVisit({ headers: asRequest(extra), body: view(page()), now: EVENING }), JSON.stringify(extra)).toEqual({ recorded: false, reason: "wrong_site" });
    }
    // No Origin and no Referer: not a browser's request from a page.
    const bare = new Headers({ "user-agent": UA, "x-forwarded-for": IP, host: "localhost:3000" });
    expect(await recordVisit({ headers: bare, body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "wrong_site" });
    // A script on another store's page naming this store.
    const other = asRequest({ referer: "http://localhost:3000/s/another-store/no" });
    expect(await recordVisit({ headers: other, body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "wrong_site" });
    expect(await visits()).toHaveLength(0);
    // The store's own page is fine, with or without a query on the Referer.
    expect(await recordVisit({ headers: asRequest({ referer: `http://localhost:3000/s/${slug}/no/p/x?a=1` }), body: view(page()), now: EVENING })).toEqual({ recorded: true });
  });

  it("limits the new rows one address can start, but not the page views of a row it already has", async () => {
    const limit = NEW_VISITS_PER_ADDRESS_WINDOW;
    // A script changing its user agent: each is a new visitor-day row from the same address.
    for (let i = 0; i < limit; i++) {
      expect(await recordVisit({ headers: asRequest({}, `Mozilla/5.0 Script/${i}`), body: view(page()), now: EVENING }), `row ${i}`).toEqual({ recorded: true });
    }
    expect(await recordVisit({ headers: asRequest({}, "Mozilla/5.0 Script/over"), body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "burst" });
    expect(await visits()).toHaveLength(limit);
    // A visitor who already has a row today keeps adding page views to it.
    expect(await recordVisit({ headers: asRequest({}, "Mozilla/5.0 Script/0"), body: view(page("/cart")), now: EVENING })).toEqual({ recorded: true });
    // Another address is not held back by it.
    expect(await recordVisit({ headers: asRequest({}, UA, "198.51.100.9"), body: view(page()), now: EVENING })).toEqual({ recorded: true });
  });

  it("limits the new rows a store takes in a day", async () => {
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (${storeId}::uuid, 'visits', date_trunc('day', now()), ${NEW_VISITS_PER_STORE_DAY})
      on conflict (store_id, bucket, "window") do update set count = ${NEW_VISITS_PER_STORE_DAY}
    `);
    expect(await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING })).toEqual({ recorded: false, reason: "store_full" });
    expect(await visits()).toHaveLength(0);
    await db().execute(sql`delete from commerce.chat_usage where store_id = ${storeId}::uuid and bucket = 'visits'`);
    expect(await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING })).toEqual({ recorded: true });
  });

  it("keeps no address in the limits' counters either, and they are pruned with the other counters", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    const counters = await db().execute<Row>(sql`select bucket, count from commerce.chat_usage where store_id = ${storeId}::uuid and (bucket like 'vn:%' or bucket = 'visits')`);
    expect(counters.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(counters)).not.toContain(IP);
    expect(counters.find((c) => String(c.bucket).startsWith("vn:"))?.bucket).toMatch(/^vn:[0-9a-f]{24}$/);
  });

  it("stops counting a visitor past the day's cap", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    await db().execute(sql`update commerce.visits set page_views = 2999 where store_id = ${storeId}::uuid`);
    expect(await recordVisit({ headers: asRequest(), body: view(page("/cart")), now: EVENING })).toEqual({ recorded: true });
    expect(await recordVisit({ headers: asRequest(), body: view(page("/cart")), now: EVENING })).toEqual({ recorded: false, reason: "capped" });
    expect((await visits())[0].page_views).toBe(3000);
  });

  it("keeps no IP address and no user agent anywhere in what it writes", async () => {
    await recordVisit({ headers: asRequest(), body: view(page("/p/demo-mug"), { referrer: "www.google.com" }), now: EVENING });
    const columns = await db().execute<Row>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'commerce' and table_name in ('visits', 'product_views') order by table_name, ordinal_position
    `);
    expect(columns.map((c) => String(c.column_name)).filter((n) => /ip|agent|ua|address|cookie|email|user/i.test(n))).toEqual([]);
    const rows = await visits();
    const text = JSON.stringify(rows);
    expect(text).not.toContain(IP);
    expect(text).not.toContain("Mozilla");
    expect(text).not.toContain("iPhone");
    expect(text).not.toContain("10.0.0.1");
    expect(rows[0].visitor).not.toContain(IP.replaceAll(".", ""));
  });
});

describe("tying a cart to its visit", () => {
  const cart = async () => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at)
      values (${storeId}::uuid, ${market}, 'NOK', 'nb-NO', now() + interval '1 day') returning id
    `);
    return String(row.id);
  };
  const visitOf = async (cartId: string) => String((await db().execute<Row>(sql`select visit_id from commerce.carts where id = ${cartId}::uuid`))[0].visit_id);

  it("sets the cart's visit when the visitor was counted that day", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    const [row] = await visits();
    const id = await cart();
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, id, EVENING))).toBe(true);
    expect(await visitOf(id)).toBe(String(row.id));
  });

  it("finds the visit of the store's day, on either side of UTC midnight", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: PAST_MIDNIGHT });
    const [row] = await visits();
    const first = await cart();
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, first, PAST_MIDNIGHT))).toBe(true);
    expect(await visitOf(first)).toBe(String(row.id));
    // 08:00Z on the 3rd is the same store day (the 3rd in Oslo) but another UTC day: the same visit.
    const second = await cart();
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, second, new Date("2026-10-03T08:00:00Z")))).toBe(true);
    expect(await visitOf(second)).toBe(String(row.id));
  });

  it("does not tie a cart to the visit of another store day", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    const id = await cart();
    // 21:30Z on the 2nd is the 2nd in Oslo; a cart made at 22:30Z is the 3rd, and nothing was counted that day.
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, id, PAST_MIDNIGHT))).toBe(false);
    expect(await visitOf(id)).toBe("null");
  });

  it("does nothing for another visitor, with counting off, for a robot, or with a privacy signal", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    const id = await cart();
    requestHeaders = asRequest({}, DESKTOP);
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, id, EVENING))).toBe(false);
    requestHeaders = asRequest({ "sec-gpc": "1" });
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, id, EVENING))).toBe(false);
    requestHeaders = asRequest({}, "curl/8.0");
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, id, EVENING))).toBe(false);
    requestHeaders = asRequest();
    await setCounting(false);
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, id, EVENING))).toBe(false);
    expect(await visitOf(id)).toBe("null");
  });

  it("never fails the transaction it runs in, and never overwrites a visit already set", async () => {
    await recordVisit({ headers: asRequest(), body: view(page()), now: EVENING });
    const worked = await db().transaction(async (tx) => {
      // Not an id: the statement fails inside its savepoint, and the cart's own transaction goes on.
      const failed = await attachVisitToCart(tx, storeId, "not-a-uuid", EVENING);
      const [still] = await tx.execute<Row>(sql`select 1 as ok`);
      return { failed, still: Number(still.ok) };
    });
    expect(worked).toEqual({ failed: false, still: 1 });
    const id = await cart();
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, id, EVENING))).toBe(true);
    const first = await visitOf(id);
    await recordVisit({ headers: asRequest({}, DESKTOP), body: view(page()), now: EVENING });
    requestHeaders = asRequest({}, DESKTOP);
    expect(await db().transaction((tx) => attachVisitToCart(tx, storeId, id, EVENING))).toBe(false);
    expect(await visitOf(id)).toBe(first);
  });
});

describe("pruning", () => {
  it("deletes visits and product counters older than 25 months, keeps the rest and lets carts forget", async () => {
    const [product] = await db().execute<Row>(sql`select id from commerce.products where store_id = ${storeId}::uuid limit 1`);
    const insert = async (day: string, visitor: string) => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.visits (store_id, day, visitor, device, channel, landing_path) values (${storeId}::uuid, ${day}::date, ${visitor}, 'desktop', 'direct', '/') returning id
      `);
      return String(row.id);
    };
    const old = await insert("2024-08-01", "a".repeat(24));
    const recent = await insert("2026-09-01", "b".repeat(24));
    await db().execute(sql`
      insert into commerce.product_views (store_id, day, product_id, views) values
        (${storeId}::uuid, '2024-08-01', ${String(product.id)}::uuid, 5), (${storeId}::uuid, '2026-09-01', ${String(product.id)}::uuid, 7)
    `);
    const [cartRow] = await db().execute<Row>(sql`
      insert into commerce.carts (store_id, market_code, currency, locale, expires_at, visit_id) values (${storeId}::uuid, ${market}, 'NOK', 'nb-NO', now() + interval '1 day', ${old}::uuid) returning id
    `);
    const deleted = await pruneVisits(new Date("2026-10-02T04:00:00Z"));
    expect(deleted.visits).toBeGreaterThanOrEqual(1);
    expect(deleted.productViews).toBeGreaterThanOrEqual(1);
    expect((await visits()).map((r) => String(r.id))).toEqual([recent]);
    const counters = await db().execute<Row>(sql`select views from commerce.product_views where store_id = ${storeId}::uuid`);
    expect(counters.map((r) => Number(r.views))).toEqual([7]);
    const [cartNow] = await db().execute<Row>(sql`select visit_id from commerce.carts where id = ${String(cartRow.id)}::uuid`);
    expect(cartNow.visit_id).toBeNull();
    // A second run has nothing left to do.
    expect(await pruneVisits(new Date("2026-10-02T04:00:00Z"))).toEqual({ visits: 0, productViews: 0 });
  });
});

describe("POST /api/visit", () => {
  const post = (body: unknown, headers: Record<string, string> = {}, raw?: string) =>
    POST(
      new Request("http://localhost:3000/api/visit", {
        method: "POST",
        headers: {
          "user-agent": UA,
          "x-forwarded-for": IP,
          host: "localhost:3000",
          origin: "http://localhost:3000",
          referer: `http://localhost:3000/s/${slug}/no/cart`,
          "content-type": "text/plain",
          ...headers,
        },
        body: raw ?? JSON.stringify(body),
      }),
    );

  it("answers 204, uncached and with no cookie, and counts the view", async () => {
    const response = await post(view(page("/cart")));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(await response.text()).toBe("");
    expect(await visits()).toHaveLength(1);
  });

  it("answers a dropped view exactly the same way: a robot, Global Privacy Control, counting off", async () => {
    const bot = await post(view(page()), { "user-agent": "Googlebot/2.1" });
    const gpc = await post(view(page()), { "sec-gpc": "1" });
    expect(await visits()).toHaveLength(0);
    await setCounting(false);
    const off = await post(view(page()));
    expect(await visits()).toHaveLength(0);
    for (const response of [bot, gpc, off]) {
      expect(response.status).toBe(204);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
    }
  });

  it("refuses another site's page, a body over 1000 bytes and a body that is not JSON", async () => {
    expect((await post(view(page()), { origin: "https://evil.example" })).status).toBe(403);
    // No Origin (a browser sends one on a POST; the empty header stands for none): Fetch Metadata decides.
    expect((await post(view(page()), { origin: "", "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await post(null, {}, JSON.stringify({ ...view(page()), padding: "x".repeat(1100) }))).status).toBe(413);
    expect((await post(null, {}, "not json")).status).toBe(400);
    expect(await visits()).toHaveLength(0);
  });

  it("takes the page from the same site, whose origin matches its host", async () => {
    const response = await post(view(page()), { origin: "http://localhost:3000" });
    expect(response.status).toBe(204);
    expect(await visits()).toHaveLength(1);
  });

  it("answers a view that names a store other than the page's the same way, and counts nothing", async () => {
    const response = await post(view(page()), { referer: "http://localhost:3000/s/another-store/no" });
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await visits()).toHaveLength(0);
  });

  it("is for POST only", () => {
    expect(Object.keys(route).filter((k) => /^(GET|PUT|PATCH|DELETE|HEAD|OPTIONS)$/.test(k))).toEqual([]);
  });
});
