import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Customers' *Sign in with Google* (wave 10 unit L, D375), the pure parts. The flow runs on Kaizena Flow's own host, because Google lets one
 * client name only the redirect addresses registered for it, and stores live on many hosts: the store's sign-in form links to
 * `/api/auth/google/start` on the platform's host, which keeps the request's state, PKCE verifier and nonce in a short, signed, HttpOnly
 * cookie (`GOOGLE_STATE_COOKIE`) and sends the browser to Google; Google returns to `/api/auth/google/callback` there, which exchanges the
 * code for an ID token with Kaizena Flow's client, checks it (`checkIdToken()`), and hands over to the store's own host with a one-time link
 * (`/api/shop/google/enter`). Only a verified email of an account the store already has signs in: nothing is created, nothing else of the
 * Google account is kept.
 */

export const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
/** The issuers Google's ID tokens carry (it uses both spellings). */
export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;

export const GOOGLE_STATE_COOKIE = "kaizen_google";
export const GOOGLE_STATE_PATH = "/api/auth/google";
/** How long a sign-in may take between the press and Google's return. */
export const GOOGLE_STATE_MINUTES = 10;
/** How long the hand-over link to the store's host lives: it is followed by the same browser at once. */
export const GOOGLE_HANDOVER_SECONDS = 120;

/** Why a sign-in ended without a session, as the store's form says it (`?google=`). */
export type GoogleOutcome = "no_account" | "failed";

/** What the state cookie holds, signed: who asked, for which store and market, and the secrets that tie Google's answer to this browser. */
export type GoogleState = { state: string; verifier: string; nonce: string; store: string; market: string; expires: number };

const SLUG = /^[a-z0-9][a-z0-9-]{0,62}$/;
const MARKET = /^[a-z]{2}(?:-[a-z0-9-]{2,20})?$/;
const RANDOM = /^[A-Za-z0-9_-]{32,128}$/;

const derive = (secret: Buffer) => createHmac("sha256", secret).update("kaizen:google-sign-in").digest();
const sign = (secret: Buffer, body: string) => createHmac("sha256", derive(secret)).update(body).digest("base64url");

export function sealState(secret: Buffer, value: Omit<GoogleState, "expires">, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ ...value, expires: now + GOOGLE_STATE_MINUTES * 60_000 })).toString("base64url");
  return `${body}.${sign(secret, body)}`;
}

/** The state cookie's contents, or null when it is not one this server signed, is altered, malformed or over. */
export function openState(secret: Buffer, sealed: string | null | undefined, now = Date.now()): GoogleState | null {
  if (typeof sealed !== "string" || sealed.length > 2000) return null;
  const [body, given, ...rest] = sealed.split(".");
  if (!body || !given || rest.length > 0) return null;
  const expected = Buffer.from(sign(secret, body));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  let value: Partial<GoogleState>;
  try {
    value = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<GoogleState>;
  } catch {
    return null;
  }
  const { state, verifier, nonce, store, market, expires } = value;
  if (![state, verifier, nonce].every((v) => typeof v === "string" && RANDOM.test(v))) return null;
  if (typeof store !== "string" || !SLUG.test(store) || typeof market !== "string" || !MARKET.test(market)) return null;
  if (typeof expires !== "number" || expires <= now || expires - now > GOOGLE_STATE_MINUTES * 60_000) return null;
  return { state: state!, verifier: verifier!, nonce: nonce!, store, market, expires };
}

/** Whether a store slug and a market slug from a request are shaped as addresses are (looked up afterwards). */
export const shopSlugsOk = (store: unknown, market: unknown): boolean => typeof store === "string" && SLUG.test(store) && typeof market === "string" && MARKET.test(market);

/** The PKCE challenge of a verifier (S256). */
export const challengeOf = (verifier: string): string => createHash("sha256").update(verifier).digest("base64url");

/** Google's authorisation address for this request: the email only (`openid email`), PKCE, a nonce, and the account chooser. */
export function authorizeUrl(o: { clientId: string; redirectUri: string; state: string; verifier: string; nonce: string; authorize?: string }): string {
  const url = new URL(o.authorize ?? GOOGLE_AUTHORIZE);
  url.search = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: "code",
    scope: "openid email",
    state: o.state,
    nonce: o.nonce,
    code_challenge: challengeOf(o.verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  return url.toString();
}

/** The claims of a JWT's payload, unverified: the caller has the token from Google's token endpoint over TLS (OIDC Core 3.1.3.7, 6). */
export function idTokenClaims(token: unknown): Record<string, unknown> | null {
  if (typeof token !== "string" || token.length > 8000) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return claims && typeof claims === "object" && !Array.isArray(claims) ? (claims as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The email an ID token vouches for, or null: from Google (`iss`), for Kaizena Flow's client (`aud`, and `azp` when present), not over
 * (`exp`, a minute's leeway) and not issued in the future, carrying this request's nonce, and with Google saying the email is verified.
 */
export function checkIdToken(claims: Record<string, unknown> | null, o: { clientId: string; nonce: string; issuers?: readonly string[]; now?: number }): string | null {
  if (!claims) return null;
  const now = Math.floor((o.now ?? Date.now()) / 1000);
  const issuers = o.issuers ?? GOOGLE_ISSUERS;
  if (typeof claims.iss !== "string" || !issuers.includes(claims.iss)) return null;
  const aud = claims.aud;
  if (!(aud === o.clientId || (Array.isArray(aud) && aud.includes(o.clientId)))) return null;
  if (claims.azp !== undefined && claims.azp !== o.clientId) return null;
  if (typeof claims.exp !== "number" || claims.exp + 60 < now) return null;
  if (typeof claims.iat === "number" && claims.iat - 60 > now) return null;
  if (claims.nonce !== o.nonce) return null;
  if (claims.email_verified !== true && claims.email_verified !== "true") return null;
  if (typeof claims.email !== "string" || claims.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) return null;
  return claims.email.trim().toLowerCase();
}
