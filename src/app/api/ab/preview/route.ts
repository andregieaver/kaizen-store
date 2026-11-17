import { connection, NextResponse } from "next/server";

import { PREVIEW_COOKIE, PREVIEW_COOKIE_SECONDS, previewCookieValue } from "@/lib/ab-preview";
import { MARKER_COOKIE } from "@/lib/experiments";
import { openPreview } from "@/server/ab-preview";

/**
 * A preview link of an A/B test's version (D148 phase 20): keeps the link's signed token in `kaizen_ab_preview` for a day, with the marker that
 * lets the proxy look, and goes to where the version is seen. A link whose test has stopped goes to the store's front door and keeps nothing; one
 * that is not good is a 404. Never indexed, never cached.
 */
export async function GET(request: Request) {
  await connection();
  const token = new URL(request.url).searchParams.get("t");
  const opened = await openPreview(token);
  if (!opened) return new Response("This preview link is not valid.", { status: 404, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
  const response = NextResponse.redirect(new URL(opened.to, request.url), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("X-Robots-Tag", "noindex, nofollow");
  const options = { httpOnly: false, sameSite: "lax" as const, path: "/", secure: process.env.NODE_ENV === "production" };
  if (opened.keep && token) {
    response.cookies.set(PREVIEW_COOKIE, previewCookieValue(opened.experiment, token), { ...options, maxAge: PREVIEW_COOKIE_SECONDS });
    // The marker lets the proxy look; an enrolled visitor's own (90 days) is left as it is.
    if (!request.headers.get("cookie")?.split(/;\s*/).some((c) => c.startsWith(`${MARKER_COOKIE}=`))) {
      response.cookies.set(MARKER_COOKIE, "1", { ...options, maxAge: PREVIEW_COOKIE_SECONDS });
    }
  } else {
    response.cookies.set(PREVIEW_COOKIE, "", { ...options, maxAge: 0 });
  }
  return response;
}
