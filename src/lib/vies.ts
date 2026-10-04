/**
 * The VIES check of an EU VAT number (D157, docs/wave-1a-tax.md section 4.3), without any input or output: the
 * constants, the request, the reading of the answer and the rules around it. The call itself is `src/server/vies.ts`,
 * which gets `fetch` injected.
 *
 * Source: the VIES REST API specification (https://ec.europa.eu/assets/taxud/vow-information/swagger_publicVAT.yaml,
 * read 2026-10-03): `POST /check-vat-number` with `countryCode`, `vatNumber` and optionally `requesterMemberStateCode` and
 * `requesterNumber`; the answer has `valid`, `requestDate`, `requestIdentifier`, `name` and `address`. The site's own
 * error codes are not in that file. VIES confirms that a number is registered; it does not say that goods are exempt.
 *
 * What is certain here: the host and path are constants (nothing a person types ever becomes part of an address); only
 * a country code from the closed list of prefixes and the number's characters enter the body; anything that is not an
 * HTTP 200 with a boolean `valid` is *unavailable*, and unavailable never exempts and never blocks a sale.
 */
import { EU_VAT_PREFIXES, VAT_NUMBER_STORED } from "./vat-number";

export const VIES_HOST = "ec.europa.eu";
export const VIES_PATH = "/taxation_customs/vies/rest-api/check-vat-number";
export const VIES_URL = `https://${VIES_HOST}${VIES_PATH}`;

/** How long one request may take. */
export const VIES_TIMEOUT_MS = 4000;
/** Retries after a timeout, a network error or a 5xx answer (none after a definite answer). */
export const VIES_RETRIES = 1;
/** The most of an answer that is read. */
export const VIES_MAX_BODY_BYTES = 16 * 1024;
/** How long an answer is reused for the same store and number. */
export const VIES_CACHE_HOURS = 24;
/**
 * Live requests (not cache hits) allowed in an hour; over it the answer is *unavailable* (VAT is charged, nothing is blocked).
 * Taken *before* VIES is asked, as one atomic count per bucket (`commerce.chat_usage`), so a burst of parallel requests cannot
 * pass them. The limits are for: one cart, one client (a keyed hash of the address, changing daily), the store's shoppers
 * together, and the store owner's own checks (a pool of its own, so that shoppers cannot use up the owner's). A cart that
 * already holds a valid answer asking again for it (a stale one before checkout) may use the store's reserve above the
 * shoppers' limit. The windows are whole clock hours: a burst can reach twice a limit across the turn of an hour.
 */
export const VIES_LIMIT_PER_CART_PER_HOUR = 10;
export const VIES_LIMIT_PER_CLIENT_PER_HOUR = 20;
export const VIES_LIMIT_PER_STORE_PER_HOUR = 60;
export const VIES_RESERVE_FOR_REFRESH_PER_HOUR = 30;
export const VIES_LIMIT_OWNER_PER_HOUR = 20;

/** The address to ask: VIES, or a test server when (and only when) the test switch is on and this is not Vercel. */
export function viesEndpoint(env: { testUrl?: string | undefined; allowTest?: string | undefined; vercel?: string | undefined }): string {
  if (env.allowTest === "1" && !env.vercel && env.testUrl) {
    try {
      const url = new URL(env.testUrl);
      if (url.protocol === "http:" || url.protocol === "https:") return url.toString();
    } catch {
      // not an address: the real one
    }
  }
  return VIES_URL;
}

/** A normalised number split for the request: prefix `EL`/`SE`... and the rest. */
export type ViesNumber = { prefix: string; body: string };

/** The request body, or null when the number is not one VIES can be asked about (a prefix outside the member states, a bad body). */
export function viesRequestBody(
  number: ViesNumber,
  requester?: ViesNumber | null,
): { countryCode: string; vatNumber: string; requesterMemberStateCode?: string; requesterNumber?: string } | null {
  const ok = (n: ViesNumber) => EU_VAT_PREFIXES.includes(n.prefix) && /^[0-9A-Za-z+*.]{2,12}$/.test(n.body);
  if (!ok(number)) return null;
  const body: { countryCode: string; vatNumber: string; requesterMemberStateCode?: string; requesterNumber?: string } = {
    countryCode: number.prefix,
    vatNumber: number.body,
  };
  if (requester && ok(requester)) {
    body.requesterMemberStateCode = requester.prefix;
    body.requesterNumber = requester.body;
  }
  return body;
}

/** Splits a stored number (`SE556677889901`) into its prefix and body; null when it is not in stored form. */
export function splitStoredNumber(number: string): ViesNumber | null {
  return VAT_NUMBER_STORED.test(number) ? { prefix: number.slice(0, 2), body: number.slice(2) } : null;
}

export type ViesStatus = "valid" | "invalid" | "unavailable";

export type ViesAnswer = {
  status: ViesStatus;
  /** What the registry holds; null where it says nothing (`---`) or the number is not valid. */
  name: string | null;
  address: string | null;
  /** The consultation number, present when the request carried the requester's own number. */
  requestIdentifier: string | null;
  /** A short code for an *unavailable* (or refused) answer: `http_503`, `timeout`, `network`, `malformed`, `limit`... */
  error: string | null;
};

const unavailable = (error: string): ViesAnswer => ({ status: "unavailable", name: null, address: null, requestIdentifier: null, error });

/** VIES writes `---` where a member state does not disclose the field. */
const disclosed = (value: unknown, max: number): string | null => {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" || /^-+$/.test(text) ? null : text.slice(0, max);
};

/** The error codes the service itself uses that are a definite answer about the number (everything else is *unavailable*). */
const DEFINITE = new Set(["", "VALID", "INVALID"]);

/**
 * Reads an answer. Definite answers are HTTP 200 with a boolean `valid` and no error text other than the two verdicts;
 * a 400 is a refusal of the request (the number is not one it can look up), the rest, and anything unreadable, is
 * unavailable. `valid: true` is only ever believed when nothing else in the answer says there was a problem.
 */
export function parseViesResponse(status: number, text: string): ViesAnswer {
  if (status === 400) return { status: "invalid", name: null, address: null, requestIdentifier: null, error: "http_400" };
  if (status !== 200) return unavailable(`http_${status}`);
  let json: unknown;
  try {
    json = JSON.parse(text.slice(0, VIES_MAX_BODY_BYTES));
  } catch {
    return unavailable("malformed");
  }
  if (typeof json !== "object" || json === null || Array.isArray(json)) return unavailable("malformed");
  const answer = json as Record<string, unknown>;
  if (typeof answer.valid !== "boolean") return unavailable("malformed");
  const userError = typeof answer.userError === "string" ? answer.userError.trim().toUpperCase() : "";
  const wrappers = answer.errorWrappers;
  if (!DEFINITE.has(userError) || (Array.isArray(wrappers) && wrappers.length > 0)) {
    return unavailable(`service_${userError || "error"}`.toLowerCase().slice(0, 60));
  }
  if (!answer.valid) return { status: "invalid", name: null, address: null, requestIdentifier: null, error: null };
  const identifier = typeof answer.requestIdentifier === "string" && answer.requestIdentifier.trim() !== "" ? answer.requestIdentifier.trim().slice(0, 60) : null;
  return {
    status: "valid",
    name: disclosed(answer.name, 200),
    address: disclosed(answer.address, 400),
    requestIdentifier: identifier,
    error: null,
  };
}

/** Whether an attempt is worth repeating: it did not get a definite answer from the service. */
export const viesWorthRetry = (answer: ViesAnswer): boolean =>
  answer.status === "unavailable" && (answer.error === "timeout" || answer.error === "network" || /^http_5\d\d$/.test(answer.error ?? ""));

export { unavailable as viesUnavailable };

/** Whether a check made at `checkedAt` may still be used at `now`. */
export const viesFresh = (checkedAt: Date | string | number, now: Date | string | number = Date.now()): boolean =>
  new Date(now).getTime() - new Date(checkedAt).getTime() <= VIES_CACHE_HOURS * 3_600_000;

/**
 * What the buyer's number means for the order, from the latest check of it: `none` (nothing typed), `valid` (checked
 * valid within 24 hours), `stale` (valid, but too old to rely on), `invalid`, or `unavailable`.
 */
export type BuyerVatState = "none" | "valid" | "invalid" | "unavailable" | "stale";

export function buyerVatState(
  check: { status: ViesStatus; requestedAt: Date | string | number } | null | undefined,
  now: Date | string | number = Date.now(),
): BuyerVatState {
  if (!check) return "none";
  if (check.status === "invalid") return "invalid";
  if (check.status === "unavailable") return "unavailable";
  return viesFresh(check.requestedAt, now) ? "valid" : "stale";
}
