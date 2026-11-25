import { NextResponse, type NextRequest } from "next/server";

import { safeBack } from "@/lib/canva";
import { sameSite } from "@/lib/same-site";
import { getAccount } from "@/server/auth";
import { disconnectCanva } from "@/server/canva";

/** *Disconnect* Canva (D898): a form posted from the admin itself by the person whose connection it is; back to the page it came from. */
export async function POST(request: NextRequest) {
  if (!sameSite(request)) return new Response("Forbidden", { status: 403 });
  const account = await getAccount();
  if (!account) return NextResponse.redirect(new URL("/admin/sign-in", request.nextUrl.origin), 303);
  const back = safeBack((await request.formData().catch(() => null))?.get("back"));
  await disconnectCanva(account.id);
  const response = NextResponse.redirect(new URL(back, request.nextUrl.origin), 303);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
