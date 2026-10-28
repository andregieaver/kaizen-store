import { NextResponse, type NextRequest } from "next/server";

import { GOOGLE_STATE_COOKIE, GOOGLE_STATE_PATH } from "@/lib/google-sign-in";
import { finishGoogle } from "@/server/google-sign-in";

/**
 * Google's return (D375): checked against this browser's state cookie, the code exchanged and the ID token checked by `finishGoogle()`,
 * then the hand-over to the store's own host or the store's form with why not. The cookie is spent either way.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const to = await finishGoogle({ code: params.get("code"), state: params.get("state"), cookie: request.cookies.get(GOOGLE_STATE_COOKIE)?.value });
  const response = NextResponse.redirect(to, 303);
  response.cookies.set(GOOGLE_STATE_COOKIE, "", { httpOnly: true, path: GOOGLE_STATE_PATH, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
