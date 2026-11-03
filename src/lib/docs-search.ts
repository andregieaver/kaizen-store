/**
 * The docs' search (wave 14 unit E3, D443): what the top bar's script, the search dialog and the search page share. Pure and small, with no
 * import but types, as every docs page's few scripts load it: the shortcut, the event, the shape of a search and of its answer, and the
 * address a search is shared by. The engine's rules (reading a search, synonyms, facets, ranking, the cursor) are `docs-search-rules.ts`; the
 * index's rows are `docs-index.ts`; the database's part is `src/server/docs-search.ts`.
 */

import type { DocArea, DocKind, DocLang, DocTrack } from "./docs-content";

/** Whether a key press asks for the docs' search: ⌘K or Ctrl+K anywhere, `/` outside a field. */
export function isSearchShortcut(event: { key: string; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }, inField: boolean): boolean {
  if (event.altKey) return false;
  if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") return true;
  return event.key === "/" && !event.metaKey && !event.ctrlKey && !inField;
}

/** Said on `window` when the reader asks for the search (⌘K): the search dialog listens for it. */
export const DOCS_SEARCH_EVENT = "kaizen:docs-search";

/**
 * The hand-over to the docs' AI guide (unit E5, D444) from a search that found nothing: said on `window` with `{ question }` as its detail.
 * Until the guide exists nothing listens, so the offer is not shown (`DOCS_GUIDE_READY`); E5 sets it, listens for the event in the dialog,
 * and reads `?ask=` on the docs' front page for the search page without JavaScript (`docsAskSub()`).
 */
export const DOCS_ASK_EVENT = "kaizen:docs-ask";
export const DOCS_GUIDE_READY = false;

/** The docs' front page with a question for the guide, as a sub-path for `docsPath()`: `?ask=…`. */
export const docsAskSub = (question: string): string => `?ask=${encodeURIComponent(question)}`;

/** Where the search page is, as a sub-path for `docsPath()` (`/docs/search`, `/search` on the docs' host). */
export const DOCS_SEARCH_SUB = "search";

/** The API (the same on every host, as every `/api` is). */
export const DOCS_SEARCH_ENDPOINT = "/api/docs/search";
/** Where the dialog counts a search that found nothing, for the docs' gap list. */
export const DOCS_MISS_ENDPOINT = "/api/docs/search/miss";
/** Where an article counts that it was read, for *Most read*. */
export const DOCS_READ_ENDPOINT = "/api/docs/read";

/** The longest search read (as the store's search, `MAX_QUERY`); longer is cut. */
export const DOCS_QUERY_MAX = 100;
/** Results a page holds. */
export const DOCS_PAGE_SIZE = 20;
/** How long the dialog waits after a key before it searches. */
export const DOCS_DEBOUNCE_MS = 200;
/** How long a search that found nothing must stand before the dialog counts it as a miss (a word half typed is not one). */
export const DOCS_MISS_SETTLE_MS = 1500;

/** The orders a list can take: best match (the docs' own reading order without words), recently checked, A to Z, most read. */
export const DOCS_SORTS = ["relevance", "checked", "title", "read"] as const;
export type DocsSort = (typeof DOCS_SORTS)[number];

/** The filters with counts (facets), in the order they are shown. */
export const DOCS_FACETS = ["track", "kind", "lang", "area"] as const;
export type DocsFacetName = (typeof DOCS_FACETS)[number];

/**
 * What a result is: a part of an article or of the changelog, or an item of the reference that unit A's contracts describe (an Admin API
 * operation, a webhook topic, an owner MCP tool, a shopping agent's tool, an error code, an Admin API scope).
 */
export const DOCS_ITEMS = ["section", "changelog", "operation", "topic", "tool", "agent-tool", "error", "scope"] as const;
export type DocsItem = (typeof DOCS_ITEMS)[number];

export type DocsFilters = { track: DocTrack[]; kind: DocKind[]; area: DocArea[]; lang: DocLang[]; section: string | null };

export type DocsSearchQuery = { q: string; filters: DocsFilters; sort: DocsSort; cursor: string | null };

export const NO_FILTERS: DocsFilters = { track: [], kind: [], area: [], lang: [], section: null };

/** One value of a filter with how many results it would leave (the other filters applied, not its own), and whether it is chosen. */
export type DocsFacet = { value: string; count: number; selected: boolean };

/** A piece of a result's text, marked when it is one of the words searched for. */
export type DocsSnippetPart = { text: string; hit: boolean };

export type DocsSearchHit = {
  /** The document: a page in one language, or one reference item. */
  doc: string;
  /** The address to open, on whichever host serves the docs, with the section's anchor. */
  href: string;
  item: DocsItem;
  track: DocTrack;
  kind: DocKind;
  lang: DocLang;
  areas: DocArea[];
  title: string;
  /** The headings down to the part found (`Follow the setup steps`), none for a page's start or a reference item. */
  headings: string[];
  /** The page's section (`owners/getting-started`) and its title in the page's language. */
  section: { path: string; title: string } | null;
  /** A reference item's name as code (`GET /api/admin/v1/products/{id}`, `order.paid`). */
  code: string | null;
  snippet: DocsSnippetPart[];
  /** `YYYY-MM-DD`, when the page was last checked against the product; none for a reference item. */
  checked: string | null;
};

/**
 * How the words were matched: `all` (every word, or close to it), `any` (no result had every word, so these have some), `none` (nothing),
 * `browse` (no words: a list, in the docs' own order unless another is asked).
 */
export type DocsMatch = "all" | "any" | "none" | "browse";

export type DocsSearchAnswer = {
  q: string;
  filters: DocsFilters;
  sort: DocsSort;
  match: DocsMatch;
  /** Whether search by meaning took part (only while the platform's AI makes vectors). */
  meaning: boolean;
  /** Documents the words found before any filter: none means the docs do not cover it (a miss), not that the filters hid it. */
  found: number;
  /** Documents left after the filters. */
  total: number;
  results: DocsSearchHit[];
  facets: Record<DocsFacetName, DocsFacet[]>;
  /** The cursor of the next page (`cursor=`), or null on the last. */
  next: string | null;
};

const list = (values: readonly string[]) => [...new Set(values)].sort().join(",");

/**
 * A search as the address holds it, in one order, so a search shared is the same address however it was made: `q`, the filters (each a
 * comma-separated list, sorted), `section`, `sort` (left out when it is the default), `cursor`.
 */
export function docsSearchParams(query: { q: string; filters: DocsFilters; sort: DocsSort; cursor?: string | null }): URLSearchParams {
  const params = new URLSearchParams();
  const q = query.q.trim();
  if (q) params.set("q", q);
  for (const facet of ["track", "kind", "area", "lang"] as const) if (query.filters[facet].length > 0) params.set(facet, list(query.filters[facet]));
  if (query.filters.section) params.set("section", query.filters.section);
  if (query.sort !== "relevance") params.set("sort", query.sort);
  if (query.cursor) params.set("cursor", query.cursor);
  return params;
}

/** `?q=…&kind=…` for a search, or `""` for none. */
export function docsSearchQueryString(query: { q: string; filters: DocsFilters; sort: DocsSort; cursor?: string | null }): string {
  const text = docsSearchParams(query).toString();
  return text ? `?${text}` : "";
}

/** The filters with one value of one facet chosen, or taken away when it was chosen. */
export function toggleFilter(filters: DocsFilters, facet: DocsFacetName, value: string): DocsFilters {
  const now = filters[facet] as string[];
  const next = now.includes(value) ? now.filter((v) => v !== value) : [...now, value];
  return { ...filters, [facet]: next } as DocsFilters;
}

/** Whether any filter is chosen. */
export const hasFilters = (filters: DocsFilters): boolean =>
  filters.track.length + filters.kind.length + filters.area.length + filters.lang.length > 0 || filters.section !== null;
