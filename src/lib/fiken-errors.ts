/**
 * Fiken (D460): what an answer from Fiken means for the sync, and what it says to an owner. Fiken documents its status codes but not the
 * body of an error, so the class is read from the status, and the words Fiken gives (a `message`, an `error_description`, a list of them, or
 * plain text) are kept only clipped, with anything that looks like a token cut out, for the owner who owns the books they are about. Every
 * other text is fixed here, so no token, no request body and no personal data reaches a page, a log or `error_key`. Pure.
 */

export type FikenFailureClass =
  /** Network, timeout or Fiken down: tried again on the ladder. */
  | "transient"
  /** Too many calls (Fiken allows one at a time, about four a second): wait and try again; not counted as a try. */
  | "rate_limit"
  /** The grant no longer works (revoked in Fiken, or the refresh token is over): the whole connection stops until it is connected again. */
  | "auth"
  /** The company may not do this (the API module is off, or the app lost the company): a person fixes it in Fiken, then retries. */
  | "permission"
  /** Something we booked was deleted in Fiken: never booked again on its own. */
  | "drift"
  /** Fiken refuses it as it is (a locked period, an account it does not take): waits for a person. */
  | "rule";

export type FikenFailure = {
  class: FikenFailureClass;
  status: number | null;
  /** Stable, for the page and the alerts: `http_401`, `closed_period`, `timeout`, … */
  key: string;
  /** The `X-Request-ID` we sent, for Fiken's support. */
  requestId: string | null;
  /** Seconds to wait (rate limit only). */
  retryAfter: number | null;
  /** Fiken's own words, clipped; shown to the owner only. */
  detail: string | null;
};

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Every text in an error body, as one line: `message`, `error_description`, `errors[]`, or the text itself. Token-like runs are cut. */
export function fikenWords(body: unknown, raw = ""): string | null {
  const found: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 3 || found.length >= 8) return;
    if (typeof value === "string") {
      if (value.trim() !== "") found.push(value.trim());
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) visit(v, depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      const o = value as Record<string, unknown>;
      for (const key of ["message", "error_description", "errorMessage", "description", "errors", "validationErrors", "messages", "field"]) {
        if (key in o) visit(o[key], depth + 1);
      }
    }
  };
  visit(body, 0);
  const text = (found.length > 0 ? [...new Set(found)].join("; ") : /^\s*</.test(raw) ? "" : raw).replace(/[A-Za-z0-9._~+/=-]{40,}/g, "…");
  const one = text.replace(/\s+/g, " ").trim();
  return one === "" ? null : clip(one, 300);
}

/** A locked or closed accounting period, as Fiken words it (Norwegian or English). */
const CLOSED = /(periode|period)[^.]*\b(låst|lukket|stengt|closed|locked)|\b(låst|lukket|closed|locked)\b[^.]*(periode|period)|årsavslutning|year[- ]end/i;

/** A failed answer's class. `status` is the HTTP status; `body` the parsed JSON, if any; `raw` its text; `header` reads one header. */
export function classifyFikenFailure(status: number, body: unknown, raw: string, header: (name: string) => string | null, requestId: string | null = null): FikenFailure {
  const detail = fikenWords(body, raw);
  const base = { status, requestId, retryAfter: null, detail };
  if (status === 429) {
    const after = Number(header("retry-after") ?? "");
    const seconds = Number.isFinite(after) && after > 0 ? Math.min(Math.ceil(after), 15 * 60) : 60;
    return { ...base, class: "rate_limit", key: "rate_limit", retryAfter: seconds, detail: null };
  }
  if (status === 401) return { ...base, class: "auth", key: "http_401", detail: null };
  if (status === 403) return { ...base, class: "permission", key: "http_403" };
  if (status === 404) return { ...base, class: "drift", key: "http_404", detail: null };
  if (status >= 500) return { ...base, class: "transient", key: `http_${status}`, detail: null };
  if (detail && CLOSED.test(detail)) return { ...base, class: "rule", key: "closed_period" };
  return { ...base, class: "rule", key: status === 400 || status === 422 ? "validation" : `http_${status}` };
}

/** A call that never got an answer: a timeout, a refused connection, a redirect we do not follow. */
export function fikenNetworkFailure(kind: "timeout" | "network" | "redirect"): FikenFailure {
  return { class: kind === "redirect" ? "rule" : "transient", status: null, key: kind, requestId: null, retryAfter: null, detail: null };
}

/** A failure of our own making (no answer to classify). */
export const fikenFailure = (key: string, kind: FikenFailureClass = "rule"): FikenFailure => ({ class: kind, status: null, key, requestId: null, retryAfter: null, detail: null });

/**
 * What each failure says to an owner, in plain words, with what to do, by `FikenFailure.key`; `transient` and `rule` for any other key of
 * that class. The admin's `fiken` catalogue gives the same keys in each language.
 */
export const FIKEN_FAILURE_WORDS = {
  http_401: "Fiken no longer lets Kaizena Flow in. Connect Fiken again on the Fiken page; everything that waited is sent then.",
  http_403: "Fiken refused it for this company. Check that the API module is on under Settings → Module access in Fiken, then press Try again.",
  http_404: "This was deleted in Fiken. Post it again, or leave it out.",
  closed_period: "The accounting period for this date is locked in Fiken. Open it in Fiken (or ask your accountant), then press Try again.",
  rate_limit: "Fiken asked us to slow down. It will go through by itself in a few minutes.",
  timeout: "Fiken did not answer. It will be tried again by itself.",
  network: "Fiken did not answer. It will be tried again by itself.",
  redirect: "Fiken answered from another address, which is not followed. It will be tried again.",
  number_taken: "Fiken already has another sale with this number. Check it in Fiken: if it is this one, delete the other or leave this out.",
  bad_answer: "Fiken answered with something we could not read. It will be tried again.",
  not_connected: "Connect Fiken first.",
  transient: "Fiken had a problem on its side. It will be tried again by itself.",
  rule: "Fiken refused it. See what it said below, fix it in Fiken or in the Fiken settings, then press Try again.",
} as const;

export type FikenFailureWords = Record<keyof typeof FIKEN_FAILURE_WORDS, string>;

/** What a failure says to an owner, in the words given (English by default). */
export function fikenFailureWords(failure: Pick<FikenFailure, "key" | "class">, words: FikenFailureWords = FIKEN_FAILURE_WORDS): string {
  if (failure.key in words) return words[failure.key as keyof FikenFailureWords];
  return failure.class === "transient" ? words.transient : words.rule;
}

/** Why a document waits before anything is sent (`FikenBlockCode` and the connection's own reasons), in words. */
export const FIKEN_BLOCK_WORDS = {
  currency_unsupported: "Only invoices in Norwegian kroner are sent to Fiken for now. Book this one by hand.",
  vat_unmapped: "This document has a kind of VAT the Fiken settings do not place yet. Choose where it goes under Fiken → Customise.",
  totals_mismatch: "The lines do not add up to the total, so nothing was sent. Contact support.",
  nothing_to_book: "There is nothing to book on this document.",
  waiting_for_invoice: "Waits until its invoice is in Fiken.",
  settings_problem: "The Fiken settings need a look before this can be sent.",
  customer_missing: "The client this document is for could not be read. Contact support.",
  document_missing: "The document could not be read. Contact support.",
} as const;

export type FikenBlockWords = Record<keyof typeof FIKEN_BLOCK_WORDS, string>;
