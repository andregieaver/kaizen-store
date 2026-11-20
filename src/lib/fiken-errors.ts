/**
 * Fiken (D460): what an answer from Fiken means for the sync, and what it says to an owner. Fiken documents its status codes but not the
 * body of an error, so the class is read from the status, and the words Fiken gives (a `message`, an `error_description`, a list of them, or
 * plain text) are kept only clipped, with anything that looks like a token cut out, for the owner who owns the books they are about. Every
 * other text is fixed here, so no token, no request body and no personal data reaches a page, a log or `error_key`. Pure.
 */
import { FIKEN_BLOCK_WORDS, FIKEN_FAILURE_WORDS } from "./fiken-labels";

export { FIKEN_BLOCK_WORDS, FIKEN_FAILURE_WORDS };

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

export type FikenFailureWords = Record<keyof typeof FIKEN_FAILURE_WORDS, string>;

/** What a failure says to an owner, in the words given (English by default). */
export function fikenFailureWords(failure: Pick<FikenFailure, "key" | "class">, words: FikenFailureWords = FIKEN_FAILURE_WORDS): string {
  if (failure.key in words) return words[failure.key as keyof FikenFailureWords];
  return failure.class === "transient" ? words.transient : words.rule;
}

