/**
 * Addresses of redirects (wave 2, second run, D168, `docs/wave-2-redirects.md` 4.1), pure: the one normal form of a redirect's source and target, how a typed
 * or imported address is read into it, what is reserved, how a request's query string is kept, and where a request's own path is in this form. Shared by the
 * browser (the form), the import's plan, the resolver and the 404 report, so a source stored, a source typed and a request for it always agree.
 *
 * A source and a target are the part of an address AFTER the market (`/p/old-cup`, not `/no/p/old-cup`), so one redirect serves every country and language.
 * The normal form of a path: percent-decoded once (except `%2f`, `%3f`, `%23` and `%25`, which stay encoded, in lower case), Unicode NFC, lower case (a CHOICE, not what
 * RFC 3986 says: every Kaizen address is lower case and an old shop's mixed-case links should still work), `//` collapsed, dot segments removed (RFC 3986
 * 5.2.4), no trailing slash, at most 12 parts of 200 characters, never a space, control character or backslash. A source has no query or fragment (they are
 * cut, with a note); a target keeps them.
 *
 * A target on another website is refused (`target.external`): the platform serves stores on a shared domain, so an open redirect would let one store send
 * shoppers anywhere from Kaizen's domain. Narrower than Shopify, on purpose.
 */
import { parseMarketSlug } from "./market-slug";

export const SOURCE_MAX = 500;
export const TARGET_MAX = 2_000;
export const SEGMENT_MAX = 200;
/** The parts a path may have (the length `parseStoreRequest()` accepts). */
export const SEGMENTS_MAX = 12;

/** A market's address: a country, with a language and a currency when they are not its own. The loose form `ab-routing.ts` uses. */
export const MARKET_SEGMENT = /^[a-z]{2}(?:-[a-z0-9]{2,8}){0,2}$/;

/**
 * The first parts of a store's own pages that are not content: the working pages (the store's reserved page addresses, `RESERVED_STORE_PAGE_SLUGS`, less the
 * content routes `blog`, `category`, `p`, `products` and `tag`; a test holds the two together). Never redirected, never recorded as missing.
 */
export const WORKING_SEGMENTS: readonly string[] = [
  "account",
  "cart",
  "checkout",
  "cookies",
  "deliveries",
  "download",
  "order",
  "returns",
  "search",
  "subscription",
  "unsubscribe",
  "withdraw",
  "wishlist",
];
/** The first parts that belong to the platform, not to a store's pages. */
export const PLATFORM_SEGMENTS: readonly string[] = ["admin", "api", "auth", "_next", "s", "r", "demo", "kaizen"];
/** A source may not begin with one of these (`source.reserved`). */
export const RESERVED_SOURCE_SEGMENTS: readonly string[] = [...WORKING_SEGMENTS, ...PLATFORM_SEGMENTS];

/** Files a request for which the proxy never looks at (`legacy-path.ts`): the extension of a static file. */
export const STATIC_EXTENSIONS: readonly string[] = [
  "ico", "png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "css", "js", "map", "txt", "xml", "json", "woff", "woff2", "ttf", "pdf", "csv", "zip", "mp4", "webm",
];

/** What a store's addresses are read against: its slug, its countries (lower case, two letters) and the hosts that are its own. */
export type AddressContext = {
  store: string;
  countries: readonly string[];
  /** Host names (no port) of the store: `{store}.{domain}`, its own domains, Kaizen's host. A full address on one of them is read as its path. */
  ownHosts: readonly string[];
};

// ---------------------------------------------------------------------------
// The normal form of a path
// ---------------------------------------------------------------------------

const KEPT_ENCODED = /%(2F|3F|23|25)/gi;
const BAD_CHARACTER = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\s\\]/u;

function decodeChunk(chunk: string): string | null {
  try {
    return decodeURIComponent(chunk);
  } catch {
    return null;
  }
}

/** Percent-decodes once; `%2F`, `%3F`, `%23` and `%25` stay encoded (in lower case, as the normal form has no capital). Null for an invalid sequence. */
export function decodeKeepingReserved(input: string): string | null {
  let out = "";
  let last = 0;
  for (const match of input.matchAll(KEPT_ENCODED)) {
    const chunk = decodeChunk(input.slice(last, match.index));
    if (chunk === null) return null;
    out += `${chunk}%${match[1].toLowerCase()}`;
    last = match.index + match[0].length;
  }
  const tail = decodeChunk(input.slice(last));
  return tail === null ? null : out + tail;
}

const lowerNfc = (text: string) => text.normalize("NFC").toLowerCase().normalize("NFC");

/**
 * A path in the normal form, or null when it cannot be (an invalid `%` sequence, a space, control character or backslash, more than 12 parts, a part over 200
 * characters, longer than `max`). A missing leading slash is added; `?` and `#` are not part of a path (`splitAddress()` first). The root is `/`.
 * Applying it to its own result changes nothing (a property test).
 */
export function normalisePath(raw: string, max: number = SOURCE_MAX): string | null {
  const decoded = decodeKeepingReserved(raw.trim());
  if (decoded === null) return null;
  const text = lowerNfc(decoded);
  if (text.includes("?") || text.includes("#") || BAD_CHARACTER.test(text)) return null;
  const stack: string[] = [];
  for (const part of text.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  if (stack.length > SEGMENTS_MAX || stack.some((part) => part.length > SEGMENT_MAX)) return null;
  const path = `/${stack.join("/")}`;
  return path.length <= max ? path : null;
}

/** The query (with its `?`, or empty) and fragment (with its `#`, or empty) of an address, and what is before them. */
export function splitAddress(raw: string): { path: string; query: string; fragment: string } {
  const hash = raw.indexOf("#");
  const fragment = hash >= 0 ? raw.slice(hash) : "";
  const beforeHash = hash >= 0 ? raw.slice(0, hash) : raw;
  const mark = beforeHash.indexOf("?");
  const query = mark >= 0 ? beforeHash.slice(mark) : "";
  return { path: mark >= 0 ? beforeHash.slice(0, mark) : beforeHash, query: query === "?" ? "" : query, fragment: fragment === "#" ? "" : fragment };
}

/** The first part of a normalised path (`/cart/x` is `cart`), or "" for the root. */
export const firstSegment = (path: string): string => path.split("/")[1] ?? "";

/** Whether a path begins with a working page or a platform route: never redirected from (`source.reserved`). */
export const isReservedPath = (path: string): boolean => RESERVED_SOURCE_SEGMENTS.includes(firstSegment(path));
/** Whether a path begins with a working page: it exists as a place to go to, and is never recorded as missing. */
export const isWorkingPath = (path: string): boolean => WORKING_SEGMENTS.includes(firstSegment(path));

/** Whether a segment looks like a market's address (`no`, `no-en`, `no-en-eur`): the first part of a request that has a country. */
export const looksLikeMarket = (segment: string): boolean => MARKET_SEGMENT.test(segment.toLowerCase());

/** Whether a segment is one of the store's own markets (its country, with or without a language and a currency). */
export function isStoreMarket(segment: string, countries: readonly string[]): boolean {
  const market = parseMarketSlug(segment.toLowerCase());
  return market !== null && countries.map((c) => c.toLowerCase()).includes(market.country.toLowerCase());
}

/**
 * The path without the market (`/no/p/x` is `/p/x`, `/no` is `/`) and without a `/s/{store}` before it, for a path in the normal form. `market` is the
 * market's address when one was removed; `viaStore` is true when `/s/{store}` was.
 */
export function splitMarket(path: string, ctx: Pick<AddressContext, "store" | "countries">): { path: string; market: string | null; viaStore: boolean } {
  let parts = path.split("/").filter(Boolean);
  let viaStore = false;
  if (parts[0] === "s" && parts[1] === ctx.store) {
    parts = parts.slice(2);
    viaStore = true;
  }
  let market: string | null = null;
  if (parts.length > 0 && isStoreMarket(parts[0], ctx.countries)) {
    market = parts[0];
    parts = parts.slice(1);
  }
  return { path: `/${parts.join("/")}`, market, viaStore };
}

// ---------------------------------------------------------------------------
// Reading a typed or imported address
// ---------------------------------------------------------------------------

type Parsed = { path: string; query: string; fragment: string } | { problem: "invalid" | "external" };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Splits a typed address into path, query and fragment, reading a full address of the store's own host as its path. */
function parseAddress(raw: string, ctx: AddressContext, allowHttp: boolean): Parsed {
  const text = raw.replace(/^﻿/, "").trim();
  if (/[\p{Cc}]/u.test(text)) return { problem: "invalid" };
  if (SCHEME.test(text) || text.startsWith("//")) {
    let url: URL;
    try {
      url = new URL(text.startsWith("//") ? `https:${text}` : text);
    } catch {
      return { problem: "invalid" };
    }
    if (url.protocol !== "https:" && !(allowHttp && url.protocol === "http:")) return { problem: "invalid" };
    if (url.username !== "" || url.password !== "") return { problem: "invalid" };
    const own = url.port === "" && ctx.ownHosts.map((h) => h.toLowerCase()).includes(url.hostname.toLowerCase());
    if (!own) return { problem: "external" };
    return { path: url.pathname, query: url.search === "?" ? "" : url.search, fragment: url.hash === "#" ? "" : url.hash };
  }
  return splitAddress(text);
}

export type SourceProblem = "source.missing" | "source.invalid" | "source.external" | "source.market_prefix" | "source.reserved" | "source.root";
export type TargetProblem = "target.missing" | "target.invalid" | "target.external";
export type SourceNote = "source.query_dropped";
export type TargetNote = "target.market_removed";

export type SourceReading =
  | { ok: true; source: string; notes: SourceNote[] }
  /** `address` is the normalised path when one could be made, for the sentence. */
  | { ok: false; code: SourceProblem; address?: string };
export type TargetReading =
  | { ok: true; target: string; path: string; notes: TargetNote[] }
  | { ok: false; code: TargetProblem; address?: string };

/**
 * An address typed or imported as a SOURCE, in the normal form of a stored source, or the reason it cannot be one. The query string and fragment are cut (a
 * note); a full address on one of the store's own hosts is read as its path, one on another website is `source.external`; a path with a country in it
 * (`/no/…`, `/no-en/…`: a first part that is one of the store's markets) or `/s/{store}/…` is `source.market_prefix`; the front page is `source.root`; a working page or a
 * platform route is `source.reserved`. Whether the address is LIVE is not known here (`validateRedirect()`).
 */
export function normaliseSource(raw: string, ctx: AddressContext): SourceReading {
  if (raw.trim() === "") return { ok: false, code: "source.missing" };
  const parsed = parseAddress(raw, ctx, true);
  if ("problem" in parsed) return { ok: false, code: parsed.problem === "external" ? "source.external" : "source.invalid" };
  const path = normalisePath(parsed.path);
  if (path === null) return { ok: false, code: "source.invalid" };
  if (path === "/") return { ok: false, code: "source.root" };
  const first = firstSegment(path);
  // A market of THIS store (or `/s/{store}/…`) is the country a request has, which a redirect never names. A first part that only looks like a market
  // (`/om-oss`, a Norwegian "about us") is not one of the store's, and a request for it reaches the redirect lookup through the unknown-market route.
  if ((first === "s" && path.split("/")[2] === ctx.store) || isStoreMarket(first, ctx.countries)) return { ok: false, code: "source.market_prefix", address: path };
  if (isReservedPath(path)) return { ok: false, code: "source.reserved", address: path };
  return { ok: true, source: path, notes: parsed.query !== "" || parsed.fragment !== "" ? ["source.query_dropped"] : [] };
}

/**
 * An address typed or imported as a TARGET: a path on the store with its query and fragment, in the normal form of its path. A country (and `/s/{store}`)
 * at the front is removed (a note); another website is `target.external`; a scheme other than https, a password, a control character, a path of another
 * store (`/s/{other}/…`) or a platform route is `target.invalid`. `/` is the market's front page.
 */
export function normaliseTarget(raw: string, ctx: AddressContext): TargetReading {
  if (raw.trim() === "") return { ok: false, code: "target.missing" };
  const parsed = parseAddress(raw, ctx, false);
  if ("problem" in parsed) return { ok: false, code: parsed.problem === "external" ? "target.external" : "target.invalid" };
  const path = normalisePath(parsed.path, TARGET_MAX);
  if (path === null) return { ok: false, code: "target.invalid" };
  const stripped = splitMarket(path, ctx);
  const first = firstSegment(stripped.path);
  // `/s/{other}/…` is another store, and the platform's own routes are not pages a redirect may send shoppers to.
  if (PLATFORM_SEGMENTS.includes(first)) return { ok: false, code: "target.invalid" };
  const tail = `${parsed.query}${parsed.fragment}`;
  if (/[\s\p{Cc}\\]/u.test(tail)) return { ok: false, code: "target.invalid" };
  const target = `${stripped.path}${tail}`;
  if (target.length > TARGET_MAX) return { ok: false, code: "target.invalid" };
  return { ok: true, target, path: stripped.path, notes: stripped.market !== null || stripped.viaStore ? ["target.market_removed"] : [] };
}

/** The path of a stored target (before its query and fragment), in the normal form: where a chain goes on from. */
export function pathOfTarget(target: string): string {
  const { path } = splitAddress(target);
  return normalisePath(path, TARGET_MAX) ?? path;
}

/**
 * An address as it goes in a `Location` header: pure ASCII. The stored normal form is percent-DECODED (a Greek, Cyrillic or Polish handle is kept as letters,
 * a typed query as typed), and a header value may hold no character above U+00FF (Node refuses it, the market route would answer 500) and a byte above
 * U+007F is no valid address. Every character that is not safe in an address is percent-encoded as UTF-8; an escape already in it (`%2f`, `%3f`, `%23`, `%25`,
 * or one in a request's query) is kept as it is, never encoded twice; a lone `%` becomes `%25`; `/`, `?`, `#`, `&` and `=` are kept. Applying it to its own
 * result changes nothing (a property test).
 */
export function encodeAddress(address: string): string {
  return address
    .toWellFormed()
    .split(/(%[0-9a-fA-F]{2})/)
    .map((part, index) => (index % 2 === 1 ? part : encodeURI(part)))
    .join("");
}

// ---------------------------------------------------------------------------
// The request's query string
// ---------------------------------------------------------------------------

/** The most of a request's query that is carried to the target. */
export const REQUEST_QUERY_MAX = 1_000;

const nameOf = (pair: string): string => {
  const raw = pair.split("=")[0];
  try {
    return decodeURIComponent(raw.replace(/\+/g, " "));
  } catch {
    return raw;
  }
};

/**
 * The address to go to, with the request's query string (rule 8): a target with no query takes the request's; a target with one gets the request's
 * parameters whose names it does not have; the target's fragment is kept; a redirect never adds a parameter of its own. `requestQuery` is the request's
 * `search` (`?a=1&b=2` or empty). What is carried is cut at `REQUEST_QUERY_MAX` characters, whole parameters only.
 */
export function mergeQuery(target: string, requestQuery: string): string {
  const { path, query, fragment } = splitAddress(target);
  const have = new Set(query === "" ? [] : query.slice(1).split("&").filter(Boolean).map(nameOf));
  const extra: string[] = [];
  let size = 0;
  for (const pair of requestQuery.replace(/^\?/, "").split("&").filter(Boolean)) {
    if (have.has(nameOf(pair))) continue;
    if (size + pair.length + 1 > REQUEST_QUERY_MAX) break;
    size += pair.length + 1;
    extra.push(pair);
  }
  if (extra.length === 0) return target;
  const joined = query === "" ? `?${extra.join("&")}` : `${query}&${extra.join("&")}`;
  return `${path}${joined}${fragment}`;
}
