/**
 * How each of a store's own Instagram posts did (D870 S1.2, `docs/social-manager.md` 4): the posts of the last `INSIGHTS_DAYS` days as the
 * Instagram API with Instagram Login gives them (`/me/media`), and each post's insights (`/{media-id}/insights`, scope
 * `instagram_business_manage_insights`) read as plain counts. Pure; the server is `src/server/social-insights.ts`.
 *
 * Only the connected account's own posts and their totals are read: never who liked, commented or viewed (Instagram does not say, and
 * nothing here asks).
 */

/** The days of posts whose figures are read again each day; older posts keep their last figures. */
export const INSIGHTS_DAYS = 90;
/** Read an account's figures again after this long. */
export const INSIGHTS_EVERY_HOURS = 24;
/** At most this many posts are read for an account in one run (`/me/media` pages of 50). */
export const INSIGHTS_POSTS_MAX = 250;
/** A kept post's caption: its start only, to recognise it. */
export const INSIGHT_CAPTION_KEPT = 300;
/** Kept posts older than this are deleted by the daily run. */
export const INSIGHTS_KEPT_DAYS = 400;

export type InsightKind = "feed" | "reel" | "story";

/** One of the account's posts as `/me/media` gives it. */
export type MediaItem = { id: string; caption: string; kind: InsightKind; mediaType: string; permalink: string; at: string };

export type PostFigures = { reach: number | null; views: number | null; likes: number | null; comments: number | null; saves: number | null; shares: number | null; interactions: number | null };

export const NO_FIGURES: PostFigures = { reach: null, views: null, likes: null, comments: null, saves: null, shares: null, interactions: null };

/** The metrics asked for each kind of post: Instagram refuses the whole request for a metric a kind does not have. */
export const METRICS: Record<InsightKind, readonly string[]> = {
  feed: ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions"],
  reel: ["reach", "views", "likes", "comments", "saved", "shares", "total_interactions"],
  story: ["reach", "views", "shares", "total_interactions"],
};

/** The fewest metrics, asked again when a post's kind refuses the full list. */
export const FALLBACK_METRICS = ["reach"] as const;

const FIELD_OF: Record<string, keyof PostFigures> = {
  reach: "reach",
  views: "views",
  likes: "likes",
  comments: "comments",
  saved: "saves",
  shares: "shares",
  total_interactions: "interactions",
};

const kindOf = (productType: unknown): InsightKind => (productType === "REELS" ? "reel" : productType === "STORY" ? "story" : "feed");

/** The posts of one `/me/media` page that are on or after `since`, and whether to read the next page (it has one and nothing was older). */
export function parseMediaPage(json: unknown, since: Date): { items: MediaItem[]; next: string | null } {
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return { items: [], next: null };
  const items: MediaItem[] = [];
  let older = false;
  for (const raw of data as Record<string, unknown>[]) {
    const id = typeof raw?.id === "string" && /^[0-9]{1,40}$/.test(raw.id) ? raw.id : null;
    const at = typeof raw?.timestamp === "string" ? new Date(raw.timestamp) : null;
    if (!id || !at || Number.isNaN(at.getTime())) continue;
    if (at < since) {
      older = true;
      continue;
    }
    const permalink = typeof raw.permalink === "string" && /^https:\/\/(www\.)?instagram\.com\//.test(raw.permalink) ? raw.permalink : "";
    items.push({
      id,
      caption: typeof raw.caption === "string" ? raw.caption.replace(/\s+/g, " ").trim().slice(0, INSIGHT_CAPTION_KEPT) : "",
      kind: kindOf(raw.media_product_type),
      mediaType: typeof raw.media_type === "string" ? raw.media_type.slice(0, 20) : "",
      permalink,
      at: at.toISOString(),
    });
  }
  const next = (json as { paging?: { next?: unknown } })?.paging?.next;
  return { items, next: !older && typeof next === "string" && (next.startsWith("https://graph.instagram.com/") || next.startsWith("https://graph.facebook.com/")) ? next : null };
}

/** A post's insights as counts: each metric's value (`values[0].value`, or `total_value.value`), null for one not given; `fields` names
 * which figure each metric is (Instagram's by default, a Facebook Page's in `src/lib/facebook-pages.ts`). */
export function parseInsights(json: unknown, fields: Record<string, keyof PostFigures> = FIELD_OF): PostFigures {
  const out: PostFigures = { ...NO_FIGURES };
  const data = (json as { data?: unknown })?.data;
  if (!Array.isArray(data)) return out;
  for (const metric of data as Record<string, unknown>[]) {
    const field = typeof metric?.name === "string" && Object.hasOwn(fields, metric.name) ? fields[metric.name] : undefined;
    if (!field) continue;
    const values = metric.values as { value?: unknown }[] | undefined;
    const value = Array.isArray(values) ? values[0]?.value : (metric.total_value as { value?: unknown } | undefined)?.value;
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) out[field] = Math.round(value);
  }
  return out;
}

/** Whether the account's figures should be read again now. */
export function insightsDue(fetchedAt: Date | null, now: Date): boolean {
  return fetchedAt === null || now.getTime() - fetchedAt.getTime() >= INSIGHTS_EVERY_HOURS * 3_600_000;
}

/** Whether a token Instagram gave carries the insights permission, from the permissions its exchange named. */
export function grantsInsights(permissions: unknown): boolean {
  const list = Array.isArray(permissions) ? permissions : typeof permissions === "string" ? permissions.split(",") : [];
  return list.some((p) => String(p).trim() === "instagram_business_manage_insights");
}
