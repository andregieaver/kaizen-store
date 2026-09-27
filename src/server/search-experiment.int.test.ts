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
});
