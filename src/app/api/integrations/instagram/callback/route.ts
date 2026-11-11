import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { platformCan, requireAccount } from "@/server/auth";
import { INSTAGRAM_COOKIE, INSTAGRAM_COOKIE_PATH, InstagramError, PLATFORM_INSTAGRAM, connectInstagram, instagramStarted } from "@/server/instagram";
import { log } from "@/server/log";
import { checkPermission } from "@/server/permissions";

/** Back from Instagram with the account the owner signed in with (D560): a store's, or Kaizena Flow's own for a platform admin. */
export async function GET(request: Request) {
  const account = await requireAccount();
  const jar = await cookies();
  const cookie = jar.get(INSTAGRAM_COOKIE)?.value;
  jar.delete({ name: INSTAGRAM_COOKIE, path: INSTAGRAM_COOKIE_PATH });
  const params = new URL(request.url).searchParams;
  let started: { owner: string; accountId: string };
  try {
    started = instagramStarted(cookie, params);
  } catch {
    return NextResponse.redirect(new URL("/admin", request.url));
  }
  const platform = started.owner === PLATFORM_INSTAGRAM;
  const page = platform ? "/admin/platform/instagram" : `/admin/${started.owner}/integrations/instagram`;
  const back = (status: string) => NextResponse.redirect(new URL(`${page}?instagram=${status}`, request.url));
  if (started.accountId !== account.id) return back("failed");
  let storeId: string | null = null;
  if (platform) {
    if (!platformCan(account, "settings")) return back("failed");
  } else {
    const member = await checkPermission(started.owner, "settings:write");
    if (!member) return back("failed");
    storeId = member.store.id;
  }
  try {
    await connectInstagram(account.id, storeId, params);
  } catch (error) {
    if (!(error instanceof InstagramError)) log("error", "instagram.connect_failed", { platform }, error);
    return back(error instanceof InstagramError && error.reason === "cancelled" ? "cancelled" : "failed");
  }
  return back("connected");
}
