/**
 * Publishing an approved social post (D870 S3.1, `docs/social-manager.md` 6): to the store's Instagram account (the Instagram API with
 * Instagram Login's content publishing: a media container, then `media_publish`), its Facebook Page (`/{page-id}/photos` or `/videos`) and
 * its Pinterest board (a Pin, S3.4, `src/lib/pinterest.ts`).
 * What each post is published as, the words it carries and how Meta's answers are read. Pure; the server is `src/server/social-publish.ts`.
 */

import { copyText, type PostChannel } from "./social-posts";

/** The channels Kaizena Flow publishes to (Pinterest from S3.4); the others stay copy-and-paste until their own step (S3.5, S3.6). */
export const PUBLISH_CHANNELS = ["instagram", "facebook", "pinterest"] as const satisfies readonly PostChannel[];
export type PublishChannel = (typeof PUBLISH_CHANNELS)[number];
export const isPublishChannel = (channel: string): channel is PublishChannel => (PUBLISH_CHANNELS as readonly string[]).includes(channel);

/** What a post goes up as: its slideshow video where it has one (a Reel on Instagram), else its picture. */
export type PublishKind = "picture" | "video";
export const publishKind = (hasVideo: boolean): PublishKind => (hasVideo ? "video" : "picture");

/** The words published with the post: what the owner would copy (caption, price line, hashtags, the link where it opens). */
export const publishedText = (post: Parameters<typeof copyText>[0]): string => copyText(post).slice(0, 2200);

const ID = /^[0-9]{1,40}(_[0-9]{1,40})?$/;

/** An id in one of Meta's answers (`id`, or a Page photo's `post_id`), or null. */
export function idFrom(json: unknown, key: "id" | "post_id" = "id"): string | null {
  const value = (json as Record<string, unknown> | null)?.[key];
  return typeof value === "string" && ID.test(value) ? value : null;
}

/** An Instagram media container's state: ready to publish, still being processed (a video), or failed. */
export function containerState(json: unknown): "ready" | "working" | "failed" {
  const code = (json as { status_code?: unknown } | null)?.status_code;
  if (code === "FINISHED" || code === "PUBLISHED") return "ready";
  if (code === "ERROR" || code === "EXPIRED") return "failed";
  return "working";
}

/** The published post's own address on the platform, kept only where it is Instagram's or Facebook's. */
export function permalinkFrom(json: unknown): string | null {
  const record = json as Record<string, unknown> | null;
  const url = typeof record?.permalink === "string" ? record.permalink : typeof record?.permalink_url === "string" ? record.permalink_url : null;
  return url && /^https:\/\/(www\.|m\.)?(instagram|facebook)\.com\//.test(url) && url.length <= 300 ? url : null;
}

/** A video container is asked about this often while Instagram processes it, at most this many times. */
export const CONTAINER_WAIT_MS = 3_000;
export const CONTAINER_CHECKS = 20;
