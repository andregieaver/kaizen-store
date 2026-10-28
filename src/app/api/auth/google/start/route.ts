import { NextResponse, type NextRequest } from "next/server";

import { GOOGLE_STATE_COOKIE, GOOGLE_STATE_MINUTES, GOOGLE_STATE_PATH } from "@/lib/google-sign-in";
import { siteUrl } from "@/lib/site";
import { startGoogle } from "@/server/google-sign-in";

/**
 * A store's *Sign in with Google* button lands here, on Kaizena Flow's own host (D375): the request's state goes into a short HttpOnly cookie
 * and the browser to Google. A store or market that is none, a store without accounts, or Google not set up goes to Kaizena Flow's home.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const started = await startGoogle(params.get("s"), params.get("m"));
  if (!started.ok) return NextResponse.redirect(siteUrl(), 303);
  const response = NextResponse.redirect(started.url, 303);
  response.cookies.set(GOOGLE_STATE_COOKIE, started.cookie, {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax",
    path: GOOGLE_STATE_PATH,
    maxAge: GOOGLE_STATE_MINUTES * 60,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
