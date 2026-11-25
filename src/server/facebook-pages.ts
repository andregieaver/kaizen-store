import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  FACEBOOK_GRAPH,
  facebookAuthorizeUrl,
  grantsPageInsights,
  keptChoices,
  PAGE_METRICS,
  parsePageInsights,
  parsePagePosts,
  parsePages,
  POST_FIELDS,
  type PageChoice,
  type PagePost,
} from "@/lib/facebook-pages";
import { INSIGHTS_DAYS, INSIGHTS_KEPT_DAYS, INSIGHTS_POSTS_MAX, insightsDue } from "@/lib/social-insights";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { audit } from "./auth";
import { jobReport } from "./cache-events";
import { encryptionKey } from "./encryption-key";
import { log } from "./log";
import type { InsightPost } from "./social-insights";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's Facebook Page and its posts' figures (D870 S1.2b, pure parts in `src/lib/facebook-pages.ts`): Kaizena Flow's Facebook app
 * (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`), Facebook Login with `pages_show_list`, `pages_read_engagement` and `read_insights`. The
 * person's token is made long-lived and its Pages listed; with one Page it is chosen, with several the owner chooses on Social posts, and the
 * Page's own token (which a long-lived person's token gives without an end) is kept, encrypted. The dispatcher's daily run reads the Page's
 * posts of the last 90 days into `social_post_insights` (channel `facebook`). A refusal is kept as the Page's `problem`, in Facebook's words.
 */

const TIMEOUT_MS = 10_000;

export const FACEBOOK_COOKIE = "kaizen_facebook_connect";
export const FACEBOOK_CALLBACK = "/api/integrations/facebook/callback";
export const FACEBOOK_COOKIE_PATH = "/api/integrations/facebook";

type App = { appId: string; appSecret: string };

function facebookApp(): App | null {
  const appId = process.env.FACEBOOK_APP_ID?.trim();
  const appSecret = process.env.FACEBOOK_APP_SECRET?.trim();
  if (!appId || !appSecret || !encryptionKey()) return null;
  return { appId, appSecret };
}

/** Kaizena Flow's Facebook app is set up here, so owners can connect a Page. */
export const facebookAppOn = () => facebookApp() !== null;

export class FacebookError extends Error {
  constructor(
    message: string,
    readonly reason: "cancelled" | "failed" = "failed",
  ) {
    super(message);
  }
}

/** Where the owner is sent to connect, and what the callback must see again (kept in `kaizen_facebook_connect`). */
export function facebookStart(storeSlug: string, accountId: string): { url: string; cookie: string } | null {
  const app = facebookApp();
  if (!app) return null;
  const state = randomBytes(24).toString("base64url");
  return { url: facebookAuthorizeUrl(app.appId, `${siteUrl()}${FACEBOOK_CALLBACK}`, state), cookie: [state, storeSlug, accountId].join(".") };
}

/** Who started connecting, from the cookie; checked against the state Facebook sends back. */
export function facebookStarted(cookie: string | undefined, params: URLSearchParams): { store: string; accountId: string } {
  const [state, store, accountId] = (cookie ?? "").split(".");
  if (!state || !store || !accountId || state !== params.get("state")) throw new FacebookError("The connection could not be checked.");
  return { store, accountId };
}

/** One call to Facebook's Graph API: its JSON, or `FacebookError` with Facebook's own words (never a person's data). */
async function graph(url: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new FacebookError("Facebook did not answer. Try again in a moment.");
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    const error = json?.error as Record<string, unknown> | undefined;
    const said = typeof error?.message === "string" ? error.message.slice(0, 200) : null;
    throw new FacebookError(said ? `Facebook said: ${said}` : `Facebook answered ${response.status}.`);
  }
  return json;
}

const q = (params: Record<string, string>) => new URLSearchParams(params).toString();

/** Keeps the chosen Page: its token encrypted, the person's token and the choices gone, the figures read from the next run. */
async function keepPage(storeId: string, page: { id: string; name: string; token: string }, key: Buffer): Promise<void> {
  await db().execute(sql`
    update commerce.facebook_pages set page_id = ${page.id}, page_name = ${page.name}, page_token_encrypted = ${encryptSecret(page.token, key)},
      user_token_encrypted = null, choices = '[]'::jsonb, fetched_at = null, problem = null, updated_at = now()
    where store_id = ${storeId}::uuid
  `);
}

/**
 * Connects from the callback: the code exchanged for a token, that for a long-lived one, the person's Pages and permissions read. One Page is
 * kept at once; with several, the person's token and the Pages' names are kept until the owner chooses (`chooseFacebookPage()`). A new
 * connection replaces the store's old one. Audited without a token. The Pages' names, to choose among, when there are several.
 */
export async function connectFacebook(accountId: string, storeId: string, params: URLSearchParams): Promise<{ choose: PageChoice[] }> {
  const app = facebookApp();
  const key = encryptionKey();
  if (!app || !key) throw new FacebookError("Kaizena Flow's Facebook app is not set up here.");
  if (params.get("error")) throw new FacebookError(params.get("error_description") ?? "Cancelled", "cancelled");
  const code = params.get("code");
  if (!code) throw new FacebookError("Facebook did not connect.");
  const short = await graph(`${FACEBOOK_GRAPH}/oauth/access_token?${q({ client_id: app.appId, client_secret: app.appSecret, redirect_uri: `${siteUrl()}${FACEBOOK_CALLBACK}`, code })}`);
  if (typeof short.access_token !== "string") throw new FacebookError("Facebook gave no token.");
  const long = await graph(
    `${FACEBOOK_GRAPH}/oauth/access_token?${q({ grant_type: "fb_exchange_token", client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: short.access_token })}`,
  );
  if (typeof long.access_token !== "string") throw new FacebookError("Facebook gave no lasting token.");
  const token = long.access_token;
  const [pages, permissions] = await Promise.all([
    graph(`${FACEBOOK_GRAPH}/me/accounts?${q({ fields: "id,name,access_token", limit: "50", access_token: token })}`).then(parsePages),
    graph(`${FACEBOOK_GRAPH}/me/permissions?${q({ access_token: token })}`).then(grantsPageInsights),
  ]);
  if (pages.length === 0) throw new FacebookError("No Facebook Page was shared. Connect again and choose your shop's Page.");
  await db().execute(sql`
    insert into commerce.facebook_pages (store_id, page_name, user_token_encrypted, choices, insights, connected_by)
    values (${storeId}::uuid, '', ${encryptSecret(token, key)}, ${JSON.stringify(pages.map(({ id, name }) => ({ id, name })))}::jsonb, ${permissions}, ${accountId}::uuid)
    on conflict on constraint facebook_pages_store_key do update set page_id = null, page_name = '', page_token_encrypted = null,
      user_token_encrypted = excluded.user_token_encrypted, choices = excluded.choices, insights = excluded.insights, fetched_at = null,
      problem = null, connected_by = excluded.connected_by, updated_at = now()
  `);
  // The old Page's figures go with a new connection; the new Page's come with its first reading.
  await db().execute(sql`delete from commerce.social_post_insights where store_id = ${storeId}::uuid and channel = 'facebook'`);
  if (pages.length === 1) await keepPage(storeId, pages[0], key);
  await audit(accountId, storeId, "store.facebook_connected", { pages: pages.length, insights: permissions });
  return { choose: pages.length === 1 ? [] : pages.map(({ id, name }) => ({ id, name })) };
}

/** The owner's choice among their Pages: its token read again with the person's kept one. False when it is not one of the choices. */
export async function chooseFacebookPage(accountId: string, storeId: string, pageId: string): Promise<boolean> {
  const key = encryptionKey();
  if (!key) return false;
  const row = await typedRow(
    z.object({ token: col.textOrNull, choices: z.unknown() }),
    sql`select user_token_encrypted as token, choices from commerce.facebook_pages where store_id = ${storeId}::uuid`,
  );
  if (!row?.token || !keptChoices(row.choices).some((c) => c.id === pageId)) return false;
  const pages = parsePages(await graph(`${FACEBOOK_GRAPH}/me/accounts?${q({ fields: "id,name,access_token", limit: "50", access_token: decryptSecret(row.token, key) })}`));
  const page = pages.find((p) => p.id === pageId);
  if (!page) return false;
  await keepPage(storeId, page, key);
  await audit(accountId, storeId, "store.facebook_page_chosen", {});
  return true;
}

/** Disconnects the store's Page: the row, its tokens and its posts' figures go. Facebook's own list of apps is the owner's to tidy. */
export async function disconnectFacebook(accountId: string, storeId: string): Promise<void> {
  const gone = await db().execute(sql`delete from commerce.facebook_pages where store_id = ${storeId}::uuid returning id`);
  if (gone.length > 0) await audit(accountId, storeId, "store.facebook_disconnected", {});
}

/** The Page's posts on or after `since`, newest first, with what the post itself counts. */
async function readPosts(pageId: string, token: string, since: Date): Promise<PagePost[]> {
  let url: string | null = `${FACEBOOK_GRAPH}/${pageId}/published_posts?${q({ fields: POST_FIELDS, limit: "50", since: String(Math.floor(since.getTime() / 1000)), access_token: token })}`;
  const items: PagePost[] = [];
  while (url && items.length < INSIGHTS_POSTS_MAX) {
    const page = parsePagePosts(await graph(url), since);
    items.push(...page.items);
    url = page.next;
  }
  return items.slice(0, INSIGHTS_POSTS_MAX);
}

/** One post's reach and views: the newest metrics, else the older ones, else none. */
async function readReach(postId: string, token: string) {
  for (const metrics of PAGE_METRICS) {
    try {
      return parsePageInsights(await graph(`${FACEBOOK_GRAPH}/${postId}/insights?${q({ metric: metrics.join(","), access_token: token })}`));
    } catch (error) {
      if (!(error instanceof FacebookError)) throw error;
    }
  }
  return { reach: null, views: null };
}

async function readPage(row: { id: string; store_id: string; page_id: string; token: string; insights: boolean }, now: Date, key: Buffer): Promise<number> {
  const token = decryptSecret(row.token, key);
  const posts = await readPosts(row.page_id, token, new Date(now.getTime() - INSIGHTS_DAYS * 86_400_000));
  for (const post of posts) {
    const reach = row.insights ? await readReach(post.id, token) : { reach: null, views: null };
    const f = { ...post.figures, ...reach };
    await db().execute(sql`
      insert into commerce.social_post_insights
        (page_id, store_id, channel, media_id, kind, media_type, posted_at, caption, permalink, reach, views, likes, comments, saves, shares, interactions, fetched_at)
      values (${row.id}::uuid, ${row.store_id}::uuid, 'facebook', ${post.id}, ${post.kind}, ${post.mediaType}, ${post.at}::timestamptz, ${post.caption}, ${post.permalink},
        ${f.reach}, ${f.views}, ${f.likes}, ${f.comments}, null, ${f.shares}, ${f.interactions}, ${now.toISOString()}::timestamptz)
      on conflict on constraint social_post_insights_page_media_key do update set
        media_type = excluded.media_type, caption = excluded.caption, permalink = excluded.permalink, reach = excluded.reach, views = excluded.views,
        likes = excluded.likes, comments = excluded.comments, shares = excluded.shares, interactions = excluded.interactions, fetched_at = excluded.fetched_at
    `);
  }
  return posts.length;
}

/**
 * The dispatcher's daily run (never throws): each chosen Page, the longest unread first, at most `limit` a run, read again once a day; its
 * posts older than 400 days are deleted with that reading. A refusal is the Page's `problem`.
 */
export async function refreshFacebookInsights(now = new Date(), limit = 10): Promise<{ read: number; posts: number; failed: number }> {
  const report = jobReport();
  const outcome = { read: 0, posts: 0, failed: 0 };
  const key = encryptionKey();
  if (!key) return outcome;
  const rows = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid, page_id: col.text, token: col.text, insights: col.bool, fetched: col.timestampOrNull }),
    sql`
      select id, store_id, page_id, page_token_encrypted as token, insights, fetched_at as fetched
      from commerce.facebook_pages
      where page_id is not null and page_token_encrypted is not null
      order by fetched_at nulls first
      limit ${limit}
    `,
  );
  for (const row of rows) {
    if (!insightsDue(row.fetched ? new Date(row.fetched) : null, now)) continue;
    try {
      outcome.posts += await readPage(row, now, key);
      outcome.read += 1;
      await db().execute(sql`update commerce.facebook_pages set fetched_at = ${now.toISOString()}::timestamptz, problem = null where id = ${row.id}::uuid and store_id = ${row.store_id}::uuid`);
      await db().execute(sql`delete from commerce.social_post_insights where page_id = ${row.id}::uuid and posted_at < ${new Date(now.getTime() - INSIGHTS_KEPT_DAYS * 86_400_000).toISOString()}::timestamptz`);
    } catch (error) {
      outcome.failed += 1;
      if (!(error instanceof FacebookError)) report(error, "page");
      const problem = error instanceof FacebookError ? error.message.slice(0, 300) : "The posts' figures could not be read.";
      await db().execute(sql`update commerce.facebook_pages set fetched_at = ${now.toISOString()}::timestamptz, problem = ${problem} where id = ${row.id}::uuid and store_id = ${row.store_id}::uuid`);
      log("warn", "social.facebook_failed", { page: row.id }, error);
    }
  }
  return outcome;
}

export type FacebookView =
  | { state: "none" }
  | { state: "choose"; choices: PageChoice[] }
  | { state: "waiting"; name: string }
  | { state: "ready"; name: string; insights: boolean; fetchedAt: string | null; problem: string | null; posts: InsightPost[] };

const POST_ROW = z.object({
  media_id: col.text,
  posted_at: col.timestamp,
  caption: col.text,
  permalink: col.text,
  reach: col.int.nullable(),
  views: col.int.nullable(),
  likes: col.int.nullable(),
  comments: col.int.nullable(),
  shares: col.int.nullable(),
  interactions: col.int.nullable(),
});

/** What the owner sees of their Page: none, Pages to choose among, figures not read yet, or the last 90 days' posts, newest first. */
export async function facebookView(storeId: string): Promise<FacebookView> {
  const page = await typedRow(
    z.object({ id: col.uuid, page_id: col.textOrNull, name: col.text, choices: z.unknown(), insights: col.bool, fetched: col.timestampOrNull, problem: col.textOrNull }),
    sql`select id, page_id, page_name as name, choices, insights, fetched_at as fetched, problem from commerce.facebook_pages where store_id = ${storeId}::uuid`,
  );
  if (!page) return { state: "none" };
  if (!page.page_id) return { state: "choose", choices: keptChoices(page.choices) };
  if (!page.fetched) return { state: "waiting", name: page.name };
  const rows = await typedRows(
    POST_ROW,
    sql`
      select media_id, posted_at, caption, permalink, reach, views, likes, comments, shares, interactions
      from commerce.social_post_insights
      where page_id = ${page.id}::uuid and store_id = ${storeId}::uuid and posted_at >= now() - make_interval(days => ${INSIGHTS_DAYS})
      order by posted_at desc
      limit ${INSIGHTS_POSTS_MAX}
    `,
  );
  return {
    state: "ready",
    name: page.name,
    insights: page.insights,
    fetchedAt: page.fetched,
    problem: page.problem,
    posts: rows.map((r) => ({
      mediaId: r.media_id,
      kind: "feed",
      postedAt: r.posted_at,
      caption: r.caption,
      permalink: r.permalink,
      figures: { reach: r.reach, views: r.views, likes: r.likes, comments: r.comments, saves: null, shares: r.shares, interactions: r.interactions },
    })),
  };
}
