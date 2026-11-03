import { NextResponse, type NextRequest } from "next/server";

import { SHOPIFY_STATE_COOKIE, SHOPIFY_STATE_PATH } from "@/lib/shopify";
import { finishShopifyConnect } from "@/server/shopify-connect";

/**
 * Shopify's return after the owner approves Kaizena Flow's app (D445 step 2): checked against this browser's state cookie and Shopify's
 * HMAC, the code exchanged and the tokens kept by `finishShopifyConnect()`, then back to the store's Moving in page with the outcome. The
 * cookie is spent either way.
 */
export async function GET(request: NextRequest) {
  const to = await finishShopifyConnect(request.nextUrl.searchParams, request.cookies.get(SHOPIFY_STATE_COOKIE)?.value);
  const response = NextResponse.redirect(new URL(to, request.nextUrl.origin), 303);
  response.cookies.set(SHOPIFY_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: SHOPIFY_STATE_PATH, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
