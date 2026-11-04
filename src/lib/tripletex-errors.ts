/**
 * Tripletex (D453): what an answer from Tripletex means for the sync, and what it says to an owner. Tripletex answers errors
 * as `{ status, code, message, developerMessage, validationMessages: [{ field, message }], requestId }` [spec]. Every class
 * decides what the sync does next (`docs/tripletex.md` 3.3); every text is fixed here, so no token, no request body and no
 * personal data ever reaches a page, a log or `last_error` from Tripletex's own words, except a validation message clipped
 * and shown to the owner who owns the books it is about.
 */

export type FailureClass =
  /** Network, timeout or Tripletex down: tried again on the ladder. */
  | "transient"
  /** Too many calls: wait the reset and try again; not counted as a try. */
  | "rate_limit"
  /** The token no longer works: the whole connection stops until a new one is pasted. */
  | "auth"
  /** The token may not do this: a person gives it the right in Tripletex, then retries. */
  | "permission"
  /** Something we booked was deleted in Tripletex: never booked again on its own. */
  | "drift"
  /** Someone changed the customer card at the same time: read again and retry once. */
  | "revision"
  /** Tripletex already has it: look it up and adopt it. */
  | "duplicate"
  /** Tripletex refuses it as it is (a closed period, a VAT code the account does not take): waits for a person. */
  | "rule";

export type TripletexFailure = {
  class: FailureClass;
  status: number | null;
  /** Tripletex's numeric error code, when it gave one. */
  code: number | null;
  /** Stable, for the page and the AI manager: `http_401`, `closed_period`, `timeout`, … */
  key: string;
  /** Tripletex's request id, for its support (`x-tlx-request-id`). */
  requestId: string | null;
  /** Seconds to wait (rate limit only). */
  retryAfter: number | null;
  /** Tripletex's own validation text, clipped; shown to the owner only. */
  detail: string | null;
};

type ErrorJson = { status?: unknown; code?: unknown; message?: unknown; validationMessages?: unknown; requestId?: unknown };

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Tripletex's validation messages as one line (`field: message; …`), with anything that looks like a token cut out. */
function validationText(body: ErrorJson): string | null {
  const list = Array.isArray(body.validationMessages) ? (body.validationMessages as { field?: unknown; message?: unknown }[]) : [];
  const parts = list
    .map((v) => [typeof v.field === "string" ? v.field : null, typeof v.message === "string" ? v.message : null].filter(Boolean).join(": "))
    .filter((s) => s !== "");
  const message = typeof body.message === "string" ? body.message : "";
  const text = (parts.length > 0 ? parts.join("; ") : message).replace(/[A-Za-z0-9._~+/=-]{40,}/g, "…");
  return text.trim() === "" ? null : clip(text.replace(/\s+/g, " ").trim(), 300);
}

/** A closed accounting period, as Tripletex words it (its code for it is not published; the words are). */
const CLOSED = /(period|periode)[^.]*\b(closed|lukket|stengt|låst|locked)|\b(closed|locked|lukket|låst)\b[^.]*(period|periode)/i;

/**
 * A failed answer's class. `status` is the HTTP status; `body` the parsed JSON, if any; `headers` reads one header.
 */
export function classifyFailure(status: number, body: unknown, header: (name: string) => string | null): TripletexFailure {
  const json: ErrorJson = body && typeof body === "object" ? (body as ErrorJson) : {};
  const code = typeof json.code === "number" ? json.code : null;
  const requestId = header("x-tlx-request-id") ?? (typeof json.requestId === "string" ? json.requestId : null);
  const detail = validationText(json);
  const base = { status, code, requestId, retryAfter: null, detail };
  if (status === 429) {
    const reset = Number(header("x-rate-limit-reset") ?? header("retry-after") ?? "");
    const seconds = Number.isFinite(reset) && reset > 0 ? Math.min(Math.ceil(reset), 15 * 60) : 60;
    return { ...base, class: "rate_limit", key: "rate_limit", retryAfter: seconds, detail: null };
  }
  if (status === 401) return { ...base, class: "auth", key: "http_401", detail: null };
  if (status === 403) return { ...base, class: "permission", key: "http_403" };
  if (status === 404) return { ...base, class: "drift", key: "http_404", detail: null };
  if (status === 409 && code === 8000) return { ...base, class: "revision", key: "revision" };
  if (status === 409 && code === 14000) return { ...base, class: "duplicate", key: "duplicate" };
  if (status >= 500) return { ...base, class: "transient", key: `http_${status}`, detail: null };
  if (detail && CLOSED.test(detail)) return { ...base, class: "rule", key: "closed_period" };
  return { ...base, class: "rule", key: status === 422 ? "validation" : `http_${status}` };
}

/** A call that never got an answer: a timeout, a refused connection, a redirect we do not follow. */
export function networkFailure(kind: "timeout" | "network" | "redirect"): TripletexFailure {
  return { class: kind === "redirect" ? "rule" : "transient", status: null, code: null, key: kind, requestId: null, retryAfter: null, detail: null };
}

/** What a failure says to an owner, in plain words, with what to do. */
export function failureWords(failure: Pick<TripletexFailure, "key" | "class">): string {
  switch (failure.key) {
    case "http_401":
      return "Tripletex no longer accepts the token. Make a new one in Tripletex and paste it on the Tripletex page.";
    case "http_403":
      return "The token may not do this in Tripletex. Give it access to accounting (vouchers, customers and accounts), then press Try again.";
    case "http_404":
      return "This was deleted in Tripletex. Post it again, or leave it out.";
    case "closed_period":
      return "Tripletex has closed the accounting period for this date. Open the period in Tripletex (or ask your accountant), then press Try again.";
    case "rate_limit":
      return "Tripletex asked us to slow down. It will go through by itself in a few minutes.";
    case "timeout":
    case "network":
      return "Tripletex did not answer. It will be tried again by itself.";
    case "redirect":
      return "Tripletex answered from another address, which is not followed. It will be tried again.";
    case "revision":
      return "The customer was changed in Tripletex at the same moment. It will be tried again.";
    case "duplicate":
      return "Tripletex already has this. It is looked up and linked.";
    case "no_consumer_token":
      return "This token is made for the Kaizena Flow app, which Tripletex has not approved yet. In Tripletex, make an API token under Company → API tokens instead, and paste that.";
    case "bad_answer":
      return "Tripletex answered with something we could not read. It will be tried again.";
    default:
      if (failure.class === "transient") return "Tripletex had a problem on its side. It will be tried again by itself.";
      return "Tripletex refused it. See what it said below, fix it in Tripletex or in the Tripletex settings, then press Try again.";
  }
}

/** Why a document waits before anything is sent (`BlockCode` of `tripletex-map.ts`, and the connection's own reasons), in words. */
export const BLOCK_WORDS: Record<string, string> = {
  currency_unsupported: "Only invoices in Norwegian kroner are sent to Tripletex for now. Book this one by hand.",
  vat_unmapped: "This document has a kind of VAT the Tripletex settings do not place yet. Choose where it goes under Tripletex → Customise.",
  totals_mismatch: "The lines do not add up to the total, so nothing was sent. Contact support.",
  nothing_to_book: "There is nothing to book on this document.",
  waiting_for_invoice: "Waits until its invoice is in Tripletex.",
  settings_problem: "The Tripletex settings need a look before this can be sent.",
};
