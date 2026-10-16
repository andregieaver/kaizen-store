import "server-only";

import sharp, { type Sharp } from "sharp";

import type { Shot } from "@/lib/theme-shoot";
import { CARD_SIZE, SHARE_SIZE, topCrop, type ShotKind, type ShotPictureKind } from "@/lib/theme-shots";

/**
 * The pictures cut from one look's photographs (`docs/theme-showcase-phase-2.md`, *Sizes*): the page at full length and its first screen as
 * WebP, and from a computer's the theme store's card (800 × 600) and a share image (1200 × 630, JPEG, which every social site reads).
 * A file larger than the bucket allows is made again smaller (`fitted()`), so it never fails to upload for its size.
 */

/** A made file before it is stored. */
export type MadeFile = { kind: ShotPictureKind; bytes: Buffer; contentType: "image/webp" | "image/jpeg"; extension: "webp" | "jpg"; width: number; height: number };

/** The public bucket's own limit is 5 MB: a file stays a little under it. */
export const FILE_BYTES_MAX = 4_500_000;

type Encode = (image: Sharp, quality: number) => Sharp;
const webp: Encode = (image, quality) => image.webp({ quality, effort: 4 });
const jpeg: Encode = (image, quality) => image.flatten({ background: "#ffffff" }).jpeg({ quality, mozjpeg: true });

/**
 * `source` encoded at the first quality that fits under `max`, then narrower (at the last quality) until it does: a long page's photograph
 * of many pictures can otherwise pass the bucket's limit.
 */
async function fitted(source: Buffer, encode: Encode, qualities: readonly number[], max = FILE_BYTES_MAX): Promise<{ bytes: Buffer; width: number; height: number }> {
  const meta = await sharp(source).metadata();
  let width = meta.width ?? 1;
  for (let round = 0; round < 6; round++) {
    for (const quality of round === 0 ? qualities : qualities.slice(-1)) {
      const { data, info } = await encode(sharp(source).resize({ width, withoutEnlargement: true }), quality).toBuffer({ resolveWithObject: true });
      if (data.length <= max) return { bytes: data, width: info.width, height: info.height };
    }
    width = Math.max(1, Math.round(width * 0.8));
  }
  throw new Error("The photograph could not be made small enough to keep.");
}

/** A rectangle of `source` scaled to exactly `size` (the crop already has its shape, so nothing is stretched). */
async function cut(source: Buffer, size: { width: number; height: number }, ratio: number): Promise<Buffer> {
  const meta = await sharp(source).metadata();
  const rect = topCrop(meta.width ?? size.width, meta.height ?? size.height, ratio);
  return sharp(source).extract(rect).resize({ width: size.width, height: size.height, fit: "cover", position: "top" }).png().toBuffer();
}

/** Every picture a width makes from its photographs. */
export async function shotFiles(kind: ShotKind, shot: Pick<Shot, "full" | "screen" | "detail">): Promise<MadeFile[]> {
  const out: MadeFile[] = [];
  const add = async (picture: ShotPictureKind, source: Buffer, encode: Encode, qualities: readonly number[], type: MadeFile["contentType"]) => {
    const made = await fitted(source, encode, qualities);
    out.push({ kind: picture, bytes: made.bytes, contentType: type, extension: type === "image/jpeg" ? "jpg" : "webp", width: made.width, height: made.height });
  };
  await add("full", shot.full, webp, [80, 70, 60], "image/webp");
  await add("screen", shot.screen, webp, [84, 74], "image/webp");
  if (kind === "computer") {
    // From the page, not its first screen: a card is taller (4:3) than a computer's screen.
    await add("card", await cut(shot.full, CARD_SIZE, CARD_SIZE.width / CARD_SIZE.height), webp, [84, 74], "image/webp");
    await add("share", await cut(shot.full, SHARE_SIZE, SHARE_SIZE.width / SHARE_SIZE.height), jpeg, [85, 75], "image/jpeg");
    // The product part at twice the pixels, which the close-up highlight is drawn from (step 2).
    if (shot.detail) await add("detail", shot.detail, webp, [86, 76], "image/webp");
  }
  return out;
}
