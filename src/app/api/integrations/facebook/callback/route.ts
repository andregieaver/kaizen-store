import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireAccount } from "@/server/auth";
import { FACEBOOK_COOKIE, FACEBOOK_COOKIE_PATH, FacebookError, connectFacebook, facebookStarted } from "@/server/facebook-pages";
import { log } from "@/server/log";
import { checkPermission } from "@/server/permissions";

/** Back from Facebook with the Pages the owner shared (D870 S1.2b), to the store's Social posts. */
export async function GET(request: Request) {
  const account = await requireAccount();
  const jar = await cookies();
  const cookie = jar.get(FACEBOOK_COOKIE)?.value;
  jar.delete({ name: FACEBOOK_COOKIE, path: FACEBOOK_COOKIE_PATH });
  const params = new URL(request.url).searchParams;
  let started: { store: string; accountId: string };
  try {
    started = facebookStarted(cookie, params);
  } catch {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  const back = (status: string) => NextResponse.redirect(new URL(`/admin/${started.store}/social?facebook=${status}#social-facebook`, request.url));
  if (started.accountId !== account.id) return back("failed");
  const member = await checkPermission(started.store, "marketing:write", "social");
  if (!member) return back("failed");
  try {
    const { choose } = await connectFacebook(account.id, member.store.id, params);
    return back(choose.length > 0 ? "choose" : "connected");
  } catch (error) {
    if (!(error instanceof FacebookError)) log("error", "facebook.connect_failed", {}, error);
    return back(error instanceof FacebookError && error.reason === "cancelled" ? "cancelled" : error instanceof FacebookError && error.message.startsWith("No Facebook Page") ? "nopage" : "failed");
  }
}
