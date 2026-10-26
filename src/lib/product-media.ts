import { storageRef } from "./store-copy-media";
import { embedUrl } from "./video-embed";

/**
 * A product's gallery items (wave 6 unit G, D325, `docs/wave-6-catalogue.md` Unit G), the parts shared by the editor and the server: the kinds,
 * the limits the editor states and `productProblems()` enforces (`mediaProblems()`), and which files a store may use (`ownMediaFile()`).
 * Every item has a picture (`url`, `thumbnailUrl`): a picture's own, or a video's or model's poster, so whatever shows a product's picture
 * (cards, the cart, feeds) reads the first item's and never needs to know its kind.
 */

export const MEDIA_KINDS = ["image", "video", "model"] as const;
export type MediaItemKind = (typeof MEDIA_KINDS)[number];

export const VIDEO_SOURCES = ["upload", "youtube", "vimeo"] as const;
export type VideoSource = (typeof VIDEO_SOURCES)[number];

/** The most items a product's gallery holds. */
export const MAX_MEDIA = 20;
/** Of them, the most videos and 3D models. */
export const MAX_VIDEOS = 5;
export const MAX_MODELS = 3;

/** A video file's largest size: the `page-videos` bucket's own limit (D86). */
export const PRODUCT_VIDEO_MAX_MB = 50;
/** A 3D model's largest size: the `product-models` bucket's own limit. */
export const MODEL_MAX_BYTES = 20 * 1024 * 1024;
export const MODEL_MAX_MB = 20;
/** A model is one GLB file: a glTF is several files and is refused (export a GLB). */
export const MODEL_TYPE = "model/gltf-binary";

/** Where uploaded files of each kind live: one folder per store in each public bucket. */
export const MEDIA_BUCKETS = { video: "page-videos", model: "product-models" } as const;

export type MediaItemShape = {
  kind: MediaItemKind;
  source: VideoSource | null;
  mediaUrl: string | null;
};

/**
 * Whether an address is a file in the store's own folder of a public bucket (`{bucket}/{store}/{file}`), so a product never plays another
 * store's or another site's file. One level under the folder, as uploads name it.
 */
export function ownMediaFile(url: string, bucket: string, storeId: string): boolean {
  const ref = storageRef(url);
  if (!ref || ref.bucket !== bucket) return false;
  const [folder, file, ...rest] = ref.path.split("/");
  return rest.length === 0 && folder === storeId.toLowerCase() && Boolean(file) && file !== "." && file !== "..";
}

/**
 * What is wrong with a gallery's kinds and counts, in the editor's words: at most `MAX_VIDEOS` videos and `MAX_MODELS` models, and each
 * item holding what its kind needs (a video its file or a YouTube or Vimeo address; a model its file; a picture neither). Whether a file is
 * the store's own is the server's check (`ownMediaFile()`).
 */
export function mediaProblems(media: readonly MediaItemShape[]): string[] {
  const problems: string[] = [];
  const videos = media.filter((m) => m.kind === "video").length;
  const models = media.filter((m) => m.kind === "model").length;
  if (videos > MAX_VIDEOS) problems.push(`Use at most ${MAX_VIDEOS} videos.`);
  if (models > MAX_MODELS) problems.push(`Use at most ${MAX_MODELS} 3D models.`);
  for (const item of media) {
    if (item.kind === "image" && (item.source !== null || item.mediaUrl !== null)) problems.push("A picture holds no video or model.");
    if (item.kind === "model" && (item.source !== null || !item.mediaUrl)) problems.push("A 3D model needs its file.");
    if (item.kind === "video") {
      if (item.source === null || !item.mediaUrl) problems.push("A video needs its file or a YouTube or Vimeo address.");
      else if (item.source !== "upload" && embedUrl(item.source, item.mediaUrl) === null) {
        problems.push(`That is not a ${item.source === "youtube" ? "YouTube" : "Vimeo"} video's address.`);
      }
    }
  }
  return [...new Set(problems)];
}

/** Where a gallery item plays from, or null for a file the store does not own: an embed's player, or the store's own file. */
export function mediaFileOk(item: MediaItemShape, storeId: string): boolean {
  if (item.kind === "image") return true;
  if (!item.mediaUrl) return false;
  if (item.kind === "model") return ownMediaFile(item.mediaUrl, MEDIA_BUCKETS.model, storeId);
  if (item.source === "upload") return ownMediaFile(item.mediaUrl, MEDIA_BUCKETS.video, storeId);
  return item.source !== null && embedUrl(item.source, item.mediaUrl) !== null;
}

/** A picture as a gallery item: the shape every writer that adds a plain picture (an upload, an import, a tool, a content pack) uses. */
export function pictureItem(url: string, thumbnailUrl: string | null, alt = "") {
  return { kind: "image" as const, source: null, mediaUrl: null, url, thumbnailUrl, alt, alts: {} as Record<string, string> };
}
