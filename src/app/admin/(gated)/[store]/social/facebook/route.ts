import { NextResponse, type NextRequest } from "next/server";

import { sameSite } from "@/lib/same-site";
import { FACEBOOK_COOKIE, FACEBOOK_COOKIE_PATH, FacebookError, chooseFacebookPage, disconnectFacebook, facebookStart } from "@/server/facebook-pages";
import { log } from "@/server/log";
import { checkPermission } from "@/server/permissions";

/**
 * The Facebook Page's buttons on Social posts (D870 S1.2b), plain forms posted here (a route, so the screen adds no server action): `connect`
 * goes to Facebook Login, `choose` keeps one of the person's Pages, `disconnect` removes the Page. Each back to the page with how it went.
 */
export async function POST(request: NextRequest, { params }: RouteContext<"/admin/[store]/social/facebook">) {
  const { store } = await params;
  const member = await checkPermission(store, "marketing:write", "social");
  if (!member) return new NextResponse("Not found", { status: 404 });
  if (!sameSite(request)) return new NextResponse("Forbidden", { status: 403 });
  const form = await request.formData().catch(() => null);
  const action = form?.get("do");
  const back = (status: string) => NextResponse.redirect(new URL(`/admin/${member.store.slug}/social?facebook=${status}#social-facebook`, request.url), 303);
  if (action === "connect") {
    const start = facebookStart(member.store.slug, member.account.id);
    if (!start) return back("failed");
    const response = NextResponse.redirect(start.url, 303);
    response.cookies.set(FACEBOOK_COOKIE, start.cookie, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: FACEBOOK_COOKIE_PATH, maxAge: 600 });
    return response;
  }
  if (action === "choose") {
    const pageId = form?.get("page");
    try {
      return back(typeof pageId === "string" && (await chooseFacebookPage(member.account.id, member.store.id, pageId)) ? "connected" : "failed");
    } catch (error) {
      if (!(error instanceof FacebookError)) log("error", "facebook.choose_failed", {}, error);
      return back("failed");
    }
  }
  if (action === "disconnect") {
    await disconnectFacebook(member.account.id, member.store.id);
    return back("disconnected");
  }
  return back("failed");
}
