import "server-only";

import sharp from "sharp";

import { diffRaster, type Raster } from "@/lib/replicate-diff";

/**
 * The pictures the page replicator makes of its work (D150): small rasters to compare a copy with its original, JPEGs
 * for the owner to watch, and side-by-side images for the AI to look at. Pure image work, no network.
 */

/** The page as a small raster, for comparing, and how many pixels of the page one of its pixels stands for. */
export async function rasterOf(png: Buffer, width: number): Promise<{ raster: Raster; scale: number }> {
  const meta = await sharp(png).metadata();
  const target = Math.max(8, width);
  const { data, info } = await sharp(png).resize({ width: target }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { raster: { width: info.width, height: info.height, data }, scale: (meta.width ?? target) / info.width };
}

/** A picture of the page for the owner's panel: JPEG, as wide as asked and no taller than `maxHeight`. */
export async function previewJpeg(png: Buffer, width: number, maxHeight: number): Promise<Buffer> {
  const meta = await sharp(png).metadata();
  const scaledHeight = Math.round(((meta.height ?? 1) * width) / (meta.width ?? width));
  let pipeline = sharp(png).resize({ width, withoutEnlargement: true });
  // A very long page shows its top part: the weakest places are in the AI's detail pictures.
  if (scaledHeight > maxHeight) pipeline = pipeline.extract({ left: 0, top: 0, width, height: maxHeight });
  return pipeline.flatten({ background: "#ffffff" }).jpeg({ quality: 72, mozjpeg: true }).toBuffer();
}

/** A stretch of a page, as raw pixels at the page's own size, padded with white below where the page is shorter. */
async function stretch(png: Buffer, y: number, height: number, width: number): Promise<{ data: Buffer; width: number; height: number }> {
  const meta = await sharp(png).metadata();
  const pageHeight = meta.height ?? 1;
  const top = Math.max(0, Math.min(y, pageHeight - 1));
  const take = Math.max(1, Math.min(height, pageHeight - top));
  const { data, info } = await sharp(png)
    .extract({ left: 0, top, width: Math.min(width, meta.width ?? width), height: take })
    .extend({ bottom: Math.max(0, height - take), background: "#ffffff" })
    .flatten({ background: "#ffffff" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** The original, the copy and (when asked) where they differ, side by side for one stretch of the page, as one JPEG of at most `maxWidth`. */
export async function pairImage(original: Buffer, copy: Buffer, region: { y: number; height: number }, pageWidth: number, maxWidth: number, withDiff: boolean): Promise<Buffer> {
  const [a, b] = await Promise.all([stretch(original, region.y, region.height, pageWidth), stretch(copy, region.y, region.height, pageWidth)]);
  const panels = [a, b];
  if (withDiff) {
    const diff = diffRaster({ width: a.width, height: a.height, data: a.data }, { width: b.width, height: b.height, data: b.data });
    panels.push({ data: Buffer.from(diff.data.buffer), width: diff.width, height: diff.height });
  }
  const gap = 12;
  const panelWidth = Math.floor((maxWidth - gap * (panels.length - 1)) / panels.length);
  const scale = Math.min(1, panelWidth / a.width);
  const resized = await Promise.all(
    panels.map((panel) => sharp(panel.data, { raw: { width: panel.width, height: panel.height, channels: 4 } }).resize({ width: Math.round(panel.width * scale) }).png().toBuffer({ resolveWithObject: true })),
  );
  const height = Math.max(...resized.map((r) => r.info.height));
  const width = resized.reduce((sum, r) => sum + r.info.width, 0) + gap * (resized.length - 1);
  let left = 0;
  const layers = resized.map((r) => {
    const layer = { input: r.data, left, top: 0 };
    left += r.info.width + gap;
    return layer;
  });
  return sharp({ create: { width, height, channels: 3, background: "#7a7a85" } })
    .composite(layers)
    .jpeg({ quality: 78 })
    .toBuffer();
}

/** The most a picture sent to the model is, in pixels of its long side. */
export const MODEL_IMAGE_SIDE = 1600;

/** The page cut into stretches of at most `height` pixels, each as a JPEG of `width`, for the model to read the original from; at most `max` of them. */
export async function slices(png: Buffer, width: number, height: number, max: number): Promise<Buffer[]> {
  const meta = await sharp(png).metadata();
  const pageHeight = meta.height ?? 1;
  const out: Buffer[] = [];
  const count = Math.min(max, Math.ceil(pageHeight / height));
  for (let i = 0; i < count; i++) {
    const top = i * height;
    const take = Math.min(height, pageHeight - top);
    out.push(
      await sharp(png)
        .extract({ left: 0, top, width: meta.width ?? width, height: take })
        .resize({ width: Math.min(width, meta.width ?? width) })
        .flatten({ background: "#ffffff" })
        .jpeg({ quality: 74 })
        .toBuffer(),
    );
  }
  return out;
}

/** What a downloaded picture is, if it is one a page can use. */
export async function pictureKind(bytes: Uint8Array): Promise<{ format: string; width: number; height: number } | null> {
  try {
    const meta = await sharp(bytes, { failOn: "error", animated: false }).metadata();
    if (!meta.format || !meta.width || !meta.height) return null;
    return { format: meta.format, width: meta.width, height: meta.height };
  } catch {
    return null;
  }
}

/** Any picture as PNG at its own size (vector pictures at the size they have, at most 2400 pixels wide), for keeping; null if it cannot be read. */
export async function asPng(bytes: Uint8Array): Promise<Buffer | null> {
  try {
    return await sharp(bytes, { failOn: "error", density: 144, animated: false }).resize({ width: 2400, withoutEnlargement: true }).png().toBuffer();
  } catch {
    return null;
  }
}
