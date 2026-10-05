/**
 * What the admin's pages for redirects, the 404 report and the category and tag search texts say and decide (wave 2, second run, D168,
 * `docs/wave-2-redirects.md` 2.2, 2.3, 2.4, 5.4), pure: addresses of the pages, the filters' words, how a row's use and maker are told, how a finding is shown
 * under the field it is about, and the sentences a saved product or category says when its address changed. No database and nothing a person typed beyond the
 * addresses themselves, which the pages pass in already in their normal form: a view test holds these. The admin is English only and these words are in no
 * catalogue.
 */
import { momentText, wholeNumber } from "./data-admin";
import type { Finding } from "./data-job";
import { NOT_FOUND_WINDOWS } from "./data-limits";
import { KIND_WORDS, findingField, redirectSentences, type RedirectKind } from "./redirects";

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
export const REDIRECT_TABS: readonly { id: RedirectTab; label: string }[] = [
  { id: "list", label: "Redirects" },
  { id: "report", label: "Pages not found" },
  { id: "import", label: "Import" },
  { id: "export", label: "Export" },
];

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

/** The kind filter of the list (2.2.1), by the value in the address. */
export const FILTER_CHOICES: readonly { value: "all" | "manual" | "products" | "terms" | "pages"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "manual", label: "Manual" },
  { value: "products", label: "Automatic: products" },
  { value: "terms", label: "Automatic: categories and tags" },
  { value: "pages", label: "Pages and articles" },
];

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
export const kindWords = (kind: RedirectKind | "page" | "article"): string => KIND_WORDS[kind];

/** Who made a row: a person, or how the system did. */
export function madeByWords(row: Maker): string {
  if (row.origin === "system" || row.kind !== "manual") return "Automatic";
  const via = row.origin === "import" ? "Imported" : row.origin === "report" ? "From the pages-not-found report" : row.origin === "assistant" ? "By the AI manager" : "Added";
  return row.createdBy ? `${via} by ${row.createdBy}` : via;
}

/** How much a redirect was used: a lower bound, and when it was last. Pages' and articles' redirects are not counted. */
export function usedWords(hits: number | null, lastHitAt: string | null, timeZone: string): string {
  if (hits === null) return "Not counted";
  if (hits <= 0) return "Not used yet";
  const last = lastHitAt ? `, last ${momentText(lastHitAt, timeZone)}` : "";
  return `At least ${wholeNumber(hits)}${last}`;
}

/** The count in the list's header: `12 of 100,000 manual redirects`. */
export const manualCountWords = (n: number, max: number): string => redirectSentences.count(n, max);

/** What the list says when there is nothing to show. */
export function emptyListWords(q: string, filter: string): string {
  if (q.trim() !== "") return "No redirect matches the search.";
  if (filter === "manual") return "You have no redirects of your own yet. Add one above, import a file, or use the pages-not-found report.";
  if (filter === "all") return "No redirects yet. Kaizen makes one when a product, category or tag changes its address; add your own above.";
  return "No redirects of this kind yet.";
}

/** The most rows one request may delete, said beside the button. */
export const deleteSelectedWords = (n: number, max: number): string => (n > max ? `Choose at most ${wholeNumber(max)} at a time.` : `Delete ${wholeNumber(n)} selected`);

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
export function helpLine(source: string | null, target: string | null): string | null {
  return source && target ? redirectSentences.fromHelp(source, target) : null;
}

/** What the form asks when the address already has a redirect, or null. */
export function existingWords(existing: { kind: "manual"; target: string } | { kind: "automatic" } | null, source: string | null): string | null {
  if (!existing || !source) return null;
  return existing.kind === "manual" ? redirectSentences.replaceAsk(source, existing.target) : redirectSentences.automaticReplaced(source);
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
export const windowWords = (days: number): string => `Last ${days} days`;

/** The windows in the order the tabs show them (7, 30, 90). */
export const WINDOW_ORDER: readonly number[] = [...NOT_FOUND_WINDOWS].sort((a, b) => a - b);

/** `12 requests, 3 by robots`: shoppers and robots together with the robots' share. */
export function requestsWords(requests: number, crawlers: number): string {
  const base = `${wholeNumber(requests)} request${requests === 1 ? "" : "s"}`;
  return crawlers > 0 ? `${base}, ${wholeNumber(crawlers)} by robots` : base;
}

/** The report's one-line account of what is shown, written from the report's own numbers. */
export function reportSummaryWords(shown: number, distinct: number, days: number): string {
  if (distinct === 0) return `No missing address was asked for in the last ${days} days.`;
  if (shown >= distinct) return `${wholeNumber(distinct)} different address${distinct === 1 ? "" : "es"} asked for in the last ${days} days.`;
  return `Showing ${wholeNumber(shown)} of ${wholeNumber(distinct)} different addresses asked for in the last ${days} days.`;
}

/** What the report says about addresses it could not count (a day's cap of different addresses was reached), or null. */
export function uncountedWords(uncounted: { requests: number; days: number }): string | null {
  if (uncounted.requests <= 0) return null;
  const days = `${wholeNumber(uncounted.days)} day${uncounted.days === 1 ? "" : "s"}`;
  const requests = `${wholeNumber(uncounted.requests)} request${uncounted.requests === 1 ? "" : "s"}`;
  return `On ${days} more different addresses were asked for than a day can list, so ${requests} ${uncounted.requests === 1 ? "is" : "are"} not counted by address.`;
}

/** The words of the one-click button of a suggestion. */
export const suggestionWords = (path: string): string => `Redirect to ${path}`;

/** The suggestion's kind as a small label beside the button. */
export const SUGGESTION_KIND: Record<string, string> = { product: "Product", category: "Category", tag: "Tag", page: "Page", article: "Article" };

// ---------------------------------------------------------------------------
// The import
// ---------------------------------------------------------------------------

export type { ExistingChoice } from "./redirect-plan";

/** The one option of an import: what happens when an address already has a redirect of its own (2.2.4 step 2). */
export const EXISTING_WORDS: Record<"replace" | "skip", { label: string; help: string }> = {
  replace: {
    label: "Replace its target with the one in the file",
    help: "The address keeps one redirect: the file's. This is what Shopify does. Redirects that are not in the file are never touched.",
  },
  skip: {
    label: "Keep the redirect that is there and skip the line",
    help: "The line is listed as skipped and nothing about that address changes.",
  },
};

/** The confirmation before an import is applied: what it writes, and what it never does. */
export function importConfirmation(toCreate: number, toReplace: number): string {
  return `This will create ${wholeNumber(toCreate)} and replace ${wholeNumber(toReplace)} redirects. Redirects are permanent, and nothing is deleted. Each line is checked again as it is written, so a line may be skipped if the store changed since the check. Lines are saved in groups, so you cannot undo an import as a whole.`;
}

/** What a line of a check or an import says happened (or would): one phrase for the item's outcome and, for a dry run, its prediction. */
export function lineResultWords(outcome: string, will: string | null): string {
  if (outcome === "checked") {
    switch (will) {
      case "created":
        return "Would be created";
      case "updated":
        return "Would replace the redirect";
      case "unchanged":
        return "Already there";
      case "skipped":
        return "Would be skipped";
      case "failed":
        return "Would not be imported";
      default:
        return "Checked";
    }
  }
  switch (outcome) {
    case "created":
      return "Created";
    case "updated":
      return "Replaced";
    case "unchanged":
      return "Already there";
    case "skipped":
      return "Skipped";
    case "failed":
      return "Not imported";
    default:
      return outcome;
  }
}
