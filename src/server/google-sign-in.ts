import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { accountsShown } from "@/lib/customer-accounts";
import { googleEnv } from "@/lib/env";
import {
  GOOGLE_HANDOVER_SECONDS,
  GOOGLE_TOKEN,
  authorizeUrl,
  checkIdToken,
  idTokenClaims,
  openState,
  sealState,
  shopSlugsOk,
  type GoogleOutcome,
} from "@/lib/google-sign-in";
import { marketOrigin, marketPath } from "@/lib/paths";
import { parseKey } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { consumeSignInLink } from "./companies";
import { sha256, startSession } from "./customers";
import { log } from "./log";
import { resolveShop } from "./shop";

type Row = Record<string, unknown>;

/**
 * Customers' *Sign in with Google* (wave 10 unit L, D375; the flow and its rules in `src/lib/google-sign-in.ts`). Off until Kaizena Flow's
 * own Google client is set (`googleEnv()`) and the server can sign (`SETTINGS_ENCRYPTION_KEY`); off for a store whose accounts are off
 * (D365). Google is asked only for the email, and only an account the store already has, by that email, signs in: Google's word that the
 * address is verified stands for the code the store would otherwise email (so an account staff added (D366), unproven, becomes proven).
 * The hand-over to the store's host is a `customer_sign_in_links` row two minutes long, used once. The tests give Google's endpoints and
 * `fetch` (`GoogleDeps`); the app never takes an endpoint from configuration.
 */

export type GoogleDeps = { fetch?: typeof fetch; authorize?: string; token?: string; issuers?: readonly string[]; now?: number };

const signingKey = (): Buffer | null => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
const random = () => randomBytes(32).toString("base64url");
export const googleRedirectUri = (): string => `${siteUrl()}/api/auth/google/callback`;

/** The client, when *Sign in with Google* can work on this server. */
function client(): { clientId: string; clientSecret: string; key: Buffer } | null {
  let env: ReturnType<typeof googleEnv>;
  try {
    env = googleEnv();
  } catch (error) {
    log("error", "google_sign_in.misconfigured", {}, error);
    return null;
  }
  const key = signingKey();
  return env && key ? { ...env, key } : null;
}

/** Whether the store's sign-in form offers Google: the client exists and the store has accounts. */
export const googleSignInOffered = (store: { customerAccounts?: Parameters<typeof accountsShown>[0]["customerAccounts"] }): boolean =>
  client() !== null && accountsShown(store);

/** Where the store's *Sign in with Google* button leads: the start on Kaizena Flow's own host. */
export const googleStartUrl = (storeSlug: string, marketSlug: string): string =>
  `${siteUrl()}/api/auth/google/start?${new URLSearchParams({ s: storeSlug, m: marketSlug })}`;

/** The store's sign-in form with what became of a sign-in, on the market's own origin. */
const backToForm = (storeSlug: string, marketSlug: string, outcome: GoogleOutcome): string =>
  `${marketOrigin(storeSlug, marketSlug)}${marketPath(storeSlug, marketSlug, `/account?google=${outcome}`)}`;

export type GoogleStart = { ok: true; url: string; cookie: string } | { ok: false };

/** The press: a fresh state, verifier and nonce, sealed for the cookie, and Google's address. Refused for a store or market that is none. */
export async function startGoogle(storeSlug: unknown, marketSlug: unknown, deps: GoogleDeps = {}): Promise<GoogleStart> {
  const c = client();
  if (!c || !shopSlugsOk(storeSlug, marketSlug)) return { ok: false };
  const shop = await resolveShop(String(storeSlug), String(marketSlug));
  if (!shop || !accountsShown(shop.store)) return { ok: false };
  const value = { state: random(), verifier: random(), nonce: random(), store: shop.store.slug, market: shop.market.slug };
  return {
    ok: true,
    cookie: sealState(c.key, value, deps.now),
    url: authorizeUrl({ clientId: c.clientId, redirectUri: googleRedirectUri(), state: value.state, verifier: value.verifier, nonce: value.nonce, authorize: deps.authorize }),
  };
}

/**
 * Google's return: the state checked against the cookie, the code exchanged for an ID token with the client's secret and the verifier, the
 * token checked, and the store's account found by the verified email. The answer is where to send the browser: the hand-over on the
 * market's own origin, or the store's form with why not. Never a page of another site: every address is the store's own or Kaizena Flow's.
 */
export async function finishGoogle(input: { code: unknown; state: unknown; cookie: string | undefined }, deps: GoogleDeps = {}): Promise<string> {
  const c = client();
  if (!c) return siteUrl();
  const sealed = openState(c.key, input.cookie, deps.now);
  if (!sealed) return siteUrl();
  const failed = backToForm(sealed.store, sealed.market, "failed");
  if (typeof input.state !== "string" || input.state !== sealed.state || typeof input.code !== "string" || input.code.length === 0 || input.code.length > 2000) return failed;
  let idToken: unknown;
  try {
    const response = await (deps.fetch ?? fetch)(deps.token ?? GOOGLE_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: input.code,
        client_id: c.clientId,
        client_secret: c.clientSecret,
        redirect_uri: googleRedirectUri(),
        code_verifier: sealed.verifier,
      }).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      log("warn", "google_sign_in.token_refused", { status: response.status });
      return failed;
    }
    idToken = ((await response.json()) as { id_token?: unknown }).id_token;
  } catch (error) {
    log("warn", "google_sign_in.token_failed", {}, error);
    return failed;
  }
  const email = checkIdToken(idTokenClaims(idToken), { clientId: c.clientId, nonce: sealed.nonce, issuers: deps.issuers, now: deps.now });
  if (!email) return failed;
  const shop = await resolveShop(sealed.store, sealed.market);
  if (!shop || !accountsShown(shop.store)) return failed;
  const [customer] = await db().execute<Row>(sql`
    select id from commerce.customers where store_id = ${shop.store.id}::uuid and lower(email) = ${email}
  `);
  if (!customer) return backToForm(shop.store.slug, shop.market.slug, "no_account");
  const token = random();
  await db().execute(sql`
    insert into commerce.customer_sign_in_links (store_id, customer_id, token_hash, expires_at)
    values (${shop.store.id}::uuid, ${String(customer.id)}::uuid, ${sha256(token)}, now() + make_interval(secs => ${GOOGLE_HANDOVER_SECONDS}))
  `);
  return `${marketOrigin(shop.store.slug, shop.market.slug)}/api/shop/google/enter?${new URLSearchParams({ s: shop.store.slug, m: shop.market.slug, t: token })}`;
}

/**
 * The hand-over on the store's own host: the link used once, a session started here (its cookie is this host's), the email marked proven,
 * and the account's page; a link used, over or of another store goes back to the form.
 */
export async function enterGoogle(storeSlug: unknown, marketSlug: unknown, token: unknown): Promise<string> {
  if (!shopSlugsOk(storeSlug, marketSlug)) return "/";
  const shop = await resolveShop(String(storeSlug), String(marketSlug));
  if (!shop) return "/";
  const customerId = typeof token === "string" ? await consumeSignInLink(shop.store.id, token) : null;
  if (!customerId) return marketPath(shop.store.slug, shop.market.slug, "/account?google=failed");
  await db().execute(sql`
    update commerce.customers set email_verified_at = coalesce(email_verified_at, now()) where store_id = ${shop.store.id}::uuid and id = ${customerId}::uuid
  `);
  await startSession(shop.store.id, customerId);
  return marketPath(shop.store.slug, shop.market.slug, "/account");
}
