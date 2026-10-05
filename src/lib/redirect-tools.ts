import { SOURCE_MAX, TARGET_MAX } from "./redirect-path";

/**
 * What the AI manager's redirect tools (D168, `docs/wave-2-redirects.md` 4.8, 5.5) do that needs no database: `redirect_overview` reads (the redirects the
 * store has by kind, and the addresses shoppers asked for that were not there, with the suggestions the code found) and `add_redirect` adds one manual
 * redirect, kept for the owner's yes because it changes what the live site answers. Every figure here is the store's own, counted in code and repeated by
 * the model; an address is only ever one the tools gave or the owner typed; nothing here edits, deletes or imports a redirect (those are on the pages).
 * Pure, so the browser-free tests hold it.
 */

export const REDIRECT_TOOLS = ["redirect_overview", "add_redirect"] as const;

/** The windows the 404 report offers (`NOT_FOUND_WINDOWS`), the same three days counts. */
export const OVERVIEW_WINDOWS = [7, 30, 90] as const;
export const OVERVIEW_ROWS_MAX = 20;
export const OVERVIEW_ROWS_DEFAULT = 10;

/** The longest address the tools take: the stored limits (`SOURCE_MAX`, `TARGET_MAX`), so a longer one is refused in the arguments, not in a finding. */
export const FROM_MAX = SOURCE_MAX;
export const TO_MAX = TARGET_MAX;

/** One line, no control characters, at most `max` characters: what a kept call shows. The owner reads what the model gave, never a hidden line. */
export const oneLine = (text: string, max = 200): string => {
  const line = text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** The words a gated `add_redirect` is kept with, for the owner's yes: the two addresses as given, and that it applies in every country. */
export function redirectSummary(from: string, to: string): string {
  return `Redirect ${oneLine(from)} to ${oneLine(to)} in every country, as a permanent redirect (308).`;
}

/** A count that is a lower bound, in words: a request served from a cache is never seen. */
export const atLeast = (n: number): string => `at least ${n}`;

export type OverviewCounts = { manual: number; product: number; category: number; tag: number; page: number; article: number; total: number; limit: number };

export type OverviewSuggestion = { kind: string; path: string; title: string };
export type OverviewMissing = { path: string; requests: number; crawlers: number; lastAsked: string; suggestions: readonly OverviewSuggestion[] };
export type OverviewReport = { days: number; rows: readonly OverviewMissing[]; distinct: number; uncounted: { requests: number; days: number }; note: string };

/** The counts by kind, with what is left of the manual limit worked out here. */
export function shapeCounts(counts: OverviewCounts) {
  return {
    manual: counts.manual,
    manual_limit: counts.limit,
    manual_left: Math.max(0, counts.limit - counts.manual),
    automatic_for_products: counts.product,
    automatic_for_categories: counts.category,
    automatic_for_tags: counts.tag,
    for_pages: counts.page,
    for_articles: counts.article,
    total: counts.total,
  };
}

/** How many addresses are named for a missing address at most: the report's own three. */
export const SUGGESTIONS_SHOWN = 3;

/**
 * The missing addresses of the report as the assistant repeats them: the address, how many times it was asked for (at least), when it was last asked for, and
 * the live addresses it may go to as the report's code found them. A row with no suggestion says so rather than leaving it to a guess.
 */
export function shapeMissing(report: OverviewReport, limit: number) {
  const shown = report.rows.slice(0, Math.max(1, limit));
  return {
    window_days: report.days,
    addresses_in_window: report.distinct,
    shown: shown.length,
    addresses: shown.map((r) => ({
      address: r.path,
      requests_at_least: r.requests,
      ...(r.crawlers > 0 ? { of_which_robots_at_least: r.crawlers } : {}),
      last_asked: r.lastAsked.slice(0, 10),
      suggested_targets: r.suggestions.slice(0, SUGGESTIONS_SHOWN).map((s) => ({ address: s.path, kind: s.kind, title: s.title })),
      ...(r.suggestions.length === 0 ? { no_suggestion: "No live page matched closely enough: ask the owner where it should go, or leave it." } : {}),
    })),
  };
}

/** What to say about a window without a recorded address: not a zero that reads as "nothing is broken". */
export const EMPTY_WINDOW = (days: number): string =>
  `No missing address has been recorded in the last ${days} days. Only requests that reached the site are counted, so this does not prove that no link is broken.`;

/** The notes that go with every overview. */
export function overviewNotes(report: OverviewReport, counts: OverviewCounts): string[] {
  const notes = [
    "Counts are at least what happened: a request answered from a cache, or counted too fast after another for the same address, is not seen. Repeat the figures as they are, never add one.",
    report.note,
    "Addresses that already have a redirect, or that the owner hid, are left out of the list.",
    "To redirect one, call add_redirect with the address as `from` and a suggested target or the page the owner names as `to`: it is kept for the owner's yes and nothing changes before that. A redirect applies in every country and language and is permanent.",
    "You cannot edit, delete or import redirects: those are done on the Redirects page (open_admin_page, redirects), the CSV import on redirects.import.",
  ];
  if (report.rows.length === 0) notes.push(EMPTY_WINDOW(report.days));
  if (report.uncounted.requests > 0) {
    notes.push(`On ${report.uncounted.days} day${report.uncounted.days === 1 ? "" : "s"} so many different addresses were asked for that the rest were only counted in all: ${report.uncounted.requests} requests that are in no address's figure.`);
  }
  if (counts.manual >= counts.limit) notes.push(`The store has reached its limit of ${counts.limit} manual redirects: no more can be added until some are deleted.`);
  return notes;
}
