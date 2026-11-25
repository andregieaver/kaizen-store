/**
 * A store's Facebook Page and how its own posts did (D870 S1.2b, `docs/social-manager.md` 4): Facebook Login's address, the Pages the person
 * may manage (`/me/accounts`), the Page's posts of the last `INSIGHTS_DAYS` days (`/{page-id}/published_posts`, with their reactions,
 * comments and shares) and each post's reach and views (`/{post-id}/insights`, with `read_insights`). Pure; the server is
 * `src/server/facebook-pages.ts`.
 *
 * Only the Page's own posts and their totals are read: never who reacted, commented or saw them.
 */

import { INSIGHT_CAPTION_KEPT, NO_FIGURES, parseInsights, type MediaItem, type PostFigures } from "./social-insights";

export const FACEBOOK_GRAPH = "https://graph.facebook.com/v24.0";
export const FACEBOOK_SCOPES = ["pages_show_list", "pages_read_engagement", "read_insights"] as const;

/** Where the owner signs in with Facebook and allows reading their Page's posts. */
export function facebookAuthorizeUrl(appId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: "code", scope: FACEBOOK_SCOPES.join(","), state });
  return `https://www.facebook.com/v24.0/dialog/oauth?${params}`;
}

export type PageChoice = { id: string; name: string };
type PageWithToken = PageChoice & { token: string };

const PAGE_ID = /^[0-9]{1,40}$/;
const POST_ID = /^[0-9]{1,40}_[0-9]{1,40}$/;

/** The Pages the person may manage, as `/me/accounts` gives them, each with its own token; at most 50. */
export function parsePages(json: unknown): PageWithToken[] {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return [];
  return (data as Record<string, unknown>[])
    .flatMap((raw) => {
      const id = typeof raw?.id === "string" && PAGE_ID.test(raw.id) ? raw.id : null;
      const token = typeof raw?.access_token === "string" && raw.access_token.length > 0 ? raw.access_token : null;
      const name = typeof raw?.name === "string" ? raw.name.replace(/\s+/g, " ").trim().slice(0, 100) : "";
      return id && token ? [{ id, name: name || id, token }] : [];
    })
    .slice(0, 50);
}

/** The Pages kept for the owner to choose from (no tokens), from the row. */
export function keptChoices(json: unknown): PageChoice[] {
  if (!Array.isArray(json)) return [];
  return (json as Record<string, unknown>[]).flatMap((c) =>
    typeof c?.id === "string" && PAGE_ID.test(c.id) && typeof c.name === "string" ? [{ id: c.id, name: c.name.slice(0, 100) }] : [],
  );
}

/** Whether the person granted `read_insights`, from `/me/permissions`. */
export function grantsPageInsights(json: unknown): boolean {
  const data = (json as { data?: unknown })?.data;
  return Array.isArray(data) && (data as Record<string, unknown>[]).some((p) => p?.permission === "read_insights" && p.status === "granted");
}

/** The fields asked of each post: its words, time and address, and the totals Facebook counts on the post itself. */
export const POST_FIELDS = "id,message,created_time,permalink_url,status_type,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)";

export type PagePost = MediaItem & { figures: PostFigures };

const total = (edge: unknown): number | null => {
  const n = (edge as { summary?: { total_count?: unknown } } | undefined)?.summary?.total_count;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
};

/** The posts of one page of `published_posts` on or after `since`, with their reactions, comments and shares, and whether to read on. */
export function parsePagePosts(json: unknown, since: Date): { items: PagePost[]; next: string | null } {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return { items: [], next: null };
  const items: PagePost[] = [];
  let older = false;
  for (const raw of data as Record<string, unknown>[]) {
    const id = typeof raw?.id === "string" && POST_ID.test(raw.id) ? raw.id : null;
    const at = typeof raw?.created_time === "string" ? new Date(raw.created_time) : null;
    if (!id || !at || Number.isNaN(at.getTime())) continue;
    if (at < since) {
      older = true;
      continue;
    }
    const likes = total(raw.reactions);
    const comments = total(raw.comments);
    const sharesRaw = (raw.shares as { count?: unknown } | undefined)?.count;
    // Facebook leaves `shares` out of a post nobody shared.
    const shares = typeof sharesRaw === "number" && Number.isFinite(sharesRaw) && sharesRaw >= 0 ? Math.round(sharesRaw) : 0;
    items.push({
      id,
      caption: typeof raw.message === "string" ? raw.message.replace(/\s+/g, " ").trim().slice(0, INSIGHT_CAPTION_KEPT) : "",
      kind: "feed",
      mediaType: typeof raw.status_type === "string" ? raw.status_type.slice(0, 20) : "",
      permalink: typeof raw.permalink_url === "string" && /^https:\/\/(www\.|m\.)?facebook\.com\//.test(raw.permalink_url) ? raw.permalink_url.slice(0, 300) : "",
      at: at.toISOString(),
      figures: { ...NO_FIGURES, likes, comments, shares, interactions: likes === null || comments === null ? null : likes + comments + shares },
    });
  }
  const next = (json as { paging?: { next?: unknown } })?.paging?.next;
  return { items, next: !older && typeof next === "string" && next.startsWith("https://graph.facebook.com/") ? next : null };
}

/**
 * The reach and views asked of each post, newest names first: Meta replaced the impressions metrics with media views (2025), and a Page
 * that refuses one list is asked the next.
 */
export const PAGE_METRICS: readonly (readonly string[])[] = [
  ["post_total_media_view_unique", "post_media_view"],
  ["post_impressions_unique", "post_impressions"],
];

const PAGE_FIELDS: Record<string, keyof PostFigures> = {
  post_total_media_view_unique: "reach",
  post_media_view: "views",
  post_impressions_unique: "reach",
  post_impressions: "views",
};

/** A post's reach and views from `/{post-id}/insights`. */
export const parsePageInsights = (json: unknown): Pick<PostFigures, "reach" | "views"> => {
  const f = parseInsights(json, PAGE_FIELDS);
  return { reach: f.reach, views: f.views };
};
