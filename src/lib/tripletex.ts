/**
 * Tripletex (D453, `docs/tripletex.md`): the pure basics every other Tripletex module shares. Reading the one token an owner
 * pastes, the two fixed addresses, the external voucher number that keeps a retry from booking twice, and amounts in the form
 * Tripletex takes. No I/O; safe in the browser.
 */

export type TripletexMode = "test" | "live";

/**
 * Where Tripletex answers. Fixed in code and chosen by the token itself, never typed by an owner, so a store cannot point
 * Kaizena Flow at another server (as `checkWebhookUrl()` does for webhooks). Tokens of one do not work on the other.
 */
export const TRIPLETEX_BASE: Record<TripletexMode, string> = {
  live: "https://tripletex.no/v2",
  test: "https://api-test.tripletex.tech/v2",
};

/**
 * What an owner pastes:
 * - `api_token`: the company's own API token (a JWT with the `tlxr_` prefix), made under Company → API tokens. Exchanged by
 *   `POST /token/session/:createFromRefreshToken`. Needs nothing of Kaizena Flow's.
 * - `employee_token`: an employee token made under My profile → API access for the application Kaizena Flow. Exchanged
 *   with Kaizena Flow's consumer token by `POST /token/session/:create`.
 *
 * A token that starts with `test-` is one of Tripletex's test environment.
 */
export type TripletexTokenKind = "api_token" | "employee_token";

export type PastedToken =
  | { ok: true; kind: TripletexTokenKind; mode: TripletexMode; token: string }
  | { ok: false; problem: "empty" | "not_a_token" };

const TOKEN_CHARS = /^[A-Za-z0-9._~+/=-]+$/;

/**
 * The token in what was pasted, with its kind and environment. Takes what a person copies: spaces, a line break, quotes, or
 * the whole `Token: …` line around it. Never logs or echoes what it was given.
 */
export function readPastedToken(raw: string): PastedToken {
  let text = raw.trim().replace(/^["'`]+|["'`]+$/g, "").trim();
  // "Token: abc…" or "API token abc…": the last word is the token.
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 1) text = words[words.length - 1].replace(/^["'`]+|["'`]+$/g, "");
  if (text === "") return { ok: false, problem: "empty" };
  if (text.length < 20 || text.length > 4000 || !TOKEN_CHARS.test(text)) return { ok: false, problem: "not_a_token" };
  const mode: TripletexMode = text.startsWith("test-") ? "test" : "live";
  const body = mode === "test" ? text.slice("test-".length) : text;
  if (body.length < 16) return { ok: false, problem: "not_a_token" };
  return { ok: true, kind: body.startsWith("tlxr_") ? "api_token" : "employee_token", mode, token: text };
}

/** What the page shows of a kept token: its prefix and last four characters, never the rest. */
export function tokenHint(token: string): string {
  const prefix = token.match(/^(test-)?(tlxr_)?/)?.[0] ?? "";
  return `${prefix}…${token.slice(-4)}`;
}

/** Tripletex's limit on `externalVoucherNumber` [spec]. */
export const EXTERNAL_NUMBER_MAX = 70;

/**
 * The external voucher number of a document: `kf/{store8}/{documentNumber}`, and `#{n}` for a deliberate second posting of
 * the same document (Post again, after a voucher was deleted in Tripletex). `store8` is the first eight hex digits of the
 * store's id, so two stores booking into one company never share a number. Looked up before every retry
 * (`GET /ledger/voucher/>externalVoucherNumber`), so a voucher whose answer was lost is adopted, never booked again.
 */
export function externalVoucherNumber(storeId: string, documentNumber: string, posting = 1): string {
  const store8 = storeId.replace(/-/g, "").slice(0, 8).toLowerCase();
  if (!/^[0-9a-f]{8}$/.test(store8)) throw new RangeError("A store id is a uuid");
  if (!Number.isSafeInteger(posting) || posting < 1) throw new RangeError("A posting is counted from 1");
  const suffix = posting > 1 ? `#${posting}` : "";
  const head = `kf/${store8}/`;
  const room = EXTERNAL_NUMBER_MAX - head.length - suffix.length;
  const doc = documentNumber.trim();
  if (doc === "" || doc.length > room) throw new RangeError("A document number is 1 to 50 characters");
  return `${head}${doc}${suffix}`;
}

/** The largest amount, in minor units, a voucher line may carry: well inside what a double holds exactly at two decimals. */
export const AMOUNT_MAX_MINOR = 1_000_000_000_000;

/**
 * An amount in minor units (øre) as the decimal number Tripletex takes ("rounded to 2 decimals" [spec]). Built from the
 * integer's digits, so 1999 is exactly 19.99, and every amount below `AMOUNT_MAX_MINOR` prints back the same. The only place
 * money becomes a non-integer, at the edge of the request.
 */
export function decimalOf(minor: number): number {
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > AMOUNT_MAX_MINOR) throw new RangeError("An amount is a whole number of minor units");
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  return Number(`${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`);
}

/** An amount Tripletex returned, back in minor units (`null` when it is not a number with at most two decimals). */
export function minorOf(amount: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount)) return null;
  const minor = Math.round(amount * 100);
  return Math.abs(minor / 100 - amount) < 1e-9 && Number.isSafeInteger(minor) ? minor : null;
}

/** Text Tripletex keeps on a voucher or posting: one line, no control characters, clipped (its limit is unverified, so kept short). */
export function clipText(text: string, max = 100): string {
  const one = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max - 1).trimEnd()}…`;
}

/** A Norwegian organisation number (nine digits, as Brønnøysund keeps them), or null. Spaces and an `MVA` suffix are dropped. */
export function norwegianOrgNumber(value: string | null | undefined): string | null {
  if (!value) return null;
  const digits = value.replace(/^NO/i, "").replace(/MVA$/i, "").replace(/[\s.-]/g, "");
  return /^\d{9}$/.test(digits) ? digits : null;
}
