import { connection } from "next/server";

import { EMAIL_PICTURE_WIDTHS, emailPictureSignatureOk } from "@/lib/email-picture";
import { parseKey } from "@/lib/secret-box";
import { log } from "@/server/log";
import { loadSharp } from "@/server/sharp-load";

/**
 * A picture for an email, as a PNG at the width the email asks (D332, `src/lib/email-picture.ts`): WebP and AVIF from the media library
 * become what every mail program shows; a person's picture (`s=1`) is cut square, as mail programs that ignore CSS draw it. Only addresses Kaizena Flow signed; at most 8 MB in, and the CDN keeps the answer.
 */
export const maxDuration = 20;

const MAX_BYTES = 8 * 1024 * 1024;

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  await connection();
  const params = new URL(request.url).searchParams;
  const url = params.get("u") ?? "";
  const width = Number(params.get("w"));
  const square = params.get("s") === "1";
  const key = parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
  if (!key || !/^https:\/\//.test(url) || !(EMAIL_PICTURE_WIDTHS as readonly number[]).includes(width) || !emailPictureSignatureOk(url, width, params.get("k") ?? "", key, square)) {
    return notFound();
  }
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(8000), cache: "no-store" });
    const type = response.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!response.ok || !type.startsWith("image/")) return notFound();
    const body = Buffer.from(await response.arrayBuffer());
    if (body.byteLength > MAX_BYTES) return notFound();
    const sharp = await loadSharp();
    const png = await sharp(body, { limitInputPixels: 40_000_000 }).rotate().resize(square ? { width, height: width, fit: "cover", position: "attention" } : { width, withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
    return new Response(new Uint8Array(png), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=86400, s-maxage=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    log("warn", "email_picture.failed", {}, error);
    return new Response("Unavailable", { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
