import "server-only";

import sharp from "sharp";

import { AiError, generateImage, type AiConnection, type ImageShape } from "./ai";
import { storePicture } from "./media-library";

/**
 * Pictures made by the site's AI (D92), kept as the site's own: the
 * model's picture, whatever its format, shrunk as the browser shrinks
 * uploads (WebP, at most 1600 pixels wide, and a 480-pixel copy), stored in
 * the site's folder and kept in the media library with its alt text, so
 * it is found, described in the other languages and used like any upload.
 */

/** As the browser's uploads (`ImageUploadButton`). */
const WIDTH = 1600;
const THUMBNAIL_WIDTH = 480;

export type MadePicture = { url: string; thumbnailUrl: string; width: number; height: number };

/** A model's picture as the pair the site keeps. */
export async function shrinkPicture(bytes: Uint8Array): Promise<{ image: Buffer; thumbnail: Buffer; width: number; height: number }> {
  const source = sharp(bytes, { failOn: "error" }).rotate();
  const [image, thumbnail] = await Promise.all([
    source.clone().resize({ width: WIDTH, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true }),
    source.clone().resize({ width: THUMBNAIL_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
  ]);
  return { image: image.data, thumbnail, width: image.info.width, height: image.info.height };
}

/** A file name from a picture's alt text: `ai-bright-shop-with-plants.webp`. */
export function pictureFileName(alt: string): string {
  const words = alt
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
  return `ai-${words || "picture"}.webp`;
}

/**
 * Makes a picture from a description with the site's picture model and
 * keeps it in the owner's library with its alt text. Throws `AiError` when
 * the model cannot; a problem storing it comes back as a problem.
 */
export async function makePicture(
  connection: AiConnection,
  owner: { storeId: string | null; accountId: string },
  request: { prompt: string; alt: string; shape: ImageShape },
): Promise<{ ok: true; picture: MadePicture } | { ok: false; problem: string }> {
  const { bytes } = await generateImage(connection, request.prompt, { shape: request.shape });
  let shrunk: Awaited<ReturnType<typeof shrinkPicture>>;
  try {
    shrunk = await shrinkPicture(bytes);
  } catch {
    throw new AiError("The provider's picture could not be read.");
  }
  const name = pictureFileName(request.alt);
  const stored = await storePicture(
    owner,
    new File([new Uint8Array(shrunk.image)], name, { type: "image/webp" }),
    new File([new Uint8Array(shrunk.thumbnail)], name.replace(/\.webp$/, "-480.webp"), { type: "image/webp" }),
    { fileName: name, alt: request.alt },
  );
  if (!stored.ok) return { ok: false, problem: stored.problem };
  return { ok: true, picture: { url: stored.url, thumbnailUrl: stored.thumbnailUrl, width: shrunk.width, height: shrunk.height } };
}

/** A small copy of a test picture as a `data:` address, shown in the admin and not kept. */
export async function testPicture(connection: AiConnection): Promise<{ ok: true; dataUrl: string; ms: number } | { ok: false; message: string }> {
  if (!connection.image) return { ok: false, message: "No picture model is set." };
  const started = Date.now();
  try {
    const { bytes } = await generateImage(connection, "A small ceramic coffee cup on a light wooden table, soft daylight, simple product photo.", {
      shape: "square",
    });
    const small = await sharp(bytes).resize({ width: 256 }).webp({ quality: 70 }).toBuffer();
    return { ok: true, dataUrl: `data:image/webp;base64,${small.toString("base64")}`, ms: Date.now() - started };
  } catch (error) {
    return { ok: false, message: error instanceof AiError ? `${error.status ? `${error.status}: ` : ""}${error.message}` : "The picture could not be made." };
  }
}
