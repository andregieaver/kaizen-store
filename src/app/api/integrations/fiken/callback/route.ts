import { NextResponse, type NextRequest } from "next/server";

import { FIKEN_STATE_COOKIE, FIKEN_STATE_PATH } from "@/lib/fiken";
import { finishFikenConnect } from "@/server/fiken";

/**
 * Fiken's return after the owner allows Kaizena Flow's app (D460): checked against this browser's state cookie, the code exchanged with its
 * PKCE verifier and the grant kept by `finishFikenConnect()`, then back to the store's Fiken page with the outcome. The cookie is spent either
 * way, and the answer is never cached nor sends Fiken's code on in a referrer.
 */
export async function GET(request: NextRequest) {
  const to = await finishFikenConnect(request.nextUrl.searchParams, request.cookies.get(FIKEN_STATE_COOKIE)?.value);
  const response = NextResponse.redirect(new URL(to, request.nextUrl.origin), 303);
  response.cookies.set(FIKEN_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: FIKEN_STATE_PATH, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
