/**
 * A media library's search and order, as its address holds them (D88):
 * `q` the words, `kind` pictures or videos, `sort` the order without
 * words, `n` how many are shown ("Show more" adds a page), `view` a grid
 * of pictures or a list with the details.
 */
export type MediaKind = "image" | "video";

export const MEDIA_SORTS = { newest: "Newest first", oldest: "Oldest first", largest: "Largest first", name: "Name" } as const;
export type MediaSort = keyof typeof MEDIA_SORTS;

/** Items per page, and the most one address shows. */
export const MEDIA_PAGE = 48;
export const MEDIA_MOST = 480;

export type MediaView = "grid" | "list";

export type MediaQuery = { q: string; kind: MediaKind | "all"; sort: MediaSort; limit: number; view: MediaView };

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
    view: one(params.view) === "list" ? "list" : "grid",
  };
}

/** The address for a query, leaving out what is the default. */
export function mediaAddress(basePath: string, query: MediaQuery): string {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.kind !== "all") params.set("kind", query.kind);
  if (query.sort !== "newest") params.set("sort", query.sort);
  if (query.limit > MEDIA_PAGE) params.set("n", String(query.limit));
  if (query.view === "list") params.set("view", "list");
  const search = params.toString();
  return search ? `${basePath}?${search}` : basePath;
}

/** File types' endings, as file names in the library have them. */
const EXTENSION = /\.(?:jpe?g|png|webp|avif|gif|svg|mp4|webm|mov)$/i;

/**
 * Whether a search is for a file by its name rather than for what a file
 * shows: it ends in a file type (`d58a….webp`), or is one word mixing
 * letters and digits such as a stored file's id. Such a search matches
 * names alone, never by meaning or likeness, so it finds that file and
 * not every file named in the same way.
 */
export function isFileNameQuery(query: string): boolean {
  const text = query.trim();
  if (EXTENSION.test(text)) return true;
  if (/\s/.test(text)) return false;
  return /[0-9]/.test(text) && /[a-z]/i.test(text) && text.length >= 8;
}

/** A search for a file name as it is compared: lower case, without the file type's ending. */
export function fileNameKey(value: string): string {
  return value.trim().toLowerCase().replace(EXTENSION, "");
}

/**
 * A file's name as words for search by meaning: without its ending and
 * without parts that are ids or numbers (a stored file's name is often
 * only an id), which say nothing of what it shows. Empty when nothing
 * readable is left.
 */
export function readableFileName(fileName: string): string {
  return fileName
    .replace(EXTENSION, "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, " ")
    .split(/[\s._-]+/)
    .filter((part) => part.length > 1 && !/\d/.test(part))
    .join(" ")
    .trim();
}
