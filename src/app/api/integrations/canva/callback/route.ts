import { NextResponse, type NextRequest } from "next/server";

import { CANVA_STATE_COOKIE, CANVA_STATE_PATH } from "@/lib/canva";
import { getAccount } from "@/server/auth";
import { finishCanvaConnect } from "@/server/canva";

/**
 * Canva's return after a person allows Kaizena Flow's integration (D898): checked against this browser's state cookie and the person signed in
 * now, the code spent and the tokens kept by `finishCanvaConnect()`, then back to the admin page the connect started from. The cookie is spent
 * either way; never cached, and Canva's code is never sent on in a referrer.
 */
export async function GET(request: NextRequest) {
  const account = await getAccount();
  const to = await finishCanvaConnect(request.nextUrl.searchParams, request.cookies.get(CANVA_STATE_COOKIE)?.value, account?.id ?? null);
  const response = NextResponse.redirect(new URL(to, request.nextUrl.origin), 303);
  response.cookies.set(CANVA_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: CANVA_STATE_PATH, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
