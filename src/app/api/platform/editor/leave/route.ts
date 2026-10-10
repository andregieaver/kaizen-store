import { connection, NextResponse } from "next/server";

import { endedPassCookie } from "@/server/edit-pass";
import { sameSite } from "@/lib/same-site";

/**
 * "Done editing" on a store's own domain (D193): the pass for changing words ends here and now instead of running out, so a shared
 * computer is not left with it. Only the site's own pages may ask.
 */
export async function POST(request: Request) {
  if (!sameSite(request)) return Response.json({ ok: false }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  await connection();
  const secure = (request.headers.get("x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "")) === "https";
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  response.cookies.set(endedPassCookie(secure));
  return response;
}
