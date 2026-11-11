/**
 * The Instagram feed (D543), pure: an owner's own posts as Instagram gives them (the API with Instagram Login, scope
 * `instagram_business_basic`), the hashtags in a caption, and the posts a feed component shows. The server is `src/server/instagram.ts`.
 *
 * A feed shows only the connected account's own posts, never strangers' (Meta's public hashtag search needs App Review, allows 30
 * hashtags a week and would put other people's photos on the owner's site). A component narrows them by hashtags in their captions.
 * Pictures are served through the site (`/api/instagram/{owner}/{post}`), so a visitor's browser never loads from Meta.
 */

export type InstagramPostKind = "image" | "video" | "carousel";

/** One post as kept (`instagram_accounts.posts`). `picture` is Instagram's address of the image (a video's cover), for the proxy only. */
export type InstagramPost = {
  id: string;
  caption: string;
  kind: InstagramPostKind;
  picture: string;
  /** A video post's own file on Instagram's hosts, for the proxy only; absent for pictures. */
  video?: string;
  permalink: string;
  /** When it was posted, ISO 8601. */
  at: string;
};

/** The most posts kept for an account: a feed shows at most `FEED_MAX`, filtered from these. */
export const POSTS_KEPT = 60;
export const FEED_MAX = 24;
export const HASHTAGS_MAX = 10;
export const HASHTAG_LENGTH_MAX = 60;
/** Captions are kept short: a feed shows only their start, and the row has a size limit. */
export const CAPTION_KEPT = 600;

/** Instagram's media hosts (pictures and videos): the proxy fetches nothing else (`isInstagramPicture()`). */
const PICTURE_HOSTS = [/(^|\.)cdninstagram\.com$/i, /(^|\.)fbcdn\.net$/i];

export function isInstagramPicture(address: string): boolean {
  try {
    const url = new URL(address);
    return url.protocol === "https:" && PICTURE_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

const KINDS: Record<string, InstagramPostKind> = { IMAGE: "image", VIDEO: "video", CAROUSEL_ALBUM: "carousel" };

/**
 * The posts in an answer of `GET /me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp`: each with a picture on
 * Instagram's hosts and a permalink on instagram.com, newest first, at most `POSTS_KEPT`. A video is kept by its cover; anything else odd is
 * left out rather than shown wrong.
 */
export function parsePosts(json: unknown): InstagramPost[] {
  const data = json && typeof json === "object" ? (json as { data?: unknown }).data : null;
  if (!Array.isArray(data)) return [];
  const posts: InstagramPost[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const kind = typeof r.media_type === "string" ? KINDS[r.media_type] : undefined;
    const picture = kind === "video" ? r.thumbnail_url : r.media_url;
    if (!kind || typeof r.id !== "string" || !/^[0-9_]{1,60}$/.test(r.id)) continue;
    if (typeof picture !== "string" || !isInstagramPicture(picture)) continue;
    if (typeof r.permalink !== "string" || !/^https:\/\/(www\.)?instagram\.com\//.test(r.permalink)) continue;
    const at = typeof r.timestamp === "string" && !Number.isNaN(Date.parse(r.timestamp)) ? new Date(r.timestamp).toISOString() : null;
    if (!at) continue;
    const video = kind === "video" && typeof r.media_url === "string" && isInstagramPicture(r.media_url) ? r.media_url : undefined;
    posts.push({ id: r.id, caption: typeof r.caption === "string" ? r.caption.slice(0, CAPTION_KEPT) : "", kind, picture, ...(video && { video }), permalink: r.permalink, at });
  }
  return posts.sort((a, b) => b.at.localeCompare(a.at)).slice(0, POSTS_KEPT);
}

/** Posts as read back from the row: the same checks, so a row edited by hand never draws a picture from elsewhere. */
export function keptPosts(value: unknown): InstagramPost[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (p): p is InstagramPost =>
      Boolean(p) &&
      typeof p === "object" &&
      typeof p.id === "string" &&
      typeof p.caption === "string" &&
      (p.kind === "image" || p.kind === "video" || p.kind === "carousel") &&
      typeof p.picture === "string" &&
      isInstagramPicture(p.picture) &&
      (p.video === undefined || (typeof p.video === "string" && isInstagramPicture(p.video))) &&
      typeof p.permalink === "string" &&
      /^https:\/\/(www\.)?instagram\.com\//.test(p.permalink) &&
      typeof p.at === "string",
  );
}

/** A hashtag as compared: without `#`, lower case, letters, digits and underscores of any script. */
const HASHTAG = /#([\p{L}\p{N}_]+)/gu;

/** The hashtags in a caption, as compared (lower case, no `#`), each once. */
export function hashtagsOf(caption: string): string[] {
  return [...new Set([...caption.matchAll(HASHTAG)].map((m) => m[1].toLocaleLowerCase()))];
}

/**
 * The hashtags an owner typed for a feed ("#summer, sale #NewIn"), cleaned: with or without `#`, split by spaces and commas, lower case, each
 * once, at most `HASHTAGS_MAX` of at most `HASHTAG_LENGTH_MAX` characters; anything that is not a hashtag's letters is left out.
 */
export function cleanHashtags(input: string | readonly string[]): string[] {
  const parts = typeof input === "string" ? input.split(/[\s,]+/) : input;
  const tags = parts
    .map((part) => part.trim().replace(/^#+/, "").toLocaleLowerCase())
    .filter((tag) => tag.length > 0 && tag.length <= HASHTAG_LENGTH_MAX && /^[\p{L}\p{N}_]+$/u.test(tag));
  return [...new Set(tags)].slice(0, HASHTAGS_MAX);
}

export type HashtagMatch = "any" | "all";

/** The posts a feed shows: those with any (or all) of its hashtags, newest first, at most `limit`; every post when it names none. */
export function feedPosts(posts: readonly InstagramPost[], tags: readonly string[], match: HashtagMatch, limit: number): InstagramPost[] {
  const wanted = cleanHashtags(tags);
  const kept =
    wanted.length === 0
      ? posts
      : posts.filter((post) => {
          const has = new Set(hashtagsOf(post.caption));
          return match === "all" ? wanted.every((tag) => has.has(tag)) : wanted.some((tag) => has.has(tag));
        });
  return [...kept].sort((a, b) => b.at.localeCompare(a.at)).slice(0, Math.max(1, Math.min(FEED_MAX, limit)));
}

/** A caption as a feed shows it under a picture or as its description: its words without the hashtags, on one line. */
export function captionText(caption: string): string {
  return caption.replace(HASHTAG, "").replace(/\s+/g, " ").trim();
}

/** Where the owner is sent to connect (Instagram Login), asking only to read the account's own profile and posts. */
export function authorizeUrl(appId: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: "code", scope: "instagram_business_basic", state });
  return `https://www.instagram.com/oauth/authorize?${params}`;
}

/** Refresh a long-lived token once it has fewer than this many days left (it lasts 60, and may be refreshed once it is a day old). */
export const REFRESH_WITHIN_DAYS = 30;
/** Read the posts again after this long. */
export const POSTS_EVERY_MINUTES = 60;

/** Whether a token should be refreshed now. */
export const tokenDue = (expiresAt: Date, now: Date): boolean => expiresAt.getTime() - now.getTime() < REFRESH_WITHIN_DAYS * 86_400_000;

/** Whether the posts should be read again now. */
export const postsDue = (fetchedAt: Date | null, now: Date): boolean => !fetchedAt || now.getTime() - fetchedAt.getTime() >= POSTS_EVERY_MINUTES * 60_000;
