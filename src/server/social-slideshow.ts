import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { SLIDES_MAX } from "@/lib/social-slideshow";

import { audit, type Membership } from "./auth";
import { registerVideo } from "./media-library";
import { startVideoUpload, type VideoUpload } from "./media";
import { memberCan, NO_ACCESS } from "./permissions";
import { storageRefusal } from "./limits";
import { ownFile, paletteOf } from "./social-pictures";
import { col, typedRows } from "./typed-rows";

/**
 * A social post's slideshow video (D870 S2.5, timings in `src/lib/social-slideshow.ts`, made in the browser by
 * `src/lib/social-slideshow-make.ts`): which photos it shows (the post's own picture, then the product's other photos), each served from
 * the page's own address so the browser may draw it, and the made video uploaded straight to Storage, kept in the library and on the post
 * (`video_media_id`, of which this is the only writer).
 */

const POST = z.object({ id: col.uuid, ref: col.text, product_id: z.string().nullable(), picture_v: col.text });

async function postOf(storeId: string, postId: unknown) {
  const id = z.uuid().safeParse(postId);
  if (!id.success) return null;
  const [post] = await typedRows(
    POST,
    sql`select id, ref, product_id,
      concat(coalesce(extract(epoch from edited_at)::bigint, 0), '-', scene_tries, '-', coalesce(picture_media_id::text, '')) as picture_v
      from commerce.social_posts where store_id = ${storeId}::uuid and id = ${id.data}::uuid`,
  );
  return post ?? null;
}

/** The product's own photos after the first, in the shop's order, at most `SLIDES_MAX - 1`. */
async function productPhotos(storeId: string, productId: string | null): Promise<string[]> {
  if (!productId) return [];
  const rows = await typedRows(
    z.object({ url: col.text }),
    sql`select url from commerce.product_media where store_id = ${storeId}::uuid and product_id = ${productId}::uuid and kind = 'image' order by position limit ${SLIDES_MAX}`,
  );
  return rows.map((r) => r.url);
}

/** What the browser draws: the photos' own addresses on this page (the post's picture first) and the colour behind them. */
export async function slideshowPlan(member: Membership, postId: unknown, base: string): Promise<{ ok: true; photos: string[]; background: string; name: string } | { ok: false }> {
  const post = await postOf(member.store.id, postId);
  if (!post) return { ok: false };
  const photos = await productPhotos(member.store.id, post.product_id);
  // The product's first photo is in the post's picture already: the video goes on from its second.
  const more = photos.slice(1, SLIDES_MAX).map((_, i) => `${base}/slides/${post.id}?n=${i + 1}`);
  return { ok: true, photos: [`${base}/picture/${post.id}?v=${encodeURIComponent(post.picture_v)}`, ...more], background: paletteOf(member.store).background, name: `post-${post.ref}` };
}

/** One of the product's photos for the video (`n` from 1), read from the store's own files; null when there is none. */
export async function slidePhoto(member: Membership, postId: unknown, n: number, origin: string): Promise<Buffer | null> {
  const post = await postOf(member.store.id, postId);
  if (!post || !Number.isInteger(n) || n < 1 || n >= SLIDES_MAX) return null;
  const url = (await productPhotos(member.store.id, post.product_id))[n];
  return url ? ownFile(url, origin) : null;
}

/** Starts the made video's upload straight from the browser to Storage, kept in the library as it starts. */
export async function startSlideshowUpload(member: Membership, postId: unknown, size: unknown): Promise<VideoUpload> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const post = await postOf(member.store.id, postId);
  const bytes = z.number().int().positive().safeParse(size);
  if (!post || !bytes.success) return { ok: false, problem: "Choose a post." };
  const full = await storageRefusal(member.store.id, bytes.data);
  if (full) return { ok: false, problem: full };
  const file = { type: "video/mp4", size: bytes.data, name: `post-${post.ref}.mp4`, compressed: true };
  const started = await startVideoUpload(member.store.id, file);
  if (started.ok) await registerVideo({ storeId: member.store.id, accountId: member.account.id }, started, file);
  return started;
}

/** Keeps the uploaded video on the post: the library's row for the path the upload was given. */
export async function keepSlideshow(member: Membership, postId: unknown, path: unknown): Promise<{ ok: true; url: string } | { ok: false; problem: string }> {
  if (!memberCan(member, "marketing:write")) return { ok: false, problem: NO_ACCESS };
  const post = await postOf(member.store.id, postId);
  const where = z.string().max(300).safeParse(path);
  if (!post || !where.success) return { ok: false, problem: "Choose a post." };
  const [video] = await typedRows(
    z.object({ id: col.uuid, url: col.text }),
    sql`select id, url from commerce.media where store_id = ${member.store.id}::uuid and kind = 'video' and path = ${where.data} limit 1`,
  );
  if (!video) return { ok: false, problem: "The video was not found in the library." };
  await db().execute(sql`update commerce.social_posts set video_media_id = ${video.id}::uuid where store_id = ${member.store.id}::uuid and id = ${post.id}::uuid`);
  await audit(member.account.id, member.store.id, "store.social_video_made", {});
  return { ok: true, url: video.url };
}
