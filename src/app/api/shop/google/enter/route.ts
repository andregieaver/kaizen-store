import { NextResponse, type NextRequest } from "next/server";

import { enterGoogle } from "@/server/google-sign-in";

/**
 * The hand-over of *Sign in with Google* on the store's own host (D375): a one-time link two minutes long, made by the callback for the
 * store's account and followed by the same browser at once. The session is started here, so its cookie is this host's; the browser goes on
 * to the account's page, or back to the form when the link was used, over or another store's. Never cached, never sent on as a referrer.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const path = await enterGoogle(params.get("s"), params.get("m"), params.get("t"));
  const response = NextResponse.redirect(new URL(path, request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
