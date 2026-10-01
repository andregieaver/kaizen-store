import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { toMarket } from "@/lib/markets";

type Row = Record<string, unknown>;

vi.mock("server-only", () => ({}));

const experiments = await import("./search-experiment");
const search = await import("./search");

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
let storeId: string;
let otherStoreId: string;
let accountId: string;

async function newStore(name: string): Promise<{ storeId: string; accountId: string }> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`${name}-${run}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`${name}-${run}`}, 'Test', null) as id
  `);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}-${run}@example.com`}`);
  return { storeId: String(store.id), accountId: String(account.id) };
}

beforeAll(async () => {
  ({ storeId, accountId } = await newStore("test"));
  ({ storeId: otherStoreId } = await newStore("other"));
  // One test runs at a time across Kaizen: start from none.
  await experiments.stopExperiment(accountId);
});

afterAll(async () => {
  await experiments.stopExperiment(accountId);
  await closeDb();
});

const shop = () => ({ storeId, market: no });

describe("search test (S5, D77)", () => {
  it("runs one test at a time, and gives keyword search to the share asked for", async () => {
    expect(await experiments.startExperiment(accountId, 1.2)).toEqual({ ok: false, problem: "The keyword share is from 5 to 95 %." });
    expect(await experiments.startExperiment(accountId, 0.3)).toEqual({ ok: true });
    expect(await experiments.startExperiment(accountId, 0.5)).toEqual({ ok: false, problem: "A test is already running. Stop it first." });
    const running = (await experiments.runningExperiment())!;
    expect(running.keywordShare).toBeCloseTo(0.3);
    expect(experiments.drawArm(running, 0.29)).toBe("keyword");
    expect(experiments.drawArm(running, 0.3)).toBe("hybrid");
    const draws = Array.from({ length: 2000 }, () => experiments.drawArm(running));
    const keyword = draws.filter((arm) => arm === "keyword").length / draws.length;
    expect(keyword).toBeGreaterThan(0.25);
    expect(keyword).toBeLessThan(0.35);
  });

  it("gives the keyword arm no model, logs each search with its arm, and records opened results only for the store's own", async () => {
    const running = (await experiments.runningExperiment())!;
    const vectorFor = vi.fn(async () => [1]);
    const understand = vi.fn();
    // Keyword arm: the page passes neither.
    await search.searchProducts(shop(), "xyzzy under 5 kr", null, null);
    expect(vectorFor).not.toHaveBeenCalled();
    expect(understand).not.toHaveBeenCalled();

    const id = randomUUID();
    await search.logSearch(shop(), "keramikkopp", 1, { semanticBest: null, meaningOnly: 0 }, { id, experimentId: running.id, arm: "keyword" });
    const [row] = await db().execute<Row>(sql`select arm, experiment_id from commerce.search_queries where id = ${id}::uuid`);
    expect(row).toEqual({ arm: "keyword", experiment_id: running.id });

    const productId = await experiments.recordClick(storeId, id, "demo-keramikkopp", 1);
    expect(productId).not.toBeNull();
    // Another store's search, an unknown product or a silly place record nothing (the product still opens where it exists).
    expect(await experiments.recordClick(otherStoreId, id, "demo-keramikkopp", 1)).not.toBeNull();
    expect(await experiments.recordClick(storeId, id, "no-such-product", 1)).toBeNull();
    await experiments.recordClick(storeId, id, "demo-keramikkopp", 500);
    await experiments.recordClick(storeId, randomUUID(), "demo-keramikkopp", 1);
    const [clicks] = await db().execute<Row>(sql`select count(*)::int as n from commerce.search_clicks where search_id = ${id}::uuid`);
    expect(clicks.n).toBe(1);
  });

  it("compares the arms: found nothing, a result opened, where, week by week, and whether the split holds", async () => {
    await experiments.stopExperiment(accountId);
    await experiments.startExperiment(accountId, 0.5);
    const running = (await experiments.runningExperiment())!;
    const log = async (arm: "hybrid" | "keyword", results: number, openedAt: number | null) => {
      const id = randomUUID();
      await search.logSearch(shop(), `søk ${arm} ${results}`, results, { semanticBest: null, meaningOnly: 0 }, { id, experimentId: running.id, arm });
      if (openedAt) await experiments.recordClick(storeId, id, "demo-keramikkopp", openedAt);
    };
    // Keyword: 10 searches, 4 found nothing, 2 of the 6 with results opened (at 3 and 5).
    for (let i = 0; i < 4; i++) await log("keyword", 0, null);
    await log("keyword", 3, 3);
    await log("keyword", 3, 5);
    for (let i = 0; i < 4; i++) await log("keyword", 3, null);
    // Hybrid: 10 searches, 1 found nothing, 6 of the 9 with results opened, all at 1.
    await log("hybrid", 0, null);
    for (let i = 0; i < 6; i++) await log("hybrid", 5, 1);
    for (let i = 0; i < 3; i++) await log("hybrid", 5, null);

    const results = await experiments.experimentResults(running);
    expect(results.arms.keyword).toEqual({ searches: 10, zero: 4, opened: 2, withResults: 6, firstPosition: 4 });
    expect(results.arms.hybrid).toEqual({ searches: 10, zero: 1, opened: 6, withResults: 9, firstPosition: 1 });
    expect(results.srmP).toBeCloseTo(1);
    expect(results.openRate.diff?.diff).toBeCloseTo(6 / 9 - 2 / 6);
    expect(results.zeroRate.diff?.diff).toBeCloseTo(0.1 - 0.4);
    // Far too few searches to read anything into, whatever the numbers.
    expect(results.openRate.verdict).toBe("few");
    expect(results.weeks).toHaveLength(1);
    expect(results.weeks[0].arms.hybrid.searches).toBe(10);
  });

  it("gives the numbers the old test gave on the same searches, and reads them in the platform's view (D148, phase 7)", async () => {
    await experiments.stopExperiment(accountId);
    await experiments.startExperiment(accountId, 0.4);
    const running = (await experiments.runningExperiment())!;
    // 1,200 keyword and 1,800 hybrid searches (the split asked for), with a different share finding nothing and being opened in each.
    const bulk = async (arm: "keyword" | "hybrid", total: number, zero: number, opened: number) => {
      const id = (n: unknown) => sql`md5(${`${run}-${arm}-`} || ${n}::text)::uuid`;
      await db().execute(sql`
        insert into commerce.search_queries (id, store_id, market_code, query, results, semantic_best, meaning_results, filters, experiment_id, arm)
        select ${id(sql`n`)}, ${storeId}::uuid, ${no.code}, 'søk ' || n, case when n <= ${zero}::int then 0 else 4 end, null, 0, '{}'::jsonb, ${running.id}::uuid, ${arm}
        from generate_series(1, ${total}::int) n
      `);
      // The first `opened` searches with results were opened.
      await db().execute(sql`
        insert into commerce.search_clicks (store_id, search_id, product_id, position)
        select ${storeId}::uuid, ${id(sql`n`)}, (select id from commerce.products where store_id = ${storeId}::uuid limit 1), 2
        from generate_series(${zero}::int + 1, ${zero}::int + ${opened}::int) n
      `);
    };
    await bulk("keyword", 1200, 360, 230);
    await bulk("hybrid", 1800, 270, 560);
    for (const table of ["search_queries", "search_clicks"]) await db().execute(sql.raw(`analyze commerce.${table}`));

    const results = await experiments.experimentResults(running);
    expect(results.arms.keyword).toMatchObject({ searches: 1200, zero: 360, opened: 230, withResults: 840 });
    expect(results.arms.hybrid).toMatchObject({ searches: 1800, zero: 270, opened: 560, withResults: 1530 });

    // The old formulas, on the same counts.
    const { legacyDifference, legacySampleRatioP, legacySearchVerdict } = await import("@/lib/experiment-legacy");
    const k = results.arms.keyword;
    const h = results.arms.hybrid;
    expect(Math.abs(results.srmP - legacySampleRatioP(k.searches, h.searches, 0.4))).toBeLessThan(1e-6);
    for (const [comparison, a, b, lower] of [
      [results.openRate, { hits: k.opened, of: k.withResults }, { hits: h.opened, of: h.withResults }, false],
      [results.zeroRate, { hits: k.zero, of: k.searches }, { hits: h.zero, of: h.searches }, true],
    ] as const) {
      const old = legacyDifference(a, b)!;
      expect(comparison.diff?.diff).toBeCloseTo(old.diff, 12);
      expect(comparison.diff?.low).toBeCloseTo(old.low, 12);
      expect(comparison.diff?.high).toBeCloseTo(old.high, 12);
      expect(comparison.verdict).toBe(legacySearchVerdict(a, b, legacySampleRatioP(k.searches, h.searches, 0.4), lower));
    }
    // These searches are decisive: hybrid opens more and finds nothing less often.
    expect(results.openRate.verdict).toBe("better");
    expect(results.zeroRate.verdict).toBe("better");

    // In the platform's view, in the engine's words.
    const view = await import("./platform-unit-tests");
    const row = (await view.platformUnitTests()).find((r) => r.kind === "search")!;
    expect(row).toMatchObject({ status: "running", call: "better", headline: "Hybrid search is better than Keyword search.", unit: "search" });
    expect(row.control.units).toBe(1200);
    expect(row.treatment.units).toBe(1800);
    expect(row.detail).toContain("1,200 searches for Keyword search and 1,800 for Hybrid search");
    expect(row.flags).toEqual([]);
  }, 60_000);
});
