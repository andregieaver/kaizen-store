import type { NextRequest } from "next/server";

import { canvaThumbnail } from "@/server/canva";

/**
 * A Canva design's thumbnail in *Import from Canva* (D898), through the site so the admin's pages load pictures only from their own hosts:
 * only an address this server signed in the last quarter of an hour, read only from Canva's file hosts.
 */
export async function GET(request: NextRequest) {
  const picture = await canvaThumbnail(request.nextUrl.searchParams);
  if (!picture) return new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
  return new Response(new Uint8Array(picture.bytes), {
    headers: { "Content-Type": picture.type, "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" },
  });
}
