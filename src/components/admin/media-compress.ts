import { compressPicture, extensionOf } from "@/lib/image-compress";
import { compressPlan, COMPRESS_WORTH } from "@/lib/media-compress";
import { createClient } from "@/lib/supabase/client";
import { compressVideo } from "@/lib/video-compress";
import type { VideoUpload } from "@/server/media";
import type { CompressOutcome } from "@/server/media-compress";
import type { MediaItem } from "@/server/media-library";

/** What Compress asks of the library's owner's server (D213), bound to the store or Kaizen's. */
export type CompressActions = {
  picture: (id: string, data: FormData) => Promise<CompressOutcome>;
  startVideo: (id: string, file: { type: "video/mp4"; size: number }) => Promise<VideoUpload>;
  finishVideo: (id: string, path: string) => Promise<CompressOutcome>;
  /** The files that wait for Compress, the largest first. */
  waiting: () => Promise<MediaItem[]>;
};

const ALREADY = "It is already about as small as it can be while it looks the same.";

/**
 * Compresses one library file in this browser (D213) and lets it take the original's place: the file is fetched, made as
 * small as it can be while it still looks the same (`compressPicture()`, `compressVideo()`), and handed to the server only
 * when it is clearly smaller. `onProgress` hears a video's progress, 0 to 1.
 */
export async function compressLibraryFile(
  item: MediaItem,
  actions: CompressActions,
  onProgress?: (progress: number) => void,
): Promise<CompressOutcome> {
  const plan = compressPlan(item);
  if (!plan.offered) return { ok: false, problem: plan.why };
  let original: Blob;
  try {
    const response = await fetch(item.url, { cache: "no-store" });
    if (!response.ok) return { ok: false, problem: "The file could not be fetched from storage." };
    original = await response.blob();
  } catch {
    return { ok: false, problem: "The file could not be fetched from storage." };
  }
  const before = Math.max(item.sizeBytes, original.size);

  if (item.kind === "image") {
    try {
      const [image, thumbnail] = await Promise.all([compressPicture(original, 1600, { avif: plan.avif }), compressPicture(original, 480)]);
      if (image.blob.size > before * COMPRESS_WORTH) return { ok: false, problem: ALREADY };
      const data = new FormData();
      data.set("image", new File([image.blob], `picture.${extensionOf(image.type)}`, { type: image.type }));
      data.set("thumbnail", new File([thumbnail.blob], `picture-480.${extensionOf(thumbnail.type)}`, { type: thumbnail.type }));
      return await actions.picture(item.id, data);
    } catch {
      return { ok: false, problem: "This browser could not read the picture to compress it." };
    }
  }

  // A video's sound is kept: the library cannot tell whether it is only a row's background.
  const compressed = await compressVideo(new File([original], item.fileName, { type: item.contentType }), { keepSound: true, onProgress });
  if (!compressed || compressed.file.size > before * COMPRESS_WORTH) return { ok: false, problem: ALREADY };
  const started = await actions.startVideo(item.id, { type: "video/mp4", size: compressed.file.size });
  if (!started.ok) return started;
  const stored = await createClient()
    .storage.from(started.bucket)
    .uploadToSignedUrl(started.path, started.token, compressed.file, { contentType: "video/mp4" });
  if (stored.error) return { ok: false, problem: "The smaller video could not be uploaded. Try again." };
  return actions.finishVideo(item.id, started.path);
}
