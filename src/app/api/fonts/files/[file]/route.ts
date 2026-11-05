import { connection } from "next/server";

import { fontFile } from "@/server/fonts";

/**
 * A self-hosted font file (D59), named by a hash of the file Google sent, so it can be kept for good: a variable family's is later cut to
 * the weights it is installed in (`trimFontFiles()`), which draws the same, so a browser that kept the whole file is not wrong.
 */
export async function GET(_request: Request, { params }: RouteContext<"/api/fonts/files/[file]">) {
  await connection();
  const data = await fontFile((await params).file);
  if (!data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "font/woff2",
      "Cache-Control": "public, max-age=31536000, immutable",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
