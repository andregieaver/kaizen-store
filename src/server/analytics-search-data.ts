import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { safeRatio } from "@/lib/analytics-core";
import { addDays, daysBetween, todayIn, type AnalyticsPeriod } from "@/lib/analytics-period";

import { inPeriod, num, type Row } from "./analytics-sql";
import { SEARCH_LOG_DAYS } from "./search";
import type { Store } from "./stores";

/**
 * What shoppers searched for, for the Traffic page (D152, docs/analytics.md): the searches of the store's own search page
 * (`commerce.search_queries`, D72), their terms, the ones that found nothing, and how many were followed by a click on a result.
 *
 * How it is read:
 *
 * - Searches are kept `SEARCH_LOG_DAYS` (90) days. A period reaching further back is cut to the first whole day still kept
 *   (`availableFrom`), and the report says so (`clamped`, `requested`); nothing is guessed for the days before. A period that
 *   lies wholly before it is empty and clamped.
 * - A term is the search as typed, lower-cased, trimmed and with single spaces (the search page stores it that way already;
 *   older rows are tidied the same way here). Terms are shown as they are, so they may hold what a shopper typed: nothing is
 *   tied to a person (a search has no visitor or account).
 * - Zero results are searches with `results = 0` and `meaning_results = 0` (a search by meaning that found something is not a
 *   miss). The same term may be a miss one day and found another, once the catalogue changed, so each is counted by its misses.
 * - Click-through is searches with at least one `search_clicks` row (a result opened through the search page's `search/go`) over
 *   all searches. The search test's arms (D77) are ignored: every search counts, whatever arm it was given.
 * - Revenue after a search is NOT tracked: a search is not tied to a visit or an order. The report says so (`revenueTracked`).
 * - Everything is one pass over the store's searches in the period (indexed by store and time), the lists cut to `TERM_LIMIT`.
 */

/** Terms in each list. */
export const TERM_LIMIT = 20;

export type SearchTermRow = {
  /** The normalised search text. */
  term: string;
  /** Searches of it. */
  searches: number;
  /** Its mean number of results, rounded; 0 when it never found anything. */
  avgResults: number;
  /** Its searches that found nothing. */
  zeroResults: number;
  /** Its searches followed by a click on a result. */
  clicked: number;
  /** Clicked / searches (0..1). */
  clickThrough: number | null;
};

export type ZeroResultRow = {
  term: string;
  /** Searches of it that found nothing. */
  searches: number;
  /** The last time it was searched with no result, ISO 8601 (UTC). */
  lastSearchedAt: string;
};

export type SearchReport = {
  /** What was asked for, and what was read: `period` is the part still kept. */
  requested: { from: string; to: string; days: number };
  period: { from: string; to: string; days: number };
  /** The period was cut because older searches are no longer kept. */
  clamped: boolean;
  /** Days searches are kept, and the first day still kept (`YYYY-MM-DD`, the store's). */
  retentionDays: number;
  availableFrom: string;
  totals: {
    searches: number;
    distinctTerms: number;
    /** Searches that found nothing, and their share of all searches (null without searches). */
    zeroResultSearches: number;
    zeroRate: number | null;
    /** Searches followed by a click on a result, and their share. */
    clickedSearches: number;
    clickThrough: number | null;
    /** Click-through of the searches that found something (a miss cannot be clicked); null without such searches. */
    clickThroughOfFound: number | null;
  };
  /** The most searched terms, by searches then term. */
  topTerms: SearchTermRow[];
  /** The terms that most often found nothing, by misses then latest. */
  zeroTerms: ZeroResultRow[];
  /** How many distinct terms found nothing (`zeroTerms` holds the first `TERM_LIMIT`). */
  zeroTermCount: number;
  /** Always false: the money a search led to is not known. */
  revenueTracked: false;
  revenueNote: string;
};

export const SEARCH_REVENUE_NOTE = "Revenue after a search is not tracked: a search is not tied to a visit or an order.";

/** The search text tidied: lower case, trimmed, single spaces. */
const TERM = sql`lower(btrim(regexp_replace(q.query, '[[:space:]]+', ' ', 'g')))`;
const CLICKED = sql`exists (select 1 from commerce.search_clicks sc where sc.store_id = q.store_id and sc.search_id = q.id)`;
const MISS = sql`(q.results = 0 and q.meaning_results = 0)`;

/** Pass `now` in tests; it decides which days are still kept. */
export async function searchReport(store: Store, period: Pick<AnalyticsPeriod, "from" | "to" | "days">, now: Date = new Date()): Promise<SearchReport> {
  const requested = { from: period.from, to: period.to, days: period.days };
  // Rows older than 90 days are deleted, so the oldest day that is whole is the one after the cutoff's.
  const cutoff = new Date(now.getTime() - SEARCH_LOG_DAYS * 86_400_000);
  const availableFrom = addDays(todayIn(cutoff, store.timeZone), 1);
  const from = period.from < availableFrom ? availableFrom : period.from;
  const clamped = from !== period.from;
  const to = period.to;
  const empty = from >= to;
  const read = { from, to, days: empty ? 0 : daysBetween(from, to) };

  const base = { requested, period: read, clamped, retentionDays: SEARCH_LOG_DAYS, availableFrom, revenueTracked: false as const, revenueNote: SEARCH_REVENUE_NOTE };
  if (empty) {
    return {
      ...base,
      totals: { searches: 0, distinctTerms: 0, zeroResultSearches: 0, zeroRate: null, clickedSearches: 0, clickThrough: null, clickThroughOfFound: null },
      topTerms: [],
      zeroTerms: [],
      zeroTermCount: 0,
    };
  }

  const where = sql`q.store_id = ${store.id}::uuid and ${inPeriod(store, sql`q.created_at`, { from, to })}`;
  const [[totals], top, zero] = await Promise.all([
    db().execute<Row>(sql`
      select count(*) as searches, count(distinct ${TERM}) as terms,
        count(*) filter (where ${MISS}) as misses,
        count(*) filter (where ${CLICKED}) as clicked,
        count(*) filter (where not ${MISS}) as found,
        count(*) filter (where not ${MISS} and ${CLICKED}) as found_clicked,
        count(distinct ${TERM}) filter (where ${MISS}) as miss_terms
      from commerce.search_queries q
      where ${where}
    `),
    db().execute<Row>(sql`
      select ${TERM} as term, count(*) as searches, avg(q.results) as avg_results,
        count(*) filter (where ${MISS}) as misses, count(*) filter (where ${CLICKED}) as clicked
      from commerce.search_queries q
      where ${where}
      group by 1
      order by count(*) desc, 1
      limit ${TERM_LIMIT}
    `),
    db().execute<Row>(sql`
      select ${TERM} as term, count(*) as searches, max(q.created_at) as last_at
      from commerce.search_queries q
      where ${where} and ${MISS}
      group by 1
      order by count(*) desc, max(q.created_at) desc, 1
      limit ${TERM_LIMIT}
    `),
  ]);

  const searches = num(totals, "searches");
  const misses = num(totals, "misses");
  const clicked = num(totals, "clicked");
  return {
    ...base,
    totals: {
      searches,
      distinctTerms: num(totals, "terms"),
      zeroResultSearches: misses,
      zeroRate: safeRatio(misses, searches),
      clickedSearches: clicked,
      clickThrough: safeRatio(clicked, searches),
      clickThroughOfFound: safeRatio(num(totals, "found_clicked"), num(totals, "found")),
    },
    topTerms: top.map((r) => ({
      term: String(r.term),
      searches: num(r, "searches"),
      avgResults: Math.round(num(r, "avg_results")),
      zeroResults: num(r, "misses"),
      clicked: num(r, "clicked"),
      clickThrough: safeRatio(num(r, "clicked"), num(r, "searches")),
    })),
    zeroTerms: zero.map((r) => ({ term: String(r.term), searches: num(r, "searches"), lastSearchedAt: new Date(r.last_at as string | Date).toISOString() })),
    zeroTermCount: num(totals, "miss_terms"),
  };
}
