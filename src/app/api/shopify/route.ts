import { NextResponse, type NextRequest } from "next/server";

/**
 * The address Shopify opens when a merchant opens Kaizena Flow's app from their Shopify admin (`application_url` in
 * `shopify/shopify.app.toml`, D445 step 2). Connecting starts on the store's own Moving in page, where Kaizena Flow knows which store it is
 * for; this sends the merchant to the admin to choose it. Nothing is read from the request.
 */
export function GET(request: NextRequest) {
  const response = NextResponse.redirect(new URL("/admin", request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
