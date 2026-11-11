import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import { authorizeUrl, keptPosts, parsePosts, postsDue, tokenDue, type InstagramPost } from "@/lib/instagram";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { audit } from "./auth";
import { log } from "./log";
import { refreshTag } from "./refresh";
import { encryptionKey } from "./settings";
import { col, typedRows } from "./typed-rows";

/**
 * The Instagram feed's connection (D543, pure parts in `src/lib/instagram.ts`): Kaizena Flow's Instagram app (`INSTAGRAM_APP_ID`,
 * `INSTAGRAM_APP_SECRET`), Instagram Login with the one scope `instagram_business_basic`, a long-lived token per owner (a store, or Kaizena
 * Flow with a null store) kept encrypted, refreshed by the dispatcher before it runs out, and the account's latest posts read hourly and kept
 * in the row. A page reads the kept posts (`instagramPosts()`, cached under `instagramTag()`), never Instagram, so a visitor costs no call
 * and tells Meta nothing; the pictures come through `/api/instagram/…`.
 */

const TIMEOUT_MS = 10_000;
const GRAPH = "https://graph.instagram.com";
const FIELDS = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp";

export const INSTAGRAM_COOKIE = "kaizen_instagram_connect";
export const INSTAGRAM_CALLBACK = "/api/integrations/instagram/callback";
export const INSTAGRAM_COOKIE_PATH = "/api/integrations/instagram";
/** In place of a store's slug in the cookie: Kaizena Flow's own account, connected on Platform → Instagram. Never a slug. */
export const PLATFORM_INSTAGRAM = "~platform";

/** The cache tag of an owner's posts: a store's id, or `kaizen` for Kaizena Flow's. */
export const instagramTag = (storeId: string | null) => `instagram:${storeId ?? "kaizen"}`;

type App = { appId: string; appSecret: string };

function instagramApp(): App | null {
  const appId = process.env.INSTAGRAM_APP_ID?.trim();
  const appSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
  if (!appId || !appSecret || !encryptionKey()) return null;
  return { appId, appSecret };
}

/** Kaizena Flow's Instagram app is set up here, so owners can connect an account. */
export const instagramAppOn = () => instagramApp() !== null;

export class InstagramError extends Error {
  constructor(
    message: string,
    readonly reason: "cancelled" | "failed" = "failed",
  ) {
    super(message);
  }
}

/** Where the owner is sent to connect, and what the callback must see again (kept in `kaizen_instagram_connect`). */
export function instagramStart(owner: string, accountId: string): { url: string; cookie: string } | null {
  const app = instagramApp();
  if (!app) return null;
  const state = randomBytes(24).toString("base64url");
  return { url: authorizeUrl(app.appId, `${siteUrl()}${INSTAGRAM_CALLBACK}`, state), cookie: [state, owner, accountId].join(".") };
}

/** Who started connecting, from the cookie; checked against the state Instagram sends back. */
export function instagramStarted(cookie: string | undefined, params: URLSearchParams): { owner: string; accountId: string } {
  const [state, owner, accountId] = (cookie ?? "").split(".");
  if (!state || !owner || !accountId || state !== params.get("state")) throw new InstagramError("The connection could not be checked.");
  return { owner, accountId };
}

async function call(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new InstagramError("Instagram did not answer. Try again in a moment.");
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    const error = json?.error as Record<string, unknown> | undefined;
    // Instagram's own message names what is wrong (an expired token, a missing permission), never a person's data.
    const said = typeof error?.message === "string" ? error.message.slice(0, 200) : typeof json?.error_message === "string" ? String(json.error_message).slice(0, 200) : null;
    throw new InstagramError(said ? `Instagram said: ${said}` : `Instagram answered ${response.status}.`);
  }
  return json;
}

/** The account's latest posts, read with its token. */
async function readPosts(token: string): Promise<InstagramPost[]> {
  const params = new URLSearchParams({ fields: FIELDS, limit: "60", access_token: token });
  return parsePosts(await call(`${GRAPH}/me/media?${params}`));
}

/**
 * Connects the account the owner signed in with: the callback's code exchanged for a short-lived token, that for a long-lived one (60 days),
 * the account's id and name read, its posts read, and all kept (a new connection replaces the owner's old one). Audited without the token.
 */
export async function connectInstagram(accountId: string, storeId: string | null, params: URLSearchParams): Promise<{ username: string }> {
  const app = instagramApp();
  const key = encryptionKey();
  if (!app || !key) throw new InstagramError("Kaizena Flow's Instagram app is not set up here.");
  if (params.get("error")) throw new InstagramError(params.get("error_description") ?? "Cancelled", "cancelled");
  const code = params.get("code");
  if (!code) throw new InstagramError("Instagram did not connect.");
  const short = await call("https://api.instagram.com/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: app.appId, client_secret: app.appSecret, grant_type: "authorization_code", redirect_uri: `${siteUrl()}${INSTAGRAM_CALLBACK}`, code }),
  });
  if (typeof short.access_token !== "string") throw new InstagramError("Instagram gave no token.");
  const long = await call(`${GRAPH}/access_token?${new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: app.appSecret, access_token: short.access_token })}`);
  if (typeof long.access_token !== "string") throw new InstagramError("Instagram gave no lasting token.");
  const token = long.access_token;
  const expiresAt = new Date(Date.now() + (typeof long.expires_in === "number" ? long.expires_in : 60 * 86_400) * 1000);
  const me = await call(`${GRAPH}/me?${new URLSearchParams({ fields: "user_id,username", access_token: token })}`);
  const userId = String(me.user_id ?? me.id ?? "");
  const username = typeof me.username === "string" ? me.username.slice(0, 60) : "";
  if (!/^[0-9]{1,40}$/.test(userId) || !username) throw new InstagramError("Instagram did not say which account this is.");
  const posts = await readPosts(token);
  await db().execute(sql`
    insert into commerce.instagram_accounts (store_id, ig_user_id, username, token_encrypted, token_expires_at, posts, posts_fetched_at, problem, connected_by)
    values (${storeId}::uuid, ${userId}, ${username}, ${encryptSecret(token, key)}, ${expiresAt.toISOString()}, ${JSON.stringify(posts)}::jsonb, now(), null, ${accountId}::uuid)
    on conflict on constraint instagram_accounts_store_key do update set ig_user_id = excluded.ig_user_id, username = excluded.username,
      token_encrypted = excluded.token_encrypted, token_expires_at = excluded.token_expires_at, posts = excluded.posts,
      posts_fetched_at = excluded.posts_fetched_at, problem = null, connected_by = excluded.connected_by, updated_at = now()
  `);
  await audit(accountId, storeId, storeId ? "store.instagram_connected" : "platform.instagram_connected", { username, posts: posts.length });
  refreshTag(instagramTag(storeId));
  return { username };
}

/** Disconnects the owner's account: the row and its token go; feeds then show nothing. Instagram's own app list is the owner's to tidy. */
export async function disconnectInstagram(accountId: string, storeId: string | null): Promise<void> {
  const owned = storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`;
  const gone = await db().execute(sql`delete from commerce.instagram_accounts where ${owned} returning id`);
  if (gone.length > 0) await audit(accountId, storeId, storeId ? "store.instagram_disconnected" : "platform.instagram_disconnected", {});
  refreshTag(instagramTag(storeId));
}

export type InstagramStatus = { username: string; posts: number; fetchedAt: string | null; problem: string | null; recent: InstagramPost[] };

/** What the admin shows of the owner's connection; null when none. */
export async function instagramStatus(storeId: string | null): Promise<InstagramStatus | null> {
  const owned = storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`;
  const [row] = await typedRows(
    z.object({ username: col.text, posts: z.unknown(), fetched: col.timestampOrNull, problem: col.textOrNull }),
    sql`select username, posts, posts_fetched_at as fetched, problem from commerce.instagram_accounts where ${owned}`,
  );
  if (!row) return null;
  const posts = keptPosts(row.posts);
  return { username: row.username, posts: posts.length, fetchedAt: row.fetched, problem: row.problem, recent: posts.slice(0, 6) };
}

/**
 * The owner's kept posts, for a page (D543): newest first, cached under the owner's tag (refreshed when they are read again or the account
 * changes). Empty without a connection.
 */
export async function instagramPosts(storeId: string | null): Promise<{ username: string; posts: InstagramPost[] } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(instagramTag(storeId));
  const owned = storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`;
  const [row] = await typedRows(
    z.object({ username: col.text, posts: z.unknown() }),
    sql`select username, posts from commerce.instagram_accounts where ${owned}`,
    readDb(),
  );
  return row ? { username: row.username, posts: keptPosts(row.posts) } : null;
}

/** Where one kept post's picture (or a video post's file) is on Instagram's servers, for the proxy; null when the owner has no such post. */
export async function postMedia(storeId: string | null, postId: string, kind: "picture" | "video"): Promise<string | null> {
  const found = await instagramPosts(storeId);
  const post = found?.posts.find((p) => p.id === postId);
  return (kind === "video" ? post?.video : post?.picture) ?? null;
}

/**
 * The dispatcher's upkeep (D543, never throws): each connected account's token refreshed when under 30 days are left, and its posts read
 * again once an hour. A failure is kept in the row's `problem` (the admin says it) and the posts kept are left as they were; an expired token
 * stays expired until the owner connects again. At most `limit` accounts a run, the longest unread first.
 */
export async function refreshInstagramFeeds(now = new Date(), limit = 20): Promise<{ refreshed: number; read: number; failed: number }> {
  const key = encryptionKey();
  const outcome = { refreshed: 0, read: 0, failed: 0 };
  if (!key) return outcome;
  const rows = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid.nullable(), token: col.text, expires: col.timestamp, fetched: col.timestampOrNull }),
    sql`
      select id, store_id, token_encrypted as token, token_expires_at as expires, posts_fetched_at as fetched
      from commerce.instagram_accounts
      where token_expires_at > now()
      order by posts_fetched_at nulls first
      limit ${limit}
    `,
  );
  for (const row of rows) {
    const refresh = tokenDue(new Date(row.expires), now);
    const read = postsDue(row.fetched ? new Date(row.fetched) : null, now);
    if (!refresh && !read) continue;
    try {
      let token = decryptSecret(row.token, key);
      if (refresh) {
        const renewed = await call(`${GRAPH}/refresh_access_token?${new URLSearchParams({ grant_type: "ig_refresh_token", access_token: token })}`);
        if (typeof renewed.access_token === "string") {
          token = renewed.access_token;
          const expiresAt = new Date(now.getTime() + (typeof renewed.expires_in === "number" ? renewed.expires_in : 60 * 86_400) * 1000);
          await db().execute(sql`update commerce.instagram_accounts set token_encrypted = ${encryptSecret(token, key)}, token_expires_at = ${expiresAt.toISOString()}, updated_at = now() where id = ${row.id}::uuid`);
          outcome.refreshed += 1;
        }
      }
      if (read) {
        const posts = await readPosts(token);
        await db().execute(sql`update commerce.instagram_accounts set posts = ${JSON.stringify(posts)}::jsonb, posts_fetched_at = now(), problem = null, updated_at = now() where id = ${row.id}::uuid`);
        refreshTag(instagramTag(row.store_id));
        outcome.read += 1;
      }
    } catch (error) {
      outcome.failed += 1;
      const problem = error instanceof InstagramError ? error.message.slice(0, 300) : "The posts could not be read.";
      await db().execute(sql`update commerce.instagram_accounts set problem = ${problem}, posts_fetched_at = now(), updated_at = now() where id = ${row.id}::uuid`);
      log("warn", "instagram.refresh_failed", { account: row.id }, error);
    }
  }
  return outcome;
}
