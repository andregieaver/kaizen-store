/**
 * Making an animation in the owner's browser (D538, `src/lib/animation.ts`): one WebM with a see-through background in, and out
 * come the two files the site plays it from. The WebM is read with its transparency (mediabunny's `CanvasSink`, loaded only
 * when a file is chosen), each frame is drawn as it looks on black above its mask, and the pair is written as H.264 in MP4 with
 * the browser's own encoder (WebCodecs), as `compressVideo()` writes a video. The last frame is kept as a picture at the
 * source's size. Nothing leaves the browser here: the caller uploads what is made. Browser only.
 */
import {
  refusalBeforeOpening,
  refusalOnceOpened,
  stackedPictureSize,
  stillSize,
  type AnimationRefusal,
} from "./animation";

export type MadeAnimation = {
  /** Picture above, mask below. */
  video: File;
  /** The last frame, see-through. */
  still: File;
  /** The picture's size inside the video. */
  width: number;
  height: number;
};

export type MakeOutcome = { ok: true; made: MadeAnimation } | { ok: false; why: AnimationRefusal };

/**
 * The animation made of `file`, or why it cannot be one. `onProgress` hears 0 to 1 as its frames are written.
 */
export async function makeAnimation(file: File, options: { onProgress?: (share: number) => void } = {}): Promise<MakeOutcome> {
  const refused = refusalBeforeOpening(file);
  if (refused) return { ok: false, why: refused };
  if (typeof VideoEncoder === "undefined" || typeof VideoDecoder === "undefined") return { ok: false, why: "browser" };
  try {
    const { ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, QUALITY_HIGH, canEncodeVideo } = await import("mediabunny");
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track) return { ok: false, why: "unreadable" };
    const seconds = await track.computeDuration();
    const unfit = refusalOnceOpened({ width: track.displayWidth, height: track.displayHeight, seconds, transparent: await track.canBeTransparent() });
    if (unfit) return { ok: false, why: unfit };
    const picture = stackedPictureSize(track.displayWidth, track.displayHeight);
    const last = stillSize(track.displayWidth, track.displayHeight);
    if (!picture || !last) return { ok: false, why: "small" };
    const { width, height } = picture;
    if (!(await canEncodeVideo("avc", { width, height: height * 2 }))) return { ok: false, why: "browser" };

    // Picture and mask, one above the other: the frame the video holds. Opaque, as H.264 is.
    const stacked = document.createElement("canvas");
    stacked.width = width;
    stacked.height = height * 2;
    const frame = stacked.getContext("2d", { alpha: false });
    const mask = document.createElement("canvas");
    mask.width = width;
    mask.height = height;
    const solid = mask.getContext("2d");
    if (!frame || !solid) return { ok: false, why: "browser" };

    const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target: new BufferTarget() });
    // A key frame every second: the player can start, and a phone can find its place, without reading far.
    const source = new CanvasSource(stacked, { codec: "avc", bitrate: QUALITY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(source);
    await output.start();

    const frames = new CanvasSink(track, { alpha: true, width, height, fit: "fill", poolSize: 2 });
    let written = 0;
    let lastAt = 0;
    for await (const one of frames.canvases()) {
      // Drawn on black, a see-through picture is its colour times how solid it is: what the player wants in the top half.
      frame.fillStyle = "#000";
      frame.fillRect(0, 0, width, height * 2);
      frame.drawImage(one.canvas, 0, 0, width, height);
      // The mask: white where the picture is, as solid as it is there.
      solid.globalCompositeOperation = "copy";
      solid.drawImage(one.canvas, 0, 0, width, height);
      solid.globalCompositeOperation = "source-in";
      solid.fillStyle = "#fff";
      solid.fillRect(0, 0, width, height);
      frame.drawImage(mask, 0, height, width, height);
      await source.add(one.timestamp, one.duration);
      written += 1;
      lastAt = one.timestamp;
      options.onProgress?.(seconds > 0 ? Math.min(1, (one.timestamp + one.duration) / seconds) : 0);
    }
    if (written === 0) return { ok: false, why: "unreadable" };
    await output.finalize();
    const bytes = output.target.buffer;
    if (!bytes) return { ok: false, why: "unreadable" };

    // The last frame at the source's size: what the animation rests on.
    const resting = await new CanvasSink(track, { alpha: true, width: last.width, height: last.height, fit: "fill" }).getCanvas(lastAt);
    if (!resting) return { ok: false, why: "unreadable" };
    const kept = document.createElement("canvas");
    kept.width = last.width;
    kept.height = last.height;
    kept.getContext("2d")?.drawImage(resting.canvas, 0, 0, last.width, last.height);
    const png = await new Promise<Blob | null>((resolve) => kept.toBlob(resolve, "image/png"));
    if (!png) return { ok: false, why: "unreadable" };

    const name = file.name.replace(/\.[a-z0-9]+$/i, "") || "animation";
    return {
      ok: true,
      made: {
        video: new File([bytes], `${name}.mp4`, { type: "video/mp4" }),
        still: new File([png], `${name}.png`, { type: "image/png" }),
        width,
        height,
      },
    };
  } catch {
    // A file the browser cannot read through, or an encoder that gave up part way.
    return { ok: false, why: "unreadable" };
  }
}
