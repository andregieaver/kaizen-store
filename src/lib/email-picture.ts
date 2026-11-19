import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Pictures in emails as every mail program shows them (D332): the media library keeps WebP and AVIF, which Outlook and older mail apps do not
 * show, so an email names its picture through `/api/email-picture`, which serves it as a PNG at the size the email draws it. Only addresses
 * Kaizena Flow signed are served (`signEmailPicture()`), as with Gravatar (D97), so the route is no open converter for anyone's pictures.
 */

/** The widths an email may ask for, in pixels: twice what it draws, for sharp screens. */
export const EMAIL_PICTURE_WIDTHS = [64, 112, 128, 256, 400, 512, 1024] as const;

function keyOf(secret: Buffer): Buffer {
  return createHmac("sha256", secret).update("kaizen:email-picture").digest();
}

/** The signature of a picture's address at a width, cut square or not (a person's picture is). */
export function signEmailPicture(url: string, width: number, secret: Buffer, square = false): string {
  return createHmac("sha256", keyOf(secret)).update(`${width}\n${square ? "square" : "whole"}\n${url}`).digest("base64url").slice(0, 22);
}

export function emailPictureSignatureOk(url: string, width: number, signature: string, secret: Buffer, square = false): boolean {
  const expected = Buffer.from(signEmailPicture(url, width, secret, square));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** The nearest allowed width at or above `wanted` (the largest past them). */
export function emailPictureWidth(wanted: number): number {
  return EMAIL_PICTURE_WIDTHS.find((width) => width >= wanted) ?? EMAIL_PICTURE_WIDTHS[EMAIL_PICTURE_WIDTHS.length - 1];
}

/**
 * The address an email uses for a picture: through the converter on `origin` (Kaizena Flow's own site) when the picture is WebP, AVIF or
 * another kind mail programs may not show and a key is set; a PNG, JPEG or GIF as it is. Null for anything but a full https address.
 */
export function emailPictureUrl(
  url: string | null | undefined,
  wanted: number,
  origin: string,
  secret: Buffer | null,
  /** Cut to a square in the middle: a person's picture, which mail programs that ignore CSS would otherwise stretch. */
  square = false,
): string | null {
  if (!url || !/^https:\/\//.test(url)) return null;
  if ((!square && /\.(png|jpe?g|gif)(\?|$)/i.test(new URL(url).pathname)) || !secret) return url;
  const width = emailPictureWidth(wanted);
  const query = new URLSearchParams({ u: url, w: String(width), ...(square ? { s: "1" } : {}), k: signEmailPicture(url, width, secret, square) });
  return `${origin.replace(/\/$/, "")}/api/email-picture?${query}`;
}
