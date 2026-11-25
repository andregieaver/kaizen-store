import { NextResponse, type NextRequest } from "next/server";

import { CANVA_STATE_COOKIE, CANVA_STATE_MINUTES, CANVA_STATE_PATH, safeBack } from "@/lib/canva";
import { sameSite } from "@/lib/same-site";
import { getAccount } from "@/server/auth";
import { startCanvaConnect } from "@/server/canva";

/**
 * *Connect Canva* (D898): a form posted from the admin itself (`sameSite()`) by someone signed in. The person's own connection, so any signed-in
 * person may start one; it seals the state cookie for the callback and sends the browser to Canva's consent page. `back` (an admin page,
 * `safeBack()`) is where the callback returns.
 */
export async function POST(request: NextRequest) {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account) return NextResponse.redirect(new URL("/admin/sign-in", request.nextUrl.origin), 303);
  const back = safeBack((await request.formData().catch(() => null))?.get("back"));
  const start = startCanvaConnect(account.id, back);
  if (!start.ok) return NextResponse.redirect(new URL(`${back}?canva=failed`, request.nextUrl.origin), 303);
  const response = NextResponse.redirect(start.url, 303);
  response.cookies.set(CANVA_STATE_COOKIE, start.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: CANVA_STATE_PATH, maxAge: CANVA_STATE_MINUTES * 60 });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
