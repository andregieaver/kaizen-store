import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { audit, requireAccount } from "@/server/auth";
import { isOwner } from "@/server/kaizen-life";
import { LINK_COOKIE, linkFinish, LifeLinkError } from "@/server/kaizen-life-link";

/** Back from Kaizen Life's OAuth server with the owner's permission for the assistant (D96). */
export async function GET(request: Request) {
  const account = await requireAccount();
  const jar = await cookies();
  const cookie = jar.get(LINK_COOKIE)?.value;
  jar.delete({ name: LINK_COOKIE, path: "/admin/account/kaizen-life" });
  const back = (status: string) => NextResponse.redirect(new URL(`/admin/account?life-assistant=${status}`, request.url));
  if (!(await isOwner(account))) return back("failed");
  try {
    await linkFinish(account.id, cookie, new URL(request.url).searchParams);
  } catch (error) {
    if (!(error instanceof LifeLinkError)) console.error("[kaizen-life-link]", error);
    return back("failed");
  }
  await audit(account.id, null, "account.kaizen_life_assistant_connected");
  return back("connected");
}
