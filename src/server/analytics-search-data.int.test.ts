import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { customPeriod } from "@/lib/analytics-period";
import { localizationOf } from "@/lib/localization";
import { toMarket } from "@/lib/markets";

import type { Store } from "./stores";

type Row = Record<string, unknown>;

vi.mock("next/cache", () => ({
  cacheLife: () => {},
  cacheTag: () => {},
  updateTag: () => {},
  revalidateTag: () => {},
}));

const { searchReport, TERM_LIMIT, SEARCH_REVENUE_NOTE } = await import("./analytics-search-data");
const { SEARCH_LOG_DAYS } = await import("./search");

/**
 * What shoppers searched for (D152, docs/analytics.md) against a hand-made search log. Europe/Oslo (UTC+2 in September), the
 * period 1-7 September, "now" 2 October 2026 (so the log reaches back to 5 July). `r` is the number of results, `m` how many of
 * them only meaning found.
 *
 *   id   when (Oslo)     term                       r  m  click
 *   S1   09-02 10:00     kopp                       5  0  yes
 *   S2   09-03 10:00     kopp                       5  0  no, in the search test's keyword arm
 *   S3   09-04 10:00     " Kopp  " (an old row)      3  0  yes, two results opened
 *   S4   09-02 12:00     tote                       2  0  no, in the search test's hybrid arm
 *   S5   09-02 11:00     gavekort                   0  0  no
 *   S6   09-03 12:00     gavekort                   0  0  no
 *   S7   09-05 09:00     gavekort                   0  0  no
 *   S8   09-06 10:00     gavekort                   4  0  yes (found once the catalogue had it)
 *   S9   09-04 08:00     ostehøvel                  0  0  no
 *   S10  09-06 08:00     ostehøvel                  0  0  no
 *   S11  09-06 15:00     vase                       0  0  no
 *   S12  09-05 14:00     present                    2  2  no (found by meaning only: not a miss)
 *   S13  09-07 23:59     tote                       2  0  no (the last minute of the last day)
 *   S14  09-03 16:00     "hvit   kopp" and S15 "hvit kopp"  3  0  no (one term, however it was spaced)
 *   never: kopp at 08-31 23:59 and at 09-08 00:00, another store's
 */

const run = Date.now().toString(36);
const no = toMarket({ code: "NO", currency: "NOK", defaultLocale: "nb-NO" });
const localization = localizationOf([], [{ currency: "NOK", rate: 1, roundTo: 1 }], [no]);
const storeOf = (id: string, slug: string) => ({ id, slug, timeZone: "Europe/Oslo", markets: [no], localization }) as unknown as Store;

const NOW = new Date("2026-10-02T10:00:00Z");
const PERIOD = customPeriod("2026-09-01", "2026-09-07");

let store: Store;
let other: Store;
let empty: Store;
const ids: Record<string, string> = {};
let experimentId: string;

async function search(s: Store, key: string | null, q: { at: string; query: string; results: number; meaning?: number; arm?: "hybrid" | "keyword"; clicks?: number }) {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.search_queries (store_id, market_code, query, results, meaning_results, experiment_id, arm, created_at)
    values (${s.id}::uuid, 'NO', ${q.query}, ${q.results}, ${q.meaning ?? 0}, ${q.arm ? experimentId : null}::uuid, ${q.arm ?? null}, ${q.at}::timestamptz)
    returning id
  `);
  if (key) ids[key] = String(row.id);
  for (let i = 0; i < (q.clicks ?? 0); i += 1) {
    await db().execute(sql`
      insert into commerce.search_clicks (store_id, search_id, product_id, position)
      select ${s.id}::uuid, ${String(row.id)}::uuid, id, ${i + 1} from commerce.products where store_id = ${s.id}::uuid order by handle limit 1
    `);
  }
}

async function makeStore(slug: string) {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [created] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  return String(created.id);
}

beforeAll(async () => {
  store = storeOf(await makeStore(`srch-${run}`), `srch-${run}`);
  other = storeOf(await makeStore(`srch-other-${run}`), `srch-other-${run}`);
  empty = storeOf(await makeStore(`srch-empty-${run}`), `srch-empty-${run}`);

  // A finished search test: its arms are ignored, every search counts.
  const [experiment] = await db().execute<Row>(sql`
    insert into commerce.search_experiments (keyword_share, started_at, ended_at) values (0.5, '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z') returning id
  `);
  experimentId = String(experiment.id);

  await search(store, "S1", { at: "2026-09-02T10:00:00+02:00", query: "kopp", results: 5, clicks: 1 });
  await search(store, "S2", { at: "2026-09-03T10:00:00+02:00", query: "kopp", results: 5, arm: "keyword" });
  await search(store, "S3", { at: "2026-09-04T10:00:00+02:00", query: " Kopp  ", results: 3, clicks: 2 });
  await search(store, "S4", { at: "2026-09-02T12:00:00+02:00", query: "tote", results: 2, arm: "hybrid" });
  await search(store, "S5", { at: "2026-09-02T11:00:00+02:00", query: "gavekort", results: 0 });
  await search(store, "S6", { at: "2026-09-03T12:00:00+02:00", query: "gavekort", results: 0 });
  await search(store, "S7", { at: "2026-09-05T09:00:00+02:00", query: "gavekort", results: 0 });
  await search(store, "S8", { at: "2026-09-06T10:00:00+02:00", query: "gavekort", results: 4, clicks: 1 });
  await search(store, "S9", { at: "2026-09-04T08:00:00+02:00", query: "ostehøvel", results: 0 });
  await search(store, "S10", { at: "2026-09-06T08:00:00+02:00", query: "ostehøvel", results: 0 });
  await search(store, "S11", { at: "2026-09-06T15:00:00+02:00", query: "vase", results: 0 });
  await search(store, "S12", { at: "2026-09-05T14:00:00+02:00", query: "present", results: 2, meaning: 2 });
  await search(store, "S13", { at: "2026-09-07T23:59:00+02:00", query: "tote", results: 2 });
  await search(store, "S14", { at: "2026-09-03T16:00:00+02:00", query: "hvit   kopp", results: 3 });
  await search(store, "S15", { at: "2026-09-03T16:30:00+02:00", query: "hvit kopp", results: 3 });

  // Outside the period, and another store's.
  await search(store, null, { at: "2026-08-31T23:59:00+02:00", query: "kopp", results: 5, clicks: 1 });
  await search(store, null, { at: "2026-09-08T00:00:00+02:00", query: "kopp", results: 0 });
  await search(other, null, { at: "2026-09-03T10:00:00+02:00", query: "kopp", results: 0 });

  // Older than the log is kept (the cron has not run in this test): 20 June is before 5 July and must not be read.
  await search(store, null, { at: "2026-06-20T10:00:00+02:00", query: "old miss", results: 0 });
  await search(store, null, { at: "2026-07-06T10:00:00+02:00", query: "july miss", results: 0 });
});

afterAll(async () => {
  await closeDb();
});

describe("searchReport: totals", () => {
  it("counts every search of the period, whatever arm of the search test it was in", async () => {
    const r = await searchReport(store, PERIOD, NOW);
    // 15 searches: S1-S15.
    expect(r.totals.searches).toBe(15);
    // Terms: kopp, tote, gavekort, ostehøvel, vase, present and "hvit kopp" (spaced two ways, one term).
    expect(r.totals.distinctTerms).toBe(7);
    expect(r.requested).toEqual({ from: "2026-09-01", to: "2026-09-08", days: 7 });
    expect(r.period).toEqual({ from: "2026-09-01", to: "2026-09-08", days: 7 });
    expect(r.clamped).toBe(false);
  });

  it("counts searches that found nothing, and shares of the searches", async () => {
    const r = await searchReport(store, PERIOD, NOW);
    // S5, S6, S7, S9, S10, S11. S12 found by meaning only, so it is not one.
    expect(r.totals.zeroResultSearches).toBe(6);
    expect(r.totals.zeroRate).toBe(6 / 15);
    // Followed by a click: S1, S3 (two results opened, one search), S8.
    expect(r.totals.clickedSearches).toBe(3);
    expect(r.totals.clickThrough).toBe(3 / 15);
    // A miss has nothing to click: 9 searches found something, three were clicked.
    expect(r.totals.clickThroughOfFound).toBe(3 / 9);
  });

  it("says plainly that revenue after a search is not tracked", async () => {
    const r = await searchReport(store, PERIOD, NOW);
    expect(r.revenueTracked).toBe(false);
    expect(r.revenueNote).toBe(SEARCH_REVENUE_NOTE);
    expect(r.revenueNote).toMatch(/not tracked/);
  });

  it("is empty, with no shares, for a store that has no searches", async () => {
    const r = await searchReport(empty, PERIOD, NOW);
    expect(r.totals).toEqual({ searches: 0, distinctTerms: 0, zeroResultSearches: 0, zeroRate: null, clickedSearches: 0, clickThrough: null, clickThroughOfFound: null });
    expect(r.topTerms).toEqual([]);
    expect(r.zeroTerms).toEqual([]);
    expect(r.zeroTermCount).toBe(0);
  });
});

describe("searchReport: terms", () => {
  it("ranks the terms by searches, tidied to lower case and single spaces, with their results and clicks", async () => {
    const r = await searchReport(store, PERIOD, NOW);
    expect(r.topTerms.map((t) => [t.term, t.searches, t.avgResults, t.zeroResults, t.clicked])).toEqual([
      // gavekort: results 0, 0, 0, 4 (mean 1), three misses, one click.
      ["gavekort", 4, 1, 3, 1],
      // kopp: 5, 5, 3 (mean 4.33), the old " Kopp  " row is the same term, S1 and S3 clicked.
      ["kopp", 3, 4, 0, 2],
      ["hvit kopp", 2, 3, 0, 0],
      ["ostehøvel", 2, 0, 2, 0],
      ["tote", 2, 2, 0, 0],
      ["present", 1, 2, 0, 0],
      ["vase", 1, 0, 1, 0],
    ]);
    expect(r.topTerms.find((t) => t.term === "kopp")!.clickThrough).toBe(2 / 3);
    expect(r.topTerms.find((t) => t.term === "gavekort")!.clickThrough).toBe(1 / 4);
    expect(r.topTerms.find((t) => t.term === "vase")!.clickThrough).toBe(0);
  });

  it("lists the terms that found nothing, most often first, with when they last did", async () => {
    const r = await searchReport(store, PERIOD, NOW);
    expect(r.zeroTerms).toEqual([
      // Its last miss was 09-05 09:00 in Oslo; the 09-06 search of it found something and is not a miss.
      { term: "gavekort", searches: 3, lastSearchedAt: "2026-09-05T07:00:00.000Z" },
      { term: "ostehøvel", searches: 2, lastSearchedAt: "2026-09-06T06:00:00.000Z" },
      { term: "vase", searches: 1, lastSearchedAt: "2026-09-06T13:00:00.000Z" },
    ]);
    expect(r.zeroTermCount).toBe(3);
  });

  it("cuts each list to the first terms and still says how many there were", async () => {
    // Twenty-five more terms that found nothing, one search each, the later the term the later its search.
    for (let i = 0; i < TERM_LIMIT + 5; i += 1) {
      await search(other, null, { at: `2026-09-02T10:${String(i).padStart(2, "0")}:00+02:00`, query: `miss ${String(i).padStart(2, "0")}`, results: 0 });
    }
    const r = await searchReport(other, PERIOD, NOW);
    expect(r.topTerms).toHaveLength(TERM_LIMIT);
    expect(r.zeroTerms).toHaveLength(TERM_LIMIT);
    // 25 terms plus the other store's own "kopp" (3 September, a miss).
    expect(r.zeroTermCount).toBe(TERM_LIMIT + 6);
    expect(r.totals.searches).toBe(TERM_LIMIT + 6);
    // One search each, so the latest come first: "kopp" on the 3rd, then the later of the 25 on the 2nd.
    expect(r.zeroTerms.slice(0, 2).map((t) => t.term)).toEqual(["kopp", "miss 24"]);
  });
});

describe("searchReport: the log's age", () => {
  it("is what the log reached back to: 90 days, and the first whole day after that", async () => {
    expect(SEARCH_LOG_DAYS).toBe(90);
    const r = await searchReport(store, PERIOD, NOW);
    // 2 October 10:00Z less 90 days is 4 July 10:00Z (12:00 in Oslo): 4 July is partly gone, so 5 July is the first day kept.
    expect(r.retentionDays).toBe(90);
    expect(r.availableFrom).toBe("2026-07-05");
  });

  it("cuts a period that reaches further back, and says so, without reading what the cron would have deleted", async () => {
    const r = await searchReport(store, customPeriod("2026-06-01", "2026-07-31"), NOW);
    expect(r.requested).toEqual({ from: "2026-06-01", to: "2026-08-01", days: 61 });
    expect(r.period).toEqual({ from: "2026-07-05", to: "2026-08-01", days: 27 });
    expect(r.clamped).toBe(true);
    // Only the 6 July miss: the 20 June one is before the log's reach.
    expect(r.totals.searches).toBe(1);
    expect(r.zeroTerms.map((t) => t.term)).toEqual(["july miss"]);
  });

  it("is empty and clamped for a period wholly before the log", async () => {
    const r = await searchReport(store, customPeriod("2026-05-01", "2026-05-31"), NOW);
    expect(r.clamped).toBe(true);
    expect(r.period.days).toBe(0);
    expect(r.totals.searches).toBe(0);
    expect(r.topTerms).toEqual([]);
  });

  it("reaches the first day exactly when the period starts there, and is not clamped", async () => {
    const r = await searchReport(store, customPeriod("2026-07-05", "2026-07-10"), NOW);
    expect(r.clamped).toBe(false);
    expect(r.totals.searches).toBe(1);
  });
});
