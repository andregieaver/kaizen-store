import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Fiken (D460, `docs/fiken.md`): the pure basics every Fiken module shares. Fiken's fixed addresses, the signed state an owner's browser
 * carries to Fiken's consent page and back (with the PKCE verifier), and the sale number that keeps a retry from booking twice. Fiken lets a
 * third party in only through OAuth2 (its terms forbid personal API tokens in one), so a store connects by approving Kaizena Flow's app on
 * fiken.no; there is no test environment, only test companies (`testCompany`). Server code only (it signs with `node:crypto`).
 */

/** Fiken's API and its OAuth2 server [spec: api.fiken.no/api/v2/docs/swagger.yaml]. Fixed in code: never from a store, a token or a page. */
export const FIKEN_API = "https://api.fiken.no/api/v2";
export const FIKEN_AUTHORIZE = "https://fiken.no/oauth/authorize";
export const FIKEN_TOKEN = "https://fiken.no/oauth/token";
export const FIKEN_REVOKE = "https://fiken.no/oauth/revoke";

/** The state cookie: only sent to the callback's own path, for a quarter of an hour. */
export const FIKEN_STATE_COOKIE = "kaizen_fiken";
export const FIKEN_STATE_PATH = "/api/integrations/fiken";
export const FIKEN_STATE_MINUTES = 15;

/** What the state cookie holds, signed: the nonce Fiken hands back, which store and account pressed Connect, and the PKCE verifier. */
export type FikenState = { state: string; store: string; account: string; verifier: string; expires: number };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;
/** RFC 7636: 43 to 128 characters of `[A-Za-z0-9-._~]`. */
const VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:fiken-connect").digest();
const sign = (secret: Buffer, body: string) => createHmac("sha256", derive(secret)).update(body).digest("base64url");

function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A fresh nonce, or a PKCE verifier: 64 characters of base64url, well inside both rules. */
export const randomToken = (): string => randomBytes(48).toString("base64url");

/** The PKCE challenge of a verifier: `base64url(sha256(verifier))`, without padding. */
export const codeChallenge = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

export function sealFikenState(secret: Buffer, value: Omit<FikenState, "expires">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, expires: now + FIKEN_STATE_MINUTES * 60_000 })).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** The state cookie's contents, or null when it is not one this server signed, is altered, malformed or over. */
export function openFikenState(secret: Buffer, sealed: string | null | undefined, now = Date.now()): FikenState | null {
  if (typeof sealed !== "string" || sealed.length > 2000) return null;
  const [body, given, ...rest] = sealed.split(".");
  if (!body || !given || rest.length > 0 || !sameText(sign(secret, body), given)) return null;
  let value: Partial<FikenState>;
  try {
    value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<FikenState>;
  } catch {
    return null;
  }
  const { state, store, account, verifier, expires } = value;
  if (typeof state !== "string" || !NONCE.test(state)) return null;
  if (typeof store !== "string" || !SLUG.test(store) || typeof account !== "string" || !UUID.test(account)) return null;
  if (typeof verifier !== "string" || !VERIFIER.test(verifier)) return null;
  if (typeof expires !== "number" || expires <= now || expires - now > FIKEN_STATE_MINUTES * 60_000) return null;
  return { state, store, account, verifier, expires };
}

/** Fiken's consent page for Kaizena Flow's app, with the state and the PKCE challenge (S256). */
export function fikenAuthorizeUrl(o: { clientId: string; redirectUri: string; state: string; challenge: string }): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    state: o.state,
    code_challenge: o.challenge,
    code_challenge_method: "S256",
  });
  return `${FIKEN_AUTHORIZE}?${query}`;
}

/** Whether an access token's time is up, two minutes early, so a call never starts with a token that ends on the way. */
export const accessDue = (expiresAt: Date | null, now = Date.now()): boolean => expiresAt === null || expiresAt.getTime() - 120_000 <= now;

/** A company's slug as Fiken names it in every address: lower case letters, digits and dashes. */
export const isFikenSlug = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,99}$/.test(value);

/**
 * The sale number of a document: its own number, as the accountant reads it on the PDF ("Annet salg" is for invoices numbered outside
 * Fiken). Looked up before every send (`GET /sales?saleNumber=`), so a sale whose answer was lost, or one the owner booked by hand, is
 * adopted when it is the same sale and never booked twice. A number of 1 to 50 characters.
 */
export function saleNumberOf(documentNumber: string): string {
  const number = documentNumber.trim();
  if (number === "" || number.length > 50) throw new RangeError("A document number is 1 to 50 characters");
  return number;
}

/** The id at the end of the address Fiken answers a create with (`Location: …/sales/2888156`), or null. */
export function idFromLocation(location: string | null, collection: "sales" | "contacts" | "attachments"): number | null {
  if (!location) return null;
  const match = location.match(new RegExp(`/${collection}/(\\d{1,18})(?:[/?#]|$)`));
  const id = match ? Number(match[1]) : NaN;
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** A country's English name, as Fiken takes it on an address ("Norway"), from its ISO code; null when unknown. */
export function countryName(code: string | null | undefined): string | null {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return null;
  try {
    const name = new Intl.DisplayNames(["en"], { type: "region" }).of(code.toUpperCase());
    return name && name !== code.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}
