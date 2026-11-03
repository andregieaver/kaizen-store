/**
 * What the admin's pages for redirects, the 404 report and the category and tag search texts say and decide (wave 2, second run, D168,
 * `docs/wave-2-redirects.md` 2.2, 2.3, 2.4, 5.4), pure: addresses of the pages, the filters' words, how a row's use and maker are told, how a finding is shown
 * under the field it is about, and the sentences a saved product or category says when its address changed. No database and nothing a person typed beyond the
 * addresses themselves, which the pages pass in already in their normal form: a view test holds these. Their words are the `redirects` catalogue (D312 A7):
 * each function takes them as its last argument and says the English ones when none are given.
 */
import { countWords, fillWords } from "./admin-fill";
import { redirectsEn, type RedirectsMessages } from "./admin-messages/redirects.en";
import { momentText, wholeNumber } from "./data-admin";
import type { Finding } from "./data-job";
import { NOT_FOUND_WINDOWS } from "./data-limits";
import { findingField, redirectSentences, type RedirectKind } from "./redirects";

type W = RedirectsMessages;

// ---------------------------------------------------------------------------
// Addresses of the pages
// ---------------------------------------------------------------------------

/** The manager's pages, after the store's own address. */
export const redirectPaths = (slug: string) => ({
  list: `/admin/${slug}/redirects`,
  report: `/admin/${slug}/redirects/404s`,
  import: `/admin/${slug}/redirects/import`,
  export: `/admin/${slug}/redirects/export`,
});

/** The tabs on every redirect page. */
export type RedirectTab = "list" | "report" | "import" | "export";
export const redirectTabs = (w: W = redirectsEn): readonly { id: RedirectTab; label: string }[] => [
  { id: "list", label: w.tabs.list },
  { id: "report", label: w.tabs.report },
  { id: "import", label: w.tabs.import },
  { id: "export", label: w.tabs.export },
];
export const REDIRECT_TABS = redirectTabs();

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** The kind filter of the list (2.2.1), by the value in the address. */
const FILTER_VALUES = ["all", "manual", "products", "terms", "pages"] as const;
export const filterChoices = (w: W = redirectsEn): readonly { value: (typeof FILTER_VALUES)[number]; label: string }[] =>
  FILTER_VALUES.map((value) => ({ value, label: w.list.filters[value] }));
export const FILTER_CHOICES = filterChoices();

export type ListQuery = { q?: string; filter?: string; page?: number };

/** The address of the list with a search, a filter and a page; the defaults are left out. */
export function listHref(base: string, query: ListQuery): string {
  const params = new URLSearchParams();
  const q = (query.q ?? "").trim();
  if (q) params.set("q", q);
  if (query.filter && query.filter !== "all") params.set("filter", query.filter);
  if (query.page && query.page > 1) params.set("page", String(query.page));
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

/** A positive whole page number from the address, else 1. */
export const pageOf = (value: unknown): number => {
  const n = Number.parseInt(typeof value === "string" ? value : "", 10);
  return Number.isInteger(n) && n > 0 && n < 100_000 ? n : 1;
};

type Maker = { kind: RedirectKind | "page" | "article"; origin: string; createdBy: string | null; readOnly?: boolean };

/** The kind as the list names it. */
export const kindWords = (kind: RedirectKind | "page" | "article", w: W = redirectsEn): string => w.kinds[kind];

/** Who made a row: a person, or how the system did. */
export function madeByWords(row: Maker, w: W = redirectsEn): string {
  if (row.origin === "system" || row.kind !== "manual") return w.made.automatic;
  const via = row.origin === "import" ? w.made.imported : row.origin === "report" ? w.made.report : row.origin === "assistant" ? w.made.assistant : w.made.added;
  return row.createdBy ? fillWords(w.made.by, { via, name: row.createdBy }) : via;
}

/** How much a redirect was used: a lower bound, and when it was last. Pages' and articles' redirects are not counted. */
export function usedWords(hits: number | null, lastHitAt: string | null, timeZone: string, w: W = redirectsEn, locale = "en-GB"): string {
  if (hits === null) return w.used.notCounted;
  if (hits <= 0) return w.used.notUsed;
  const last = lastHitAt ? fillWords(w.used.last, { when: momentText(lastHitAt, timeZone, locale) }) : "";
  return `${fillWords(w.used.atLeast, { n: wholeNumber(hits, locale) })}${last}`;
}

/** The count in the list's header: `12 of 100,000 manual redirects`. */
export const manualCountWords = (n: number, max: number, w: W = redirectsEn, locale = "en"): string =>
  fillWords(w.sentences.count, { n: n.toLocaleString(locale), max: max.toLocaleString(locale) });

/** What the list says when there is nothing to show. */
export function emptyListWords(q: string, filter: string, w: W = redirectsEn): string {
  if (q.trim() !== "") return w.list.empty.search;
  if (filter === "manual") return w.list.empty.manual;
  if (filter === "all") return w.list.empty.all;
  return w.list.empty.kind;
}

/** The most rows one request may delete, said beside the button. */
export const deleteSelectedWords = (n: number, max: number, w: W = redirectsEn, locale = "en-GB"): string =>
  n > max ? fillWords(w.table.atMost, { max: wholeNumber(max, locale) }) : fillWords(w.table.deleteSelected, { n: wholeNumber(n, locale) });

// ---------------------------------------------------------------------------
// The form's findings, shown under the field they are about
// ---------------------------------------------------------------------------

export type FieldFindings = { from: Finding[]; to: Finding[]; line: Finding[] };

/** Sorts a check's findings under the field each is about (`from`, `to`, or the line as a whole). */
export function splitFindings(findings: readonly Finding[]): FieldFindings {
  const out: FieldFindings = { from: [], to: [], line: [] };
  for (const f of findings) out[findingField(f.code)].push(f);
  return out;
}

/** Whether any finding is an error (the redirect cannot be saved). */
export const hasError = (findings: readonly Finding[]): boolean => findings.some((f) => f.severity === "error");

/** The line under the two fields once both are readable: where shoppers will go. */
export function helpLine(source: string | null, target: string | null, w: W = redirectsEn): string | null {
  return source && target ? fillWords(w.sentences.fromHelp, { from: source, to: target }) : null;
}

/** What the form asks when the address already has a redirect, or null. */
export function existingWords(existing: { kind: "manual"; target: string } | { kind: "automatic" } | null, source: string | null, w: W = redirectsEn): string | null {
  if (!existing || !source) return null;
  return existing.kind === "manual" ? fillWords(w.sentences.replaceAsk, { from: source, old: existing.target }) : fillWords(w.sentences.automaticReplaced, { from: source });
}

// ---------------------------------------------------------------------------
// After a product or a category is saved with another address (2.2.6)
// ---------------------------------------------------------------------------

export type AddressChange = { from: string; to: string };

/**
 * The pair a saved product's changed handle gives (`/p/old` and `/p/new`): null when the handle did not change, or when the database left no redirect (a
 * product that was never live leaves none, since nobody has the address). `redirected` is whether a redirect from the old address exists after the save.
 */
export function productAddressChange(oldHandle: string | null, newHandle: string, redirected: boolean): AddressChange | null {
  if (!oldHandle || oldHandle === newHandle || !redirected) return null;
  return { from: `/p/${oldHandle}`, to: `/p/${newHandle}` };
}

/** The same for a category or a tag (`/category/old`, `/tag/old`). */
export function termAddressChange(kind: "category" | "tag", oldSlug: string | null, newSlug: string, redirected: boolean): AddressChange | null {
  if (!oldSlug || oldSlug === newSlug || !redirected) return null;
  return { from: `/${kind}/${oldSlug}`, to: `/${kind}/${newSlug}` };
}

/** The sentence a saved product or category says. */
export const addressChangeWords = (change: AddressChange): string => redirectSentences.handleChanged(change.from, change.to);

// ---------------------------------------------------------------------------
// The report of pages not found
// ---------------------------------------------------------------------------

export type ReportQuery = { days?: number; covered?: boolean; ignored?: boolean };

/** The address of the report with its window and switches; the defaults (30 days, neither switch) are left out. */
export function reportHref(base: string, query: ReportQuery): string {
  const params = new URLSearchParams();
  if (query.days && query.days !== NOT_FOUND_WINDOWS[0]) params.set("days", String(query.days));
  if (query.covered) params.set("covered", "1");
  if (query.ignored) params.set("ignored", "1");
  const text = params.toString();
  return text ? `${base}?${text}` : base;
}

/** The window words: `Last 30 days`. */
export const windowWords = (days: number, w: W = redirectsEn): string => fillWords(w.report.window, { n: days });

/** The windows in the order the tabs show them (7, 30, 90). */
export const WINDOW_ORDER: readonly number[] = [...NOT_FOUND_WINDOWS].sort((a, b) => a - b);

/** `12 requests, 3 by robots`: shoppers and robots together with the robots' share. */
export function requestsWords(requests: number, crawlers: number, w: W = redirectsEn, locale = "en-GB"): string {
  const base = countWords(requests, w.report.requests, { n: wholeNumber(requests, locale) });
  return crawlers > 0 ? `${base}${fillWords(w.report.byRobots, { n: wholeNumber(crawlers, locale) })}` : base;
}

/** The report's one-line account of what is shown, written from the report's own numbers. */
export function reportSummaryWords(shown: number, distinct: number, days: number, w: W = redirectsEn, locale = "en-GB"): string {
  if (distinct === 0) return fillWords(w.report.summary.none, { days });
  if (shown >= distinct) return countWords(distinct, w.report.summary.all, { n: wholeNumber(distinct, locale), days });
  return fillWords(w.report.summary.some, { shown: wholeNumber(shown, locale), n: wholeNumber(distinct, locale), days });
}

/** What the report says about addresses it could not count (a day's cap of different addresses was reached), or null. */
export function uncountedWords(uncounted: { requests: number; days: number }, w: W = redirectsEn, locale = "en-GB"): string | null {
  if (uncounted.requests <= 0) return null;
  const days = countWords(uncounted.days, w.report.days, { n: wholeNumber(uncounted.days, locale) });
  const requests = countWords(uncounted.requests, w.report.requests, { n: wholeNumber(uncounted.requests, locale) });
  return countWords(uncounted.requests, w.report.uncounted, { days, requests });
}

/** The words of the one-click button of a suggestion. */
export const suggestionWords = (path: string, w: W = redirectsEn): string => fillWords(w.report.table.redirectTo, { path });

/** The suggestion's kind as a small label beside the button. */
export const SUGGESTION_KIND: Record<string, string> = redirectsEn.report.suggestionKinds;
export const suggestionKind = (kind: string, w: W = redirectsEn): string => (w.report.suggestionKinds as Record<string, string>)[kind] ?? kind;

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

export type { ExistingChoice } from "./redirect-plan";

/** The one option of an import: what happens when an address already has a redirect of its own (2.2.4 step 2). */
export const existingChoiceWords = (w: W = redirectsEn): Record<"replace" | "skip", { label: string; help: string }> => ({ replace: w.import.options.replace, skip: w.import.options.skip });
export const EXISTING_WORDS = existingChoiceWords();

/** The confirmation before an import is applied: what it writes, and what it never does. */
export function importConfirmation(toCreate: number, toReplace: number, w: W = redirectsEn, locale = "en-GB"): string {
  return fillWords(w.import.apply.confirm, { create: wholeNumber(toCreate, locale), replace: wholeNumber(toReplace, locale) });
}

/** What a line of a check or an import says happened (or would): one phrase for the item's outcome and, for a dry run, its prediction. */
export function lineResultWords(outcome: string, will: string | null, w: W = redirectsEn): string {
  const l = w.import.lines_;
  if (outcome === "checked") {
    switch (will) {
      case "created":
        return l.wouldCreate;
      case "updated":
        return l.wouldReplace;
      case "unchanged":
        return l.already;
      case "skipped":
        return l.wouldSkip;
      case "failed":
        return l.wouldFail;
      default:
        return l.checked;
    }
  }
  switch (outcome) {
    case "created":
      return l.created;
    case "updated":
      return l.replaced;
    case "unchanged":
      return l.already;
    case "skipped":
      return l.skipped;
    case "failed":
      return l.failed;
    default:
      return outcome;
  }
}
