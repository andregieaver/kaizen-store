/**
 * Reading a review's picture from its bytes (D301 G4, `docs/wave-5-marketing.md` 9.7), pure: what kind of file it is and its size in pixels,
 * from the file's own header, never from a name or a type the browser claims. WebP (lossy, lossless or extended) and JPEG; anything else, a
 * cut-off file or a header that disagrees with its length is null. No zod and no server imports, so the review form shares the limits.
 */

import {
  REVIEW_PICTURE_BYTES,
  REVIEW_PICTURE_SIZE,
  REVIEW_PICTURES_MAX,
  REVIEW_THUMB_BYTES,
  REVIEW_THUMB_SIZE,
  type ReviewPictureType,
} from "./review-status";

export type PictureFacts = { type: ReviewPictureType; width: number; height: number };

const ascii = (b: Uint8Array, at: number, text: string) => [...text].every((c, i) => b[at + i] === c.charCodeAt(0));
const le16 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8);
const le24 = (b: Uint8Array, at: number) => b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
const le32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const be16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];

function webp(b: Uint8Array): PictureFacts | null {
  if (b.length < 30 || !ascii(b, 0, "RIFF") || !ascii(b, 8, "WEBP")) return null;
  // The RIFF size is the file less its first eight bytes (a writer may pad one byte).
  const riff = le32(b, 4);
  if (riff + 8 !== b.length && riff + 9 !== b.length) return null;
  let width: number;
  let height: number;
  if (ascii(b, 12, "VP8 ")) {
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    width = le16(b, 26) & 0x3fff;
    height = le16(b, 28) & 0x3fff;
  } else if (ascii(b, 12, "VP8L")) {
    if (b[20] !== 0x2f) return null;
    width = 1 + (b[21] | ((b[22] & 0x3f) << 8));
    height = 1 + ((b[22] >> 6) | (b[23] << 2) | ((b[24] & 0x0f) << 10));
  } else if (ascii(b, 12, "VP8X")) {
    width = 1 + le24(b, 24);
    height = 1 + le24(b, 27);
  } else return null;
  return width > 0 && height > 0 ? { type: "image/webp", width, height } : null;
}

/** The start-of-frame markers that carry a JPEG's size (not DHT C4, JPG C8 or DAC CC). */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function jpeg(b: Uint8Array): PictureFacts | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8 || b[b.length - 2] !== 0xff || b[b.length - 1] !== 0xd9) return null;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    const length = be16(b, at + 2);
    if (length < 2) return null;
    if (SOF.has(marker)) {
      const height = be16(b, at + 5);
      const width = be16(b, at + 7);
      return width > 0 && height > 0 ? { type: "image/jpeg", width, height } : null;
    }
    at += 2 + length;
  }
  return null;
}

/** A picture's kind and size from its bytes, or null for anything that is not a whole WebP or JPEG. */
export function readPicture(bytes: Uint8Array): PictureFacts | null {
  return webp(bytes) ?? jpeg(bytes);
}

export type PictureUpload = { full: Uint8Array; thumb: Uint8Array };
export type CheckedPicture = PictureFacts & { full: Uint8Array; thumb: Uint8Array };

/**
 * A picture and its small copy as the server takes them (9.7): both read from their bytes, of the same kind, the picture at most
 * `REVIEW_PICTURE_BYTES` and `REVIEW_PICTURE_SIZE` pixels on each side, the small copy at most `REVIEW_THUMB_BYTES` and `REVIEW_THUMB_SIZE`.
 */
export function checkPicture(upload: PictureUpload): CheckedPicture | null {
  if (upload.full.byteLength > REVIEW_PICTURE_BYTES || upload.thumb.byteLength > REVIEW_THUMB_BYTES) return null;
  const full = readPicture(upload.full);
  const thumb = readPicture(upload.thumb);
  if (!full || !thumb || full.type !== thumb.type) return null;
  if (full.width > REVIEW_PICTURE_SIZE || full.height > REVIEW_PICTURE_SIZE) return null;
  if (thumb.width > REVIEW_THUMB_SIZE || thumb.height > REVIEW_THUMB_SIZE) return null;
  return { ...full, full: upload.full, thumb: upload.thumb };
}

/** What a review's pictures are after an edit: the ones kept (of those it had) and the new ones, never more than three. */
export function pictureChange(had: readonly string[], keep: readonly string[] | null, adding: number): { kept: string[]; removed: string[] } | null {
  const kept = keep === null ? [...had] : had.filter((id) => keep.includes(id));
  if (kept.length + adding > REVIEW_PICTURES_MAX) return null;
  return { kept, removed: had.filter((id) => !kept.includes(id)) };
}

export const pictureExtension = (type: ReviewPictureType) => (type === "image/webp" ? "webp" : "jpg");

/** Where a picture and its small copy are kept in the `review-pictures` bucket: `{store}/{id}.{ext}` and `{store}/{id}-480.{ext}`. */
export const picturePaths = (storeId: string, id: string, type: ReviewPictureType) => {
  const ext = pictureExtension(type);
  return { full: `${storeId}/${id}.${ext}`, thumb: `${storeId}/${id}-${REVIEW_THUMB_SIZE}.${ext}` };
};

/** The picture id a stored file belongs to, or null for a name the bucket should not hold. */
export function pictureIdOfFile(name: string): string | null {
  const m = new RegExp(`^([0-9a-f-]{36})(?:-${REVIEW_THUMB_SIZE})?\\.(webp|jpg)$`).exec(name);
  return m ? m[1] : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The pictures a review form sent (9.7): each new picture as `picture` with its small copy as `thumb` at the same place, and the review's own it
 * keeps as `keep` (only when the form showed them, `pictures` = `shown`; otherwise it keeps them all). Null for a form that does not add up.
 */
export async function picturesOfForm(form: FormData): Promise<{ add: PictureUpload[]; keep: string[] | null } | null> {
  const files = form.getAll("picture");
  const thumbs = form.getAll("thumb");
  if (files.length !== thumbs.length || files.length > REVIEW_PICTURES_MAX) return null;
  const add: PictureUpload[] = [];
  for (const [i, file] of files.entries()) {
    const thumb = thumbs[i];
    if (typeof file === "string" || typeof thumb === "string") return null;
    add.push({ full: new Uint8Array(await file.arrayBuffer()), thumb: new Uint8Array(await thumb.arrayBuffer()) });
  }
  const keep = form.get("pictures") === "shown" ? form.getAll("keep").filter((v): v is string => typeof v === "string" && UUID.test(v)) : null;
  return { add, keep };
}
