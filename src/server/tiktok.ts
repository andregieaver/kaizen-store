import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";
import { grantsVideoPublish, parseCreator, parseTokens, renewDue, TIKTOK_API, tiktokAuthorizeUrl, tiktokRefusal } from "@/lib/tiktok";

import { audit } from "./auth";
import { encryptionKey } from "./encryption-key";
import type { Connection } from "./social-connect-routes";
import { ConnectError, connectStart, connectStarted } from "./social-connect-state";
import { col, typedRow } from "./typed-rows";

/**
 * A store's TikTok account (D870 S3.5, pure parts in `src/lib/tiktok.ts`): Kaizena Flow's TikTok app (`TIKTOK_CLIENT_KEY`,
 * `TIKTOK_CLIENT_SECRET`), signing in with `user.info.basic` and `video.publish`. The code is exchanged for tokens, kept encrypted, and the
 * account's name read from TikTok's creator info. The access token runs a day and is renewed whenever it is used near its end
 * (`tiktokTarget()`). `TIKTOK_PUBLIC` set to 1 once TikTok has audited the app: until then every post is private to the account. The only
 * writer of `tiktok_accounts`.
 */

const TIMEOUT_MS = 15_000;

export const TIKTOK_COOKIE = "kaizen_tiktok_connect";
export const TIKTOK_CALLBACK = "/api/integrations/tiktok/callback";
export const TIKTOK_COOKIE_PATH = "/api/integrations/tiktok";

type App = { key: string; secret: string };

function tiktokApp(): App | null {
  const key = process.env.TIKTOK_CLIENT_KEY?.trim();
  const secret = process.env.TIKTOK_CLIENT_SECRET?.trim();
  return key && secret && encryptionKey() ? { key, secret } : null;
}

/** Kaizena Flow's TikTok app is set up here, so owners can connect an account. */
export const tiktokAppOn = () => tiktokApp() !== null;

/** TikTok has audited Kaizena Flow's app, so posts may be public (`TIKTOK_PUBLIC=1`); until then they are private to the account. */
export const tiktokAudited = () => process.env.TIKTOK_PUBLIC?.trim() === "1";

export class TiktokError extends ConnectError {}

/** Where the owner is sent to connect, and what the callback must see again (kept in `kaizen_tiktok_connect`). */
export function tiktokStart(storeSlug: string, accountId: string): { url: string; cookie: string } | null {
  const app = tiktokApp();
  return app ? connectStart((state) => tiktokAuthorizeUrl(app.key, `${siteUrl()}${TIKTOK_CALLBACK}`, state), storeSlug, accountId) : null;
}

/** Who started connecting, from the cookie; checked against the state TikTok sends back. */
export function tiktokStarted(cookie: string | undefined, params: URLSearchParams): { store: string; accountId: string } {
  return connectStarted(cookie, params, (message) => new TiktokError(message));
}

/** One call to TikTok's API: its JSON, or `TiktokError` with TikTok's own words (never a person's data). */
export async function tiktokCall(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${TIKTOK_API}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new TiktokError("TikTok did not answer. Try again in a moment.");
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  // The token endpoint names its refusal in `error` and `error_description`; the other endpoints in `error.code` and `error.message`.
  const tokenRefusal = typeof json?.error === "string" ? String(json.error_description ?? json.error).slice(0, 200) : null;
  const said = tokenRefusal ?? tiktokRefusal(json);
  if (!response.ok || !json || said) throw new TiktokError(said ? `TikTok said: ${said}` : `TikTok answered ${response.status}.`);
  return json;
}

const json = (token: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=UTF-8" },
  body: JSON.stringify(body),
});

/** The app's own call for tokens: a code exchanged, or a refresh token renewed. */
function tokenCall(app: App, params: Record<string, string>, call: typeof tiktokCall) {
  return call("/oauth/token/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_key: app.key, client_secret: app.secret, ...params }),
  });
}

/** The account's name and who it lets see its posts, asked of TikTok before each post too (its rule for posting). */
export const creatorInfo = async (token: string, call: typeof tiktokCall = tiktokCall) => parseCreator(await call("/post/publish/creator_info/query/", json(token, {})));

/** Connects from the callback: the code exchanged for tokens and the account's name read. A new connection replaces the old one. */
export async function connectTiktok(accountId: string, storeId: string, params: URLSearchParams, call: typeof tiktokCall = tiktokCall): Promise<{ choose: never[] }> {
  const app = tiktokApp();
  const key = encryptionKey();
  if (!app || !key) throw new TiktokError("Kaizena Flow's TikTok app is not set up here.");
  if (params.get("error")) throw new TiktokError(params.get("error_description") ?? "Cancelled", "cancelled");
  const code = params.get("code");
  if (!code) throw new TiktokError("TikTok did not connect.");
  const tokens = parseTokens(await tokenCall(app, { code, grant_type: "authorization_code", redirect_uri: `${siteUrl()}${TIKTOK_CALLBACK}` }, call), new Date());
  if (!tokens) throw new TiktokError("TikTok gave no token.");
  const publish = grantsVideoPublish(tokens.scopes);
  const creator = publish ? await creatorInfo(tokens.access, call) : { username: "" };
  await db().execute(sql`
    insert into commerce.tiktok_accounts (store_id, open_id, username, access_token_encrypted, refresh_token_encrypted, token_expires_at, refresh_expires_at, publish, connected_by)
    values (${storeId}::uuid, ${tokens.openId}, ${creator.username}, ${encryptSecret(tokens.access, key)}, ${encryptSecret(tokens.refresh, key)},
      ${tokens.expiresAt.toISOString()}::timestamptz, ${tokens.refreshExpiresAt.toISOString()}::timestamptz, ${publish}, ${accountId}::uuid)
    on conflict on constraint tiktok_accounts_store_key do update set open_id = excluded.open_id, username = excluded.username,
      access_token_encrypted = excluded.access_token_encrypted, refresh_token_encrypted = excluded.refresh_token_encrypted,
      token_expires_at = excluded.token_expires_at, refresh_expires_at = excluded.refresh_expires_at, publish = excluded.publish, problem = null,
      connected_by = excluded.connected_by, updated_at = now()
  `);
  await audit(accountId, storeId, "store.tiktok_connected", { publish });
  return { choose: [] };
}

/** Disconnects the store's TikTok account: the row and its tokens go. TikTok's own list of apps is the owner's to tidy. */
export async function disconnectTiktok(accountId: string, storeId: string): Promise<void> {
  const gone = await db().execute(sql`delete from commerce.tiktok_accounts where store_id = ${storeId}::uuid returning id`);
  if (gone.length > 0) await audit(accountId, storeId, "store.tiktok_disconnected", {});
}

const TARGET = z.object({ username: col.text, access: col.text, refresh: col.text, expires: col.timestamp, refresh_expires: col.timestamp, publish: col.bool });

/** The account a store's videos go to with a live token, renewed first when it nears its end (the new tokens kept); or why not, in words. */
export async function tiktokTarget(storeId: string, now = new Date(), call: typeof tiktokCall = tiktokCall): Promise<{ username: string; token: string } | { problem: string }> {
  const key = encryptionKey();
  if (!key) return { problem: "Publishing is not set up here." };
  const row = await typedRow(
    TARGET,
    sql`select username, access_token_encrypted as access, refresh_token_encrypted as refresh, token_expires_at as expires, refresh_expires_at as refresh_expires, publish
      from commerce.tiktok_accounts where store_id = ${storeId}::uuid`,
  );
  if (!row) return { problem: "Connect the store's TikTok account first." };
  if (!row.publish) return { problem: "Connect TikTok again and allow posting videos, so Kaizena Flow may post for you." };
  if (!renewDue(new Date(row.expires), now)) return { username: row.username, token: decryptSecret(row.access, key) };
  if (new Date(row.refresh_expires).getTime() <= now.getTime()) return { problem: "The TikTok connection has run out. Connect it again." };
  const app = tiktokApp();
  if (!app) return { problem: "Kaizena Flow's TikTok app is not set up here." };
  let tokens;
  try {
    tokens = parseTokens(await tokenCall(app, { grant_type: "refresh_token", refresh_token: decryptSecret(row.refresh, key) }, call), now);
  } catch (error) {
    if (!(error instanceof TiktokError)) throw error;
    await db().execute(sql`update commerce.tiktok_accounts set problem = ${error.message.slice(0, 300)}, updated_at = now() where store_id = ${storeId}::uuid`);
    return { problem: error.message };
  }
  if (!tokens) return { problem: "TikTok did not renew the connection. Connect it again." };
  await db().execute(sql`
    update commerce.tiktok_accounts set access_token_encrypted = ${encryptSecret(tokens.access, key)}, refresh_token_encrypted = ${encryptSecret(tokens.refresh, key)},
      token_expires_at = ${tokens.expiresAt.toISOString()}::timestamptz, refresh_expires_at = ${tokens.refreshExpiresAt.toISOString()}::timestamptz, problem = null, updated_at = now()
    where store_id = ${storeId}::uuid`);
  return { username: row.username, token: tokens.access };
}

export type TiktokView = { state: "none" } | { state: "ready"; username: string; publish: boolean; problem: string | null };

/** What the owner sees of their TikTok connection. */
export async function tiktokView(storeId: string): Promise<TiktokView> {
  const row = await typedRow(
    z.object({ username: col.text, publish: col.bool, problem: col.textOrNull }),
    sql`select username, publish, problem from commerce.tiktok_accounts where store_id = ${storeId}::uuid`,
  );
  return row ? { state: "ready", username: row.username, publish: row.publish, problem: row.problem } : { state: "none" };
}

/** The TikTok account's connection for its routes on Social posts (`src/server/social-connect-routes.ts`): one account, nothing to choose. */
export const TIKTOK_CONNECTION: Connection = {
  key: "tiktok",
  cookie: TIKTOK_COOKIE,
  cookiePath: TIKTOK_COOKIE_PATH,
  isPlatformError: (error) => error instanceof TiktokError,
  start: tiktokStart,
  started: tiktokStarted,
  connect: (accountId, storeId, params) => connectTiktok(accountId, storeId, params),
  choose: async () => false,
  chooseField: "account",
  disconnect: disconnectTiktok,
  failedStatus: (error) => (error instanceof TiktokError && error.reason === "cancelled" ? "cancelled" : "failed"),
};
