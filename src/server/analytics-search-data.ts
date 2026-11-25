import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { safeRatio } from "@/lib/analytics-core";
import { addDays, daysBetween, todayIn, type AnalyticsPeriod } from "@/lib/analytics-period";
import { LOW_CLICK_MIN, LOW_CLICK_RATE } from "@/lib/analytics-search";
import { ANALYTICS_NOTES_EN } from "@/lib/analytics-note-labels";

import { dayKey, dayOf, inMain, inPeriod, num, PAID, VOUCHER_NET, type Row } from "./analytics-sql";
import { SEARCH_LOG_DAYS } from "./search";
import type { Store } from "./stores";
import { col, typedRows } from "./typed-rows";

/** What the orders after searches came to in one currency, without VAT and gift cards, in its minor units (CODE-02). */
const REVENUE_AFTER_SEARCH = z.object({ currency: col.currency, revenue: col.minor });

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
 *   miss), and not `redirected` (one a search redirect sent to a page, D324, searched nothing). The same term may be a miss one day and found another, once the catalogue changed, so each is counted by its misses.
 * - Click-through is searches with at least one `search_clicks` row (a result opened through the search page's `search/go`) over
 *   all searches. The search test's arms (D77) are ignored: every search counts, whatever arm it was given.
 * - Revenue after a search (D347): while the store counts visits a search keeps the day's visit of the same hashed visitor
 *   (`search_queries.visit_id`, `visitKeyOf()`). An order follows a search when it is paid (`PAID`), was placed from a cart of that
 *   visit (`carts.visit_id`) and was placed at or after the search. Its revenue is D152's (without VAT, gift cards sold left out), each
 *   order counted once however many searches it followed, summed per currency and converted (`inMain()`, a currency with no rate left out
 *   and counted). Searches with no visit (counting off, a privacy signal, a visitor whose page views were not counted) are in every other
 *   figure and in none of these; `tiedSearches` says how many had one.
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
  /** Paid orders that followed its searches (D347), each once; only in the most searched list. */
  orders?: number;
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
  /** Whether any search of the period is tied to a visit, so what followed it can be counted. */
  revenueTracked: boolean;
  revenueNote: string;
  /** What followed the searches tied to a visit (D347); null when none was. */
  afterSearch: AfterSearch | null;
  /** Terms searched at least `LOW_CLICK_MIN` times that found something but whose results were rarely opened, by searches then term. */
  lowClickTerms: SearchTermRow[];
  /** Searches tied to a visit and those followed by an order, per day of the period that had any (`YYYY-MM-DD`, the store's). */
  byDay: { day: string; tied: number; converted: number }[];
};

export type AfterSearch = {
  /** Searches of the period tied to a visit, and their share of all searches. */
  tiedSearches: number;
  tiedShare: number | null;
  /** Tied searches followed by a paid order, and their share of tied searches. */
  convertedSearches: number;
  conversion: number | null;
  /** Paid orders that followed a search, each once. */
  orders: number;
  /** Their revenue in the main currency without VAT; orders in a currency with no rate are left out and counted. */
  revenueMinor: number;
  unconverted: number;
  missingCurrencies: string[];
};

export const SEARCH_REVENUE_NOTE = ANALYTICS_NOTES_EN.search.revenue;
export const SEARCH_REVENUE_OFF_NOTE = ANALYTICS_NOTES_EN.search.revenueOff;

export { LOW_CLICK_MIN, LOW_CLICK_RATE };

/** The search text tidied: lower case, trimmed, single spaces. */
const TERM = sql`lower(btrim(regexp_replace(q.query, '[[:space:]]+', ' ', 'g')))`;
const CLICKED = sql`exists (select 1 from commerce.search_clicks sc where sc.store_id = q.store_id and sc.search_id = q.id)`;
// A search sent to a page by a search redirect (D324) found nothing because nothing was searched: not a miss.
const MISS = sql`(q.results = 0 and q.meaning_results = 0 and not q.redirected)`;

/** Pass `now` in tests; it decides which days are still kept. */
/**
 * The part of a period whose searches are still kept: rows older than 90 days are deleted, so the oldest day that is whole is the one
 * after the cutoff's. `empty` when no day of the period is.
 */
function searchWindow(store: Store, period: Pick<AnalyticsPeriod, "from" | "to">, now: Date) {
  const cutoff = new Date(now.getTime() - SEARCH_LOG_DAYS * 86_400_000);
  const availableFrom = addDays(todayIn(cutoff, store.timeZone), 1);
  const from = period.from < availableFrom ? availableFrom : period.from;
  const to = period.to;
  const empty = from >= to;
  return { availableFrom, from, to, empty, clamped: from !== period.from, read: { from, to, days: empty ? 0 : daysBetween(from, to) } };
}

export async function searchReport(store: Store, period: Pick<AnalyticsPeriod, "from" | "to" | "days">, now: Date = new Date()): Promise<SearchReport> {
  const requested = { from: period.from, to: period.to, days: period.days };
  const { availableFrom, from, to, empty, clamped, read } = searchWindow(store, period, now);

  const base = { requested, period: read, clamped, retentionDays: SEARCH_LOG_DAYS, availableFrom };
  if (empty) {
    return {
      ...base,
      totals: { searches: 0, distinctTerms: 0, zeroResultSearches: 0, zeroRate: null, clickedSearches: 0, clickThrough: null, clickThroughOfFound: null },
      topTerms: [],
      zeroTerms: [],
      zeroTermCount: 0,
      revenueTracked: false,
      revenueNote: SEARCH_REVENUE_OFF_NOTE,
      afterSearch: null,
      lowClickTerms: [],
      byDay: [],
    };
  }

  const where = sql`q.store_id = ${store.id}::uuid and ${inPeriod(store, sql`q.created_at`, { from, to })}`;
  // Each tied search with the paid orders placed after it from a cart of its visit (D347).
  const followed = sql`
    select distinct q.id as search_id, o.id as order_id
    from commerce.search_queries q
    join commerce.carts c on c.store_id = q.store_id and c.visit_id = q.visit_id
    join commerce.orders o on o.store_id = q.store_id and o.cart_id = c.id and o.placed_at >= q.created_at
    where ${where} and q.visit_id is not null and ${PAID}
  `;
  const [[totals], top, zero, revenue, days, low] = await Promise.all([
    db().execute<Row>(sql`
      select count(*) as searches, count(distinct ${TERM}) as terms,
        count(*) filter (where ${MISS}) as misses,
        count(*) filter (where ${CLICKED}) as clicked,
        count(*) filter (where not ${MISS}) as found,
        count(*) filter (where not ${MISS} and ${CLICKED}) as found_clicked,
        count(distinct ${TERM}) filter (where ${MISS}) as miss_terms,
        count(*) filter (where q.visit_id is not null) as tied,
        (select count(distinct f.search_id) from (${followed}) f) as converted,
        (select count(distinct f.order_id) from (${followed}) f) as orders
      from commerce.search_queries q
      where ${where}
    `),
    db().execute<Row>(sql`
      with t as (
        select ${TERM} as term, count(*) as searches, avg(q.results) as avg_results,
          count(*) filter (where ${MISS}) as misses, count(*) filter (where ${CLICKED}) as clicked
        from commerce.search_queries q
        where ${where}
        group by 1
        order by count(*) desc, 1
        limit ${TERM_LIMIT}
      ),
      f as (
        select ${TERM} as term, count(distinct fo.order_id) as orders
        from (${followed}) fo join commerce.search_queries q on q.id = fo.search_id
        group by 1
      )
      select t.*, coalesce(f.orders, 0) as orders from t left join f on f.term = t.term
      order by t.searches desc, t.term
    `),
    db().execute<Row>(sql`
      select ${TERM} as term, count(*) as searches, max(q.created_at) as last_at
      from commerce.search_queries q
      where ${where} and ${MISS}
      group by 1
      order by count(*) desc, max(q.created_at) desc, 1
      limit ${TERM_LIMIT}
    `),
    // Each order once, its revenue by D152's definition, per currency.
    typedRows(
      REVENUE_AFTER_SEARCH,
      sql`
      select o.currency, sum(o.total_minor - o.tax_minor - ${VOUCHER_NET}) as revenue
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and o.id in (select f.order_id from (${followed}) f)
      group by o.currency
    `,
    ),
    db().execute<Row>(sql`
      with f as (${followed})
      select ${dayOf(store, sql`q.created_at`)} as day, count(*) as tied, count(*) filter (where exists (select 1 from f where f.search_id = q.id)) as converted
      from commerce.search_queries q
      where ${where} and q.visit_id is not null
      group by 1
      order by 1
    `),
    db().execute<Row>(sql`
      select ${TERM} as term, count(*) as searches, avg(q.results) as avg_results,
        count(*) filter (where ${MISS}) as misses, count(*) filter (where ${CLICKED}) as clicked
      from commerce.search_queries q
      where ${where} and not ${MISS}
      group by 1
      having count(*) >= ${LOW_CLICK_MIN} and count(*) filter (where ${CLICKED}) < count(*) * ${LOW_CLICK_RATE}::numeric
      order by count(*) desc, 1
      limit ${TERM_LIMIT}
    `),
  ]);

  const searches = num(totals, "searches");
  const tied = num(totals, "tied");
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
    topTerms: top.map(termRow),
    zeroTerms: zero.map((r) => ({ term: String(r.term), searches: num(r, "searches"), lastSearchedAt: new Date(r.last_at as string | Date).toISOString() })),
    zeroTermCount: num(totals, "miss_terms"),
    revenueTracked: tied > 0,
    revenueNote: tied > 0 ? SEARCH_REVENUE_NOTE : SEARCH_REVENUE_OFF_NOTE,
    afterSearch:
      tied > 0
        ? (() => {
            const money = inMain(store, revenue.map((r) => ({ currency: String(r.currency), revenue: num(r, "revenue") })), ["revenue"]);
            return {
              tiedSearches: tied,
              tiedShare: safeRatio(tied, searches),
              convertedSearches: num(totals, "converted"),
              conversion: safeRatio(num(totals, "converted"), tied),
              orders: num(totals, "orders"),
              revenueMinor: money.values.revenue,
              unconverted: money.unconverted,
              missingCurrencies: money.missing,
            };
          })()
        : null,
    lowClickTerms: low.map(termRow),
    byDay: days.map((r) => ({ day: dayKey(r.day), tied: num(r, "tied"), converted: num(r, "converted") })),
  };
}

function termRow(r: Row): SearchTermRow {
  return {
    term: String(r.term),
    searches: num(r, "searches"),
    avgResults: Math.round(num(r, "avg_results")),
    zeroResults: num(r, "misses"),
    clicked: num(r, "clicked"),
    clickThrough: safeRatio(num(r, "clicked"), num(r, "searches")),
    ...(r.orders !== undefined ? { orders: num(r, "orders") } : {}),
  };
}

/** One country's searches (D900, `docs/analytics.md` "Markets"): all of them, those that found nothing, and its most missed terms. */
export type MarketSearches = { searches: number; misses: number; terms: { term: string; misses: number }[] };

export type SearchesByMarket = {
  /** No searched day of the period is still kept: nothing is known, and every country's searches are null. */
  empty: boolean;
  /** The period was cut to the days still kept. */
  clamped: boolean;
  availableFrom: string;
  /** By the country's code (the search's `market_code`). */
  markets: Map<string, MarketSearches>;
  /** Terms with at least `minMisses` misses in the whole store, most first, with the countries they were missed in. */
  demand: { term: string; misses: number; markets: { code: string; misses: number }[] }[];
};

const MARKET_SEARCH_ROW = z.object({ market: col.text, searches: col.minor, misses: col.minor });
const MARKET_MISS_ROW = z.object({ term: col.text, market: col.text, misses: col.minor, in_market: col.minor, term_rank: col.minor });

/**
 * The searches of a period by the country they were made in, for the market check (D900): `MISS` and the tidied term exactly as the
 * Traffic page counts them, the period cut to the days still kept as `searchReport()` cuts it. Two reads over the store's searches of the
 * period (indexed by store and time): the counts per country, and each missed term per country, kept when it is one of the country's
 * `perMarket` most missed or one of the store's `demandTerms` terms missed at least `minMisses` times.
 */
export async function searchesByMarket(
  store: Store,
  period: Pick<AnalyticsPeriod, "from" | "to">,
  limits: { perMarket: number; minMisses: number; demandTerms: number },
  now: Date = new Date(),
): Promise<SearchesByMarket> {
  const { availableFrom, from, to, empty, clamped } = searchWindow(store, period, now);
  if (empty) return { empty, clamped, availableFrom, markets: new Map(), demand: [] };
  const where = sql`q.store_id = ${store.id}::uuid and ${inPeriod(store, sql`q.created_at`, { from, to })}`;
  const [counts, missed] = await Promise.all([
    typedRows(
      MARKET_SEARCH_ROW,
      sql`
        select q.market_code::text as market, count(*) as searches, count(*) filter (where ${MISS}) as misses
        from commerce.search_queries q where ${where} group by 1
      `,
    ),
    typedRows(
      MARKET_MISS_ROW,
      sql`
        with t as (
          select ${TERM} as term, q.market_code::text as market, count(*) as misses, max(q.created_at) as last_at
          from commerce.search_queries q where ${where} and ${MISS} group by 1, 2
        ),
        r as (
          select t.*, row_number() over (partition by t.market order by t.misses desc, t.last_at desc, t.term) as in_market,
            sum(t.misses) over (partition by t.term) as total, max(t.last_at) over (partition by t.term) as term_last
          from t
        ),
        k as (
          select d.term, row_number() over (order by d.total desc, d.term_last desc, d.term) as n
          from (select distinct r.term, r.total, r.term_last from r where r.total >= ${limits.minMisses}) d
        )
        select r.term, r.market, r.misses, r.in_market, coalesce(k.n, 0) as term_rank
        from r left join k on k.term = r.term
        where r.in_market <= ${limits.perMarket} or (k.n is not null and k.n <= ${limits.demandTerms})
        order by r.market, r.in_market
      `,
    ),
  ]);
  const markets = new Map<string, MarketSearches>(counts.map((c) => [c.market.trim(), { searches: c.searches, misses: c.misses, terms: [] }]));
  const demand = new Map<string, { rank: number; term: string; misses: number; markets: { code: string; misses: number }[] }>();
  for (const row of missed) {
    const code = row.market.trim();
    if (row.in_market <= limits.perMarket) markets.get(code)?.terms.push({ term: row.term, misses: row.misses });
    if (row.term_rank > 0 && row.term_rank <= limits.demandTerms) {
      const entry = demand.get(row.term) ?? { rank: row.term_rank, term: row.term, misses: 0, markets: [] };
      entry.misses += row.misses;
      entry.markets.push({ code, misses: row.misses });
      demand.set(row.term, entry);
    }
  }
  return {
    empty,
    clamped,
    availableFrom,
    markets,
    demand: [...demand.values()]
      .sort((a, b) => a.rank - b.rank)
      .map(({ term, misses, markets: m }) => ({ term, misses, markets: m.sort((a, b) => b.misses - a.misses || a.code.localeCompare(b.code)) })),
  };
}
