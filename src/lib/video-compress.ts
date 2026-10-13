/**
 * Compressing a video in the browser before it is uploaded (D213), with the browser's own encoder (WebCodecs, through
 * mediabunny, loaded only when a video is chosen): at most 1080p (1920 × 1080 either way round), H.264 in MP4 at mediabunny's
 * "very high" quality for its size and frame rate, without its sound for a row's background, which never plays it. The
 * result is used only when it is clearly smaller (`WORTH`); otherwise, or when the browser cannot encode, the video goes up
 * as it was chosen. Browser only.
 */

/** A compressed video is used only when it is at most this share of the original. */
const WORTH = 0.8;
const LONG_SIDE = 1920;
const SHORT_SIDE = 1080;

/** The largest video a person may choose when this browser can compress it, and the largest that may be stored. */
export const VIDEO_CHOOSE_MAX_BYTES = 500 * 1024 * 1024;
export const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

export type CompressedVideo = { file: File; before: number };

/** Whether this browser can encode H.264, which compressing needs. */
export async function canCompressVideo(): Promise<boolean> {
  if (typeof VideoEncoder === "undefined") return false;
  try {
    const { canEncodeVideo } = await import("mediabunny");
    return await canEncodeVideo("avc");
  } catch {
    return false;
  }
}

/** The size a video is made at: no larger than 1080p, its own proportions, even numbers as encoders need. */
export function videoTarget(width: number, height: number): { width: number; height: number } {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  const scale = Math.min(1, LONG_SIDE / long, SHORT_SIDE / short);
  const even = (n: number) => Math.max(2, Math.round((n * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/**
 * The video made smaller, or null when it could not be or would not be worth it (the original is used then). `keepSound`
 * keeps its sound track; `onProgress` hears 0 to 1.
 */
export async function compressVideo(
  file: File,
  options: { keepSound: boolean; onProgress?: (progress: number) => void },
): Promise<CompressedVideo | null> {
  if (!(await canCompressVideo())) return null;
  try {
    const { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, Quality } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const size = videoTarget(track.displayWidth, track.displayHeight);
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    const conversion = await Conversion.init({
      input,
      output,
      video: { width: size.width, height: size.height, fit: "fill", codec: "avc", bitrate: new Quality("very-high"), forceTranscode: true },
      audio: options.keepSound ? { codec: "aac", bitrate: new Quality("high") } : { discard: true },
    });
    if (!conversion.isValid) return null;
    if (options.onProgress) conversion.onProgress = (progress) => options.onProgress?.(progress);
    await conversion.execute();
    const buffer = output.target.buffer;
    if (!buffer || buffer.byteLength > file.size * WORTH) return null;
    const name = file.name.replace(/\.[a-z0-9]+$/i, "") + ".mp4";
    return { file: new File([buffer], name, { type: "video/mp4" }), before: file.size };
  } catch {
    return null;
  }
}
