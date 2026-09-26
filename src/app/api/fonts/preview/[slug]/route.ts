import { connection } from "next/server";

import { fontPreview } from "@/server/fonts";

/** A family's name in itself, for the font picker (D59), passed on from Google so the browser never contacts it. */
export async function GET(_request: Request, { params }: RouteContext<"/api/fonts/preview/[slug]">) {
  await connection();
  const data = await fontPreview((await params).slug);
  if (!data) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": "font/woff2", "Cache-Control": "public, max-age=2592000, s-maxage=31536000" },
  });
}
