/**
 * A media library's search and order, as its address holds them (D88):
 * `q` the words, `kind` pictures or videos, `sort` the order without
 * words, `n` how many are shown ("Show more" adds a page).
 */
export type MediaKind = "image" | "video";

export const MEDIA_SORTS = { newest: "Newest first", oldest: "Oldest first", largest: "Largest first", name: "Name" } as const;
export type MediaSort = keyof typeof MEDIA_SORTS;

/** Items per page, and the most one address shows. */
export const MEDIA_PAGE = 48;
export const MEDIA_MOST = 480;

export type MediaQuery = { q: string; kind: MediaKind | "all"; sort: MediaSort; limit: number };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

/** The query an address asks for; anything unknown falls back to the defaults. */
export function mediaQuery(params: Record<string, string | string[] | undefined>): MediaQuery {
  const kind = one(params.kind);
  const sort = one(params.sort);
  const pages = Math.ceil(Number.parseInt(one(params.n), 10) / MEDIA_PAGE) || 1;
  return {
    q: one(params.q).trim().slice(0, 200),
    kind: kind === "image" || kind === "video" ? kind : "all",
    sort: Object.hasOwn(MEDIA_SORTS, sort) ? (sort as MediaSort) : "newest",
    limit: Math.min(Math.max(pages, 1) * MEDIA_PAGE, MEDIA_MOST),
  };
}

/** The address for a query, leaving out what is the default. */
export function mediaAddress(basePath: string, query: MediaQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.kind !== "all") params.set("kind", query.kind);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.limit > MEDIA_PAGE) params.set("n", String(query.limit));
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}
