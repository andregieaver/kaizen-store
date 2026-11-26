/**
 * TikTok for the social media manager (D870 S3.5, `docs/social-manager.md` 6): TikTok's sign-in address (Login Kit), its tokens (an access token
 * for a day, renewed with the refresh token), and a post made through the Content Posting API: the post's slideshow video uploaded as a file
 * (so no address of ours needs verifying with TikTok), its caption as the post's words, and who may see it. Until TikTok has audited Kaizena
 * Flow's app, every post is private to the account (`SELF_ONLY`); once audited (`TIKTOK_PUBLIC`), public where the account allows it. Pure; the
 * server is `src/server/tiktok.ts`.
 *
 * Only the account's id and name are read: never who watched or liked a video.
 */

export const TIKTOK_API = "https://open.tiktokapis.com/v2";
export const TIKTOK_SCOPES = ["user.info.basic", "video.publish"] as const;
/** The access token is renewed when it ends within this many minutes (it runs 24 hours). */
export const TIKTOK_RENEW_MINUTES = 60;
/** A video up to this size goes up in one piece (TikTok takes one chunk up to 64 MB). */
export const TIKTOK_ONE_CHUNK_MAX = 64 * 1024 * 1024;

/** Where the owner signs in with TikTok and allows Kaizena Flow to post videos for them. */
export function tiktokAuthorizeUrl(clientKey: string, redirectUri: string, state: string): string {
  const params = new URLSearchParams({ client_key: clientKey, scope: TIKTOK_SCOPES.join(","), response_type: "code", redirect_uri: redirectUri, state });
  return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
}

export type TiktokTokens = { access: string; refresh: string; openId: string; expiresAt: Date; refreshExpiresAt: Date; scopes: string[] };

/** The tokens in TikTok's answer to a code or a renewal; null when it gave none. */
export function parseTokens(json: unknown, now: Date): TiktokTokens | null {
  const r = json as Record<string, unknown> | null;
  const text = (key: string) => (typeof r?.[key] === "string" && (r[key] as string).length > 0 ? (r[key] as string) : null);
  const seconds = (key: string) => (typeof r?.[key] === "number" && (r[key] as number) > 0 ? (r[key] as number) : null);
  const access = text("access_token");
  const refresh = text("refresh_token");
  const openId = text("open_id");
  const expires = seconds("expires_in");
  if (!access || !refresh || !openId || !expires) return null;
  return {
    access,
    refresh,
    openId: openId.slice(0, 200),
    expiresAt: new Date(now.getTime() + expires * 1000),
    refreshExpiresAt: new Date(now.getTime() + (seconds("refresh_expires_in") ?? 365 * 86_400) * 1000),
    scopes: (text("scope") ?? "").split(/[,\s]+/).filter(Boolean),
  };
}

/** Whether the person allowed posting videos. */
export const grantsVideoPublish = (scopes: readonly string[]): boolean => scopes.includes("video.publish");

/** Whether the access token is due for renewal. */
export const renewDue = (expiresAt: Date, now: Date): boolean => expiresAt.getTime() - now.getTime() < TIKTOK_RENEW_MINUTES * 60_000;

/** TikTok's refusal in an API answer (`error.code` other than `ok`), in its words; null when it went well. */
export function tiktokRefusal(json: unknown): string | null {
  const error = (json as { error?: { code?: unknown; message?: unknown } } | null)?.error;
  if (!error || error.code === "ok") return null;
  const said = typeof error.message === "string" && error.message ? error.message : String(error.code ?? "unknown");
  return said.slice(0, 200);
}

/** The account's name and who may see its posts, from `creator_info/query`. */
export function parseCreator(json: unknown): { username: string; privacy: string[] } {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  const username = typeof data?.creator_username === "string" ? data.creator_username.slice(0, 100) : "";
  const privacy = Array.isArray(data?.privacy_level_options) ? data.privacy_level_options.filter((p): p is string => typeof p === "string") : [];
  return { username, privacy };
}

/** Who sees the post: everyone once the app is audited and the account allows it, else only the account (`SELF_ONLY`). */
export function privacyFor(options: readonly string[], audited: boolean): string {
  return audited && options.includes("PUBLIC_TO_EVERYONE") ? "PUBLIC_TO_EVERYONE" : "SELF_ONLY";
}

/** The start of a video post uploaded as one file: its words (2,200 characters), who sees it, and its size. */
export function videoInitBody(text: string, privacy: string, size: number) {
  return {
    post_info: { title: text.slice(0, 2200), privacy_level: privacy, disable_comment: false, disable_duet: false, disable_stitch: false, video_cover_timestamp_ms: 1000 },
    source_info: { source: "FILE_UPLOAD", video_size: size, chunk_size: size, total_chunk_count: 1 },
  };
}

/** The post's id and where its video goes, from the start's answer; null when TikTok gave neither. */
export function parseInit(json: unknown): { publishId: string; uploadUrl: string } | null {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  const publishId = typeof data?.publish_id === "string" && /^[A-Za-z0-9_.~-]{1,100}$/.test(data.publish_id) ? data.publish_id : null;
  const uploadUrl = typeof data?.upload_url === "string" && data.upload_url.startsWith("https://") ? data.upload_url : null;
  return publishId && uploadUrl ? { publishId, uploadUrl } : null;
}

/** Where a post stands: out (with its public id, where TikTok gave one), still being processed, or failed (TikTok's reason). */
export function postState(json: unknown): { state: "done"; postId: string | null } | { state: "working" } | { state: "failed"; reason: string } {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  const status = data?.status;
  if (status === "PUBLISH_COMPLETE") {
    const ids = Array.isArray(data?.publicaly_available_post_id) ? data.publicaly_available_post_id : [];
    const id = ids.map(String).find((v) => /^[0-9]{1,40}$/.test(v)) ?? null;
    return { state: "done", postId: id };
  }
  if (status === "FAILED") return { state: "failed", reason: typeof data?.fail_reason === "string" ? data.fail_reason.slice(0, 200) : "unknown" };
  return { state: "working" };
}

/** A public video's own address, where its id and the account's name are known. */
export const videoUrl = (username: string, postId: string | null): string | null =>
  postId && /^[A-Za-z0-9._]{1,100}$/.test(username) ? `https://www.tiktok.com/@${username}/video/${postId}` : null;
