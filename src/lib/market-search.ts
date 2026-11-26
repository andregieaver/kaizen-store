import { SEARCH_RESULTS_MAX } from "./web-search";

/**
 * Where a store and its rivals come up in search (D905, market check M5b, `docs/market-check.md` 7.3), the pure parts: the limits, a
 * word as it is kept, and where a site stands in one page of results. The search is made by `searchWeb()` (only the word and the country
 * are sent), kept by `src/server/market-search.ts`; every position is counted here, never by a model.
 */

/** Words a store follows in one country. */
export const SEARCH_TERMS_PER_MARKET = 10;
/** A word is searched again once it was checked longer ago than this; a try that could not search waits a day. */
export const SEARCH_CHECK_DAYS = 30;
export const SEARCH_RETRY_DAYS = 1;
/** Words searched in one run of the five-minute dispatcher, and at most in a day for one store: its AI keeps the rest of its searches. */
export const SEARCH_TERMS_PER_RUN = 2;
export const SEARCH_TERMS_PER_STORE_DAY = 10;
/** A check older than this makes no finding. */
export const SEARCH_FRESH_DAYS = 45;
/** The places counted: one page of results. */
export const SEARCH_PLACES = SEARCH_RESULTS_MAX;
/** The highest place that is a strength when no rival you follow is above it. */
export const SEARCH_AHEAD_MAX = 3;

/** A word as it is kept and searched: trimmed, its spaces one, lower case, 2 to 80 characters; null otherwise. */
export function normaliseTerm(raw: string): string | null {
  const term = raw.trim().replace(/\s+/g, " ").toLowerCase();
  return term.length >= 2 && term.length <= 80 ? term : null;
}

/** The store's own site as search results show it: its hosts (own domains, `www.` left out), or a path on another host (`/s/{slug}`). */
export type OwnSite = { hosts: string[]; prefix: { host: string; path: string } | null };

const hostOf = (url: string): { host: string; path: string } | null => {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return { host: u.hostname.toLowerCase().replace(/\.$/, "").replace(/^www\./, ""), path: u.pathname };
  } catch {
    return null;
  }
};

/** Whether a result's address is on a host or a host below it (`shop.` of it), http or https. */
export function urlOnHost(url: string, host: string): boolean {
  const at = hostOf(url);
  return at !== null && (at.host === host || at.host.endsWith(`.${host}`));
}

/** Whether a result's address is the store's own site. */
export function urlOnSite(url: string, own: OwnSite): boolean {
  const at = hostOf(url);
  if (!at) return false;
  if (own.hosts.some((h) => at.host === h || at.host.endsWith(`.${h}`))) return true;
  return own.prefix !== null && at.host === own.prefix.host && (at.path === own.prefix.path || at.path.startsWith(`${own.prefix.path}/`));
}

/** Where the store and each rival host first come up in one page of results (1 is first), null where they do not. */
export function placesIn(results: readonly { url: string }[], own: OwnSite, rivalHosts: readonly string[]): { own: number | null; rivals: Record<string, number> } {
  let mine: number | null = null;
  const rivals: Record<string, number> = {};
  results.slice(0, SEARCH_PLACES).forEach((r, i) => {
    if (mine === null && urlOnSite(r.url, own)) mine = i + 1;
    for (const host of rivalHosts) if (rivals[host] === undefined && urlOnHost(r.url, host)) rivals[host] = i + 1;
  });
  return { own: mine, rivals };
}

/** A word the store follows, as last checked (`listSearchTerms()`), with its rivals in that country and where each came up. */
export type SearchTermFacts = {
  term: string;
  market: string;
  checkedAt: string | null;
  own: number | null;
  rivals: { name: string; host: string; position: number | null }[];
};

/** Whether a check is recent enough to make a finding. */
export function searchFresh(checkedAt: string | null, now: Date): boolean {
  if (!checkedAt) return false;
  const at = Date.parse(checkedAt);
  return Number.isFinite(at) && now.getTime() - at <= SEARCH_FRESH_DAYS * 86_400_000;
}

/**
 * What a word's last check means: the rival highest above the store (`behind`), or the store at `SEARCH_AHEAD_MAX` or higher with no rival
 * above it (`ahead`), or nothing. Only from a fresh check.
 */
export function searchStanding(
  t: SearchTermFacts,
  now: Date,
): { kind: "behind"; rivalName: string; theirs: number; yours: number | null } | { kind: "ahead"; yours: number } | null {
  if (!searchFresh(t.checkedAt, now)) return null;
  const above = t.rivals
    .filter((r): r is { name: string; host: string; position: number } => r.position !== null && r.position < (t.own ?? SEARCH_PLACES + 1))
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))[0];
  if (above) return { kind: "behind", rivalName: above.name, theirs: above.position, yours: t.own };
  if (t.own !== null && t.own <= SEARCH_AHEAD_MAX) return { kind: "ahead", yours: t.own };
  return null;
}
