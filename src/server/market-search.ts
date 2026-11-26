import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  normaliseTerm,
  placesIn,
  SEARCH_CHECK_DAYS,
  SEARCH_PLACES,
  SEARCH_RETRY_DAYS,
  SEARCH_TERMS_PER_MARKET,
  SEARCH_TERMS_PER_RUN,
  SEARCH_TERMS_PER_STORE_DAY,
  type OwnSite,
  type SearchTermFacts,
} from "@/lib/market-search";
import { storeDomain } from "@/lib/paths";
import { publicSiteHost } from "@/lib/site";

import { audit } from "./auth";
import { log } from "./log";
import { OwnerToolError } from "./owner-tool-error";
import { searchWeb, type ResearchDeps } from "./research";
import { getStore, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Where a store and its rivals come up in search (D905, market check M5b, `docs/market-check.md` 7.3), the only writer of
 * `commerce.search_terms`. The owner follows up to `SEARCH_TERMS_PER_MARKET` words a country; the five-minute dispatcher's `rivalWatch`
 * searches each monthly through `searchWeb()` (the platform's search service, counted as the store's searches and AI usage; only the word
 * and the country are sent) and keeps where the store's own site and each rival's host came up on the first page (`placesIn()`). No AI.
 */

export type SearchTermProblem = "market" | "term" | "full" | "exists";

export class SearchTermError extends Error {
  constructor(readonly problem: SearchTermProblem) {
    super(problem);
  }
}

/** A followed word as Analytics → Markets shows it. */
export type KeptSearchTerm = SearchTermFacts & {
  id: string;
  previous: number | null;
  previousAt: string | null;
  triedAt: string | null;
  problem: "off" | "failed" | null;
};

/**
 * The store's own site as results show it: its active own domains; the platform's host for Kaizena Flow's own store (its pages are the
 * site); `{slug}.{store domain}` where stores have one; else its path on the platform's host (`/s/{slug}`).
 */
export async function ownSite(store: Pick<Store, "id" | "slug" | "house">): Promise<OwnSite> {
  const rows = await typedRows(
    z.object({ hostname: col.text }),
    sql`select hostname from commerce.store_domains where store_id = ${store.id}::uuid and status = 'active' order by is_primary desc, hostname`,
  );
  const hosts = rows.map((r) => r.hostname.toLowerCase().replace(/^www\./, ""));
  const site = publicSiteHost();
  if (store.house && site) hosts.push(site.replace(/^www\./, ""));
  const domain = storeDomain();
  if (domain) hosts.push(`${store.slug}.${domain.split(":")[0]}`);
  return { hosts: [...new Set(hosts)], prefix: !store.house && !domain && site ? { host: site.replace(/^www\./, ""), path: `/s/${store.slug}` } : null };
}

const TERM_ROW = z.object({
  id: col.uuid,
  market: col.text,
  term: col.text,
  checked_at: col.textOrNull,
  own_position: col.int.nullable(),
  positions: z.record(z.string(), z.number().int()),
  previous_position: col.int.nullable(),
  previous_at: col.textOrNull,
  tried_at: col.textOrNull,
  problem: z.enum(["off", "failed"]).nullable(),
  rivals: z.array(z.object({ name: z.string(), host: z.string() })).nullable(),
});

/** The store's followed words, by country and word, each with its rivals in that country and where each came up at the last search. */
export async function listSearchTerms(storeId: string): Promise<KeptSearchTerm[]> {
  const rows = await typedRows(
    TERM_ROW,
    sql`
      select t.id, t.market_code::text as market, t.term, t.checked_at::text, t.own_position, t.positions, t.previous_position, t.previous_at::text,
        t.tried_at::text, t.problem,
        (select jsonb_agg(jsonb_build_object('name', r.name, 'host', r.host) order by lower(r.name))
         from commerce.market_rivals r where r.store_id = t.store_id and r.market_code = t.market_code) as rivals
      from commerce.search_terms t
      where t.store_id = ${storeId}::uuid
      order by t.market_code, t.term
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    term: r.term,
    market: r.market.trim(),
    checkedAt: r.checked_at,
    own: r.own_position,
    rivals: (r.rivals ?? []).map((x) => ({ name: x.name, host: x.host, position: r.checked_at ? (r.positions[x.host] ?? null) : null })),
    previous: r.previous_position,
    previousAt: r.previous_at,
    triedAt: r.tried_at,
    problem: r.problem,
  }));
}

/** Follows a word in one of the store's countries; refused past `SEARCH_TERMS_PER_MARKET` or for a word already followed there. */
export async function addSearchTerm(actor: { account: { id: string }; store: Store }, input: { market: string; term: string }): Promise<{ id: string; term: string }> {
  const market = input.market.trim().toUpperCase();
  if (!actor.store.markets.some((m) => m.code === market)) throw new SearchTermError("market");
  const term = normaliseTerm(input.term);
  if (!term) throw new SearchTermError("term");
  const count = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.search_terms where store_id = ${actor.store.id}::uuid and market_code = ${market}`,
  );
  if ((count?.n ?? 0) >= SEARCH_TERMS_PER_MARKET) throw new SearchTermError("full");
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.search_terms (store_id, market_code, term, added_by) values (${actor.store.id}::uuid, ${market}, ${term}, ${actor.account.id}::uuid)
      on conflict (store_id, market_code, term) do nothing returning id`,
  );
  if (!row) throw new SearchTermError("exists");
  await audit(actor.account.id, actor.store.id, "analytics.search_term_added", { term: row.id, market });
  return { id: row.id, term };
}

/** Stops following a word; false when the store has no such word. */
export async function removeSearchTerm(actor: { account: { id: string }; store: Store }, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const gone = await db().execute(sql`delete from commerce.search_terms where store_id = ${actor.store.id}::uuid and id = ${id}::uuid returning id`);
  if (gone.length === 0) return false;
  await audit(actor.account.id, actor.store.id, "analytics.search_term_removed", { term: id });
  return true;
}

/** The words the store has searched most in its own search over 90 days: ideas for words to follow. */
export async function searchTermIdeas(storeId: string, limit = 10): Promise<string[]> {
  const rows = await typedRows(
    z.object({ term: col.text }),
    sql`
      select lower(btrim(query)) as term from commerce.search_queries
      where store_id = ${storeId}::uuid and created_at > now() - interval '90 days' and length(btrim(query)) between 2 and 80
      group by 1 order by count(*) desc, 1 limit ${limit}
    `,
  );
  return rows.map((r) => r.term);
}

export type SearchWatchRun = { searched: number; waiting: number };
export type SearchWatchDeps = ResearchDeps & { now?: Date };

/**
 * The watcher's part for followed words: a word never searched first (one just added is searched within minutes), then each searched longer
 * ago than `SEARCH_CHECK_DAYS`, `SEARCH_TERMS_PER_RUN` a run and at most `SEARCH_TERMS_PER_STORE_DAY` a store a day, as the person who added
 * it, for every open store (Kaizena Flow's own too). The try is claimed first (`tried_at`); a search that cannot be made (not set up, the
 * store's AI or the day's searches used, the service busy) waits `SEARCH_RETRY_DAYS` and says why. A search that answers keeps where the
 * store's site and each rival's host came up on the first page, and the store's place before. No AI.
 */
export async function watchSearchTerms(deps: SearchWatchDeps = {}): Promise<SearchWatchRun> {
  const now = deps.now ?? new Date();
  const at = now.toISOString();
  const due = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid, slug: col.text, market: col.text, term: col.text, added_by: col.uuid }),
    sql`
      with claimed as (
        update commerce.search_terms t set tried_at = ${at}::timestamptz
        where t.id in (
          select t2.id from commerce.search_terms t2
          where t2.added_by is not null and commerce.store_is_active(t2.store_id)
            and (t2.checked_at is null or t2.checked_at < ${at}::timestamptz - make_interval(days => ${SEARCH_CHECK_DAYS}))
            and (t2.tried_at is null or t2.tried_at < ${at}::timestamptz - make_interval(days => ${SEARCH_RETRY_DAYS}))
            and (select count(*) from commerce.search_terms w
                 where w.store_id = t2.store_id and w.tried_at > ${at}::timestamptz - interval '1 day') < ${SEARCH_TERMS_PER_STORE_DAY}
          order by t2.checked_at nulls first, t2.created_at
          limit ${SEARCH_TERMS_PER_RUN}
          for update of t2 skip locked
        )
        returning t.id, t.store_id, t.market_code, t.term, t.added_by
      )
      select c.id, c.store_id, s.slug, c.market_code::text as market, c.term, c.added_by from claimed c join commerce.stores s on s.id = c.store_id
    `,
  );
  const run: SearchWatchRun = { searched: 0, waiting: 0 };
  // An error that is not a business outcome is thrown once the other words were tried, for the job to report.
  let failure: unknown = null;
  for (const t of due) {
    try {
      const store = await getStore(t.slug);
      if (!store || store.id !== t.store_id) continue;
      const found = await searchWeb({ account: { id: t.added_by }, store }, { query: t.term, count: SEARCH_PLACES, country: t.market.trim(), freshness: "any" }, deps);
      const rivals = await typedRows(
        z.object({ host: col.text }),
        sql`select host from commerce.market_rivals where store_id = ${t.store_id}::uuid and market_code = ${t.market}`,
      );
      const places = placesIn(found.results, await ownSite(store), rivals.map((r) => r.host));
      await db().execute(sql`
        update commerce.search_terms set
          previous_position = case when checked_at is null then null else own_position end,
          previous_at = checked_at,
          checked_at = ${at}::timestamptz, own_position = ${places.own}, positions = ${JSON.stringify(places.rivals)}::jsonb, problem = null
        where store_id = ${t.store_id}::uuid and id = ${t.id}::uuid
      `);
      run.searched++;
    } catch (error) {
      if (!(error instanceof OwnerToolError)) {
        failure ??= error;
        continue;
      }
      run.waiting++;
      const off = /not set up/i.test(error.message);
      log("info", "market_search.waits", { term: t.id, off });
      await db().execute(sql`update commerce.search_terms set problem = ${off ? "off" : "failed"} where store_id = ${t.store_id}::uuid and id = ${t.id}::uuid`);
    }
  }
  if (failure) throw failure;
  return run;
}
