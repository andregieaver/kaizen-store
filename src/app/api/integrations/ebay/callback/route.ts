import { NextResponse, type NextRequest } from "next/server";

import { EBAY_STATE_COOKIE, EBAY_STATE_PATH, finishEbayConnect } from "@/server/ebay";

/**
 * eBay's return after the owner allows Kaizena Flow's app (D555): checked against this browser's state cookie, the code exchanged and the grant
 * kept by `finishEbayConnect()`, then back to the store's eBay page with the outcome. The cookie is spent either way; never cached, and eBay's
 * code is never sent on in a referrer.
 */
export async function GET(request: NextRequest) {
  const to = await finishEbayConnect(request.nextUrl.searchParams, request.cookies.get(EBAY_STATE_COOKIE)?.value);
  const response = NextResponse.redirect(new URL(to, request.nextUrl.origin), 303);
  response.cookies.set(EBAY_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: EBAY_STATE_PATH, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
