import { NextResponse, type NextRequest } from "next/server";

import { WALLET_STATE_COOKIE, WALLET_STATE_PATH } from "@/lib/card-wallet";
import { finishWalletConnect } from "@/server/card-wallet";

/**
 * Airwallex's return after the owner allows Kaizena Flow's partner app (D599): checked against this browser's state cookie, the code
 * exchanged and the grant kept by `finishWalletConnect()`, then back to the store's Autopilot settings with the outcome. The cookie is spent
 * either way, and the answer is never cached nor sends Airwallex's code on in a referrer.
 */
export async function GET(request: NextRequest) {
  const to = await finishWalletConnect(request.nextUrl.searchParams, request.cookies.get(WALLET_STATE_COOKIE)?.value);
  const response = NextResponse.redirect(new URL(to, request.nextUrl.origin), 303);
  response.cookies.set(WALLET_STATE_COOKIE, "", { httpOnly: true, secure: true, sameSite: "lax", path: WALLET_STATE_PATH, maxAge: 0 });
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
