import "server-only";

import { randomUUID } from "node:crypto";

export { fontFamilies, pictureAddresses, videoAddresses } from "@/lib/replicate-assets-plan";

import { fontSlug } from "@/lib/fonts";

import { findFontBySlug, installFont } from "./fonts";
import { registerVideo, storePicture } from "./media-library";
import { uploadBytes, VIDEO_FILE_TYPES, VIDEO_MAX_BYTES } from "./media";
import { shrinkPicture } from "./ai-pictures";
import { asPng, pictureKind } from "./replicate-images";
import { safeFetch, type FetchOptions } from "./replicate-fetch";

/**
 * Everything a copied page needs besides its words (D150): the pictures, videos and fonts of the original, found in what
 * was captured, downloaded through the safe fetcher and kept as the store's own: pictures shrunk to WebP in the media
 * library like any upload, videos in the page-video bucket, fonts installed from Google Fonts where the family is one. What
 * cannot be copied is reported by name, never silently dropped.
 */

export type AssetOwner = { storeId: string; accountId: string };
export type KeptPicture = { url: string; width: number; height: number };

const PICTURE_BYTES = 15 * 1024 * 1024;

/** A file name for a picture, from its address. */
function nameFrom(url: string, fallback: string): string {
  try {
    const last = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    const base = decodeURIComponent(last).replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
    return `${base || fallback}.webp`;
  } catch {
    return `${fallback}.webp`;
  }
}

const options = (referer: string, accept: string, maxBytes: number): FetchOptions => ({ maxBytes, accept, referer, timeoutMs: 25_000 });

/** Keeps a picture's bytes as the store's own (WebP, at most 1600 wide, and a small copy) in its media library. */
export async function keepPicture(owner: AssetOwner, bytes: Uint8Array, name: string, alt = ""): Promise<{ ok: true; picture: KeptPicture } | { ok: false; problem: string }> {
  const kind = await pictureKind(bytes);
  if (!kind) return { ok: false, problem: "It is not a picture the page can use." };
  // Vector pictures and formats the library does not keep are drawn to PNG first.
  const source = kind.format === "svg" || kind.format === "heif" ? await asPng(bytes) : Buffer.from(bytes);
  if (!source) return { ok: false, problem: "It could not be read." };
  let shrunk: Awaited<ReturnType<typeof shrinkPicture>>;
  try {
    shrunk = await shrinkPicture(source);
  } catch {
    return { ok: false, problem: "It could not be read." };
  }
  const image = new File([new Uint8Array(shrunk.image)], name, { type: "image/webp" });
  const thumbnail = new File([new Uint8Array(shrunk.thumbnail)], name.replace(/\.webp$/, "-480.webp"), { type: "image/webp" });
  const stored = await storePicture(owner, image, thumbnail, { fileName: name, alt });
  if (!stored.ok) return { ok: false, problem: stored.problem };
  return { ok: true, picture: { url: stored.url, width: shrunk.width, height: shrunk.height } };
}

/** Downloads a picture of the original and keeps it. */
export async function savePicture(owner: AssetOwner, url: string, referer: string, alt = ""): Promise<{ ok: true; picture: KeptPicture } | { ok: false; problem: string }> {
  const fetched = await safeFetch(url, options(referer, "image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8", PICTURE_BYTES));
  if (!fetched.ok) return { ok: false, problem: fetched.problem };
  return keepPicture(owner, fetched.bytes, nameFrom(url, "picture"), alt);
}

/** Keeps a picture the browser took of an element (an icon, a canvas, a widget). */
export async function saveShot(owner: AssetOwner, png: Buffer, name: string): Promise<{ ok: true; picture: KeptPicture } | { ok: false; problem: string }> {
  return keepPicture(owner, png, `${name}.webp`);
}

/** Downloads a video file of the original and keeps it with the page's other videos. */
export async function saveVideo(owner: AssetOwner, url: string, referer: string): Promise<{ ok: true; url: string } | { ok: false; problem: string }> {
  if (/\.m3u8(\?|$)|\.mpd(\?|$)/i.test(url)) return { ok: false, problem: "It is streamed in pieces, which a page cannot play from a file." };
  const fetched = await safeFetch(url, options(referer, "video/mp4,video/webm,video/*;q=0.8", VIDEO_MAX_BYTES));
  if (!fetched.ok) return { ok: false, problem: fetched.problem };
  const type = fetched.contentType.startsWith("video/") ? fetched.contentType : /\.webm(\?|$)/i.test(url) ? "video/webm" : /\.mp4(\?|$)/i.test(url) ? "video/mp4" : fetched.contentType;
  const extension = VIDEO_FILE_TYPES[type];
  if (!extension) return { ok: false, problem: "Only MP4 and WebM videos can be kept." };
  const path = `${owner.storeId}/${randomUUID()}.${extension}`;
  const uploaded = await uploadBytes("page-videos", path, fetched.bytes, type);
  if (!uploaded.ok) return { ok: false, problem: uploaded.problem };
  await registerVideo(owner, { url: uploaded.url, bucket: "page-videos", path }, { name: nameFrom(url, "video").replace(/\.webp$/, `.${extension}`), type, size: fetched.bytes.length });
  return { ok: true, url: uploaded.url };
}

// ---------------------------------------------------------------------------
// Fonts
// ---------------------------------------------------------------------------

/** Installs a family from Google Fonts if it is one; the catalogue's own spelling of its name, or why not. */
export async function installFamily(family: string): Promise<{ ok: true; family: string } | { ok: false; problem: string }> {
  const font = findFontBySlug(fontSlug(family));
  if (!font) return { ok: false, problem: "It is not in Google Fonts." };
  const result = await installFont(font.family);
  return result.ok ? { ok: true, family: font.family } : { ok: false, problem: result.problem };
}
