import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  grantsPosting,
  isAuthorUrn,
  LINKEDIN_API,
  LINKEDIN_VERSION,
  linkedinAuthorizeUrl,
  memberFrom,
  organizationFrom,
  organizationIds,
  parseTokens,
  renewDue,
  type AuthorChoice,
} from "@/lib/linkedin";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { audit } from "./auth";
import { encryptionKey } from "./encryption-key";
import { dropConnection, keepProblem, keepTokens } from "./social-connect-tokens";
import type { Connection } from "./social-connect-routes";
import { ConnectError, connectStart, connectStarted } from "./social-connect-state";
import { col, typedRow } from "./typed-rows";

/**
 * A store's LinkedIn connection (D870 S3.6, pure parts in `src/lib/linkedin.ts`): Kaizena Flow's LinkedIn app (`LINKEDIN_CLIENT_ID`,
 * `LINKEDIN_CLIENT_SECRET`), signing in with `openid`, `profile` and `w_member_social`, and with `LINKEDIN_PAGES=1` (once LinkedIn has given
 * the app its Community Management API) `r_organization_admin` and `w_organization_social` too. The member's profile and the Pages they
 * administer are the places a post may go; with one it is chosen, with several the owner chooses on Social posts. The access token runs 60
 * days: renewed where LinkedIn gave a refresh token, else the card says when to connect again. The only writer of `linkedin_accounts`.
 */

const TIMEOUT_MS = 15_000;

export const LINKEDIN_COOKIE = "kaizen_linkedin_connect";
export const LINKEDIN_CALLBACK = "/api/integrations/linkedin/callback";
export const LINKEDIN_COOKIE_PATH = "/api/integrations/linkedin";

type App = { id: string; secret: string; pages: boolean };

function linkedinApp(): App | null {
  const id = process.env.LINKEDIN_CLIENT_ID?.trim();
  const secret = process.env.LINKEDIN_CLIENT_SECRET?.trim();
  return id && secret && encryptionKey() ? { id, secret, pages: process.env.LINKEDIN_PAGES?.trim() === "1" } : null;
}

/** Kaizena Flow's LinkedIn app is set up here, so owners can connect. */
export const linkedinAppOn = () => linkedinApp() !== null;

export class LinkedinError extends ConnectError {}

/** Where the owner is sent to connect, and what the callback must see again (kept in `kaizen_linkedin_connect`). */
export function linkedinStart(storeSlug: string, accountId: string): { url: string; cookie: string } | null {
  const app = linkedinApp();
  return app ? connectStart((state) => linkedinAuthorizeUrl(app.id, `${siteUrl()}${LINKEDIN_CALLBACK}`, state, app.pages), storeSlug, accountId) : null;
}

/** Who started connecting, from the cookie; checked against the state LinkedIn sends back. */
export function linkedinStarted(cookie: string | undefined, params: URLSearchParams): { store: string; accountId: string } {
  return connectStarted(cookie, params, (message) => new LinkedinError(message));
}

export type LinkedinAnswer = { json: Record<string, unknown>; restliId: string | null };

/** One call to LinkedIn (`url` whole): its JSON (empty for an answer without one) and its `x-restli-id`, or `LinkedinError` in LinkedIn's words. */
export async function linkedinCall(url: string, init: RequestInit = {}): Promise<LinkedinAnswer> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new LinkedinError("LinkedIn did not answer. Try again in a moment.");
  }
  const json = ((await response.json().catch(() => null)) as Record<string, unknown> | null) ?? {};
  if (!response.ok) {
    const said = typeof json.message === "string" ? json.message : typeof json.error_description === "string" ? json.error_description : null;
    throw new LinkedinError(said ? `LinkedIn said: ${said.slice(0, 200)}` : `LinkedIn answered ${response.status}.`);
  }
  return { json, restliId: response.headers.get("x-restli-id") };
}

/** The headers LinkedIn's versioned API wants with a token. */
export const restHeaders = (token: string, extra: Record<string, string> = {}): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "LinkedIn-Version": process.env.LINKEDIN_API_VERSION?.trim() || LINKEDIN_VERSION,
  "X-Restli-Protocol-Version": "2.0.0",
  ...extra,
});

/** The app's own call for tokens: a code exchanged, or a refresh token renewed. */
function tokenCall(app: App, params: Record<string, string>, call: typeof linkedinCall) {
  return call("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.id, client_secret: app.secret, ...params }),
  });
}

/** A place kept to choose among, with whether the token may post there. */
const CHOICE = z.object({ urn: z.string().refine(isAuthorUrn), name: z.string().max(200), post: z.boolean() });

/** The member's profile and, where the token reads them, the Pages they administer (at most 20), each with whether it may be posted to. */
async function placesOf(token: string, scopes: string[], call: typeof linkedinCall): Promise<z.infer<typeof CHOICE>[]> {
  const member = memberFrom((await call(`${LINKEDIN_API}/v2/userinfo`, { headers: { Authorization: `Bearer ${token}` } })).json);
  if (!member) throw new LinkedinError("LinkedIn did not say who signed in.");
  const places: AuthorChoice[] = [member];
  if (scopes.includes("r_organization_admin")) {
    const acls = await call(`${LINKEDIN_API}/rest/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED`, { headers: restHeaders(token) });
    for (const id of organizationIds(acls.json)) {
      places.push(organizationFrom(id, (await call(`${LINKEDIN_API}/rest/organizations/${id}`, { headers: restHeaders(token) }).catch(() => ({ json: {} }))).json));
    }
  }
  return places.map((p) => ({ ...p, post: grantsPosting(scopes, p.urn) }));
}

/**
 * Connects from the callback: the code exchanged for tokens and the places read. With only the profile it is chosen at once; with Pages too
 * the owner chooses (`chooseLinkedinPlace()`). A new connection replaces the store's old one. Audited without a token. The places to choose
 * among, when there are several.
 */
export async function connectLinkedin(accountId: string, storeId: string, params: URLSearchParams, call: typeof linkedinCall = linkedinCall): Promise<{ choose: AuthorChoice[] }> {
  const app = linkedinApp();
  const key = encryptionKey();
  if (!app || !key) throw new LinkedinError("Kaizena Flow's LinkedIn app is not set up here.");
  if (params.get("error")) throw new LinkedinError(params.get("error_description") ?? "Cancelled", "cancelled");
  const code = params.get("code");
  if (!code) throw new LinkedinError("LinkedIn did not connect.");
  const tokens = parseTokens((await tokenCall(app, { grant_type: "authorization_code", code, redirect_uri: `${siteUrl()}${LINKEDIN_CALLBACK}` }, call)).json, new Date());
  if (!tokens) throw new LinkedinError("LinkedIn gave no token.");
  const places = await placesOf(tokens.access, tokens.scopes, call);
  const only = places.length === 1 ? places[0] : null;
  await db().execute(sql`
    insert into commerce.linkedin_accounts (store_id, member_name, access_token_encrypted, refresh_token_encrypted, token_expires_at, refresh_expires_at, author_urn, author_name, choices, publish, connected_by)
    values (${storeId}::uuid, ${places[0].name}, ${encryptSecret(tokens.access, key)}, ${tokens.refresh ? encryptSecret(tokens.refresh, key) : null},
      ${tokens.expiresAt.toISOString()}::timestamptz, ${tokens.refreshExpiresAt?.toISOString() ?? null}::timestamptz, ${only?.urn ?? null}, ${only?.name ?? ""},
      ${JSON.stringify(only ? [] : places)}::jsonb, ${only?.post ?? false}, ${accountId}::uuid)
    on conflict on constraint linkedin_accounts_store_key do update set member_name = excluded.member_name, access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted, token_expires_at = excluded.token_expires_at, refresh_expires_at = excluded.refresh_expires_at,
      author_urn = excluded.author_urn, author_name = excluded.author_name, choices = excluded.choices, publish = excluded.publish, problem = null,
      connected_by = excluded.connected_by, updated_at = now()
  `);
  await audit(accountId, storeId, "store.linkedin_connected", { places: places.length, pages: places.length - 1 });
  return { choose: only ? [] : places.map(({ urn, name }) => ({ urn, name })) };
}

/** The owner's choice among the places: the profile or a Page. False when it is not one of the choices. */
export async function chooseLinkedinPlace(accountId: string, storeId: string, urn: string): Promise<boolean> {
  const row = await typedRow(z.object({ choices: z.unknown() }), sql`select choices from commerce.linkedin_accounts where store_id = ${storeId}::uuid`);
  const place = z.array(CHOICE).catch([]).parse(row?.choices ?? []).find((c) => c.urn === urn);
  if (!place) return false;
  await db().execute(sql`
    update commerce.linkedin_accounts set author_urn = ${place.urn}, author_name = ${place.name}, publish = ${place.post}, choices = '[]'::jsonb, problem = null, updated_at = now()
    where store_id = ${storeId}::uuid`);
  await audit(accountId, storeId, "store.linkedin_place_chosen", { page: place.urn.startsWith("urn:li:organization:") });
  return true;
}

/** Disconnects the store's LinkedIn: the row and its tokens go. LinkedIn's own list of apps is the member's to tidy. */
export async function disconnectLinkedin(accountId: string, storeId: string): Promise<void> {
  await dropConnection("linkedin_accounts", accountId, storeId, "store.linkedin_disconnected");
}

const TARGET = z.object({
  author: col.textOrNull,
  access: col.text,
  refresh: col.textOrNull,
  expires: col.timestamp,
  refresh_expires: col.timestampOrNull,
  publish: col.bool,
});

/**
 * Where a store's posts go with a live token: renewed first where it nears its end and LinkedIn gave a refresh token; used as it is while it
 * lasts otherwise. Or why it cannot be posted to, in words.
 */
export async function linkedinTarget(storeId: string, now = new Date(), call: typeof linkedinCall = linkedinCall): Promise<{ author: string; token: string } | { problem: string }> {
  const key = encryptionKey();
  if (!key) return { problem: "Publishing is not set up here." };
  const row = await typedRow(
    TARGET,
    sql`select author_urn as author, access_token_encrypted as access, refresh_token_encrypted as refresh, token_expires_at as expires,
        refresh_expires_at as refresh_expires, publish
      from commerce.linkedin_accounts where store_id = ${storeId}::uuid`,
  );
  if (!row?.author) return { problem: "Connect the store's LinkedIn and choose where posts go first." };
  if (!row.publish) return { problem: "LinkedIn does not allow Kaizena Flow to post there yet: connect again and allow posting." };
  const expires = new Date(row.expires);
  const renewable = row.refresh && (!row.refresh_expires || new Date(row.refresh_expires).getTime() > now.getTime());
  if (!renewDue(expires, now) || !renewable) {
    return expires.getTime() > now.getTime() ? { author: row.author, token: decryptSecret(row.access, key) } : { problem: "The LinkedIn connection has run out. Connect it again." };
  }
  const app = linkedinApp();
  if (!app) return { problem: "Kaizena Flow's LinkedIn app is not set up here." };
  const kept = { refresh: decryptSecret(row.refresh!, key), refreshExpiresAt: row.refresh_expires ? new Date(row.refresh_expires) : null };
  let tokens;
  try {
    tokens = parseTokens((await tokenCall(app, { grant_type: "refresh_token", refresh_token: kept.refresh }, call)).json, now, kept);
  } catch (error) {
    if (!(error instanceof LinkedinError)) throw error;
    await keepProblem("linkedin_accounts", storeId, error.message);
    return expires.getTime() > now.getTime() ? { author: row.author, token: decryptSecret(row.access, key) } : { problem: error.message };
  }
  if (!tokens) return { problem: "LinkedIn did not renew the connection. Connect it again." };
  await keepTokens("linkedin_accounts", storeId, key, tokens);
  return { author: row.author, token: tokens.access };
}

export type LinkedinView =
  | { state: "none" }
  | { state: "choose"; choices: AuthorChoice[] }
  | { state: "ready"; place: string; page: boolean; publish: boolean; endsAt: string | null; problem: string | null };

/** What the owner sees of their LinkedIn: none, places to choose among, or where posts go (with when to connect again, without renewal). */
export async function linkedinView(storeId: string): Promise<LinkedinView> {
  const row = await typedRow(
    z.object({ author: col.textOrNull, name: col.text, choices: z.unknown(), publish: col.bool, expires: col.timestamp, renewable: col.bool, problem: col.textOrNull }),
    sql`select author_urn as author, author_name as name, choices, publish, token_expires_at as expires, refresh_token_encrypted is not null as renewable, problem
      from commerce.linkedin_accounts where store_id = ${storeId}::uuid`,
  );
  if (!row) return { state: "none" };
  if (!row.author) return { state: "choose", choices: z.array(CHOICE).catch([]).parse(row.choices).map(({ urn, name }) => ({ urn, name })) };
  return { state: "ready", place: row.name, page: row.author.startsWith("urn:li:organization:"), publish: row.publish, endsAt: row.renewable ? null : row.expires, problem: row.problem };
}

/** The LinkedIn connection for its routes on Social posts (`src/server/social-connect-routes.ts`). */
export const LINKEDIN_CONNECTION: Connection = {
  key: "linkedin",
  cookie: LINKEDIN_COOKIE,
  cookiePath: LINKEDIN_COOKIE_PATH,
  isPlatformError: (error) => error instanceof LinkedinError,
  start: linkedinStart,
  started: linkedinStarted,
  connect: (accountId, storeId, params) => connectLinkedin(accountId, storeId, params),
  choose: chooseLinkedinPlace,
  chooseField: "place",
  disconnect: disconnectLinkedin,
  failedStatus: (error) => (error instanceof LinkedinError && error.reason === "cancelled" ? "cancelled" : "failed"),
};
