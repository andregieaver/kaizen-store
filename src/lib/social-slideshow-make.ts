/**
 * Makes a social post's slideshow video in the owner's browser (D870 S2.5, the timings in `src/lib/social-slideshow.ts`): each photo drawn
 * on a 1080 × 1920 canvas frame by frame, encoded as H.264 MP4 by the browser's own encoder (WebCodecs through mediabunny, loaded only on
 * the press, as `video-compress.ts` does). The first photo is the post's own picture, drawn whole over a blurred copy of itself so its
 * words are never cut; the product's photos after it fill the frame. No sound. Browser only.
 */

import { coverRect, containRect, framesAt, slideshowSeconds, SLIDES_MAX, VIDEO_FPS, VIDEO_SIZE } from "./social-slideshow";

export type SlideshowOutcome = { ok: true; video: File } | { ok: false; why: "browser" | "photos" };

/** Whether this browser can make the video: it encodes H.264 at the video's size. */
export async function canMakeSlideshow(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { canEncodeVideo } = await import("mediabunny");
    return await canEncodeVideo("avc", { width: VIDEO_SIZE.width, height: VIDEO_SIZE.height });
  } catch {
    return false;
  }
}

async function loadPhoto(url: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) return null;
    return await createImageBitmap(await response.blob());
  } catch {
    return null;
  }
}

/** Makes the video from the photos at `urls` (the post's picture first; the page's own addresses), named after `name`. */
export async function makeSlideshow(urls: string[], name: string, options: { background?: string; onProgress?: (share: number) => void } = {}): Promise<SlideshowOutcome> {
  if (!(await canMakeSlideshow())) return { ok: false, why: "browser" };
  const photos = (await Promise.all(urls.slice(0, SLIDES_MAX).map(loadPhoto))).filter((p): p is ImageBitmap => p !== null);
  if (photos.length === 0) return { ok: false, why: "photos" };
  const { BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH } = await import("mediabunny");
  const { width, height } = VIDEO_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) return { ok: false, why: "browser" };

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_HIGH, keyFrameInterval: 1 });
  output.addVideoTrack(source, { frameRate: VIDEO_FPS });
  await output.start();

  const seconds = slideshowSeconds(photos.length);
  const total = Math.round(seconds * VIDEO_FPS);
  const box = { width, height };
  for (let i = 0; i < total; i++) {
    const t = i / VIDEO_FPS;
    ctx.globalAlpha = 1;
    ctx.fillStyle = options.background ?? "#111111";
    ctx.fillRect(0, 0, width, height);
    for (const frame of framesAt(t, photos.length)) {
      const photo = photos[frame.index];
      ctx.globalAlpha = frame.alpha;
      if (frame.index === 0) {
        // The post's own picture: whole, over a blurred copy of itself that fills the frame.
        const behind = coverRect(photo, box, { scale: 1.1, driftX: 0, driftY: 0 });
        ctx.filter = "blur(48px) brightness(0.8)";
        ctx.drawImage(photo, behind.x, behind.y, behind.width, behind.height);
        ctx.filter = "none";
        const whole = containRect(photo, box, frame.scale);
        ctx.drawImage(photo, whole.x, whole.y, whole.width, whole.height);
      } else {
        const r = coverRect(photo, box, frame);
        ctx.drawImage(photo, r.x, r.y, r.width, r.height);
      }
    }
    await source.add(t, 1 / VIDEO_FPS);
    options.onProgress?.((i + 1) / total);
  }
  source.close();
  await output.finalize();
  const bytes = output.target.buffer;
  if (!bytes) return { ok: false, why: "browser" };
  return { ok: true, video: new File([bytes], `${name}.mp4`, { type: "video/mp4" }) };
}
