import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { igApi, igSelf, type InstagramVia } from "@/lib/instagram";
import { decryptSecret } from "@/lib/secret-box";
import {
  FALLBACK_METRICS,
  INSIGHTS_DAYS,
  INSIGHTS_KEPT_DAYS,
  INSIGHTS_POSTS_MAX,
  insightsDue,
  METRICS,
  NO_FIGURES,
  parseInsights,
  parseMediaPage,
  type InsightKind,
  type MediaItem,
  type PostFigures,
} from "@/lib/social-insights";

import { jobReport } from "./cache-events";
import { encryptionKey } from "./encryption-key";
import { call, InstagramError } from "./instagram";
import { log } from "./log";
import { owned } from "./owned";
import { col, typedRows } from "./typed-rows";

/**
 * How each of a connected Instagram account's own posts did (D870 S1.2, `docs/social-manager.md` 4, pure parts in
 * `src/lib/social-insights.ts`). The dispatcher's daily run reads, for each account whose token carries `instagram_business_manage_insights`,
 * its posts of the last 90 days and each one's totals, and keeps them in `social_post_insights` (the adviser's facts, S1.3). The token is the
 * Instagram feed's (D560, refreshed by its job); a refusal is kept as the account's `insights_problem`, in Instagram's words.
 */

/** The account's posts on or after `since`, newest first, at most `INSIGHTS_POSTS_MAX`. */
async function readMedia(token: string, since: Date, via: InstagramVia, igUserId: string): Promise<MediaItem[]> {
  const params = new URLSearchParams({
    fields: "id,caption,media_type,media_product_type,permalink,timestamp",
    limit: "50",
    since: String(Math.floor(since.getTime() / 1000)),
    access_token: token,
  });
  let url: string | null = `${igApi(via)}/${igSelf(via, igUserId)}/media?${params}`;
  const items: MediaItem[] = [];
  while (url && items.length < INSIGHTS_POSTS_MAX) {
    const page = parseMediaPage(await call(url), since);
    items.push(...page.items);
    url = page.next;
  }
  return items.slice(0, INSIGHTS_POSTS_MAX);
}

/** One post's totals: the metrics its kind has, else reach alone, else none (a post Instagram keeps no figures for). */
async function readFigures(token: string, mediaId: string, kind: InsightKind, via: InstagramVia): Promise<PostFigures> {
  for (const metrics of [METRICS[kind], FALLBACK_METRICS]) {
    try {
      return parseInsights(await call(`${igApi(via)}/${mediaId}/insights?${new URLSearchParams({ metric: metrics.join(","), access_token: token })}`));
    } catch (error) {
      if (!(error instanceof InstagramError)) throw error;
    }
  }
  return { ...NO_FIGURES };
}

/** Reads and keeps one account's posts and figures; the number of posts kept. */
async function readAccount(row: { id: string; store_id: string | null; token: string; via: InstagramVia; user: string }, now: Date): Promise<number> {
  const key = encryptionKey();
  if (!key) return 0;
  const token = decryptSecret(row.token, key);
  const media = await readMedia(token, new Date(now.getTime() - INSIGHTS_DAYS * 86_400_000), row.via, row.user);
  for (const item of media) {
    const f = await readFigures(token, item.id, item.kind, row.via);
    await db().execute(sql`
      insert into commerce.social_post_insights
        (account_id, store_id, media_id, kind, media_type, posted_at, caption, permalink, reach, views, likes, comments, saves, shares, interactions, fetched_at)
      values (${row.id}::uuid, ${row.store_id}::uuid, ${item.id}, ${item.kind}, ${item.mediaType}, ${item.at}::timestamptz, ${item.caption}, ${item.permalink},
        ${f.reach}, ${f.views}, ${f.likes}, ${f.comments}, ${f.saves}, ${f.shares}, ${f.interactions}, ${now.toISOString()}::timestamptz)
      on conflict on constraint social_post_insights_media_key do update set
        kind = excluded.kind, media_type = excluded.media_type, caption = excluded.caption, permalink = excluded.permalink,
        reach = excluded.reach, views = excluded.views, likes = excluded.likes, comments = excluded.comments, saves = excluded.saves,
        shares = excluded.shares, interactions = excluded.interactions, fetched_at = excluded.fetched_at
    `);
  }
  return media.length;
}

/**
 * The dispatcher's daily run (never throws): each account with the insights permission and a live token, the longest unread first, at most
 * `limit` a run, read again once a day; its posts older than 400 days are deleted with that reading. A refusal is the account's `insights_problem`.
 */
export async function refreshSocialInsights(now = new Date(), limit = 10): Promise<{ read: number; posts: number; failed: number }> {
  const report = jobReport();
  const outcome = { read: 0, posts: 0, failed: 0 };
  if (!encryptionKey()) return outcome;
  const rows = await typedRows(
    z.object({ id: col.uuid, store_id: col.uuid.nullable(), token: col.text, fetched: col.timestampOrNull, via: z.enum(["instagram", "facebook"]), user: col.text }),
    sql`
      select id, store_id, token_encrypted as token, insights_fetched_at as fetched, via, ig_user_id as user
      from commerce.instagram_accounts
      where insights and token_expires_at > now()
      order by insights_fetched_at nulls first
      limit ${limit}
    `,
  );
  for (const row of rows) {
    if (!insightsDue(row.fetched ? new Date(row.fetched) : null, now)) continue;
    try {
      outcome.posts += await readAccount(row, now);
      outcome.read += 1;
      await db().execute(sql`update commerce.instagram_accounts set insights_fetched_at = ${now.toISOString()}::timestamptz, insights_problem = null where id = ${row.id}::uuid and ${owned(row.store_id)}`);
      // The account's posts past 400 days go with its daily reading, not in every run of the dispatcher.
      await db().execute(sql`delete from commerce.social_post_insights where account_id = ${row.id}::uuid and posted_at < ${new Date(now.getTime() - INSIGHTS_KEPT_DAYS * 86_400_000).toISOString()}::timestamptz`);
    } catch (error) {
      outcome.failed += 1;
      if (!(error instanceof InstagramError)) report(error, "account");
      const problem = error instanceof InstagramError ? error.message.slice(0, 300) : "The posts' figures could not be read.";
      await db().execute(sql`update commerce.instagram_accounts set insights_fetched_at = ${now.toISOString()}::timestamptz, insights_problem = ${problem} where id = ${row.id}::uuid and ${owned(row.store_id)}`);
      log("warn", "social.insights_failed", { account: row.id }, error);
    }
  }
  return outcome;
}

export type InsightPost = {
  mediaId: string;
  kind: InsightKind;
  postedAt: string;
  caption: string;
  permalink: string;
  figures: PostFigures;
};

export type InsightsView =
  | { state: "none" }
  | { state: "reconnect"; username: string }
  | { state: "waiting"; username: string }
  | { state: "ready"; username: string; fetchedAt: string | null; problem: string | null; posts: InsightPost[] };

const INSIGHT_ROW = z.object({
  media_id: col.text,
  kind: z.enum(["feed", "reel", "story"]),
  posted_at: col.timestamp,
  caption: col.text,
  permalink: col.text,
  reach: col.int.nullable(),
  views: col.int.nullable(),
  likes: col.int.nullable(),
  comments: col.int.nullable(),
  saves: col.int.nullable(),
  shares: col.int.nullable(),
  interactions: col.int.nullable(),
});

/**
 * What the owner sees of their Instagram posts' figures: no account, an account to connect again for the permission, figures not read yet,
 * or the posts of the last 90 days, newest first. A store's, or Kaizena Flow's own with a null store.
 */
export async function insightsView(storeId: string | null): Promise<InsightsView> {
  const [account] = await typedRows(
    z.object({ id: col.uuid, username: col.text, insights: col.bool, fetched: col.timestampOrNull, problem: col.textOrNull }),
    sql`select id, username, insights, insights_fetched_at as fetched, insights_problem as problem from commerce.instagram_accounts where ${owned(storeId)}`,
  );
  if (!account) return { state: "none" };
  if (!account.insights) return { state: "reconnect", username: account.username };
  if (!account.fetched) return { state: "waiting", username: account.username };
  const rows = await typedRows(
    INSIGHT_ROW,
    sql`
      select media_id, kind, posted_at, caption, permalink, reach, views, likes, comments, saves, shares, interactions
      from commerce.social_post_insights
      where account_id = ${account.id}::uuid and posted_at >= now() - make_interval(days => ${INSIGHTS_DAYS})
      order by posted_at desc
      limit ${INSIGHTS_POSTS_MAX}
    `,
  );
  return {
    state: "ready",
    username: account.username,
    fetchedAt: account.fetched,
    problem: account.problem,
    posts: rows.map((r) => ({
      mediaId: r.media_id,
      kind: r.kind,
      postedAt: r.posted_at,
      caption: r.caption,
      permalink: r.permalink,
      figures: { reach: r.reach, views: r.views, likes: r.likes, comments: r.comments, saves: r.saves, shares: r.shares, interactions: r.interactions },
    })),
  };
}
