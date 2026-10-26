import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  compareOptions,
  NOTES_MAX,
  normaliseSource,
  RESEARCH_KEEP_DAYS,
  SOURCE_DAYS,
  type CompareOptionsInput,
} from "@/lib/research";
import { isReadableType, PAGE_MAX_BYTES, PAGES_PER_DAY, pageText } from "@/lib/web-page-text";
import { SEARCH_APIS, SEARCH_MODEL, searchHostOk, SEARCHES_PER_DAY, type Freshness, type SearchResult } from "@/lib/web-search";

import { currentActor } from "./actor";
import { aiRoomLeft } from "./ai";
import { recordUsage } from "./ai-usage";
import { log } from "./log";
import { OwnerToolError } from "./owner-tool-error";
import { safeFetch, type FetchOptions, type Fetched } from "./replicate-fetch";
import type { Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";
import { searchConnection } from "./web-search-settings";

/**
 * The AI's web research (D329, `docs/ai-autopilot.md` 13), the only writer of `commerce.research_sources` and `research_notes`: a search
 * through the platform's search service (metered as AI usage on Kaizena Flow's key), a public page read through `safeFetch()`, notes that
 * cite only addresses the store searched or read, and comparisons added up in code. For a store, or Kaizena Flow's own site (no store).
 */

export type ResearchActor = { account: { id: string }; store: Store | null };

export type ResearchDeps = {
  /** The search service's request; `fetch` unless given (tests). */
  fetch?: typeof fetch;
  /** A page's fetch; `safeFetch()` unless given (tests). */
  fetchPage?: (url: string, options: FetchOptions) => Promise<Fetched>;
};

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const storeIdOf = (a: ResearchActor) => a.store?.id ?? null;
const inScope = (a: ResearchActor, column = sql`store_id`) => (a.store ? sql`${column} = ${a.store.id}::uuid` : sql`${column} is null`);

async function countToday(a: ResearchActor, kind: "search" | "page"): Promise<number> {
  // Searches are counted from the usage they were recorded as (one found nothing keeps no source), pages from the pages kept.
  const row = await typedRow(
    z.object({ n: col.int }),
    kind === "search"
      ? sql`select coalesce(sum(searches), 0)::int as n from commerce.ai_usage where ${inScope(a)} and kind = 'search' and created_at > now() - interval '1 day'`
      : sql`select count(*)::int as n from commerce.research_sources where ${inScope(a)} and kind = 'page' and created_at > now() - interval '1 day'`,
  );
  return row?.n ?? 0;
}

async function keepSources(a: ResearchActor, kind: "search" | "page", rows: { url: string; title: string; hash?: string | null }[]): Promise<void> {
  const kept = rows.map((r) => ({ ...r, url: normaliseSource(r.url) })).filter((r): r is { url: string; title: string; hash?: string | null } => r.url !== null);
  if (kept.length === 0) return;
  await db().execute(sql`
    insert into commerce.research_sources (store_id, kind, url, title, text_hash, account_id, created_at)
    values ${sql.join(
      kept.map((r) => sql`(${storeIdOf(a)}::uuid, ${kind}, ${r.url.slice(0, 2000)}, ${r.title.slice(0, 300)}, ${r.hash ?? null}, ${a.account.id}::uuid, now())`),
      sql`, `,
    )}
  `);
}

export type SearchInput = { query: string; count: number; country?: string; freshness: Freshness };

/** One search: the platform's service set and on, the store's AI and the day's searches not spent; recorded as usage and as sources. */
export async function searchWeb(a: ResearchActor, input: SearchInput, deps: ResearchDeps = {}): Promise<{ query: string; results: SearchResult[] }> {
  const connection = await searchConnection();
  if (!connection) return fail("Web search is not set up: a platform admin sets the search service on Platform → AI.");
  if (a.store && !(await aiRoomLeft(a.store.id))) return fail("The store's AI for this month on Kaizena Flow's key is used up, so web search is too.");
  if ((await countToday(a, "search")) >= SEARCHES_PER_DAY) return fail(`The day's ${SEARCHES_PER_DAY} web searches are used: try again tomorrow, or work with what was found.`);
  const api = SEARCH_APIS[connection.provider];
  const request = api.request({ query: input.query, count: input.count, country: input.country ?? null, freshness: input.freshness }, connection.apiKey);
  if (!searchHostOk(connection.provider, request.url)) return fail("The search service's address is not the one it is reached at.");
  const usage = { storeId: storeIdOf(a), feature: currentActor() === "autopilot" ? ("autopilot" as const) : ("web_research" as const), accountId: a.account.id };
  const base = { source: "platform" as const, provider: connection.provider, model: SEARCH_MODEL, kind: "search" as const };
  let body: unknown;
  try {
    const response = await (deps.fetch ?? fetch)(request.url, { headers: request.headers, signal: AbortSignal.timeout(10_000), redirect: "error" });
    if (!response.ok) {
      await recordUsage(usage, { ...base, failed: true });
      return fail(response.status === 429 ? "The search service is busy: try again in a minute." : `The search service answered ${response.status}.`);
    }
    body = await response.json();
  } catch (error) {
    if (error instanceof OwnerToolError) throw error;
    log("warn", "research.search_failed", { provider: connection.provider }, error);
    await recordUsage(usage, { ...base, failed: true });
    return fail("The search service could not be reached.");
  }
  const results = api.parse(body);
  await recordUsage(usage, { ...base, amounts: { searches: 1 }, failed: results === null });
  if (results === null) return fail("The search service gave an answer that could not be read.");
  await keepSources(a, "search", results.map((r) => ({ url: r.url, title: r.title })));
  return { query: input.query, results };
}

/** A public page's title, description and readable text, through `safeFetch()`; kept as a source. */
export async function readWebPage(
  a: ResearchActor,
  input: { url: string },
  deps: ResearchDeps = {},
): Promise<{ url: string; title: string; description: string; text: string; cut: boolean }> {
  if (!normaliseSource(input.url)) return fail("Give a page's full address, starting with https://.");
  if ((await countToday(a, "page")) >= PAGES_PER_DAY) return fail(`The day's ${PAGES_PER_DAY} pages are read: try again tomorrow.`);
  const fetched = await (deps.fetchPage ?? safeFetch)(input.url, {
    maxBytes: PAGE_MAX_BYTES,
    timeoutMs: 15_000,
    accept: "text/html,application/xhtml+xml,text/plain;q=0.9",
  });
  if (!fetched.ok) return fail(`The page could not be read: ${fetched.problem}`);
  if (!isReadableType(fetched.contentType)) return fail(`That address is ${fetched.contentType || "a file"}, not a page that can be read.`);
  const page = pageText(new TextDecoder("utf-8").decode(fetched.bytes), fetched.contentType);
  const hash = createHash("sha256").update(page.text).digest("hex");
  // Both the address asked for and the one it ended at count as read.
  const read = [...new Set([input.url, fetched.url])].map((url) => ({ url, title: page.title, hash }));
  await keepSources(a, "page", read);
  return { url: fetched.url, ...page };
}

/** Of the addresses given, those the store did not search or read within `SOURCE_DAYS`. */
async function unknownSources(a: ResearchActor, sources: readonly string[]): Promise<string[]> {
  const wanted = sources.map((s) => ({ given: s, url: normaliseSource(s) }));
  const urls = wanted.map((w) => w.url).filter((u): u is string => u !== null);
  const known = urls.length
    ? new Set(
        (
          await typedRows(
            z.object({ url: col.text }),
            sql`select distinct url from commerce.research_sources where ${inScope(a)} and created_at > now() - make_interval(days => ${SOURCE_DAYS})
              and url in (${sql.join(urls.map((u) => sql`${u}`), sql`, `)})`,
          )
        ).map((r) => r.url),
      )
    : new Set<string>();
  return wanted.filter((w) => !w.url || !known.has(w.url)).map((w) => w.given);
}

async function keepNote(a: ResearchActor, note: { kind: "note" | "comparison"; topic: string; finding: string; sources: string[]; data?: unknown }): Promise<string> {
  const unknown = await unknownSources(a, note.sources);
  if (unknown.length) return fail(`These were not searched or read in the last ${SOURCE_DAYS} days, so a note cannot cite them: ${unknown.slice(0, 5).join(", ")}. Read them with read_web_page first.`);
  const count = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.research_notes where ${inScope(a)}`);
  if ((count?.n ?? 0) >= NOTES_MAX) return fail(`The store keeps ${NOTES_MAX} research notes at most.`);
  const sources = [...new Set(note.sources.map((s) => normaliseSource(s) as string))];
  // A Postgres array literal: an array given to sql`` would be spread into separate parameters.
  const literal = `{${sources.map((u) => `"${u.replace(/["\\]/g, (c) => `\\${c}`)}"`).join(",")}}`;
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.research_notes (store_id, kind, topic, finding, sources, data, account_id)
      values (${storeIdOf(a)}::uuid, ${note.kind}, ${note.topic}, ${note.finding.slice(0, 2000)}, ${literal}::text[], ${note.data === undefined ? null : JSON.stringify(note.data)}::jsonb, ${a.account.id}::uuid)
      returning id`,
  );
  return row?.id ?? fail("The note could not be kept.");
}

export async function saveResearchNote(a: ResearchActor, input: { topic: string; finding: string; sources: string[] }): Promise<{ id: string }> {
  return { id: await keepNote(a, { kind: "note", ...input }) };
}

export type ResearchNote = { id: string; kind: string; topic: string; finding: string; sources: string[]; data: unknown; createdAt: string };

export async function listResearchNotes(a: ResearchActor, input: { topic?: string; limit: number }): Promise<ResearchNote[]> {
  const words = input.topic?.trim();
  const rows = await typedRows(
    z.object({ id: col.uuid, kind: col.text, topic: col.text, finding: col.text, sources: z.array(z.string()), data: z.unknown(), created_at: col.timestamp }),
    sql`select id, kind, topic, finding, sources, data, created_at from commerce.research_notes where ${inScope(a)}
      ${words ? sql`and (topic ilike ${`%${escapeLike(words)}%`} or finding ilike ${`%${escapeLike(words)}%`})` : sql``}
      order by created_at desc limit ${input.limit}`,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, topic: r.topic, finding: r.finding, sources: r.sources, data: r.data, createdAt: r.created_at }));
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A comparison added up in code (`compareOptions()`) and kept as a note of kind `comparison`, its ranking written by code. */
export async function compareAndKeep(a: ResearchActor, input: CompareOptionsInput) {
  const result = compareOptions(input);
  if (!result.ok) return fail(result.problem);
  const ranking = result.comparison.options.map((o) => `${o.rank}. ${o.name} (${o.percent} %)`).join(", ");
  const id = await keepNote(a, { kind: "comparison", topic: input.topic, finding: `Ranked by weighted score: ${ranking}.`, sources: input.sources, data: result.comparison });
  return { id, comparison: result.comparison };
}

/** Searched and read addresses older than `RESEARCH_KEEP_DAYS` go (daily; notes keep their own copy of the addresses). Never throws. */
export async function pruneResearch(): Promise<number> {
  try {
    const rows = await db().execute(sql`delete from commerce.research_sources where created_at < now() - make_interval(days => ${RESEARCH_KEEP_DAYS}) returning id`);
    return rows.length;
  } catch (error) {
    log("error", "research.prune_failed", {}, error);
    return 0;
  }
}
