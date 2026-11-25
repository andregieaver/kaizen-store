import { NextResponse, type NextRequest } from "next/server";

import { canvaReturned } from "@/server/canva";

/**
 * Canva's *Return* button (D898): the JWT Canva signs is checked by `canvaReturned()`, and the person goes to the media library the edit
 * came from, which brings the design back. Never cached, and the JWT is never sent on in a referrer.
 */
export async function GET(request: NextRequest) {
  const to = await canvaReturned(request.nextUrl.searchParams);
  const response = NextResponse.redirect(new URL(to, request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
