import "server-only";

import { createHash } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import { DOC_AREAS, DOC_KINDS, DOC_LANGS, DOC_TRACKS, type DocLang, type DocsIndex } from "@/lib/docs-content";
import { docsPath } from "@/lib/docs-host";
import { docsIndexFingerprint, docsIndexRows, embedText, type DocsIndexRow } from "@/lib/docs-index";
import { docsReferenceItems } from "@/lib/docs-reference";
import { DOCS_ITEMS, type DocsSearchAnswer, type DocsSearchHit, type DocsSearchQuery } from "@/lib/docs-search";
import {
  anyWordsQuery,
  decodeCursor,
  docsAlternatives,
  facetCounts,
  fuseRanks,
  groupDocs,
  matchOf,
  missQuery,
  pageOf,
  passes,
  queryWords,
  snippetOf,
  snippetTerms,
  type DocsCandidate,
} from "@/lib/docs-search-rules";
import { normalizeQuery, prefixQuery } from "@/lib/search";
import { vectorLiteral } from "@/lib/vectors";

import { AiError, aiFor, embedTexts, type AiConnection } from "./ai";
import { audit } from "./auth";
import { docsIndex } from "./docs";
import { log } from "./log";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * The docs' search (wave 14 unit E3, D443): the only writer and reader of `commerce.docs_index`, `docs_index_state`, `docs_search_misses`
 * and `docs_reads`.
 *
 * - **The index** is the rows `docsIndexRows()` makes from the deployed articles and unit A's contracts. The five-minute dispatcher
 *   (`refreshDocsIndex()`) compares their fingerprint with the one stored and rewrites the index when they differ (after a deploy that changed
 *   an article, a contract or how rows are made), keeping each row's vector while its words are the same; then it gives rows vectors with the
 *   platform's AI where it has an embedding model (as the chat's knowledge, D81). Search works without any.
 * - **A search** (`searchDocs()`) asks the database for the parts its words find (stemmed in each row's language, the synonyms' alternatives,
 *   the start of a word while typing, a title close to what was typed) and, with vectors, the parts closest in meaning; `docs-search-rules.ts`
 *   merges them by rank, groups them into documents, counts the filters, orders and pages them.
 * - **Misses and reads** are counts and nothing more: a reader's same search or page counts once an hour, by a counter in `chat_usage` keyed
 *   by the budgets' daily hash of their address (gone after two days, `pruneChatUsage()`).
 */

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

/** How close a title, heading or reference item's code must be to what was typed to be found (pg_trgm's word similarity, 0 to 1). */
const CLOSE = 0.5;
/** How far below the closest part others may be and still be found by meaning. */
const MEANING_MARGIN = 0.1;
/** Parts the meaning search hands on. */
const MEANING_CANDIDATES = 40;
/** A search waits this long for its vector before going on with its words alone. */
const MEANING_TIMEOUT_MS = 3000;
/** Reference items weigh less than articles for the same words, so a guide comes before the 255 tools that name the same thing. */
const REFERENCE_WEIGHT = 0.8;
/** Reads counted for *Most read*: the last 90 days. */
const READ_DAYS = 90;

// ---------------------------------------------------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------------------------------------------------

let deployed: { rows: DocsIndexRow[]; hash: string } | null = null;

/** The rows this deployment makes and the hash of their fingerprint; made once a server's life in production, where neither changes. */
export function deployedDocsRows(index: DocsIndex = docsIndex()): { rows: DocsIndexRow[]; hash: string } {
  if (deployed && process.env.NODE_ENV === "production") return deployed;
  const rows = docsIndexRows(index, docsReferenceItems());
  deployed = { rows, hash: sha(docsIndexFingerprint(rows)) };
  return deployed;
}

const textArray = (values: readonly string[]): SQL =>
  values.length === 0 ? sql`'{}'::text[]` : sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`;

const rowHash = (row: DocsIndexRow) => sha(embedText(row));

/**
 * Writes the rows in place of the index's, in one transaction under a lock (two runs never write at once; the one that waits finds the
 * fingerprint written and stops, so a search that met an empty index finds the rows once it has waited): each row by its key, keeping its
 * vector while its words are the same, then every row not written now removed, then the fingerprint. False when the fingerprint is already
 * this one.
 */
async function writeDocsIndex(rows: readonly DocsIndexRow[], hash: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('commerce.docs_index'))`);
    const state = await typedRow(z.object({ hash: col.text }), sql`select hash from commerce.docs_index_state where id = 1`, tx);
    if (state?.hash === hash) return false;
    for (let start = 0; start < rows.length; start += 200) {
      const values = rows.slice(start, start + 200).map(
        (r) => sql`(${r.key}, ${r.doc}, ${r.item}, ${r.track}, ${r.kind}, ${r.lang}, ${textArray(r.areas)}, ${textArray(r.features)}, ${textArray(r.plans)},
          ${r.section}, ${r.sectionTitle}, ${r.path}, ${r.url}, ${r.title}, ${r.headings.join("\n")}, ${r.code}, ${r.summary}, ${r.text},
          ${r.position}, ${r.reading}, ${r.checked}::date, ${rowHash(r)})`,
      );
      await tx.execute(sql`
        insert into commerce.docs_index (key, doc, item, track, kind, lang, areas, features, plans, section, section_title, path, url, title,
          headings, code, summary, text, position, reading, checked, text_hash)
        values ${sql.join(values, sql`, `)}
        on conflict (key) do update set
          doc = excluded.doc, item = excluded.item, track = excluded.track, kind = excluded.kind, lang = excluded.lang, areas = excluded.areas,
          features = excluded.features, plans = excluded.plans, section = excluded.section, section_title = excluded.section_title,
          path = excluded.path, url = excluded.url, title = excluded.title, headings = excluded.headings, code = excluded.code,
          summary = excluded.summary, text = excluded.text, position = excluded.position, reading = excluded.reading, checked = excluded.checked,
          space = case when commerce.docs_index.text_hash = excluded.text_hash then commerce.docs_index.space end,
          embedding = case when commerce.docs_index.text_hash = excluded.text_hash then commerce.docs_index.embedding end,
          text_hash = excluded.text_hash, updated_at = now()
      `);
    }
    // Every row written now has this transaction's time; any other is no longer made.
    await tx.execute(sql`delete from commerce.docs_index where updated_at < now()`);
    await tx.execute(sql`
      insert into commerce.docs_index_state (id, hash, rows, written_at) values (1, ${hash}, ${rows.length}, now())
      on conflict (id) do update set hash = excluded.hash, rows = excluded.rows, written_at = now()
    `);
    return true;
  });
}

const EMBED_BATCH = 32;
const EMBED_PER_RUN = 256;

const bigId = z.union([z.number(), z.string()]).transform(Number).pipe(z.int());

/** Gives rows vectors from the platform's AI where they have none from its current model; stops at the first failure. */
export async function embedDocsIndex(connection: AiConnection, limit = EMBED_PER_RUN): Promise<{ embedded: number; failed: string | null }> {
  const space = connection.space;
  if (!space || !connection.embeddingModel) return { embedded: 0, failed: null };
  const stale = await typedRows(
    z.object({ id: bigId, title: col.text, headings: col.text, code: col.textOrNull, text: col.text }),
    sql`select id, title, headings, code, text from commerce.docs_index where space is null or space <> ${space} order by reading, position limit ${limit}`,
  );
  let embedded = 0;
  for (let start = 0; start < stale.length; start += EMBED_BATCH) {
    const batch = stale.slice(start, start + EMBED_BATCH);
    try {
      const { vectors } = await embedTexts(
        connection,
        batch.map((row) => embedText({ title: row.title, headings: row.headings.split("\n").filter(Boolean), code: row.code, text: row.text })),
      );
      await db().execute(sql`
        update commerce.docs_index d set space = ${space}, embedding = v.embedding::extensions.vector
        from (values ${sql.join(
          batch.map((row, i) => sql`(${row.id}::bigint, ${vectorLiteral(vectors[i])})`),
          sql`, `,
        )}) as v(id, embedding)
        where d.id = v.id
      `);
      embedded += batch.length;
    } catch (error) {
      const message = error instanceof AiError ? error.message : String(error);
      log("warn", "docs_index.embed_failed", { embedded, source: connection.source }, error);
      return { embedded, failed: message };
    }
  }
  return { embedded, failed: null };
}

export type DocsIndexRefresh = { written: boolean; rows: number; embedded: number; failed: string | null };

/**
 * The dispatcher's share (every five minutes): the index rewritten when the deployment's rows differ from the stored fingerprint, then up to
 * 256 rows given vectors while the platform's AI has an embedding model. `rows` is for tests (a deployment's own rows otherwise).
 */
export async function refreshDocsIndex(options: { rows?: DocsIndexRow[]; embed?: boolean } = {}): Promise<DocsIndexRefresh> {
  const { rows, hash } = options.rows ? { rows: options.rows, hash: sha(docsIndexFingerprint(options.rows)) } : deployedDocsRows();
  const stored = await typedRow(z.object({ hash: col.text }), sql`select hash from commerce.docs_index_state where id = 1`);
  const written = stored?.hash === hash ? false : await writeDocsIndex(rows, hash);
  if (written) log("info", "docs_index.written", { rows: rows.length });
  let embedded = 0;
  let failed: string | null = null;
  if (options.embed !== false) {
    const connection = await aiFor(null, { feature: "docs_search" });
    if (connection?.space && connection.embeddingModel) ({ embedded, failed } = await embedDocsIndex(connection));
  }
  return { written, rows: rows.length, embedded, failed };
}

/** Reads older than 90 days and misses not seen for 180 forgotten (in the dispatcher). */
export async function pruneDocsCounts(): Promise<{ reads: number; misses: number }> {
  const reads = await db().execute(sql`delete from commerce.docs_reads where day < current_date - ${READ_DAYS}::int returning 1`);
  const misses = await db().execute(sql`delete from commerce.docs_search_misses where last_at < now() - interval '180 days' returning 1`);
  return { reads: reads.length, misses: misses.length };
}

// ---------------------------------------------------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------------------------------------------------

const CANDIDATE = z.object({
  id: bigId,
  doc: col.text,
  item: z.enum(DOCS_ITEMS),
  track: z.enum(DOC_TRACKS),
  kind: z.enum(DOC_KINDS),
  lang: z.enum(DOC_LANGS),
  areas: z.array(z.string()).transform((list) => list.filter((a): a is (typeof DOC_AREAS)[number] => (DOC_AREAS as readonly string[]).includes(a))),
  section: col.textOrNull,
  title: col.text,
  checked: col.textOrNull,
  reading: col.int,
  position: col.int,
  reads: z.union([z.number(), z.string()]).transform(Number).pipe(z.int()),
});

const FACTS = sql`d.id, d.doc, d.item, d.track, d.kind, d.lang, d.areas, d.section, d.title, d.checked::text as checked, d.reading, d.position`;

/** Each page's reads over the last 90 days, for *Most read*; nothing (0) for other orders. */
const readsOf = (withReads: boolean): SQL =>
  withReads
    ? sql`coalesce((select sum(r.reads) from commerce.docs_reads r where r.path = d.path and r.lang = d.lang and r.day >= current_date - ${READ_DAYS}::int), 0)::int`
    : sql`0`;

/** Every document's start, for a list without words. */
async function browseCandidates(withReads: boolean, executor: Executor = readDb()): Promise<DocsCandidate[]> {
  const rows = await typedRows(CANDIDATE, sql`select ${FACTS}, ${readsOf(withReads)} as reads from commerce.docs_index d where d.position = 0`, executor);
  return rows.map((row) => ({ ...row, keyword: null, similarity: null }));
}

/** The parts the search's words find: every word (or close to it), and, for the fallback, any word. */
async function keywordCandidates(text: string, withReads: boolean, executor: Executor = readDb()): Promise<DocsCandidate[]> {
  const all = [text, ...docsAlternatives(text)];
  const any = anyWordsQuery(text);
  const prefix = prefixQuery(text);
  const allOf = (lang: DocLang) => sql.join(all.map((t) => sql`websearch_to_tsquery(commerce.search_config(${lang}), ${t})`), sql` || `);
  const anyOf = (lang: DocLang) => (any ? sql`to_tsquery(commerce.search_config(${lang}), ${any})` : sql`null::tsquery`);
  const rows = await typedRows(
    CANDIDATE.extend({ all_hit: col.bool, any_hit: col.bool, score: col.decimal }),
    sql`
      with q as (
        select ${allOf("en")} as all_en, ${allOf("nb")} as all_nb, ${anyOf("en")} as any_en, ${anyOf("nb")} as any_nb,
          ${prefix ? sql`to_tsquery('pg_catalog.simple', ${prefix})` : sql`null::tsquery`} as prefix, ${text}::text as text
      ),
      found as (
        select d.id, d.doc, d.item, d.track, d.kind, d.lang, d.areas, d.section, d.title, d.checked, d.reading, d.position, d.path, d.code,
          d.headings, d.search, d.words, d.trgm, q.text as q_text, q.prefix as q_prefix,
          case when d.lang = 'nb' then q.all_nb else q.all_en end as q_all,
          case when d.lang = 'nb' then q.any_nb else q.any_en end as q_any
        from commerce.docs_index d cross join q
      ),
      scored as (
        select d.*,
          coalesce(d.search @@ d.q_all, false) or coalesce(d.words @@ d.q_prefix, false)
            or extensions.word_similarity(d.q_text, d.trgm) >= ${CLOSE}::float8 as all_hit,
          coalesce(d.search @@ d.q_any, false) as any_hit,
          (coalesce(ts_rank(d.search, d.q_any), 0)
            + case when coalesce(d.search @@ d.q_all, false) then 0.5 else 0 end
            + coalesce(ts_rank(d.words, d.q_prefix), 0) * 0.5
            + extensions.word_similarity(d.q_text, d.trgm)
            + case when lower(d.title) = d.q_text or lower(coalesce(d.code, '')) = d.q_text then 1 else 0 end
            -- Words a heading holds lead to that heading; words only the page's title holds, to the page's top rather than to a part
            -- that repeats them.
            + case when d.position > 0 and coalesce(pg_catalog.to_tsvector(commerce.search_config(d.lang), d.headings) @@ d.q_all, false) then 0.7 else 0 end
            + case when d.position = 0 and coalesce(pg_catalog.to_tsvector(commerce.search_config(d.lang), d.title) @@ d.q_all, false) then 0.6 else 0 end
          ) * case when d.item in ('section', 'changelog') then 1.0 else ${REFERENCE_WEIGHT}::float8 end as score
        from found d
      )
      select ${FACTS}, ${readsOf(withReads)} as reads, d.all_hit, d.any_hit, d.score
      from scored d
      where d.all_hit or d.any_hit
    `,
    executor,
  );
  return rows.map(({ all_hit, any_hit, score, ...row }) => ({ ...row, keyword: all_hit || any_hit ? { score, all: all_hit } : null, similarity: null }));
}

/** The parts closest in meaning, while the platform's AI makes vectors: those within a margin of the closest and above its own limit. */
async function meaningCandidates(text: string, withReads: boolean): Promise<{ used: boolean; rows: DocsCandidate[] }> {
  if (text.length < 3 || queryWords(text).length === 0) return { used: false, rows: [] };
  const connection = await aiFor(null, { feature: "docs_search" });
  if (!connection?.space || !connection.embeddingModel) return { used: false, rows: [] };
  try {
    const { vectors } = await embedTexts(connection, [text], MEANING_TIMEOUT_MS);
    const rows = await typedRows(
      CANDIDATE.extend({ similarity: col.decimal }),
      sql`
        with q as (select ${vectorLiteral(vectors[0])}::extensions.vector as v)
        select ${FACTS}, ${readsOf(withReads)} as reads, 1 - (d.embedding OPERATOR(extensions.<=>) q.v) as similarity
        from commerce.docs_index d cross join q
        where d.space = ${connection.space} and extensions.vector_dims(d.embedding) = extensions.vector_dims(q.v)
        order by d.embedding OPERATOR(extensions.<=>) q.v
        limit ${MEANING_CANDIDATES}
      `,
      readDb(),
    );
    const best = rows[0]?.similarity ?? 0;
    const floor = Math.max(connection.minSimilarity, best - MEANING_MARGIN);
    return { used: true, rows: rows.filter((r) => r.similarity >= floor).map(({ similarity, ...row }) => ({ ...row, keyword: null, similarity })) };
  } catch (error) {
    // Without its vector a search goes on with its words alone.
    if (!(error instanceof AiError)) log("warn", "docs_search.meaning_failed", {}, error);
    return { used: true, rows: [] };
  }
}

/** Keyword's and meaning's candidates as one list: a part both found carries both. */
function joinCandidates(keyword: readonly DocsCandidate[], meaning: readonly DocsCandidate[]): DocsCandidate[] {
  const byId = new Map<number, DocsCandidate>(keyword.map((c) => [c.id, c]));
  for (const c of meaning) {
    const known = byId.get(c.id);
    byId.set(c.id, known ? { ...known, similarity: c.similarity } : c);
  }
  return [...byId.values()];
}

async function indexIsEmpty(): Promise<boolean> {
  const row = await typedRow(z.object({ empty: col.bool }), sql`select not exists (select 1 from commerce.docs_index) as empty`);
  return row?.empty ?? true;
}

const DETAILS = z.object({ id: bigId, url: col.text, headings: col.text, code: col.textOrNull, summary: col.text, text: col.text, section_title: col.textOrNull });

export type DocsSearchResult = { ok: true; answer: DocsSearchAnswer } | { ok: false; problem: "cursor" };

/**
 * A search of the docs: the parts found (or, without words, every document's start), merged by rank into documents, filtered, counted,
 * ordered and paged. A cursor made for another order is refused. An index not written yet (the minutes after the first deploy, a fresh
 * database) is written first.
 */
export async function searchDocs(query: DocsSearchQuery): Promise<DocsSearchResult> {
  const after = query.cursor ? decodeCursor(query.cursor, query.sort) : null;
  if (query.cursor && !after) return { ok: false, problem: "cursor" };
  const text = normalizeQuery(query.q);
  const browse = text === "";
  const withReads = query.sort === "read";

  const find = async () => {
    if (browse) return { candidates: await browseCandidates(withReads), meaning: false };
    const [keyword, meaning] = await Promise.all([keywordCandidates(text, withReads), meaningCandidates(text, withReads)]);
    return { candidates: joinCandidates(keyword, meaning.rows), meaning: meaning.used };
  };
  let found = await find();
  if (found.candidates.length === 0 && (await indexIsEmpty())) {
    await refreshDocsIndex({ embed: false });
    found = await find();
  }

  const match = matchOf(query.q, found.candidates);
  const docs = groupDocs(found.candidates, fuseRanks(found.candidates, match), match);
  const facets = facetCounts(docs, query.filters);
  const passing = docs.filter((doc) => passes(doc, query.filters));
  const { page, next } = pageOf(passing, query.sort, browse, after);

  const details = page.length
    ? await typedRows(DETAILS, sql`select id, url, headings, code, summary, text, section_title from commerce.docs_index where id = any(${`{${page.map((d) => d.best.id).join(",")}}`}::bigint[])`, readDb())
    : [];
  const byId = new Map(details.map((d) => [d.id, d]));
  const terms = browse ? [] : snippetTerms(text);
  const results: DocsSearchHit[] = page.flatMap((doc) => {
    const row = byId.get(doc.best.id);
    if (!row) return [];
    const words = browse || row.text.trim() === "" ? row.summary : row.text;
    return [
      {
        doc: doc.doc,
        href: docsPath(row.url, doc.lang),
        item: doc.item,
        track: doc.track,
        kind: doc.kind,
        lang: doc.lang,
        areas: doc.areas,
        title: doc.title,
        headings: row.headings.split("\n").filter(Boolean),
        section: doc.section && row.section_title ? { path: doc.section, title: row.section_title } : null,
        code: row.code,
        snippet: snippetOf(words, terms),
        checked: doc.checked,
      },
    ];
  });

  return {
    ok: true,
    answer: {
      q: query.q,
      filters: query.filters,
      sort: query.sort,
      match: passing.length === 0 && match !== "browse" ? "none" : match,
      meaning: found.meaning,
      found: docs.length,
      total: passing.length,
      results,
      facets,
      next,
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Misses and reads
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Adds one to a count, once an hour for one reader and one thing: a counter in `chat_usage` (`{kind}:{visitor}:{hash}`, under no store,
 * pruned after two days as every budget's) says whether this reader already counted it this hour; only the first time does `insert` run.
 */
async function onceAnHour(kind: string, visitor: string, thing: string, insert: SQL): Promise<boolean> {
  const bucket = `${kind}:${visitor.slice(0, 32)}:${sha(thing).slice(0, 24)}`;
  const rows = await db().execute(sql`
    with seen as (
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${bucket}, date_trunc('hour', now()), 1)
      on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
      returning count
    )
    ${insert}
  `);
  return rows.length > 0;
}

/**
 * Counts a search that found nothing for the docs' gap list, under its words as a search reads them (`missQuery()`); words that are not
 * counted (too short, a person's details, a secret) and a reader's same search within the hour count nothing. Whether it was counted.
 */
export async function countDocsMiss(raw: string, lang: DocLang, visitor: string): Promise<boolean> {
  const query = missQuery(raw);
  if (!query) return false;
  return onceAnHour(
    "docs_miss",
    visitor,
    `${lang}|${query}`,
    sql`
      insert into commerce.docs_search_misses (query, lang, misses, first_at, last_at)
      select ${query}, ${lang}, 1, now(), now() from seen where seen.count = 1
      on conflict (query, lang) do update set misses = commerce.docs_search_misses.misses + 1, last_at = now()
      returning 1
    `,
  );
}

/**
 * Counts a question the docs guide (D444) said the docs do not cover, for the gap list beside the searches: under the topic the guide gave,
 * read as a search's words are (`missQuery()`: never what looks like an email address, a long number or a token), in the conversation's
 * language; one reader's same topic within the hour counts once. Whether it was counted.
 */
export async function countGuideMiss(topic: string, lang: DocLang, visitor: string): Promise<boolean> {
  const query = missQuery(topic);
  if (!query) return false;
  return onceAnHour(
    "docs_guide_miss",
    visitor,
    `${lang}|${query}`,
    sql`
      insert into commerce.docs_search_misses (query, lang, misses, guide_misses, first_at, last_at)
      select ${query}, ${lang}, 0, 1, now(), now() from seen where seen.count = 1
      on conflict (query, lang) do update set guide_misses = commerce.docs_search_misses.guide_misses + 1, last_at = now()
      returning 1
    `,
  );
}

/** Counts a read of a docs page (once an hour for one reader). Whether it was counted. */
export async function countDocsRead(path: string, lang: DocLang, visitor: string): Promise<boolean> {
  return onceAnHour(
    "docs_read",
    visitor,
    `${lang}|${path}`,
    sql`
      insert into commerce.docs_reads (path, lang, day, reads)
      select ${path}, ${lang}, current_date, 1 from seen where seen.count = 1
      on conflict (path, lang, day) do update set reads = commerce.docs_reads.reads + 1
      returning 1
    `,
  );
}

export type DocsMiss = { query: string; lang: DocLang; misses: number; guideMisses: number; firstAt: string; lastAt: string };

/**
 * The searches that found nothing and the questions the guide could not answer (D444) in the last 90 days, the most often first: the docs'
 * gap list, for the platform's admins.
 */
export async function listDocsMisses(limit = 100): Promise<DocsMiss[]> {
  const rows = await typedRows(
    z.object({ query: col.text, lang: z.enum(DOC_LANGS), misses: col.int, guide_misses: col.int, first_at: col.timestamp, last_at: col.timestamp }),
    sql`
      select query, lang, misses, guide_misses, first_at, last_at from commerce.docs_search_misses
      where last_at > now() - interval '90 days'
      order by misses + guide_misses desc, last_at desc, query
      limit ${Math.min(Math.max(limit, 1), 500)}
    `,
  );
  return rows.map((r) => ({ query: r.query, lang: r.lang, misses: r.misses, guideMisses: r.guide_misses, firstAt: r.first_at, lastAt: r.last_at }));
}

/** Takes a search off the gap list (it is answered now, or it names someone). Audited with its language and count, never its words. */
export async function removeDocsMiss(admin: { id: string }, query: string, lang: DocLang): Promise<boolean> {
  const row = await typedRow(
    z.object({ misses: col.int }),
    sql`delete from commerce.docs_search_misses where query = ${query} and lang = ${lang} returning misses`,
  );
  if (row) await audit(admin.id, null, "platform.docs_miss_removed", { lang, misses: row.misses });
  return row !== null;
}
