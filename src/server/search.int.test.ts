import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const search = await import("./search");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const se = toMarket({ code: "SE", currency: "SEK", defaultLocale: "sv-SE" });
let storeId: string;
const handle = new Map<string, string>();

beforeAll(async () => {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`search-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`search-${run}`}, 'Test', null) as id
  `);
  // A new store starts with the shop alone (D178): the demo appointment, stay and rental are offered with their features on, as an owner switches them under Features.
  await db().execute(sql`update commerce.stores set features = features || array['appointments', 'bookings']::text[] where slug = ${`search-${run}`}`);
  storeId = String(store.id);
  const rows = await db().execute<Row>(sql`select id, handle from commerce.products where store_id = ${storeId}::uuid`);
  for (const row of rows) handle.set(String(row.id), String(row.handle));
});

afterAll(async () => {
  await closeDb();
});

/** The handles a search finds in a market, best first. */
const find = async (query: string, market = no, prefix = false) =>
  (await search.matchingIds({ storeId, market }, query, 10, prefix)).map((id) => handle.get(id));

describe("keyword search (Phase 2, S1)", () => {
  it("finds products by their title, in the market's language, best first", async () => {
    expect((await find("keramikkopp"))[0]).toBe("demo-keramikkopp");
    expect((await find("keramikmugg", se))[0]).toBe("demo-keramikkopp");
    expect((await find("stuga", se))[0]).toBe("demo-hytte");
    // Norwegian stemming: plural and definite forms find the singular.
    expect(await find("hyttene")).toContain("demo-hytte");
  });

  it("finds parts of compound words and misspellings, by trigrams", async () => {
    expect(await find("kopp")).toContain("demo-keramikkopp");
    expect((await find("bordlampa"))[0]).toBe("demo-bordlampe");
    expect((await find("notatbk"))[0]).toBe("demo-notatbok");
  });

  it("finds words of the description, a SKU first, and a category's products", async () => {
    expect(await find("oppvaskmaskin")).toContain("demo-keramikkopp");
    expect((await find("DEMO-LAMP"))[0]).toBe("demo-bordlampe");
    expect(await find("belysning")).toEqual(["demo-bordlampe"]);
  });

  it("suggests as the shopper types, from the start of words", async () => {
    expect((await find("kera", no, true))[0]).toBe("demo-keramikkopp");
    expect(await find("hyt", no, true)).toContain("demo-hytte");
    expect(await find("elsyk", no, true)).toContain("demo-sykkelutleie");
  });

  it("finds nothing for nonsense, nothing for empty, and never a product not for sale", async () => {
    expect(await find("xyzzyqwv")).toEqual([]);
    expect(await find("   ")).toEqual([]);
    await db().execute(sql`update commerce.products set status = 'draft' where store_id = ${storeId}::uuid and handle = 'demo-bordlampe'`);
    try {
      expect(await find("bordlampe")).not.toContain("demo-bordlampe");
    } finally {
      await db().execute(sql`update commerce.products set status = 'active' where store_id = ${storeId}::uuid and handle = 'demo-bordlampe'`);
    }
  });

  it("keeps searches for the zero-result rate, and forgets them after 90 days", async () => {
    const shop = { storeId, market: no };
    await search.logSearch(shop, "  Keramikkopp ", 1);
    await search.logSearch(shop, "keramikkopp", 1);
    await search.logSearch(shop, "Xyzzyqwv", 0);
    await search.logSearch(shop, "   ", 0);
    const stats = await search.searchStats(storeId);
    expect(stats).toMatchObject({ searches: 3, zero: [{ query: "xyzzyqwv", count: 1 }] });
    expect(stats.zeroRate).toBeCloseTo(1 / 3);
    expect(stats.top[0]).toEqual({ query: "keramikkopp", count: 2, results: 1 });

    await db().execute(sql`
      update commerce.search_queries set created_at = now() - interval '91 days'
      where store_id = ${storeId}::uuid and query = 'xyzzyqwv'
    `);
    expect(await search.pruneSearchLog()).toBeGreaterThanOrEqual(1);
    expect((await search.searchStats(storeId)).searches).toBe(2);
  });
});
