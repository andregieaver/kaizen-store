import { likeness, looksTheSame, lowestPassing, type Likeness, type Pixels } from "./image-quality";

/**
 * Compressing a picture in the browser before it is uploaded (D213): resized to at most `maxSize` pixels on its long side,
 * then written at the lowest quality whose result still looks the same as the resized picture (`looksTheSame()`), never above
 * 95 %. WebP (JPEG where the browser cannot write WebP), and AVIF where it is asked for and is clearly smaller. Camera
 * metadata such as location never comes along, as the picture is drawn anew. Browser only: it needs a canvas.
 */

export type PictureFormat = "image/avif" | "image/webp" | "image/jpeg";

export type CompressedPicture = {
  blob: Blob;
  type: PictureFormat;
  width: number;
  height: number;
  /** The size of the file as it was chosen, to say what was saved. */
  before: number;
  /** The quality chosen, 0 to 1, and how alike the result measured. */
  quality: number;
  likeness: Likeness | null;
};

/** The qualities searched between, as fractions, and how many tries the search takes. */
const LOWEST = 0.5;
const HIGHEST = 0.95;
const TRIES = 5;
/** AVIF is kept only when it is at least this much smaller than the WebP, as it costs a WebAssembly encoder to make. */
const AVIF_GAIN = 0.9;
/** An AVIF try slower than this (on a slow computer) gives up AVIF for this picture. */
const AVIF_PATIENCE_MS = 6000;

export const extensionOf = (type: string): string => ({ "image/avif": "avif", "image/webp": "webp", "image/png": "png" })[type] ?? "jpg";

function canvasOf(width: number, height: number): { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser cannot resize pictures.");
  return { canvas, context };
}

/** The pixels a written picture comes back as, at the size it was written. */
async function decoded(blob: Blob, width: number, height: number): Promise<Pixels> {
  const bitmap = await createImageBitmap(blob);
  const { context } = canvasOf(width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  return context.getImageData(0, 0, width, height);
}

const written = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

/** The type this browser writes from a canvas: WebP, else JPEG (some browsers quietly write PNG when asked for WebP). */
async function canvasType(canvas: HTMLCanvasElement): Promise<"image/webp" | "image/jpeg"> {
  const probe = await written(canvas, "image/webp", 0.5);
  return probe?.type === "image/webp" ? "image/webp" : "image/jpeg";
}

type Try = { blob: Blob; likeness: Likeness };

export async function compressPicture(file: Blob, maxSize: number, options: { avif?: boolean } = {}): Promise<CompressedPicture> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const { canvas, context } = canvasOf(width, height);
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const reference = context.getImageData(0, 0, width, height);

  const type = await canvasType(canvas);
  const attempt = async (quality: number): Promise<Try> => {
    const blob = await written(canvas, type, quality);
    if (!blob) throw new Error("The picture could not be converted.");
    return { blob, likeness: likeness(reference, await decoded(blob, width, height)) };
  };
  const passes = (t: Try) => looksTheSame(t.likeness);
  const chosen = await lowestPassing(LOWEST, HIGHEST, TRIES, attempt, passes);
  let best: CompressedPicture = {
    blob: chosen.result.blob,
    type,
    width,
    height,
    before: file.size,
    quality: chosen.setting,
    likeness: chosen.result.likeness,
  };

  if (options.avif) {
    const avif = await tryAvif(reference, width, height, best.blob.size * AVIF_GAIN).catch(() => null);
    if (avif && avif.blob.size < best.blob.size * AVIF_GAIN) best = { ...best, ...avif, type: "image/avif" };
  }
  return best;
}

/**
 * The smallest AVIF that looks the same and is under `limit` bytes, or null when the browser cannot make or read one, it
 * takes too long, or it cannot win: a try that does not yet look the same and is already over `limit` means every higher
 * quality is larger still, so the search stops there.
 */
async function tryAvif(reference: ImageData, width: number, height: number, limit: number): Promise<{ blob: Blob; quality: number; likeness: Likeness } | null> {
  const { encodeAvif } = await import("./avif-encode");
  let stop = false;
  const attempt = async (quality: number): Promise<Try | null> => {
    if (stop) return null;
    const started = performance.now();
    const bytes = await encodeAvif(reference, { quality: Math.round(quality * 100), speed: 8 });
    if (performance.now() - started > AVIF_PATIENCE_MS) stop = true;
    const blob = new Blob([bytes], { type: "image/avif" });
    const tried = { blob, likeness: likeness(reference, await decoded(blob, width, height)) };
    if (blob.size >= limit && !looksTheSame(tried.likeness)) stop = true;
    return tried;
  };
  const chosen = await lowestPassing(0.4, 0.9, 4, attempt, (t) => t !== null && looksTheSame(t.likeness));
  if (!chosen.result || !looksTheSame(chosen.result.likeness) || chosen.result.blob.size >= limit) return null;
  return { blob: chosen.result.blob, quality: chosen.setting, likeness: chosen.result.likeness };
}

/** A picture compressed for upload, as a blob (the shape callers used before D213). */
export async function shrinkImage(file: File, maxSize: number): Promise<Blob> {
  return (await compressPicture(file, maxSize)).blob;
}
