/**
 * The docs' search engine's rules (wave 14 unit E3, D443): everything about a search that needs no database, so it is tested alone. Reading a
 * search from an address, the reviewed synonyms, the words a miss is counted under, merging what keyword and meaning found by rank (as
 * `searchKnowledge()` merges them, D81), grouping parts into documents, the filters and their counts, the orders, the cursor and the
 * snippet. `src/server/docs-search.ts` asks the database for the candidates and hands them here.
 */

import { DOC_AREAS, DOC_KINDS, DOC_LANGS, DOC_TRACKS, type DocArea, type DocKind, type DocLang, type DocTrack } from "./docs-content";
import type { DocsIndexRow } from "./docs-index";
import {
  DOCS_FACETS,
  DOCS_PAGE_SIZE,
  DOCS_QUERY_MAX,
  DOCS_SORTS,
  type DocsFacet,
  type DocsFacetName,
  type DocsFilters,
  type DocsItem,
  type DocsMatch,
  type DocsSearchQuery,
  type DocsSnippetPart,
  type DocsSort,
} from "./docs-search";
import { normalizeQuery } from "./search";
import { expandQuery, type SynonymGroup } from "./search-synonyms";

// ---------------------------------------------------------------------------------------------------------------------
// Reading a search
// ---------------------------------------------------------------------------------------------------------------------

const SECTION = /^(?:owners|developers)\/[a-z0-9][a-z0-9-]{0,60}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,800}$/;

export type ReadSearch = { ok: true; query: DocsSearchQuery } | { ok: false; problem: "cursor" };

type Params = URLSearchParams | Record<string, string | string[] | undefined>;

function values(params: Params, key: string): string[] {
  if (params instanceof URLSearchParams) return params.getAll(key);
  const value = params[key];
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

/** One facet's values from the address: comma-separated, repeated or both; unknown values are left out, each kept once, sorted. */
function chosen<T extends string>(params: Params, key: string, known: readonly T[]): T[] {
  const out = new Set<T>();
  for (const value of values(params, key)) {
    for (const part of value.split(",")) {
      const v = part.trim().toLowerCase();
      if ((known as readonly string[]).includes(v)) out.add(v as T);
    }
  }
  return [...out].sort();
}

/**
 * A search as an address asks it (`?q=&track=&kind=&area=&lang=&section=&sort=&cursor=`). Lenient where it can be: a filter's unknown value
 * and an unknown order are left out (the default order is used), and words past `DOCS_QUERY_MAX` are cut; a cursor that is not one is
 * refused, as the Admin API refuses one.
 */
export function readDocsSearch(params: Params): ReadSearch {
  const q = (values(params, "q")[0] ?? "").replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, DOCS_QUERY_MAX).trim();
  const section = values(params, "section")[0]?.trim().toLowerCase() ?? "";
  const sort = values(params, "sort")[0]?.trim().toLowerCase() ?? "";
  const cursor = values(params, "cursor")[0]?.trim() ?? "";
  if (cursor && !CURSOR.test(cursor)) return { ok: false, problem: "cursor" };
  return {
    ok: true,
    query: {
      q,
      filters: {
        track: chosen(params, "track", DOC_TRACKS),
        kind: chosen(params, "kind", DOC_KINDS),
        area: chosen(params, "area", DOC_AREAS),
        lang: chosen(params, "lang", DOC_LANGS),
        section: SECTION.test(section) ? section : null,
      },
      sort: (DOCS_SORTS as readonly string[]).includes(sort) ? (sort as DocsSort) : "relevance",
      cursor: cursor || null,
    },
  };
}

/** A search as the search page reads its address: as `readDocsSearch()`, a cursor that is not one being the first page rather than an error. */
export function readDocsSearchPage(params: Params): DocsSearchQuery {
  const read = readDocsSearch(params);
  if (read.ok) return read.query;
  const others = params instanceof URLSearchParams ? new URLSearchParams(params) : { ...params };
  if (others instanceof URLSearchParams) others.delete("cursor");
  else delete others.cursor;
  return (readDocsSearch(others) as Extract<ReadSearch, { ok: true }>).query;
}

// ---------------------------------------------------------------------------------------------------------------------
// Words: synonyms, the words of a search, misses
// ---------------------------------------------------------------------------------------------------------------------

const both = (...words: string[]): SynonymGroup => ({ kind: "both", words, means: [] });

/**
 * The docs' synonyms (reviewed, as a store's own are, D324): each word of a group also finds the others, across English and Norwegian, so
 * "mva" finds the pages about VAT and "quote" the ones about offers. Small on purpose: a word goes here when readers are known to use it for
 * a thing the docs name otherwise, never a near-meaning. Kept in `normalizeQuery()`'s form.
 */
export const DOCS_SYNONYMS: readonly SynonymGroup[] = [
  both("vat", "mva", "moms", "merverdiavgift"),
  both("quote", "offer", "tilbud", "quotation"),
  both("shipping", "delivery", "frakt", "levering"),
  both("refund", "refusjon", "tilbakebetaling"),
  both("return", "retur"),
  both("withdrawal", "angrerett"),
  both("discount", "rabatt", "coupon"),
  both("discount code", "rabattkode"),
  both("stock", "inventory", "lager", "lagerbeholdning"),
  both("order", "ordre", "bestilling"),
  both("product", "produkt"),
  both("customer", "kunde"),
  both("invoice", "faktura"),
  both("payment", "betaling"),
  both("store", "shop", "butikk", "nettbutikk"),
  both("theme", "tema"),
  both("gift card", "gavekort"),
  both("subscription", "abonnement"),
  both("picture", "image", "photo", "bilde"),
  both("price", "pris"),
  both("domain", "domene"),
  both("sign up", "register", "registrer"),
  both("sign in", "log in", "login", "logg inn"),
  both("token", "api key"),
];

/** The search's alternatives through the synonyms: the search with one word put in place of another, at most eight. */
export const docsAlternatives = (q: string): string[] => expandQuery(q, DOCS_SYNONYMS);

/** The words of a search, as text search reads them: letters and digits only, at most eight, so nothing typed changes a query's meaning. */
export function queryWords(q: string): string[] {
  return (normalizeQuery(q).match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 8);
}

/** `a | b | c`: any of the search's words (and its alternatives' words), for the fallback when no part has them all; null without words. */
export function anyWordsQuery(q: string): string | null {
  const words = [...new Set([...queryWords(q), ...docsAlternatives(q).flatMap(queryWords)])];
  return words.length === 0 ? null : words.join(" | ");
}

/** The words a result's snippet marks: the search's and its alternatives', each at least two letters. */
export function snippetTerms(q: string): string[] {
  return [...new Set([...queryWords(q), ...docsAlternatives(q).flatMap(queryWords)])].filter((w) => w.length >= 2);
}

/**
 * The words a search that found nothing is counted under for the docs' gap list, or null when it is not counted: tidied as a search reads it,
 * two to a hundred characters with a letter, and never what looks like a person's details or a secret (an email address, a long number such
 * as a phone's, an order's or a card's, a token).
 */
export function missQuery(raw: string): string | null {
  const q = normalizeQuery(raw);
  if (q.length < 2 || q.length > DOCS_QUERY_MAX) return null;
  if (!/\p{L}/u.test(q)) return null;
  if (q.includes("@")) return null;
  if (/\d[\d\s().+-]{5,}\d/.test(q)) return null;
  if (/\bkfs?_[\w-]{6,}/.test(q) || /\b(?:sk|pk|rk)_(?:live|test)_\w+/.test(q)) return null;
  return q;
}

// ---------------------------------------------------------------------------------------------------------------------
// Ranking: candidates, merging by rank, documents
// ---------------------------------------------------------------------------------------------------------------------

/** A row the database found for a search, with what found it. */
export type DocsCandidate = {
  id: number;
  doc: string;
  item: DocsItem;
  track: DocTrack;
  kind: DocKind;
  lang: DocLang;
  areas: DocArea[];
  section: string | null;
  title: string;
  checked: string | null;
  reading: number;
  position: number;
  /** Found by its words: the score (title and headings weigh most) and whether it had every word (`all`) or only some. */
  keyword: { score: number; all: boolean } | null;
  /** Found by meaning: how close (cosine similarity), when the platform's AI made vectors. */
  similarity: number | null;
  /** The page's reads over the last 90 days (for *Most read*). */
  reads: number;
};

/** A document as a list shows it: its best part, its facts, its score. */
export type DocsDoc = {
  doc: string;
  best: DocsCandidate;
  score: number;
  item: DocsItem;
  track: DocTrack;
  kind: DocKind;
  lang: DocLang;
  areas: DocArea[];
  section: string | null;
  title: string;
  checked: string | null;
  reading: number;
  reads: number;
};

/** The rank fusion's damping, as `searchKnowledge()` and the store's search use. */
export const RRF_K = 60;

/** How a search's words were matched (`DocsMatch`): every word where any part has them all (or meaning found it), else some, else none. */
export function matchOf(q: string, candidates: readonly DocsCandidate[]): DocsMatch {
  if (q.trim() === "") return "browse";
  if (candidates.some((c) => c.keyword?.all || c.similarity !== null)) return "all";
  if (candidates.some((c) => c.keyword)) return "any";
  return "none";
}

/**
 * Each part's score: keyword's and meaning's lists each ordered best first, and each list gives a part 1 / (k + its place), summed
 * (reciprocal rank fusion). Ranks, not scores, so the two scales combine; ties keep the docs' reading order. With `any`, only the keyword
 * list counts (meaning had nothing, or `all` would have been chosen).
 */
export function fuseRanks(candidates: readonly DocsCandidate[], match: DocsMatch): Map<number, number> {
  const byReading = (a: DocsCandidate, b: DocsCandidate) => a.reading - b.reading || a.position - b.position;
  const keyword = candidates
    .filter((c) => c.keyword && (match === "any" || c.keyword.all))
    .sort((a, b) => (b.keyword?.score ?? 0) - (a.keyword?.score ?? 0) || byReading(a, b));
  const meaning = match === "all" ? candidates.filter((c) => c.similarity !== null).sort((a, b) => (b.similarity ?? 0) - (a.similarity ?? 0) || byReading(a, b)) : [];
  const scores = new Map<number, number>();
  for (const list of [keyword, meaning]) list.forEach((c, rank) => scores.set(c.id, (scores.get(c.id) ?? 0) + 1 / (RRF_K + rank + 1)));
  return scores;
}

/**
 * The documents the parts belong to, each at its best part (the highest score; at a tie the earlier part). In `browse`, every candidate is a
 * document's start and scores nothing.
 */
export function groupDocs(candidates: readonly DocsCandidate[], scores: ReadonlyMap<number, number>, match: DocsMatch): DocsDoc[] {
  const docs = new Map<string, DocsDoc>();
  for (const c of candidates) {
    if (match !== "browse" && !scores.has(c.id)) continue;
    const score = scores.get(c.id) ?? 0;
    const known = docs.get(c.doc);
    if (known && (known.score > score || (known.score === score && known.best.position <= c.position))) continue;
    docs.set(c.doc, {
      doc: c.doc,
      best: c,
      score,
      item: c.item,
      track: c.track,
      kind: c.kind,
      lang: c.lang,
      areas: c.areas,
      section: c.section,
      title: c.title,
      checked: c.checked,
      reading: c.reading,
      reads: c.reads,
    });
  }
  return [...docs.values()];
}

/** The documents of the index's rows for a list without words (a section's page at build): each document's start, in reading order. */
export function browseDocs(rows: readonly Pick<DocsIndexRow, "doc" | "item" | "track" | "kind" | "lang" | "areas" | "section" | "title" | "checked" | "reading" | "position">[]): DocsDoc[] {
  const candidates: DocsCandidate[] = rows
    .filter((row) => row.position === 0)
    .map((row, i) => ({ ...row, id: i, keyword: null, similarity: null, reads: 0 }));
  return groupDocs(candidates, new Map(), "browse");
}

// ---------------------------------------------------------------------------------------------------------------------
// Filters and their counts
// ---------------------------------------------------------------------------------------------------------------------

const valuesOf = (doc: DocsDoc, facet: DocsFacetName): readonly string[] => (facet === "area" ? doc.areas : [doc[facet]]);

/**
 * Whether a document passes the filters: within a facet any chosen value (a document with several areas passes on any of them), across
 * facets every one, and the section when one is chosen; `except` leaves one facet out (for its own counts).
 */
export function passes(doc: DocsDoc, filters: DocsFilters, except: DocsFacetName | null = null): boolean {
  for (const facet of DOCS_FACETS) {
    if (facet === except) continue;
    const want = filters[facet] as readonly string[];
    if (want.length > 0 && !valuesOf(doc, facet).some((v) => want.includes(v))) return false;
  }
  return filters.section === null || doc.section === filters.section;
}

const FACET_VALUES: Record<DocsFacetName, readonly string[]> = { track: DOC_TRACKS, kind: DOC_KINDS, lang: DOC_LANGS, area: DOC_AREAS };

/**
 * Each filter's values with how many documents choosing it would leave: the other filters applied, not its own (so choosing a second kind
 * adds to the list, and the counts say how much). A value is listed when it would leave any, or when it is chosen (so it can be taken away).
 * Tracks, kinds and languages keep their own order; areas come most first.
 */
export function facetCounts(docs: readonly DocsDoc[], filters: DocsFilters): Record<DocsFacetName, DocsFacet[]> {
  const out = {} as Record<DocsFacetName, DocsFacet[]>;
  for (const facet of DOCS_FACETS) {
    const counts = new Map<string, number>();
    for (const doc of docs) {
      if (!passes(doc, filters, facet)) continue;
      for (const value of new Set(valuesOf(doc, facet))) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    const chosenNow = filters[facet] as readonly string[];
    const listed = FACET_VALUES[facet]
      .map((value) => ({ value, count: counts.get(value) ?? 0, selected: chosenNow.includes(value) }))
      .filter((f) => f.count > 0 || f.selected);
    out[facet] = facet === "area" ? listed.sort((a, b) => b.count - a.count) : listed;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Orders and the cursor
// ---------------------------------------------------------------------------------------------------------------------

type SortKey = (number | string)[];

const collator = new Intl.Collator(["nb", "en"], { sensitivity: "base", numeric: true });

/** `2026-11-03` as a number that sorts the most recent first (`-20261103`); none after every day. */
const recentFirst = (day: string | null): number => (day ? -Number(day.replaceAll("-", "")) : 0);

/**
 * What a document is ordered by in a list, compared item by item, the document's key last so no two are equal: best match (the score, then
 * the docs' reading order; without words the reading order alone), recently checked, A to Z (its title, then language), most read.
 */
export function sortKey(doc: DocsDoc, sort: DocsSort, browse: boolean): SortKey {
  const relevance: SortKey = browse ? [doc.reading, doc.doc] : [-doc.score, doc.reading, doc.doc];
  switch (sort) {
    case "relevance":
      return relevance;
    case "checked":
      return [recentFirst(doc.checked), ...relevance];
    case "title":
      return [doc.title, doc.lang, doc.doc];
    case "read":
      return [-doc.reads, ...relevance];
  }
}

export function compareKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? 0 : -1) : 1;
    const order = typeof x === "number" && typeof y === "number" ? x - y : collator.compare(String(x), String(y)) || (String(x) < String(y) ? -1 : String(x) > String(y) ? 1 : 0);
    if (order !== 0) return order < 0 ? -1 : 1;
  }
  return 0;
}

export function sortDocs(docs: readonly DocsDoc[], sort: DocsSort, browse: boolean): DocsDoc[] {
  return docs
    .map((doc) => ({ doc, key: sortKey(doc, sort, browse) }))
    .sort((a, b) => compareKeys(a.key, b.key))
    .map(({ doc }) => doc);
}

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string | null {
  try {
    const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  } catch {
    return null;
  }
}

/**
 * A page's cursor: the order it was made in and the last document's key, so the next page starts after that document wherever it now stands
 * (a document added or gone meanwhile moves nothing else).
 */
export function encodeCursor(sort: DocsSort, key: SortKey): string {
  return toBase64Url(JSON.stringify([sort, ...key]));
}

/** A cursor's key when it was made for this order and is one, else null. */
export function decodeCursor(cursor: string, sort: DocsSort): SortKey | null {
  const text = fromBase64Url(cursor);
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(value) || value[0] !== sort || value.length < 2 || value.length > 6) return null;
  const key = value.slice(1);
  return key.every((part) => (typeof part === "number" && Number.isFinite(part)) || (typeof part === "string" && part.length <= 400)) ? (key as SortKey) : null;
}

/** One page of documents in order: from after the cursor's document, `size` of them, and the cursor of the next page (null on the last). */
export function pageOf(
  docs: readonly DocsDoc[],
  sort: DocsSort,
  browse: boolean,
  after: SortKey | null,
  size = DOCS_PAGE_SIZE,
): { page: DocsDoc[]; next: string | null } {
  const ordered = sortDocs(docs, sort, browse);
  const start = after ? ordered.findIndex((doc) => compareKeys(sortKey(doc, sort, browse), after) > 0) : 0;
  if (start < 0) return { page: [], next: null };
  const page = ordered.slice(start, start + size);
  const more = start + size < ordered.length;
  return { page, next: more && page.length > 0 ? encodeCursor(sort, sortKey(page[page.length - 1], sort, browse)) : null };
}

// ---------------------------------------------------------------------------------------------------------------------
// The snippet
// ---------------------------------------------------------------------------------------------------------------------

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How many characters a snippet shows. */
export const SNIPPET_MAX = 220;

/**
 * A result's few words: around the first place one of `terms` starts a word (else from the start), cut at words with an ellipsis, each word
 * that starts with a term marked (so "product" marks "products"). Text only: a part is drawn by React as text, never as HTML.
 */
export function snippetOf(text: string, terms: readonly string[], max = SNIPPET_MAX): DocsSnippetPart[] {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat === "") return [];
  const usable = [...terms].filter((t) => t.length >= 2).sort((a, b) => b.length - a.length);
  const pattern = usable.length > 0 ? new RegExp(`(?<![\\p{L}\\p{N}])(?:${usable.map(escapeRegex).join("|")})[\\p{L}\\p{N}]*`, "giu") : null;
  const first = pattern ? flat.search(new RegExp(pattern.source, "iu")) : -1;
  let start = first > 40 ? first - 40 : 0;
  if (start > 0) {
    const space = flat.indexOf(" ", start);
    start = space >= 0 && space < first ? space + 1 : start;
  }
  let end = Math.min(flat.length, start + max);
  if (end < flat.length) {
    const space = flat.lastIndexOf(" ", end);
    if (space > start + max / 2) end = space;
  }
  const window = flat.slice(start, end);
  const parts: DocsSnippetPart[] = [];
  const push = (value: string, hit: boolean) => {
    if (!value) return;
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += value;
    else parts.push({ text: value, hit });
  };
  if (start > 0) push("…", false);
  let at = 0;
  if (pattern) {
    for (const match of window.matchAll(pattern)) {
      push(window.slice(at, match.index), false);
      push(match[0], true);
      at = (match.index ?? 0) + match[0].length;
    }
  }
  push(window.slice(at), false);
  if (end < flat.length) push("…", false);
  return parts;
}

